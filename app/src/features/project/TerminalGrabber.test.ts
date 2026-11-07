import { DETENTS, snapFraction } from './TerminalGrabber';

describe('snapFraction', () => {
  it('snaps to the nearest detent', () => {
    expect(snapFraction(0.35)).toBe(0.3);
    expect(snapFraction(0.5)).toBe(0.6);
    expect(snapFraction(0.85)).toBe(0.92);
  });

  it('hides when dragged low', () => {
    expect(snapFraction(0.1)).toBeNull();
  });

  it('moves one detent on a flick', () => {
    expect(snapFraction(0.35, -2)).toBe(0.6);
    expect(snapFraction(0.55, 2)).toBe(0.3);
    expect(snapFraction(0.3, 2)).toBeNull();
    expect(snapFraction(0.92, -2)).toBe(DETENTS[2]);
  });
});
