// Tuning and math for the key bar's gestures, kept free of React Native so it
// can be tested directly: a drag across the keys moves the cursor, a hold
// opens a key's variants.

// Movement under this is still a tap.
export const DRAG_SLOP = 10;
export const LONG_PRESS_MS = 350;
// Points of drag per character at normal speed.
const STEP = 9;
// A haptic tick every few characters; one per character buzzes on fast drags.
const TICK_EVERY = 3;

// Points per millisecond; slow drags stay precise, fast ones cover up to three times the ground.
export function swipeGain(speed: number): number {
  return Math.min(3, Math.max(1, 1 + (speed - 0.4) * 1.5));
}

export function createCursorSwipe() {
  let rest = 0;
  let moved = 0;
  return {
    // `dx` points since the last move, over `dt` milliseconds.
    move(dx: number, dt: number): { steps: number; tick: boolean } {
      rest += dx * swipeGain(dt > 0 ? Math.abs(dx) / dt : 0);
      const steps = Math.trunc(rest / STEP);
      rest -= steps * STEP;
      const before = Math.trunc(moved / TICK_EVERY);
      moved += Math.abs(steps);
      return { steps, tick: Math.trunc(moved / TICK_EVERY) !== before };
    },
  };
}

// The variant popover in window coordinates: `count` cells of `cell` points from `left`.
export interface VariantBox {
  left: number;
  top: number;
  bottom: number;
  cell: number;
  count: number;
}

// How far the finger may stray above or below the popover and key before release cancels.
const VARIANT_SLOP = 24;

export function variantAt(box: VariantBox, x: number, y: number): number | null {
  if (y < box.top - VARIANT_SLOP || y > box.bottom + VARIANT_SLOP) return null;
  const i = Math.floor((x - box.left) / box.cell);
  return i >= 0 && i < box.count ? i : null;
}
