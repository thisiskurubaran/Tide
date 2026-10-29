// Two-finger pinch to change the font size, shared by the editor and terminal
// bundles. The page itself never zooms (user-scalable=no); this scales text.
export function pinchToZoom(
  el: HTMLElement,
  { get, preview, commit, min = 10, max = 24 }: { get(): number; preview(size: number): void; commit(size: number): void; min?: number; max?: number },
) {
  let start: { distance: number; size: number } | null = null;
  let size = 0;
  const distance = (t: TouchList) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
  el.addEventListener(
    'touchstart',
    (e) => {
      if (e.touches.length !== 2) return;
      start = { distance: distance(e.touches), size: get() };
      size = start.size;
    },
    { passive: true },
  );
  el.addEventListener(
    'touchmove',
    (e) => {
      if (!start || e.touches.length !== 2) return;
      // Stop the two fingers from also scrolling.
      e.preventDefault();
      const next = Math.round(Math.min(max, Math.max(min, start.size * (distance(e.touches) / start.distance))));
      if (next !== size) {
        size = next;
        preview(size);
      }
    },
    { passive: false },
  );
  const end = (e: TouchEvent) => {
    if (!start || e.touches.length >= 2) return;
    if (size !== start.size) commit(size);
    start = null;
  };
  el.addEventListener('touchend', end);
  el.addEventListener('touchcancel', end);
}
