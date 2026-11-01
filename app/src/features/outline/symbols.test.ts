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
});
