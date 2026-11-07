import { ALL_GESTURES, EditorGestures, NO_GESTURES } from '../../src/features/editor/bridge';
import { FONT_SIZE_MAX, FONT_SIZE_MIN } from '../../src/state/settings';
import { createGestureRecognizer, GestureEvent, MAX_FONT_SIZE, MIN_FONT_SIZE, PULL_THRESHOLD, StartInfo, TouchPoint } from './gestures';

const TOP: StartInfo = { scrollTop: 0, inContent: true };

function setup(flags: EditorGestures = ALL_GESTURES, size = 14) {
  const r = createGestureRecognizer({ flags: () => flags, fontSize: () => size });
  const events: GestureEvent[] = [];
  const prevented: string[] = [];
  let t = 0;
  let down: TouchPoint[] = [];
  const record = (name: string, s: { events: GestureEvent[]; preventDefault: boolean }) => {
    events.push(...s.events);
    if (s.preventDefault) prevented.push(name);
  };
  return {
    events,
    prevented,
    // Puts fingers down one after another, at (x, y) pairs.
    down(points: [number, number][], info: StartInfo = { scrollTop: 200, inContent: true }) {
      for (const [x, y] of points) {
        down = [...down, { id: down.length, x, y }];
        record('start', r.start(down, t, info));
      }
    },
    // Moves every finger by (dx, dy) in `steps` steps.
    move(dx: number, dy: number, steps = 4) {
      const from = down;
      for (let i = 1; i <= steps; i++) {
        t += 16;
        down = from.map((p) => ({ ...p, x: p.x + (dx * i) / steps, y: p.y + (dy * i) / steps }));
        record('move', r.move(down));
      }
    },
    // Spreads two fingers apart horizontally by `by` pixels in total.
    spread(by: number) {
      t += 16;
      down = down.map((p, i) => ({ ...p, x: p.x + (i === 0 ? -by / 2 : by / 2) }));
      record('move', r.move(down));
    },
    wait(ms: number) {
      t += ms;
    },
    up() {
      while (down.length) {
        t += 10;
        down = down.slice(1);
        record('end', r.end(down, t));
      }
    },
    cancel() {
      down = [];
      record('cancel', r.cancel());
    },
  };
}

describe('gesture recognizer', () => {
  it('uses the same font size range as Settings', () => {
    expect(MIN_FONT_SIZE).toBe(FONT_SIZE_MIN);
    expect(MAX_FONT_SIZE).toBe(FONT_SIZE_MAX);
  });

  it('turns a two-finger swipe left into the next tab, right into the previous', () => {
    const g = setup();
    g.down([[100, 100], [100, 160]]);
    g.move(-120, 5);
    g.up();
    g.down([[100, 100], [100, 160]]);
    g.move(120, -5);
    g.up();
    expect(g.events).toEqual([
      { type: 'tab', direction: 'next' },
      { type: 'tab', direction: 'prev' },
    ]);
  });

  it('ignores a short two-finger swipe and a two-finger scroll', () => {
    const g = setup();
    g.down([[100, 100], [100, 160]]);
    g.move(-40, 0);
    g.up();
    expect(g.events).toEqual([]);
    const scroll = setup();
    scroll.down([[100, 100], [100, 160]]);
    scroll.move(10, -200);
    scroll.up();
    expect(scroll.events).toEqual([]);
    // The scroll is never prevented.
    expect(scroll.prevented).toEqual([]);
  });

  it('only prevents a multi-finger touch once it is recognised', () => {
    const g = setup();
    g.down([[100, 100], [100, 160]]);
    expect(g.prevented).toEqual([]);
    g.move(-5, 0, 1);
    expect(g.prevented).toEqual([]);
    g.move(-100, 0, 2);
    expect(g.prevented).toContain('move');
    g.up();
    expect(g.prevented.filter((p) => p === 'end')).toHaveLength(2);
  });

  it('zooms live while pinching and saves the size at the end', () => {
    const g = setup(ALL_GESTURES, 14);
    g.down([[100, 100], [200, 100]]);
    g.spread(50);
    g.spread(50);
    g.up();
    const zooms = g.events.filter((e) => e.type === 'zoom');
    expect(zooms.length).toBeGreaterThan(1);
    expect(zooms.slice(0, -1).every((e) => e.type === 'zoom' && !e.done)).toBe(true);
    expect(zooms[zooms.length - 1]).toEqual({ type: 'zoom', fontSize: MAX_FONT_SIZE, done: true });
  });

  it('clamps a pinch to the settings range', () => {
    const g = setup(ALL_GESTURES, 14);
    g.down([[0, 100], [400, 100]]);
    g.spread(-380);
    g.up();
    expect(g.events[g.events.length - 1]).toEqual({ type: 'zoom', fontSize: MIN_FONT_SIZE, done: true });
  });

  it('undoes with a three-finger swipe left and redoes with one right', () => {
    const g = setup();
    g.down([[100, 100], [100, 150], [100, 200]]);
    g.move(-100, 0);
    g.up();
    g.down([[100, 100], [100, 150], [100, 200]]);
    g.move(100, 0);
    g.up();
    expect(g.events).toEqual([
      { type: 'history', action: 'undo' },
      { type: 'history', action: 'redo' },
    ]);
  });

  it('does not treat the first two fingers of a three-finger swipe as a tab swipe', () => {
    const g = setup();
    g.down([[100, 100], [100, 150]]);
    g.down([[100, 200]]);
    g.move(-100, 0);
    g.up();
    expect(g.events).toEqual([{ type: 'history', action: 'undo' }]);
  });

  it('opens the palette after pulling down far enough at the top', () => {
    const g = setup();
    g.down([[100, 100]], TOP);
    g.move(0, PULL_THRESHOLD + 10);
    const pulls = g.events.filter((e) => e.type === 'pull');
    expect(pulls[pulls.length - 1]).toEqual({ type: 'pull', distance: PULL_THRESHOLD + 10, armed: true });
    g.up();
    expect(g.events[g.events.length - 1]).toEqual({ type: 'pullEnd', open: true });
    // The lift is swallowed, so the caret doesn't move to where the finger was.
    expect(g.prevented).toContain('end');
  });

  it('does not open the palette for a short pull', () => {
    const g = setup();
    g.down([[100, 100]], TOP);
    g.move(0, 40);
    g.up();
    expect(g.events[g.events.length - 1]).toEqual({ type: 'pullEnd', open: false });
  });

  it('leaves one-finger touches alone unless pulling down at the top of the text', () => {
    for (const info of [
      { scrollTop: 50, inContent: true },
      { scrollTop: 0, inContent: false },
    ]) {
      const g = setup();
      g.down([[100, 100]], info);
      g.move(0, 150);
      g.up();
      expect(g.events).toEqual([]);
      expect(g.prevented).toEqual([]);
    }
    // Scrolling up, a sideways drag and a tap at the top.
    for (const [dx, dy] of [
      [0, -100],
      [80, 20],
      [0, 0],
    ]) {
      const g = setup();
      g.down([[100, 100]], TOP);
      g.move(dx, dy);
      g.up();
      expect(g.events).toEqual([]);
      expect(g.prevented).toEqual([]);
    }
  });

  it('asks for the editor actions on a quick two-finger tap', () => {
    const g = setup();
    g.down([[100, 100], [160, 100]]);
    g.move(2, 2, 1);
    g.up();
    expect(g.events).toEqual([{ type: 'actions' }]);
    expect(g.prevented).toContain('end');
  });

  it('does not count a slow two-finger press as a tap', () => {
    const g = setup();
    g.down([[100, 100], [160, 100]]);
    g.wait(800);
    g.up();
    expect(g.events).toEqual([]);
  });

  it('does nothing for a gesture that is switched off', () => {
    const g = setup(NO_GESTURES);
    g.down([[100, 100], [100, 160]]);
    g.move(-120, 0);
    g.up();
    g.down([[100, 100], [200, 100]]);
    g.spread(100);
    g.up();
    g.down([[100, 100], [100, 150], [100, 200]]);
    g.move(-100, 0);
    g.up();
    g.down([[100, 100]], TOP);
    g.move(0, 150);
    g.up();
    g.down([[100, 100], [160, 100]]);
    g.up();
    expect(g.events).toEqual([]);
    expect(g.prevented).toEqual([]);
  });

  it('keeps other gestures when one is off', () => {
    const g = setup({ ...ALL_GESTURES, pinch: false });
    g.down([[100, 100], [200, 100]]);
    g.spread(100);
    g.up();
    expect(g.events).toEqual([]);
    g.down([[100, 100], [100, 160]]);
    g.move(-120, 0);
    g.up();
    expect(g.events).toEqual([{ type: 'tab', direction: 'next' }]);
  });

  it('hides the pill and keeps the zoom when the touch is cancelled', () => {
    const g = setup();
    g.down([[100, 100]], TOP);
    g.move(0, 100);
    g.cancel();
    expect(g.events[g.events.length - 1]).toEqual({ type: 'pullEnd', open: false });
    const z = setup(ALL_GESTURES, 14);
    z.down([[100, 100], [200, 100]]);
    z.spread(100);
    z.cancel();
    expect(z.events[z.events.length - 1]).toEqual({ type: 'zoom', fontSize: 24, done: true });
  });

  it('turns a pull into a two-finger gesture when a second finger lands', () => {
    const g = setup();
    g.down([[100, 100]], TOP);
    g.move(0, 30);
    g.down([[100, 200]]);
    g.move(-120, 0);
    g.up();
    expect(g.events.filter((e) => e.type !== 'pull')).toEqual([
      { type: 'pullEnd', open: false },
      { type: 'tab', direction: 'next' },
    ]);
  });
});
