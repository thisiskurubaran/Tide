import { createCursorSwipe, swipeGain, variantAt } from './keyGesture';

describe('cursor swipe', () => {
  it('moves a character per 9 points when slow, keeping the remainder', () => {
    const swipe = createCursorSwipe();
    expect(swipe.move(5, 100).steps).toBe(0);
    expect(swipe.move(5, 100).steps).toBe(1);
    expect(swipe.move(-10, 100).steps).toBe(-1);
  });

  it('accelerates fast drags, up to three times', () => {
    expect(swipeGain(0.1)).toBe(1);
    expect(swipeGain(1)).toBeCloseTo(1.9);
    expect(swipeGain(10)).toBe(3);
    expect(createCursorSwipe().move(30, 10).steps).toBe(10);
  });

  it('ticks every third character', () => {
    const swipe = createCursorSwipe();
    const ticks = [9, 9, 9, 9, 9, 18].map((dx) => swipe.move(dx, 100).tick);
    expect(ticks).toEqual([false, false, true, false, false, true]);
  });
});

describe('variantAt', () => {
  const box = { left: 10, top: 100, bottom: 180, cell: 40, count: 3 };

  it('finds the cell under the finger, or none when it slid off', () => {
    expect(variantAt(box, 10, 120)).toBe(0);
    expect(variantAt(box, 95, 170)).toBe(2);
    expect(variantAt(box, 130, 120)).toBeNull();
    expect(variantAt(box, 5, 120)).toBeNull();
    expect(variantAt(box, 50, 40)).toBeNull();
  });
});
