// @ts-check
// tide:lua — Lua 5.3 on fengari (Lua written in JavaScript, no WebAssembly).
//
//   tide:lua <file.lua> [args]
//
// fengari's io library only writes, so this adds io.read, io.lines and
// io.open (with file:read, :lines, :write, :close). Reading the terminal
// can't block a worker, so the script runs as a coroutine: io.read yields,
// the line typed in the terminal arrives on stdin, and the script resumes.
'use strict';

const fs = require('fs');
const path = require('path');
const { lua, lauxlib, lualib, to_luastring, to_jsstring } = require('./fengari');

const [file, ...args] = process.argv.slice(2);
if (!file) {
  process.stderr.write('usage: lua <file.lua> [args]\n');
  process.exit(1);
}

const L = lauxlib.luaL_newstate();
lualib.luaL_openlibs(L);

// Lines typed in the terminal, waiting to be read.
let stdinBuffer = '';
let stdinEnded = false;
/** @type {(() => void) | null} */
let wake = null;
process.stdin.setEncoding('utf8');
process.stdin.on('data', (d) => {
  stdinBuffer += d;
  wake?.();
});
process.stdin.on('end', () => {
  stdinEnded = true;
  wake?.();
});
process.stdin.pause();

/** @param {string} name @param {(T: any) => number} fn */
const def = (name, fn) => {
  lua.lua_pushcfunction(L, fn);
  lua.lua_setglobal(L, to_luastring(name));
};
// Helpers get the state they're called on: the script runs in a coroutine with its own stack.
const str = (T, i) => to_jsstring(lauxlib.luaL_checkstring(T, i));
const pushStr = (T, s) => lua.lua_pushstring(T, to_luastring(s));

def('__tide_readfile', (T) => {
  const file = str(T, 1);
  try {
    const data = fs.readFileSync(file);
    lua.lua_pushlstring(T, data, data.length);
    return 1;
  } catch (e) {
    lua.lua_pushnil(T);
    pushStr(T, `${file}: ${e.code === 'ENOENT' ? 'No such file or directory' : e.message}`);
    return 2;
  }
});
def('__tide_writefile', (T) => {
  const file = str(T, 1);
  try {
    const data = Buffer.from(lauxlib.luaL_checklstring(T, 2));
    if (lua.lua_toboolean(T, 3)) fs.appendFileSync(file, data);
    else fs.writeFileSync(file, data);
    lua.lua_pushboolean(T, true);
    return 1;
  } catch (e) {
    lua.lua_pushnil(T);
    pushStr(T, `${file}: ${e.message}`);
    return 2;
  }
});
def('__tide_exit', (T) => {
  const code = lua.lua_isboolean(T, 1) ? (lua.lua_toboolean(T, 1) ? 0 : 1) : lauxlib.luaL_optinteger(T, 1, 0);
  process.exit(code);
});

// The Lua side: io.read/io.lines on stdin yield with a request; files are read whole.
const PRELUDE = `
local yield = coroutine.yield
local function stdin_read(fmt) return yield({ "read", fmt or "l" }) end

local function take(buf, pos, fmt)
  fmt = type(fmt) == "string" and fmt:gsub("^%*", "") or fmt
  if pos > #buf then return nil, pos end
  if type(fmt) == "number" then local s = buf:sub(pos, pos + fmt - 1) return s, pos + #s end
  if fmt == "a" then return buf:sub(pos), #buf + 1 end
  if fmt == "n" then
    local s, e = buf:find("^%s*[-+]?%d*%.?%d+[eE]?[-+]?%d*", pos)
    if not s then return nil, pos end
    return tonumber(buf:sub(s, e)), e + 1
  end
  local nl = buf:find("\\n", pos, true)
  if not nl then return buf:sub(pos), #buf + 1 end
  return buf:sub(pos, fmt == "L" and nl or nl - 1), nl + 1
end

local File = {}
File.__index = File
function File:read(...)
  local fmts, out = { ... }, {}
  if #fmts == 0 then fmts = { "l" } end
  for i, f in ipairs(fmts) do out[i], self.pos = take(self.data, self.pos, f) end
  return table.unpack(out, 1, #fmts)
end
function File:lines(fmt) return function() return (self:read(fmt or "l")) end end
function File:write(...)
  for _, v in ipairs({ ... }) do self.data = self.data .. tostring(v) end
  self.dirty = true
  return self
end
function File:seek(whence, offset)
  whence, offset = whence or "cur", offset or 0
  local base = whence == "set" and 0 or whence == "end" and #self.data or self.pos - 1
  self.pos = base + offset + 1
  return self.pos - 1
end
function File:flush()
  if self.dirty then assert(__tide_writefile(self.path, self.data)) self.dirty = false end
  return self
end
function File:close() self:flush() self.closed = true return true end
File.__close = File.close
File.__gc = File.flush

local stdin_file = setmetatable({}, { __index = {
  read = function(_, ...) local n = select("#", ...) if n == 0 then return stdin_read("l") end
    local out = {} for i = 1, n do out[i] = stdin_read((select(i, ...))) end return table.unpack(out, 1, n) end,
  lines = function(_, fmt) return function() return stdin_read(fmt or "l") end end,
  close = function() return true end,
} })
io.stdin = stdin_file

io.read = function(...) return stdin_file:read(...) end
io.lines = function(path, ...)
  if path == nil then return stdin_file:lines(...) end
  local f = assert(io.open(path, "r"))
  local fmts = { ... }
  return function() local v = f:read(table.unpack(fmts)) if v == nil then f:close() end return v end
end
io.open = function(path, mode)
  mode = mode or "r"
  local data, err = "", nil
  if mode:find("[ra]") then
    data, err = __tide_readfile(path)
    if not data then if mode:find("r") then return nil, err end data = "" end
  end
  local f = setmetatable({ path = path, data = data, pos = mode:find("a") and #data + 1 or 1, dirty = mode:find("[wa+]") ~= nil }, File)
  if mode:find("w") then f.data = "" f:flush() end
  return f
end
os.exit = function(code) io.stdout:flush() __tide_exit(code) end

package.path = "./?.lua;./?/init.lua;" .. package.path
`;

function check(status) {
  if (status === lua.LUA_OK || status === lua.LUA_YIELD) return;
  const msg = lua.lua_tostring(L, -1);
  process.stderr.write(`lua: ${msg ? to_jsstring(msg) : 'error'}\n`);
  process.exit(1);
}

check(lauxlib.luaL_dostring(L, to_luastring(PRELUDE)));

// arg[0] is the script, arg[1..] its arguments, as with the lua command.
lua.lua_createtable(L, args.length, 1);
pushStr(L, file);
lua.lua_rawseti(L, -2, 0);
args.forEach((a, i) => {
  pushStr(L, a);
  lua.lua_rawseti(L, -2, i + 1);
});
lua.lua_setglobal(L, to_luastring('arg'));

const thread = lua.lua_newthread(L);
let source;
try {
  source = fs.readFileSync(file);
} catch {
  process.stderr.write(`lua: cannot open ${file}\n`);
  process.exit(1);
}
check(lauxlib.luaL_loadbuffer(thread, source, source.length, to_luastring(`@${path.basename(file)}`)));
for (const a of args) lua.lua_pushstring(thread, to_luastring(a));

// Answers one read request from what's buffered; returns false to wait for more input.
function answer(fmt) {
  const f = typeof fmt === 'string' ? fmt.replace(/^\*/, '') : fmt;
  if (f === 'a') {
    if (!stdinEnded) return false;
    const all = stdinBuffer;
    stdinBuffer = '';
    lua.lua_pushstring(thread, to_luastring(all));
    return true;
  }
  if (typeof f === 'number') {
    if (stdinBuffer.length < f && !stdinEnded) return false;
    const s = stdinBuffer.slice(0, f);
    stdinBuffer = stdinBuffer.slice(f);
    if (s === '' && stdinEnded) lua.lua_pushnil(thread);
    else lua.lua_pushstring(thread, to_luastring(s));
    return true;
  }
  const nl = stdinBuffer.indexOf('\n');
  if (nl === -1 && !stdinEnded) return false;
  if (nl === -1 && stdinBuffer === '') {
    lua.lua_pushnil(thread);
    return true;
  }
  const line = nl === -1 ? stdinBuffer : stdinBuffer.slice(0, nl);
  stdinBuffer = nl === -1 ? '' : stdinBuffer.slice(nl + 1);
  if (f === 'n') {
    // Like Lua's own reader: "21" is the integer 21, "2.5" a float.
    const text = line.trim();
    const n = Number(text);
    if (text === '' || Number.isNaN(n)) lua.lua_pushnil(thread);
    else if (/^[-+]?\d+$/.test(text) && Number.isSafeInteger(n)) lua.lua_pushinteger(thread, n);
    else lua.lua_pushnumber(thread, n);
  } else lua.lua_pushstring(thread, to_luastring(f === 'L' && nl !== -1 ? `${line}\n` : line));
  return true;
}

let nargs = args.length;
function step() {
  for (;;) {
    const status = lua.lua_resume(thread, null, nargs);
    nargs = 0;
    if (status === lua.LUA_OK) {
      process.exit(0);
    }
    if (status !== lua.LUA_YIELD) {
      lauxlib.luaL_traceback(L, thread, lua.lua_tostring(thread, -1), 0);
      process.stderr.write(`lua: ${to_jsstring(lua.lua_tostring(L, -1))}\n`);
      process.exit(1);
    }
    // The yielded request: { "read", fmt }.
    lua.lua_rawgeti(thread, -1, 2);
    const fmt = lua.lua_type(thread, -1) === lua.LUA_TNUMBER ? lua.lua_tonumber(thread, -1) : to_jsstring(lua.lua_tostring(thread, -1));
    lua.lua_pop(thread, 2);
    if (!answer(fmt)) {
      process.stdin.resume();
      wake = () => {
        if (!answer(fmt)) return;
        wake = null;
        process.stdin.pause();
        nargs = 1;
        setImmediate(step);
      };
      return;
    }
    nargs = 1;
  }
}
step();
