#import "TidePython.h"

#include <Python/Python.h>

static NSString *const TidePythonErrorDomain = @"TidePython";
static NSString *initFailure = nil;

static NSError *TideError(NSString *message) {
  return [NSError errorWithDomain:TidePythonErrorDomain
                             code:1
                         userInfo:@{NSLocalizedDescriptionKey : message}];
}

// Caller must hold the GIL.
static NSString *TideTakeException(void) {
  PyObject *exc = PyErr_GetRaisedException();
  if (exc == NULL) {
    return @"unknown Python error";
  }
  PyObject *text = PyObject_Str(exc);
  NSString *message = text ? @(PyUnicode_AsUTF8(text)) : @"unprintable Python error";
  Py_XDECREF(text);
  Py_DECREF(exc);
  return message;
}

static void TideStartPython(void) {
  NSString *resources = NSBundle.mainBundle.resourcePath;
  NSString *home = [resources stringByAppendingPathComponent:@"python"];
  NSString *tideLib = [home stringByAppendingPathComponent:@"tide"];

  PyConfig config;
  PyConfig_InitIsolatedConfig(&config);
  config.buffered_stdio = 0;
  config.write_bytecode = 0;
  // The app owns signals; Ctrl-C is delivered through PyThreadState_SetAsyncExc in Phase 5.
  config.install_signal_handlers = 0;

  PyStatus status = PyConfig_SetBytesString(&config, &config.home, home.UTF8String);
  if (!PyStatus_Exception(status)) {
    status = Py_InitializeFromConfig(&config);
  }
  PyConfig_Clear(&config);
  if (PyStatus_Exception(status)) {
    initFailure = [NSString stringWithFormat:@"Python failed to start: %s",
                                             status.err_msg ? status.err_msg : "unknown"];
    return;
  }

  PyObject *path = PySys_GetObject("path");
  PyObject *entry = PyUnicode_FromString(tideLib.UTF8String);
  if (path && entry) {
    PyList_Insert(path, 0, entry);
  }
  Py_XDECREF(entry);

  // Release the GIL; every call re-acquires it because GCD may use any thread.
  PyEval_SaveThread();
}

static NSString *_Nullable TideCall(const char *function, NSString *_Nullable arg, NSError **error) {
  static dispatch_once_t once;
  dispatch_once(&once, ^{
    TideStartPython();
  });
  if (initFailure) {
    if (error) *error = TideError(initFailure);
    return nil;
  }

  PyGILState_STATE gil = PyGILState_Ensure();
  NSString *output = nil;
  NSString *failure = nil;

  PyObject *module = PyImport_ImportModule("tide_runner");
  PyObject *result = NULL;
  if (module) {
    result = arg ? PyObject_CallMethod(module, function, "s", arg.UTF8String)
                 : PyObject_CallMethod(module, function, NULL);
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
  return TideCall("version", nil, error);
}

+ (nullable NSString *)runCode:(NSString *)code error:(NSError **)error {
  return TideCall("run", code, error);
}

@end
