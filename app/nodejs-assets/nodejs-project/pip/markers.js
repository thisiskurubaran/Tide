// @ts-check
// Evaluates PEP 508 environment markers ("python_version >= '3.8' and sys_platform != 'win32").
'use strict';

const pep440 = require('./pep440');

const VERSION_VARS = new Set(['python_version', 'python_full_version', 'implementation_version']);

function tokenize(text) {
  const tokens = [];
  const re = /\s*(?:(\()|(\))|('[^']*'|"[^"]*")|(===|==|!=|<=|>=|~=|<|>|not\s+in\b|in\b)|(and\b|or\b)|([A-Za-z_][A-Za-z0-9_.]*))/y;
  let m;
  while (re.lastIndex < text.length && (m = re.exec(text))) {
    if (m[1]) tokens.push({ t: '(' });
    else if (m[2]) tokens.push({ t: ')' });
    else if (m[3]) tokens.push({ t: 'str', v: m[3].slice(1, -1) });
    else if (m[4]) tokens.push({ t: 'op', v: m[4].replace(/\s+/, ' ') });
    else if (m[5]) tokens.push({ t: m[5] });
    else if (m[6]) tokens.push({ t: 'var', v: m[6] });
    if (/^\s*$/.test(text.slice(re.lastIndex))) break;
  }
  return tokens;
}

/** @param {string} text @param {Record<string, string>} env */
function evaluate(text, env) {
  const tokens = tokenize(text);
  let i = 0;
  const value = (tok) => (tok.t === 'str' ? tok.v : env[tok.v] ?? '');
  function compareOp(left, op, right, versioned) {
    if (op === 'in') return right.includes(left);
    if (op === 'not in') return !right.includes(left);
    if (versioned && pep440.parse(left) && pep440.parse(right)) return pep440.satisfies(left, `${op}${right}`);
    if (op === '==' || op === '===') return left === right;
    if (op === '!=') return left !== right;
    return false;
  }
  function atom() {
    const tok = tokens[i++];
    if (!tok) return false;
    if (tok.t === '(') {
      const v = or();
      i++;
      return v;
    }
    const op = tokens[i++];
    const right = tokens[i++];
    if (!op || !right) return false;
    const versioned = VERSION_VARS.has(tok.v) || VERSION_VARS.has(right.v);
    const l = value(tok);
    const r = value(right);
    // "extra" compares normalized names.
    if (tok.v === 'extra' || right.v === 'extra') return compareOp(l.toLowerCase(), op.v, r.toLowerCase(), false);
    return compareOp(l, op.v, r, versioned);
  }
  function and() {
    let v = atom();
    while (tokens[i] && tokens[i].t === 'and') {
      i++;
      const r = atom();
      v = v && r;
    }
    return v;
  }
  function or() {
    let v = and();
    while (tokens[i] && tokens[i].t === 'or') {
      i++;
      const r = and();
      v = v || r;
    }
    return v;
  }
  return or();
}

/** Marker environment for the embedded interpreter on this device. */
function deviceEnv(platform = process.platform) {
  const android = platform === 'android';
  return {
    python_version: '3.15',
    python_full_version: '3.15.2',
    implementation_name: 'cpython',
    implementation_version: '3.15.2',
    platform_python_implementation: 'CPython',
    os_name: 'posix',
    sys_platform: android ? 'android' : 'ios',
    platform_system: android ? 'Android' : 'iOS',
    platform_machine: 'arm64',
    extra: '',
  };
}

module.exports = { evaluate, deviceEnv };
