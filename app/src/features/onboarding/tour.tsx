// The editor's first-run coach marks: a dimmed overlay with a cut-out around
// one control at a time and a callout explaining it. Controls opt in with
// useTourTarget(id); <EditorTour /> shows the steps whose controls are on screen.
import { ComponentRef, useCallback, useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, LayoutChangeEvent, Modal, Pressable, View, useWindowDimensions } from 'react-native';
import { createStore, useStore } from 'zustand';

import { useReduceMotion } from '../../components/a11y';
import { Text } from '../../components/Text';
import { makeStyles, useColors } from '../../theme/theme';
import { fonts, fontSizes, radius, spacing } from '../../theme/tokens';
import { supportStore, useSupport } from '../support/store';

export type TourStepId = 'run' | 'files' | 'palette' | 'terminal';

export interface TourStep {
  id: TourStepId;
  title: string;
  body: string;
}

export const TOUR_STEPS: TourStep[] = [
  { id: 'run', title: 'Run your project', body: 'Tap Run to start it. The terminal slides up with the output, and Run turns into Stop.' },
  { id: 'files', title: 'Your files', body: 'Tap Files, or swipe in from the left edge, to browse, create and move files.' },
  { id: 'palette', title: 'Everything in one place', body: 'The ⌘ button opens the command palette: files, commands with >, symbols with @, lines with :.' },
  { id: 'terminal', title: 'Terminal', body: 'Open the terminal any time. Drag its handle to resize it, or down to hide it.' },
];

export interface TourRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface TargetsState {
  rects: Partial<Record<TourStepId, TourRect>>;
  set(id: TourStepId, rect: TourRect | null): void;
}

// Where each registered control is, in window coordinates.
export const tourTargets = createStore<TargetsState>()((set) => ({
  rects: {},
  set: (id, rect) =>
    set((s) => {
      const rects = { ...s.rects };
      if (rect) rects[id] = rect;
      else delete rects[id];
      return { rects };
    }),
}));

interface TourState {
  // Index into TOUR_STEPS; steps without a target are passed over.
  index: number;
  // Off under jest so screen tests don't get a modal on top; tests opt in.
  enabled: boolean;
}

export const tourStore = createStore<TourState>()(() => ({
  index: 0,
  enabled: process.env.JEST_WORKER_ID === undefined,
}));

// The steps that can be shown now: those whose control has been measured.
export const availableSteps = (rects: TargetsState['rects']) => TOUR_STEPS.filter((s) => rects[s.id]);

// The step to show at `index`, skipping ones that aren't registered, or null when past the end.
export function currentStep(index: number, rects: TargetsState['rects']): TourStep | null {
  return TOUR_STEPS.slice(index).find((s) => rects[s.id]) ?? null;
}

export function finishEditorTour() {
  supportStore.getState().setTouredEditor(true);
  tourStore.setState({ index: 0 });
}

// Moves past the current step; finishing the last one ends the tour for good.
export function nextTourStep() {
  const { rects } = tourTargets.getState();
  const step = currentStep(tourStore.getState().index, rects);
  const at = step ? TOUR_STEPS.indexOf(step) : TOUR_STEPS.length;
  if (!currentStep(at + 1, rects)) finishEditorTour();
  else tourStore.setState({ index: at + 1 });
}

export const skipEditorTour = finishEditorTour;

// Shows the tour again the next time an editor is on screen (or now, if one is).
export function resetEditorTour() {
  tourStore.setState({ index: 0 });
  supportStore.getState().setTouredEditor(false);
}

// Attach to a control: <Pressable ref={t.ref} onLayout={t.onLayout} />.
// onLayout only gives the position in the parent, so it re-measures in the window.
export function useTourTarget(id: TourStepId) {
  const ref = useRef<ComponentRef<typeof View>>(null);
  const frame = useRef<number | null>(null);
  const measure = useCallback(() => {
    const node = ref.current;
    // Missing under jest's host mocks; there's nothing to measure there.
    if (!node?.measureInWindow) return;
    node.measureInWindow((x, y, width, height) => {
      // Zero size means hidden or not laid out yet; don't point at nothing.
      if (width > 0 && height > 0) tourTargets.getState().set(id, { x, y, width, height });
      else tourTargets.getState().set(id, null);
    });
  }, [id]);
  const onLayout = useCallback(
    (_e?: LayoutChangeEvent) => {
      measure();
      // Parents can still be moving on the first layout (safe area, sheets); measure again a frame later.
      if (frame.current !== null) cancelAnimationFrame(frame.current);
      frame.current = requestAnimationFrame(measure);
    },
    [measure],
  );
  useEffect(
    () => () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
      tourTargets.getState().set(id, null);
    },
    [id],
  );
  return { ref, onLayout, measure };
}

const PAD = 6;
const GAP = 12;
const CALLOUT_WIDTH = 340;
const CALLOUT_ROOM = 190;
// Lets every control register before the first step shows, so the count is right.
const SETTLE_MS = 450;

export function EditorTour() {
  const styles = useStyles();
  const colors = useColors();
  const reduceMotion = useReduceMotion();
  const { width: winW, height: winH } = useWindowDimensions();
  const toured = useSupport((s) => s.touredEditor);
  const enabled = useStore(tourStore, (s) => s.enabled);
  const index = useStore(tourStore, (s) => s.index);
  const rects = useStore(tourTargets, (s) => s.rects);
  const [settled, setSettled] = useState(false);
  const titleRef = useRef<ComponentRef<typeof View>>(null);
  const appear = useRef(new Animated.Value(0)).current;

  const active = enabled && !toured;
  useEffect(() => {
    if (!active) return;
    const t = setTimeout(() => setSettled(true), SETTLE_MS);
    return () => clearTimeout(t);
  }, [active]);

  const step = active && settled ? currentStep(index, rects) : null;
  const rect = step ? rects[step.id] : undefined;
  const available = availableSteps(rects);
  const position = step ? available.indexOf(step) + 1 : 0;
  const last = step !== null && currentStep(TOUR_STEPS.indexOf(step) + 1, rects) === null;

  useEffect(() => {
    if (!step) return;
    appear.setValue(reduceMotion ? 1 : 0);
    if (!reduceMotion) Animated.timing(appear, { toValue: 1, duration: 220, useNativeDriver: true }).start();
    // Move the screen reader to the new step's title.
    const t = setTimeout(() => {
      if (titleRef.current) AccessibilityInfo.sendAccessibilityEvent?.(titleRef.current, 'focus');
    }, 100);
    return () => clearTimeout(t);
  }, [step, reduceMotion, appear]);

  if (!step || !rect) return null;

  const hole = {
    x: Math.max(0, rect.x - PAD),
    y: Math.max(0, rect.y - PAD),
    width: rect.width + PAD * 2,
    height: rect.height + PAD * 2,
  };
  const below = winH - (hole.y + hole.height);
  const placeBelow = below >= CALLOUT_ROOM || below >= hole.y;
  const calloutW = Math.min(CALLOUT_WIDTH, winW - spacing.md * 2);
  const left = Math.min(Math.max(spacing.md, hole.x + hole.width / 2 - calloutW / 2), winW - spacing.md - calloutW);
  const vertical = placeBelow ? { top: hole.y + hole.height + GAP } : { bottom: winH - hole.y + GAP };
  const slide = appear.interpolate({ inputRange: [0, 1], outputRange: [placeBelow ? -8 : 8, 0] });

  return (
    <Modal transparent visible animationType="none" statusBarTranslucent navigationBarTranslucent onRequestClose={skipEditorTour} supportedOrientations={['portrait', 'landscape']}>
      <Animated.View style={[styles.fill, { opacity: appear }]} testID="editor-tour">
        {/* Four dim panels around the target leave it visible through a hole. */}
        <View style={[styles.dim, { left: 0, right: 0, top: 0, height: hole.y }]} />
        <View style={[styles.dim, { left: 0, right: 0, top: hole.y + hole.height, bottom: 0 }]} />
        <View style={[styles.dim, { left: 0, width: hole.x, top: hole.y, height: hole.height }]} />
        <View style={[styles.dim, { left: hole.x + hole.width, right: 0, top: hole.y, height: hole.height }]} />
        <View pointerEvents="none" style={[styles.ring, { left: hole.x, top: hole.y, width: hole.width, height: hole.height, borderColor: colors.brand }]} />

        <Animated.View
          accessibilityViewIsModal
          style={[styles.callout, vertical, { left, width: calloutW, transform: [{ translateY: slide }] }]}
          testID="editor-tour-callout"
        >
          <Text style={styles.count}>
            {position} OF {available.length}
          </Text>
          {/* A focusable wrapper, since Text doesn't take a ref; screen readers land here on each step. */}
          <View ref={titleRef} accessible accessibilityRole="header" accessibilityLabel={`Step ${position} of ${available.length}. ${step.title}`}>
            <Text variant="title">{step.title}</Text>
          </View>
          <Text variant="muted" style={styles.body}>
            {step.body}
          </Text>
          <View style={styles.actions}>
            {!last && (
              <Pressable onPress={skipEditorTour} accessibilityRole="button" accessibilityLabel="Skip tour" hitSlop={10} testID="editor-tour-skip">
                <Text variant="muted">Skip tour</Text>
              </Pressable>
            )}
            <View style={styles.flex} />
            <Pressable
              onPress={nextTourStep}
              accessibilityRole="button"
              accessibilityLabel={last ? 'Done, end the tour' : 'Next step'}
              style={({ pressed }) => [styles.next, { backgroundColor: colors.brand }, pressed && styles.pressed]}
              testID="editor-tour-next"
            >
              <Text style={[styles.nextText, { color: colors.brandForeground }]}>{last ? 'Done' : 'Next'}</Text>
            </Pressable>
          </View>
        </Animated.View>
      </Animated.View>
    </Modal>
  );
}

const useStyles = makeStyles((colors) => ({
  fill: { flex: 1 },
  flex: { flex: 1 },
  dim: { position: 'absolute', backgroundColor: 'rgba(0,0,0,0.7)' },
  ring: { position: 'absolute', borderWidth: 2, borderRadius: radius.md },
  callout: {
    position: 'absolute',
    gap: spacing.xs + 2,
    padding: spacing.md,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.brand,
    backgroundColor: colors.card,
  },
  count: { color: colors.brand, fontFamily: fonts.sans.semibold, fontSize: 11, letterSpacing: 1.2 },
  body: { fontSize: fontSizes.sm, lineHeight: fontSizes.sm * 1.5 },
  actions: { flexDirection: 'row', alignItems: 'center', marginTop: spacing.sm },
  next: { minHeight: 40, minWidth: 84, paddingHorizontal: spacing.md, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  nextText: { fontFamily: fonts.sans.semibold, fontSize: fontSizes.sm },
  pressed: { opacity: 0.8 },
}));
