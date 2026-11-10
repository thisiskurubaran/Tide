// Orders native sheet presentations on iOS. UIKit can't present a view
// controller while another one is still animating in or out: an action sheet
// item that closes the menu and opens a form in the same tap would otherwise
// lose the form (UIKit logs a warning and never presents it). A sheet that
// wants to open waits until no other sheet is mid-transition; sheets that are
// fully open don't block, so a sheet can still open on top of another.
import { useCallback, useEffect, useState } from 'react';

type Phase = 'opening' | 'open' | 'closing';

const phases = new Map<number, Phase>();
const timers = new Map<number, ReturnType<typeof setTimeout>>();
const waiters = new Set<() => void>();
const gone = new Map<number, () => void>();
let nextId = 1;

// If UIKit never reports the end of a transition (no window, a failed
// presentation), move on after this long rather than block every sheet.
export const SETTLE_MS = 1000;

function busy(except: number): boolean {
  for (const [id, phase] of phases) if (id !== except && phase !== 'open') return true;
  return false;
}

function setPhase(id: number, phase: Phase | undefined) {
  clearTimeout(timers.get(id));
  timers.delete(id);
  if (phase === undefined) phases.delete(id);
  else phases.set(id, phase);
  if (phase === 'opening') timers.set(id, setTimeout(() => setPhase(id, 'open'), SETTLE_MS));
  else if (phase === 'closing') timers.set(id, setTimeout(() => setPhase(id, undefined), SETTLE_MS));
  if (phase === undefined) gone.get(id)?.();
  // Something settled: let a waiting sheet try again. Opening never frees
  // anything, and skipping it keeps a claim from re-entering this loop.
  if (phase !== 'opening') [...waiters].forEach((w) => w());
}

export interface SheetPresentation {
  // Render the native sheet at all (open, or still animating out).
  mounted: boolean;
  // The native sheet's isOpen.
  isOpen: boolean;
  onDidAppear(): void;
  onDidDisappear(): void;
  // The person swiped the sheet away or tapped the backdrop: it's gone already.
  onNativeDismiss(): void;
}

export function useSheetPresentation(wantOpen: boolean): SheetPresentation {
  const [id] = useState(() => nextId++);
  const [isOpen, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    gone.set(id, () => setMounted(false));
    return () => {
      gone.delete(id);
      // Unmounted while open: the native view dismisses itself without animation.
      setPhase(id, undefined);
    };
  }, [id]);

  useEffect(() => {
    if (wantOpen) {
      if (isOpen) return;
      const claim = () => {
        if (busy(id)) return false;
        setPhase(id, 'opening');
        setMounted(true);
        setOpen(true);
        return true;
      };
      if (claim()) return;
      const waiter = () => {
        if (claim()) waiters.delete(waiter);
      };
      waiters.add(waiter);
      return () => {
        waiters.delete(waiter);
      };
    }
    if (isOpen) {
      setOpen(false);
      setPhase(id, 'closing');
    }
  }, [wantOpen, isOpen, id]);

  const onDidAppear = useCallback(() => {
    if (phases.get(id) === 'opening') setPhase(id, 'open');
  }, [id]);
  // Also fires when a full-screen modal covers the sheet; only a closing sheet is done.
  const onDidDisappear = useCallback(() => {
    if (phases.get(id) === 'closing') setPhase(id, undefined);
  }, [id]);
  const onNativeDismiss = useCallback(() => {
    setOpen(false);
    setPhase(id, undefined);
  }, [id]);

  return { mounted, isOpen, onDidAppear, onDidDisappear, onNativeDismiss };
}
