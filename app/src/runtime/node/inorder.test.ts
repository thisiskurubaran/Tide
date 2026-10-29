// eslint-disable-next-line @typescript-eslint/no-require-imports
const { inOrder } = require('../../../nodejs-assets/nodejs-project/inorder');

describe('inOrder', () => {
  it('holds early messages until the gap is filled and drops repeats', () => {
    const got: string[] = [];
    const receive = inOrder((m: string) => got.push(m));
    receive(1, 'run');
    receive(2, 'stdin');
    expect(got).toEqual([]);
    receive(0, 'init');
    receive(1, 'run again');
    receive(3, 'kill');
    expect(got).toEqual(['init', 'run', 'stdin', 'kill']);
  });
});
