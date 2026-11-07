import { leadingColumns } from './wrapIndent';

it('counts leading spaces and tabs as columns', () => {
  expect(leadingColumns('    <meta>', 2)).toBe(4);
  expect(leadingColumns('\t\tx', 4)).toBe(8);
  expect(leadingColumns('  \tx', 4)).toBe(4);
  expect(leadingColumns('x  ', 2)).toBe(0);
  expect(leadingColumns('', 2)).toBe(0);
});
