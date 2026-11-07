// Touch gestures in the editor. The recognizer is plain logic fed with touch
// points, so it can be tested without a DOM; attachGestures wires it to touch
// events. One-finger touches belong to CodeMirror and the browser (scrolling,
// the caret, selection), except a pull down when the file is scrolled to the
// top. Nothing is prevented until a gesture has been recognised, and a
// recognised gesture also swallows its touchend, so the tap the browser would
// synthesise never moves the caret.
import type { EditorGestures } from '../../src/features/editor/bridge';

// The same range as the Settings font size stepper (FONT_SIZE_MIN/MAX in
// src/state/settings.ts; a test keeps them equal).
export const MIN_FONT_SIZE = 10;
export const MAX_FONT_SIZE = 24;

// How far a pull has to go before letting go opens the palette.
export const PULL_THRESHOLD = 70;
// Movement before a gesture is decided, in CSS pixels.
const SLOP = 10;
const SWIPE_RECOGNISE = 30;
// A swipe has to travel this far to count when the fingers lift.
export const SWIPE_DISTANCE = 60;
// A change in finger spread that reads as a pinch rather than a swipe.
const PINCH_RECOGNISE = 24;
const TAP_MS = 350;

export interface TouchPoint {
  id: number;
  x: number;
  y: number;
}

export type GestureEvent =
  | { type: 'tab'; direction: 'next' | 'prev' }
  // `done` on the last one of a pinch: that size is saved.
  | { type: 'zoom'; fontSize: number; done: boolean }
  | { type: 'history'; action: 'undo' | 'redo' }
  | { type: 'pull'; distance: number; armed: boolean }
  | { type: 'pullEnd'; open: boolean }
  | { type: 'actions' };

export interface GestureStep {
  events: GestureEvent[];
  // Whether the touch event should be prevented (only once a gesture is recognised).
  preventDefault: boolean;
}

export interface StartInfo {
  // The scroller's scrollTop when the touch started.
  scrollTop: number;
  // Whether it started on the text (not the gutter, a panel or a tooltip).
  inContent: boolean;
}

type Kind =
  // One finger at the top of the file, not yet moving down.
  | 'pull'
  | 'pulling'
  // Two or three fingers, not yet decided.
  | 'two'
  | 'three'
  | 'pinch'
  | 'swipe2'
  | 'swipe3'
  // Down, but not a gesture of ours (a scroll, or everything is off).
  | 'none';

interface Gesture {
  kind: Kind;
  start: Map<number, { x: number; y: number }>;
  t0: number;
  // Two-finger spread and font size at the start, for pinches.
  spread: number;
  size0: number;
  size: number;
  dx: number;
  dy: number;
  // Any finger moved beyond the slop, so it can't be a tap.
  moved: boolean;
  // Decided; the rest of the touch is ignored until every finger lifts.
  done: boolean;
}

const RECOGNISED = new Set<Kind>(['pulling', 'pinch', 'swipe2', 'swipe3']);

const clamp = (n: number) => Math.min(MAX_FONT_SIZE, Math.max(MIN_FONT_SIZE, Math.round(n)));
const spreadOf = (t: TouchPoint[]) => (t.length >= 2 ? Math.hypot(t[0].x - t[1].x, t[0].y - t[1].y) : 0);
const step = (events: GestureEvent[] = [], preventDefault = false): GestureStep => ({ events, preventDefault });

export function createGestureRecognizer({ flags, fontSize }: { flags(): EditorGestures; fontSize(): number }) {
  let g: Gesture | null = null;
  // Whether the gesture being held (or just lifted) was one of ours.
  let claimed = false;

  const begin = (kind: Kind, touches: TouchPoint[], time: number): Gesture => {
    const size = fontSize();
    return {
      kind,
      start: new Map(touches.map((t) => [t.id, { x: t.x, y: t.y }])),
      t0: time,
      spread: spreadOf(touches),
      size0: size,
      size,
      dx: 0,
      dy: 0,
      moved: false,
      done: false,
    };
  };

  // Average movement of the fingers that were down at the start.
  const track = (gesture: Gesture, touches: TouchPoint[]) => {
    let dx = 0;
    let dy = 0;
    let n = 0;
    for (const t of touches) {
      const s = gesture.start.get(t.id);
      if (!s) continue;
      const mx = t.x - s.x;
      const my = t.y - s.y;
      if (Math.hypot(mx, my) > SLOP) gesture.moved = true;
      dx += mx;
      dy += my;
      n++;
    }
    if (n) {
      gesture.dx = dx / n;
      gesture.dy = dy / n;
    }
  };

  function start(touches: TouchPoint[], time: number, info: StartInfo): GestureStep {
    const on = flags();
    const events: GestureEvent[] = [];
    if (g?.done) return step();
    // A finger joining a pull turns it into a two-finger gesture.
    if (g?.kind === 'pulling') events.push({ type: 'pullEnd', open: false });
    // A third finger doesn't break a pinch or a swipe that is under way.
    if (g && (g.kind === 'pinch' || g.kind === 'swipe2')) return step(events);
    claimed = false;
    const n = touches.length;
    if (n === 1) {
      g = on.pullPalette && info.scrollTop <= 0 && info.inContent ? begin('pull', touches, time) : null;
    } else if (n === 2) {
      g = begin(on.tabs || on.pinch || on.twoFingerTap ? 'two' : 'none', touches, time);
    } else if (n === 3) {
      g = begin(on.undo ? 'three' : 'none', touches, time);
    } else {
      g = { ...begin('none', touches, time), done: true };
    }
    return step(events);
  }

  function move(touches: TouchPoint[]): GestureStep {
    if (!g || g.done) return step([], claimed);
    const on = flags();
    track(g, touches);
    const { dx, dy } = g;
    switch (g.kind) {
      case 'pull':
        if (touches.length !== 1) return step();
        if (dy > SLOP && dy > Math.abs(dx) * 2) g.kind = 'pulling';
        else if (dy < -SLOP || Math.abs(dx) > SLOP) {
          // A scroll or a sideways drag: not ours.
          g = null;
          return step();
        } else return step();
      // falls through
      case 'pulling': {
        const distance = Math.max(0, g.dy);
        return step([{ type: 'pull', distance, armed: distance >= PULL_THRESHOLD }], true);
      }
      case 'two': {
        if (touches.length < 2) return step();
        const spread = Math.abs(spreadOf(touches) - g.spread);
        const travel = Math.max(Math.abs(dx), Math.abs(dy));
        if (on.pinch && g.spread > 0 && spread > PINCH_RECOGNISE && spread > travel) {
          g.kind = 'pinch';
          return move(touches);
        }
        if (on.tabs && Math.abs(dx) > SWIPE_RECOGNISE && Math.abs(dx) > Math.abs(dy) * 2) {
          g.kind = 'swipe2';
          return step([], true);
        }
        // A two-finger scroll.
        if (Math.abs(dy) > SWIPE_RECOGNISE && Math.abs(dy) > Math.abs(dx)) g.kind = 'none';
        return step();
      }
      case 'pinch': {
        if (touches.length < 2 || !g.spread) return step([], true);
        const size = clamp(g.size0 * (spreadOf(touches) / g.spread));
        if (size === g.size) return step([], true);
        g.size = size;
        return step([{ type: 'zoom', fontSize: size, done: false }], true);
      }
      case 'three':
        if (Math.abs(dx) > SWIPE_RECOGNISE && Math.abs(dx) > Math.abs(dy) * 2) {
          g.kind = 'swipe3';
          return step([], true);
        }
        if (Math.abs(dy) > SWIPE_RECOGNISE) g.kind = 'none';
        return step();
      case 'swipe2':
      case 'swipe3':
        return step([], true);
      case 'none':
        return step();
    }
  }

  // Decides what the gesture was when its fingers start lifting.
  function resolve(gesture: Gesture, time: number): GestureEvent[] {
    const on = flags();
    switch (gesture.kind) {
      case 'pulling':
        return [{ type: 'pullEnd', open: gesture.dy >= PULL_THRESHOLD }];
      case 'two':
        return on.twoFingerTap && !gesture.moved && time - gesture.t0 <= TAP_MS ? [{ type: 'actions' }] : [];
      case 'pinch':
        return gesture.size !== gesture.size0 ? [{ type: 'zoom', fontSize: gesture.size, done: true }] : [];
      case 'swipe2':
        if (!on.tabs || Math.abs(gesture.dx) < SWIPE_DISTANCE) return [];
        // Like turning a page: swiping left brings in the next tab.
        return [{ type: 'tab', direction: gesture.dx < 0 ? 'next' : 'prev' }];
      case 'swipe3':
        if (!on.undo || Math.abs(gesture.dx) < SWIPE_DISTANCE) return [];
        return [{ type: 'history', action: gesture.dx < 0 ? 'undo' : 'redo' }];
      default:
        return [];
    }
  }

  // `remaining` is the fingers still down.
  function end(remaining: TouchPoint[], time: number): GestureStep {
    if (!g) return step();
    let events: GestureEvent[] = [];
    if (!g.done) {
      // A pending pull that never moved is a plain tap.
      if (g.kind === 'pull') {
        g = null;
        return step();
      }
      events = resolve(g, time);
      // A two-finger tap is recognised only now, and its lift is swallowed too.
      claimed = RECOGNISED.has(g.kind) || events.length > 0;
      g.done = true;
    }
    if (remaining.length === 0) g = null;
    return step(events, claimed);
  }

  function cancel(): GestureStep {
    const events: GestureEvent[] = [];
    if (g && !g.done) {
      if (g.kind === 'pulling') events.push({ type: 'pullEnd', open: false });
      // The new size is already showing; keep it.
      if (g.kind === 'pinch' && g.size !== g.size0) events.push({ type: 'zoom', fontSize: g.size, done: true });
    }
    g = null;
    claimed = false;
    return step(events);
  }

  return { start, move, end, cancel };
}

export type GestureRecognizer = ReturnType<typeof createGestureRecognizer>;

// ---- DOM wiring ----

export interface GestureHost {
  flags(): EditorGestures;
  fontSize(): number;
  scrollTop(): number;
  inContent(target: EventTarget | null): boolean;
  onEvent(event: GestureEvent): void;
}

const points = (list: TouchList): TouchPoint[] =>
  Array.from(list, (t) => ({ id: t.identifier, x: t.clientX, y: t.clientY }));

export function attachGestures(el: HTMLElement, host: GestureHost) {
  const recognizer = createGestureRecognizer(host);
  const apply = (e: TouchEvent, s: GestureStep) => {
    if (s.preventDefault && e.cancelable) e.preventDefault();
    s.events.forEach(host.onEvent);
  };
  // Capture, so a recognised gesture is prevented before CodeMirror sees it.
  const opts = { capture: true, passive: false } as const;
  el.addEventListener('touchstart', (e) => apply(e, recognizer.start(points(e.touches), e.timeStamp, { scrollTop: host.scrollTop(), inContent: host.inContent(e.target) })), opts);
  el.addEventListener('touchmove', (e) => apply(e, recognizer.move(points(e.touches))), opts);
  el.addEventListener('touchend', (e) => apply(e, recognizer.end(points(e.touches), e.timeStamp)), opts);
  el.addEventListener('touchcancel', (e) => apply(e, recognizer.cancel()), opts);
  return recognizer;
}

// The "Release for commands" pill shown while pulling down at the top.
export function createPullPill(parent: HTMLElement) {
  const pill = document.createElement('div');
  pill.className = 'tide-pull-pill';
  pill.setAttribute('aria-hidden', 'true');
  parent.appendChild(pill);
  return {
    update(distance: number, armed: boolean) {
      pill.textContent = armed ? 'Release for commands' : 'Pull for commands';
      pill.classList.toggle('tide-armed', armed);
      pill.style.opacity = String(Math.min(1, distance / PULL_THRESHOLD));
      pill.style.transform = `translate(-50%, ${Math.min(distance, PULL_THRESHOLD) / 2}px)`;
      pill.style.display = 'block';
    },
    hide() {
      pill.style.display = 'none';
    },
  };
}

export const PULL_PILL_CSS = `
  .tide-pull-pill { display: none; position: fixed; top: 8px; left: 50%; z-index: 300; pointer-events: none;
    padding: 4px 12px; border-radius: 999px; font: 600 12px -apple-system, system-ui, sans-serif;
    background: rgba(16, 28, 32, 0.85); color: #e6f4f1; backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px); }
  .tide-pull-pill.tide-armed { background: #2dd4bf; color: #0a1115; }
`;
