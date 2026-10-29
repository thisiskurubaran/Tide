// @ts-check
// Delivers numbered messages in order, holding any that arrive early. See
// Envelope in shared/protocol.ts for why the channel needs this.
'use strict';

/**
 * @template T
 * @param {(msg: T) => void} deliver
 * @returns {(n: number, msg: T) => void}
 */
function inOrder(deliver) {
  let next = 0;
  /** @type {Map<number, T>} */
  const held = new Map();
  return (n, msg) => {
    if (n < next) return;
    held.set(n, msg);
    while (held.has(next)) {
      const m = /** @type {T} */ (held.get(next));
      held.delete(next);
      next++;
      deliver(m);
    }
  };
}

module.exports = { inOrder };
