import { symbolsAt } from './breadcrumbs';
import { symbolsFor } from './symbols';

const at = (text: string, language: Parameters<typeof symbolsFor>[1], line: number) =>
  symbolsAt(symbolsFor(text, language), text.split('\n'), line).map((s) => s.name);

describe('breadcrumb symbols', () => {
  it('follows braces in JavaScript, including the closing line', () => {
    const js = ['class Cart {', '  add(item) {', '    this.items.push(item);', '  }', '', '  total() {', '    return 0;', '  }', '}', '', 'function main() {', '  return new Cart();', '}', 'main();'].join('\n');
    expect(at(js, 'javascript', 3)).toEqual(['Cart', 'add']);
    expect(at(js, 'javascript', 4)).toEqual(['Cart', 'add']);
    expect(at(js, 'javascript', 5)).toEqual(['Cart']);
    expect(at(js, 'javascript', 7)).toEqual(['Cart', 'total']);
    expect(at(js, 'javascript', 12)).toEqual(['main']);
    expect(at(js, 'javascript', 14)).toEqual([]);
  });

  it('follows indentation in Python', () => {
    const py = ['class Shop:', '    def buy(self):', '        pay()', '', '    def sell(self):', '        pass', '', 'def run():', '    Shop()', 'run()'].join('\n');
    expect(at(py, 'python', 3)).toEqual(['Shop', 'buy']);
    expect(at(py, 'python', 6)).toEqual(['Shop', 'sell']);
    expect(at(py, 'python', 9)).toEqual(['run']);
    expect(at(py, 'python', 10)).toEqual([]);
  });

  it('nests Markdown headings by level', () => {
    const md = ['# Guide', 'intro', '## Install', 'npm i', '### macOS', 'brew', '## Use', 'run it'].join('\n');
    expect(at(md, 'markdown', 6)).toEqual(['Guide', 'Install', 'macOS']);
    expect(at(md, 'markdown', 8)).toEqual(['Guide', 'Use']);
    expect(at(md, 'markdown', 2)).toEqual(['Guide']);
  });
});
