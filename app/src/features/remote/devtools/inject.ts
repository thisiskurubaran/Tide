// Runs in the previewed page before its own scripts: forwards console
// output, uncaught errors and fetch/XHR requests to the app, and evaluates
// expressions typed in the console. Kept as plain ES5-ish code in a string,
// since it runs in whatever page the server returns.
export const DEVTOOLS_SCRIPT = String.raw`(function () {
  if (window.__tideDevtools) return;
  window.__tideDevtools = true;
  var bridge = window.ReactNativeWebView;
  function post(msg) {
    msg.__tide = true;
    msg.time = Date.now();
    try { bridge && bridge.postMessage(JSON.stringify(msg)); } catch (e) {}
  }
  function show(v, depth, seen) {
    depth = depth || 0;
    seen = seen || [];
    if (v === undefined) return 'undefined';
    if (v === null) return 'null';
    var t = typeof v;
    if (t === 'string') return depth ? JSON.stringify(v) : v;
    if (t === 'number' || t === 'boolean' || t === 'bigint' || t === 'symbol') return String(v);
    if (t === 'function') return 'ƒ ' + (v.name || 'anonymous') + '()';
    if (v instanceof Error) return (v.stack || (v.name + ': ' + v.message));
    if (typeof Element !== 'undefined' && v instanceof Element) {
      return '<' + v.tagName.toLowerCase() + (v.id ? '#' + v.id : '') + (v.className && typeof v.className === 'string' ? '.' + v.className.trim().split(/\s+/).join('.') : '') + '>';
    }
    if (seen.indexOf(v) !== -1) return '[Circular]';
    if (depth > 3) return Array.isArray(v) ? '[…]' : '{…}';
    seen = seen.concat([v]);
    try {
      if (Array.isArray(v)) {
        var items = v.slice(0, 100).map(function (x) { return show(x, depth + 1, seen); });
        return '[' + items.join(', ') + (v.length > 100 ? ', … ' + (v.length - 100) + ' more' : '') + ']';
      }
      var keys = Object.keys(v);
      var parts = keys.slice(0, 50).map(function (k) { return k + ': ' + show(v[k], depth + 1, seen); });
      var name = v.constructor && v.constructor.name && v.constructor.name !== 'Object' ? v.constructor.name + ' ' : '';
      return name + '{' + parts.join(', ') + (keys.length > 50 ? ', …' : '') + '}';
    } catch (e) {
      return String(v);
    }
  }
  ['log', 'info', 'warn', 'error', 'debug'].forEach(function (level) {
    var original = console[level];
    console[level] = function () {
      var args = Array.prototype.slice.call(arguments);
      post({ kind: 'console', level: level, text: args.map(function (a) { return show(a); }).join(' ').slice(0, 10000) });
      return original && original.apply(console, arguments);
    };
  });
  window.addEventListener('error', function (e) {
    post({ kind: 'console', level: 'error', text: (e.error && e.error.stack) || e.message, source: e.filename ? e.filename + ':' + e.lineno : undefined });
  });
  window.addEventListener('unhandledrejection', function (e) {
    post({ kind: 'console', level: 'error', text: 'Unhandled rejection: ' + show(e.reason) });
  });

  var nextId = 0;
  if (window.fetch) {
    var fetch0 = window.fetch;
    window.fetch = function (input, init) {
      var id = 'f' + (++nextId);
      var url = typeof input === 'string' ? input : (input && input.url) || String(input);
      var method = ((init && init.method) || (input && input.method) || 'GET').toUpperCase();
      var start = Date.now();
      post({ kind: 'net', phase: 'start', id: id, method: method, url: new URL(url, location.href).href, type: 'fetch' });
      return fetch0.apply(this, arguments).then(function (res) {
        var size = res.headers.get('content-length');
        post({ kind: 'net', phase: 'end', id: id, status: res.status, ms: Date.now() - start, size: size ? Number(size) : null, contentType: res.headers.get('content-type') });
        return res;
      }, function (err) {
        post({ kind: 'net', phase: 'error', id: id, ms: Date.now() - start, error: String(err && err.message || err) });
        throw err;
      });
    };
  }
  var open0 = XMLHttpRequest.prototype.open;
  var send0 = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (method, url) {
    this.__tide = { id: 'x' + (++nextId), method: String(method).toUpperCase(), url: new URL(url, location.href).href };
    return open0.apply(this, arguments);
  };
  XMLHttpRequest.prototype.send = function () {
    var info = this.__tide;
    var xhr = this;
    if (info) {
      var start = Date.now();
      post({ kind: 'net', phase: 'start', id: info.id, method: info.method, url: info.url, type: 'xhr' });
      xhr.addEventListener('loadend', function () {
        if (xhr.status === 0) post({ kind: 'net', phase: 'error', id: info.id, ms: Date.now() - start, error: 'Network error' });
        else post({ kind: 'net', phase: 'end', id: info.id, status: xhr.status, ms: Date.now() - start, size: (xhr.responseText || '').length || null, contentType: xhr.getResponseHeader('content-type') });
      });
    }
    return send0.apply(this, arguments);
  };

  window.__tideEval = function (id, code) {
    function done(ok, value) {
      // A thrown error's stack is all the console's own frames; the message is what matters.
      var text = !ok && value instanceof Error ? value.name + ': ' + value.message : show(value, 1);
      post({ kind: 'eval', id: id, ok: ok, text: text });
    }
    try {
      var result = (0, eval)(code);
      if (result && typeof result.then === 'function') result.then(function (v) { done(true, v); }, function (e) { done(false, e); });
      else done(true, result);
    } catch (e) {
      done(false, e);
    }
  };
  post({ kind: 'page', url: location.href, title: document.title });
})();
true;`;

export const evalScript = (id: number, code: string) => `window.__tideEval && window.__tideEval(${id}, ${JSON.stringify(code)});true;`;
