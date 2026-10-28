#import "TidePython.h"

#include <Python/Python.h>

static NSString *const TidePythonErrorDomain = @"TidePython";
static NSString *initFailure = nil;

// Python's default secondary-thread stack on iOS is too small for deep recursion.
static const NSUInteger TideRunStackSize = 8 * 1024 * 1024;
static const double TideFlushSeconds = 0.016;

static TideOutputHandler outputHandler;
static dispatch_queue_t outputQueue;
static NSMutableArray<NSArray<NSString *> *> *pendingOutput;
static BOOL flushScheduled = NO;

static NSError *TideError(NSString *message) {
  return [NSError errorWithDomain:TidePythonErrorDomain code:1 userInfo:@{NSLocalizedDescriptionKey : message}];
}

// Merges consecutive chunks for the same run and stream, so a print loop
// becomes a few events per frame instead of one per write.
static void TideFlushOutput(void) {
  flushScheduled = NO;
  if (pendingOutput.count == 0 || !outputHandler) return;
  NSMutableArray<NSArray<NSString *> *> *merged = [NSMutableArray array];
  for (NSArray<NSString *> *chunk in pendingOutput) {
    NSArray<NSString *> *last = merged.lastObject;
    if (last && [last[0] isEqualToString:chunk[0]] && [last[1] isEqualToString:chunk[1]]) {
      merged[merged.count - 1] = @[ last[0], last[1], [last[2] stringByAppendingString:chunk[2]] ];
    } else {
      [merged addObject:chunk];
    }
  }
  [pendingOutput removeAllObjects];
  for (NSArray<NSString *> *chunk in merged) outputHandler(chunk[0], chunk[1], chunk[2]);
}

// _tide.emit(run_id, kind, text): the only native function Python calls.
static PyObject *TideEmit(PyObject *self, PyObject *args) {
  const char *runId;
  const char *kind;
  PyObject *text;
  if (!PyArg_ParseTuple(args, "ssU", &runId, &kind, &text)) return NULL;
  Py_ssize_t length;
  const char *utf8 = PyUnicode_AsUTF8AndSize(text, &length);
  if (!utf8) return NULL;
  NSString *chunk = [[NSString alloc] initWithBytes:utf8 length:length encoding:NSUTF8StringEncoding] ?: @"";
  NSArray<NSString *> *entry = @[ @(runId), @(kind), chunk ];
  dispatch_async(outputQueue, ^{
    [pendingOutput addObject:entry];
    if (!flushScheduled) {
      flushScheduled = YES;
      dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(TideFlushSeconds * NSEC_PER_SEC)), outputQueue, ^{
        TideFlushOutput();
      });
    }
  });
  Py_RETURN_NONE;
}

static PyMethodDef TideMethods[] = {
    {"emit", TideEmit, METH_VARARGS, NULL},
    {NULL, NULL, 0, NULL},
};

static struct PyModuleDef TideModule = {PyModuleDef_HEAD_INIT, "_tide", NULL, -1, TideMethods};

static PyObject *PyInit__tide(void) { return PyModule_Create(&TideModule); }

// Caller must hold the GIL.
static NSString *TideTakeException(void) {
  PyObject *exc = PyErr_GetRaisedException();
  if (exc == NULL) return @"unknown Python error";
  PyObject *text = PyObject_Str(exc);
  NSString *message = text ? @(PyUnicode_AsUTF8(text)) : @"unprintable Python error";
  Py_XDECREF(text);
  Py_DECREF(exc);
  return message;
}

static void TideStartPython(void) {
  outputQueue = dispatch_queue_create("dev.tide.python.output", DISPATCH_QUEUE_SERIAL);
  pendingOutput = [NSMutableArray array];

  NSString *home = [NSBundle.mainBundle.resourcePath stringByAppendingPathComponent:@"python"];
  NSString *tideLib = [home stringByAppendingPathComponent:@"tide"];

  if (PyImport_AppendInittab("_tide", PyInit__tide) == -1) {
    initFailure = @"Python failed to register the _tide module";
    return;
  }

  PyConfig config;
  PyConfig_InitIsolatedConfig(&config);
  config.buffered_stdio = 0;
  config.write_bytecode = 0;
  // The app owns signals; Ctrl-C arrives as KeyboardInterrupt via tide_runner.kill.
  config.install_signal_handlers = 0;

  PyStatus status = PyConfig_SetBytesString(&config, &config.home, home.UTF8String);
  if (!PyStatus_Exception(status)) status = Py_InitializeFromConfig(&config);
  PyConfig_Clear(&config);
  if (PyStatus_Exception(status)) {
    initFailure = [NSString stringWithFormat:@"Python failed to start: %s", status.err_msg ? status.err_msg : "unknown"];
    return;
  }

  PyObject *path = PySys_GetObject("path");
  PyObject *entry = PyUnicode_FromString(tideLib.UTF8String);
  if (path && entry) PyList_Insert(path, 0, entry);
  Py_XDECREF(entry);

  // Release the GIL; every call re-acquires it because GCD may use any thread.
  PyEval_SaveThread();
}

static BOOL TideEnsureStarted(NSError **error) {
  static dispatch_once_t once;
  dispatch_once(&once, ^{
    TideStartPython();
  });
  if (initFailure && error) *error = TideError(initFailure);
  return initFailure == nil;
}

static PyObject *TideStringList(NSArray<NSString *> *items) {
  PyObject *list = PyList_New((Py_ssize_t)items.count);
  for (NSUInteger i = 0; i < items.count; i++) {
    PyList_SET_ITEM(list, (Py_ssize_t)i, PyUnicode_FromString(items[i].UTF8String));
  }
  return list;
}

// Calls tide_runner.<function>(run_id[, data]) for feed, eof and kill.
static void TideCallRunner(const char *function, NSString *runId, NSString *_Nullable data) {
  if (!TideEnsureStarted(NULL)) return;
  PyGILState_STATE gil = PyGILState_Ensure();
  PyObject *module = PyImport_ImportModule("tide_runner");
  PyObject *result = NULL;
  if (module) {
    result = data ? PyObject_CallMethod(module, function, "ss", runId.UTF8String, data.UTF8String)
                  : PyObject_CallMethod(module, function, "s", runId.UTF8String);
  }
  if (!result) PyErr_Clear();
  Py_XDECREF(result);
  Py_XDECREF(module);
  PyGILState_Release(gil);
}

static NSString *_Nullable TideCallString(const char *function, NSString *_Nullable arg, NSError **error) {
  if (!TideEnsureStarted(error)) return nil;
  PyGILState_STATE gil = PyGILState_Ensure();
  NSString *output = nil;
  NSString *failure = nil;
  PyObject *module = PyImport_ImportModule("tide_runner");
  PyObject *result = NULL;
  if (module) {
    result = arg ? PyObject_CallMethod(module, function, "s", arg.UTF8String) : PyObject_CallMethod(module, function, NULL);
  }
  if (result && PyUnicode_Check(result)) {
    output = @(PyUnicode_AsUTF8(result));
  } else {
    failure = PyErr_Occurred() ? TideTakeException() : @"tide_runner returned a non-string";
  }
  Py_XDECREF(result);
  Py_XDECREF(module);
  PyGILState_Release(gil);
  if (failure && error) *error = TideError(failure);
  return output;
}

@implementation TidePython

+ (nullable NSString *)pythonVersionAndReturnError:(NSError **)error {
  return TideCallString("version", nil, error);
}

+ (nullable NSString *)runSnippet:(NSString *)code error:(NSError **)error {
  return TideCallString("snippet", code, error);
}

+ (void)setOutputHandler:(TideOutputHandler)handler {
  outputHandler = [handler copy];
}

+ (void)runWithId:(NSString *)runId
            entry:(NSString *)entry
              cwd:(NSString *)cwd
             args:(NSArray<NSString *> *)args
       extraPaths:(NSArray<NSString *> *)extraPaths
        purgeRoot:(NSString *)purgeRoot
       completion:(TideExitHandler)completion {
  NSError *error = nil;
  if (!TideEnsureStarted(&error)) {
    outputHandler(runId, @"stderr", [error.localizedDescription stringByAppendingString:@"\n"]);
    completion(1, NO);
    return;
  }
  NSThread *thread = [[NSThread alloc] initWithBlock:^{
    NSInteger code = 1;
    BOOL killed = NO;
    PyGILState_STATE gil = PyGILState_Ensure();
    PyObject *runner = PyImport_ImportModule("tide_runner");
    PyObject *tide = PyImport_ImportModule("_tide");
    PyObject *emit = tide ? PyObject_GetAttrString(tide, "emit") : NULL;
    PyObject *pyArgs = TideStringList(args);
    PyObject *pyPaths = TideStringList(extraPaths);
    PyObject *result = (runner && emit)
                           ? PyObject_CallMethod(runner, "run", "OsssOOs", emit, runId.UTF8String, entry.UTF8String,
                                                 cwd.UTF8String, pyArgs, pyPaths, purgeRoot.UTF8String)
                           : NULL;
    if (result && PyTuple_Check(result) && PyTuple_Size(result) == 2) {
      code = PyLong_AsLong(PyTuple_GetItem(result, 0));
      killed = PyObject_IsTrue(PyTuple_GetItem(result, 1)) == 1;
    } else {
      NSString *message = PyErr_Occurred() ? TideTakeException() : @"tide_runner.run returned an unexpected value";
      outputHandler(runId, @"stderr", [NSString stringWithFormat:@"Python runner failed: %@\n", message]);
    }
    Py_XDECREF(result);
    Py_XDECREF(pyPaths);
    Py_XDECREF(pyArgs);
    Py_XDECREF(emit);
    Py_XDECREF(tide);
    Py_XDECREF(runner);
    PyGILState_Release(gil);
    // Deliver the run's last output before its exit.
    dispatch_async(outputQueue, ^{
      TideFlushOutput();
      completion(code, killed);
    });
  }];
  thread.name = [@"python-run-" stringByAppendingString:runId];
  thread.stackSize = TideRunStackSize;
  [thread start];
}

+ (void)feed:(NSString *)runId data:(NSString *)data {
  TideCallRunner("feed", runId, data);
}

+ (void)endInput:(NSString *)runId {
  TideCallRunner("eof", runId, nil);
}

+ (void)kill:(NSString *)runId {
  TideCallRunner("kill", runId, nil);
}

@end
