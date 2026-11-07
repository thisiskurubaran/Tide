import { symbolsFor } from './symbols';

const brief = (s: { name: string; kind: string; line: number; depth: number }[]) => s.map((x) => `${'  '.repeat(x.depth)}${x.kind} ${x.name}:${x.line}`);

describe('outline', () => {
  it('reads JavaScript and TypeScript', () => {
    const ts = `import x from 'y';
export interface User { id: number }
export type Id = string;
export default class Store {
  #items = new Map();
  static create() { return new Store(); }
  async load(id: string): Promise<void> {
    if (id) { return; }
    const s = "}";
  }
  get size() { return 1; }
  handle = (e) => { };
}
/* class NotReal {} */
export async function main() {}
const helper = async (a, b) => a + b;
export const Comp = ({ a }: Props) => <div />;
let value = 3;
enum Color { Red }`;
    expect(brief(symbolsFor(ts, 'tsx'))).toEqual([
      'type User:2',
      'type Id:3',
      'class Store:4',
      '  method create:6',
      '  method load:7',
      '  method size:11',
      '  method handle:12',
      'function main:15',
      'function helper:16',
      'function Comp:17',
      'type Color:19',
    ]);
  });

  it('reads Python, Ruby, Lua and PHP by indentation', () => {
    expect(brief(symbolsFor('class A:\n    def f(self):\n        def inner(): pass\n\nasync def main():\n    pass\n', 'python'))).toEqual([
      'class A:1',
      '  method f:2',
      '    method inner:3',
      'function main:5',
    ]);
    expect(brief(symbolsFor('module Shop\n  class Cart\n    def self.build\n    end\n    def total?\n    end\n  end\nend\n', 'ruby'))).toEqual([
      'class Shop:1',
      '  class Cart:2',
      '    method self.build:3',
      '    method total?:5',
    ]);
    expect(brief(symbolsFor('local function a()\nend\nfunction M.b(x)\nend\nlocal c = function() end\n', 'lua'))).toEqual(['function a:1', 'function M.b:3', 'function c:5']);
    expect(brief(symbolsFor('<?php\nfinal class Api {\n    public static function get() {}\n}\nfunction helper() {}\n', 'php'))).toEqual(['class Api:2', '  method get:3', 'function helper:5']);
  });

  it('reads Markdown headings, CSS rules and SQL tables', () => {
    expect(brief(symbolsFor('# Title\ntext\n## Part\n```\n# not a heading\n```\n### Deep ##\n', 'markdown'))).toEqual(['heading Title:1', '  heading Part:3', '    heading Deep:7']);
    expect(brief(symbolsFor('body {\n  margin: 0;\n}\n@media (max-width: 600px) {\n  .card { padding: 0 }\n}\n', 'css'))).toEqual([
      'selector body:1',
      'module @media (max-width: 600px):4',
      '  selector .card:5',
    ]);
    expect(brief(symbolsFor('CREATE TABLE IF NOT EXISTS users (id int);\ncreate view active as select 1;\n', 'sql'))).toEqual(['table users:1', 'table active:2']);
    expect(symbolsFor('anything', 'plain')).toEqual([]);
  });
  it('reads Go', () => {
    const src = `package main

type Server struct {
	addr string
}

type Handler interface {
	Serve() error
}

type ID string

func (s *Server) Start() error {
	if s.addr == "" {
		return nil
	}
	return nil
}

func main() {
	go func() {}()
}`;
    expect(brief(symbolsFor(src, 'go'))).toEqual(['class Server:3', 'type Handler:7', 'type ID:11', 'method Start:13', 'function main:20']);
  });

  it('reads Rust', () => {
    const src = `mod net;
pub mod util {
    pub fn helper<'a>(s: &'a str) -> &'a str { s }
}
#[derive(Debug)]
pub struct Point { x: i32 }
enum Shape { Circle, Square }
pub trait Draw {
    fn draw(&self);
}
impl<'a> Draw for Point {
    fn draw(&self) {
        let c = '{';
        fn not_listed() {}
    }
}
pub(crate) async fn main() {}`;
    expect(brief(symbolsFor(src, 'rust'))).toEqual([
      'module net:1',
      'module util:2',
      '  method helper:3',
      'class Point:6',
      'type Shape:7',
      'type Draw:8',
      '  method draw:9',
      'class Draw for Point:11',
      '  method draw:12',
      'function main:17',
    ]);
  });

  it('reads Java, C# and Kotlin', () => {
    const java = `package a;
@Service
public final class Store<T> {
    private int count = compute();
    public Store(int n) { this.count = n; }
    @Override
    public List<String> names(int max) throws IOException {
        if (max > 0) { return list(max); }
        return foo(x);
    }
    interface Listener {
        void changed(String key);
    }
}`;
    expect(brief(symbolsFor(java, 'java'))).toEqual(['class Store:3', '  method Store:5', '  method names:7', '  class Listener:11', '    method changed:12']);
    const cs = `namespace Shop.Api
{
    public sealed class Cart
    {
        public Cart() { }
        public async Task<int> TotalAsync(string id)
        {
            var x = Compute(id);
            return x;
        }
    }
}`;
    expect(brief(symbolsFor(cs, 'csharp'))).toEqual(['module Shop.Api:1', '  class Cart:3', '    method Cart:5', '    method TotalAsync:6']);
    const kt = `data class User(val name: String)
class Repo {
    companion object {
        fun create(): Repo = Repo()
    }
    suspend fun load(id: Int): User { return User("") }
}
fun String.shout() = uppercase()
fun main() {
    fun local() {}
}`;
    expect(brief(symbolsFor(kt, 'kotlin'))).toEqual(['class User:1', 'class Repo:2', '  class object:3', '    method create:4', '  method load:6', 'function shout:8', 'function main:9']);
  });

  it('reads Swift and Dart', () => {
    const swift = `import UIKit
protocol Drawable {
    func draw()
}
final class View: UIView, Drawable {
    override init(frame: CGRect) { super.init(frame: frame) }
    func draw() {
        func inner() {}
    }
}
extension View {
    static func make() -> View { View() }
}
func main() {}`;
    expect(brief(symbolsFor(swift, 'swift'))).toEqual([
      'type Drawable:2',
      '  method draw:3',
      'class View:5',
      '  method init:6',
      '  method draw:7',
      'class View:11',
      '  method make:12',
      'function main:14',
    ]);
    const dart = `abstract class Shape {
  double area();
  Shape.named();
  String describe() {
    print(area());
    return '';
  }
}
void main() {
  runApp(App());
}`;
    expect(brief(symbolsFor(dart, 'dart'))).toEqual(['class Shape:1', '  method area:2', '  method describe:4', 'function main:9']);
  });

  it('reads C, C++ and Objective-C', () => {
    const c = `#include <stdio.h>
#define MAX(a, b) ((a) > (b) ? (a) : (b))
struct point { int x, y; };
struct point origin;
typedef struct node node_t;
static int count(const char *s);
static struct point *make(int x)
{
    if (x) { return NULL; }
    printf("%d", x);
}
int main(int argc, char **argv) {
    return count("x");
}`;
    expect(brief(symbolsFor(c, 'c'))).toEqual(['class point:3', 'function count:6', 'function make:7', 'function main:12']);
    const cpp = `namespace app {
class Widget : public Base {
public:
    Widget();
    ~Widget();
    virtual void draw() const override;
private:
    int size_ = 0;
};
Widget::Widget() {}
void Widget::draw() const {
    helper(1);
}
}
template <typename T> T clamp(T v) { return v; }`;
    expect(brief(symbolsFor(cpp, 'cpp'))).toEqual([
      'module app:1',
      '  class Widget:2',
      '    method Widget:4',
      '    method ~Widget:5',
      '    method draw:6',
      '  method Widget::Widget:10',
      '  method Widget::draw:11',
      'function clamp:15',
    ]);
    const objc = `@interface View : UIView
- (void)layout;
@end
@implementation View (Extras)
- (instancetype)initWithFrame:(CGRect)frame {
}
+ (id)shared { return nil; }
@end
int helper(void) { return 0; }`;
    expect(brief(symbolsFor(objc, 'objectivec'))).toEqual([
      'class View:1',
      '  method layout:2',
      'class View (Extras):4',
      '  method initWithFrame:5',
      '  method shared:7',
      'function helper:9',
    ]);
  });

  it('reads shell, PowerShell and Makefiles', () => {
    expect(brief(symbolsFor('#!/bin/sh\nbuild() {\n  echo hi\n}\nfunction deploy {\n  build\n}\nfunction clean() { :; }\n', 'shell'))).toEqual(['function build:2', 'function deploy:5', 'function clean:8']);
    expect(brief(symbolsFor('function Get-Thing {\n}\nclass Box {\n}\n', 'powershell'))).toEqual(['function Get-Thing:1', 'class Box:3']);
    const mk = `CC := gcc
CFLAGS ?= -O2
.PHONY: all clean
all: app
app: main.o util.o
\t$(CC) -o $@ $^
%.o: %.c
\t$(CC) -c $<
ifeq ($(OS),Windows)
endif
clean:
\trm -f app`;
    expect(brief(symbolsFor(mk, 'makefile'))).toEqual(['function all:4', 'function app:5', 'function %.o:7', 'function clean:11']);
  });

  it('reads YAML, TOML, INI, env files and Dockerfiles', () => {
    const yml = `# CI
name: build
on:
  push:
    branches: [main]
"jobs": 
  test:
    run: |
      echo: not a key
script: >
  folded: text
- item
env: {}`;
    expect(brief(symbolsFor(yml, 'yaml'))).toEqual(['variable name:2', 'variable on:3', 'variable jobs:6', 'variable script:10', 'variable env:13']);
    expect(brief(symbolsFor('title = "x"\n[package]\nname = "a"\n[[bin]]\n[dependencies.serde]\n', 'toml'))).toEqual(['module package:2', 'module bin:4', 'module dependencies.serde:5']);
    expect(brief(symbolsFor('; c\n[core]\nbare = false\n', 'ini'))).toEqual(['module core:2']);
    expect(brief(symbolsFor('# x\nAPI_KEY=abc\nexport PORT=3000\n', 'env'))).toEqual(['variable API_KEY:2', 'variable PORT:3']);
    expect(brief(symbolsFor('FROM node:20 AS build\nRUN npm ci\nFROM --platform=linux/amd64 nginx:alpine\n', 'dockerfile'))).toEqual(['module build:1', 'module nginx:alpine:3']);
  });
});
