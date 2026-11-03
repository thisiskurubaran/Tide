import Feather from '@expo/vector-icons/Feather';
import { ComponentRef, Fragment, ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityActionEvent, GestureResponderEvent, Pressable, ScrollView, View } from 'react-native';

import { borderWidth, fonts, fontSizes, radius, spacing } from '../theme/tokens';
import { IconName } from './Button';
import { haptic } from './haptics';
import { createCursorSwipe, DRAG_SLOP, LONG_PRESS_MS, VariantBox, variantAt } from './keyGesture';
import { Text } from './Text';
import { makeStyles, useColors } from '../theme/theme';

export const KEY_BAR_HEIGHT = 44;
const KEY_HEIGHT = 32;
// Variant cells are square and big enough to land a finger on.
const CELL = 44;
const POPOVER_GAP = 4;
// Padding plus border around the cells.
const POPOVER_INSET = 2 + borderWidth;
// Labels stay inside the 32pt chips at large text sizes.
const MAX_FONT_SCALE = 1.3;

// Offered when a key is held, e.g. () for (.
export type KeyVariant = { label: string; a11y: string; onPress(): void };

// `active` marks a toggle that is on, such as select mode.
export type KeyItem = { a11y: string; onPress(): void; active?: boolean; variants?: KeyVariant[] } & ({ label: string } | { icon: IconName });

interface KeyBarProps {
  // Groups are separated by a thin divider.
  groups: KeyItem[][];
  // Fixed before the scrolling keys, e.g. the cursor trackpad.
  leading?: ReactNode;
  onHide(): void;
  // A drag across the keys moves the cursor this many characters (negative is
  // left). The row then pages with a key instead of scrolling, since both are horizontal drags.
  onSwipe?(steps: number): void;
  testID?: string;
}

// Lets a held key open the variant popover, which lives on the bar so the
// scroll view doesn't clip it.
interface VariantHost {
  show(variants: KeyVariant[], keyLeft: number, keyTop: number): VariantBox;
  select(index: number | null): void;
  hide(): void;
}

// Accessory row that sits on top of the software keyboard. Native buttons never
// take focus from the WebView, so the keyboard stays up while they are tapped.
export function KeyBar({ groups, leading, onHide, onSwipe, testID }: KeyBarProps) {
  const styles = useStyles();
  const colors = useColors();
  const bar = useRef<ComponentRef<typeof View>>(null);
  const barFrame = useRef({ x: 0, width: 0 });
  const [popover, setPopover] = useState<{ variants: KeyVariant[]; left: number; selected: number | null } | null>(null);
  const host = useMemo<VariantHost>(
    () => ({
      show(variants, keyLeft, keyTop) {
        const { x, width } = barFrame.current;
        // The first variant sits over the key, shifted to stay on screen.
        const left = Math.max(spacing.xs, Math.min(keyLeft - x - POPOVER_INSET, width - variants.length * CELL - 2 * POPOVER_INSET - spacing.xs));
        setPopover({ variants, left, selected: null });
        const top = keyTop - POPOVER_GAP - POPOVER_INSET - CELL;
        return { left: x + left + POPOVER_INSET, top, bottom: keyTop + KEY_HEIGHT, cell: CELL, count: variants.length };
      },
      select: (selected) => setPopover((p) => (p && p.selected !== selected ? { ...p, selected } : p)),
      hide: () => setPopover(null),
    }),
    [],
  );

  const scroll = useRef<ComponentRef<typeof ScrollView>>(null);
  const [size, setSize] = useState({ view: 0, content: 0 });
  const [offset, setOffset] = useState(0);
  const max = size.content - size.view;
  const atEnd = offset >= max - 1;
  const page = () => {
    const next = atEnd ? 0 : Math.min(offset + size.view * 0.8, max);
    scroll.current?.scrollTo({ x: next, animated: true });
    setOffset(next);
  };

  return (
    <View
      ref={bar}
      style={styles.bar}
      testID={testID}
      onLayout={() =>
        bar.current?.measureInWindow((x, _y, width) => {
          barFrame.current = { x, width };
        })
      }
    >
      {leading}
      <ScrollView
        ref={scroll}
        testID={testID && `${testID}-keys`}
        horizontal
        scrollEnabled={!onSwipe}
        keyboardShouldPersistTaps="always"
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.keys}
        onLayout={(e) => setSize((s) => ({ ...s, view: e.nativeEvent.layout.width }))}
        onContentSizeChange={(content) => setSize((s) => ({ ...s, content }))}
      >
        {groups.map((group, g) => (
          <Fragment key={g}>
            {g > 0 && <View style={styles.divider} />}
            {group.map((k, i) =>
              // Users can add the same key twice, so the index keeps keys unique.
              onSwipe || k.variants?.length ? (
                <GestureKey key={`${i}-${k.a11y}`} item={k} onSwipe={onSwipe} host={host} />
              ) : (
                <Pressable
                  accessibilityRole="button"
                  key={`${i}-${k.a11y}`}
                  accessibilityLabel={k.a11y}
                  accessibilityState={k.active === undefined ? undefined : { selected: k.active }}
                  onPress={() => {
                    haptic('tap');
                    k.onPress();
                  }}
                  style={({ pressed }) => [styles.key, (pressed || k.active) && styles.pressed, k.active && styles.active]}
                >
                  <KeyFace item={k} />
                </Pressable>
              ),
            )}
          </Fragment>
        ))}
      </ScrollView>
      {onSwipe && max > 1 && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="More keys"
          onPress={page}
          style={({ pressed }) => [styles.edge, styles.more, pressed && styles.pressed]}
        >
          <Feather name={atEnd ? 'chevrons-left' : 'chevrons-right'} size={18} color={colors.mutedForeground} />
        </Pressable>
      )}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Hide keyboard"
        onPress={onHide}
        style={({ pressed }) => [styles.edge, styles.hide, pressed && styles.pressed]}
      >
        <Feather name="chevron-down" size={18} color={colors.mutedForeground} />
      </Pressable>
      {popover && (
        <View pointerEvents="none" style={[styles.popover, { left: popover.left }]}>
          {popover.variants.map((v, i) => (
            <View key={i} style={[styles.cell, i === popover.selected && styles.active]}>
              <Text style={styles.label} numberOfLines={1} adjustsFontSizeToFit maxFontSizeMultiplier={MAX_FONT_SCALE}>
                {v.label}
              </Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

function KeyFace({ item }: { item: KeyItem }) {
  const styles = useStyles();
  const colors = useColors();
  return 'icon' in item ? (
    <Feather name={item.icon} size={16} color={colors.foreground} />
  ) : (
    <Text style={styles.label} numberOfLines={1} maxFontSizeMultiplier={MAX_FONT_SCALE}>
      {item.label}
    </Text>
  );
}

interface Gesture {
  // Undecided until it moves past the slop (swipe) or is held (variants).
  mode: 'pending' | 'swipe' | 'variants' | 'cancelled';
  x0: number;
  y0: number;
  x: number;
  y: number;
  t: number;
  swipe: ReturnType<typeof createCursorSwipe>;
  box: VariantBox | null;
  selected: number | null;
  timer?: ReturnType<typeof setTimeout>;
}

// A key that tells a tap from a drag (cursor swipe) and a hold (variants).
// Raw responder events rather than Pressable, which would fire on release after a drag.
function GestureKey({ item, onSwipe, host }: { item: KeyItem; onSwipe?(steps: number): void; host: VariantHost }) {
  const styles = useStyles();
  const gesture = useRef<Gesture | null>(null);
  const [pressed, setPressed] = useState(false);
  useEffect(() => () => clearTimeout(gesture.current?.timer), []);

  const end = () => {
    clearTimeout(gesture.current?.timer);
    if (gesture.current?.mode === 'variants') host.hide();
    gesture.current = null;
    setPressed(false);
  };

  const grant = (e: GestureResponderEvent) => {
    const { pageX, pageY, locationX, locationY, timestamp } = e.nativeEvent;
    const g: Gesture = { mode: 'pending', x0: pageX, y0: pageY, x: pageX, y: pageY, t: timestamp, swipe: createCursorSwipe(), box: null, selected: null };
    const variants = item.variants;
    if (variants?.length) {
      g.timer = setTimeout(() => {
        if (gesture.current !== g || g.mode !== 'pending') return;
        g.mode = 'variants';
        g.box = host.show(variants, pageX - locationX, pageY - locationY);
        g.selected = variantAt(g.box, g.x, g.y);
        host.select(g.selected);
        haptic('press');
      }, LONG_PRESS_MS);
    }
    gesture.current = g;
    setPressed(true);
  };

  const move = (e: GestureResponderEvent) => {
    const g = gesture.current;
    if (!g) return;
    const { pageX, pageY, timestamp } = e.nativeEvent;
    if (g.mode === 'pending') {
      const dx = pageX - g.x0;
      const dy = pageY - g.y0;
      // Past the slop it is a drag, never a tap; only a sideways one moves the cursor.
      if (onSwipe && Math.abs(dx) > DRAG_SLOP && Math.abs(dx) >= Math.abs(dy)) g.mode = 'swipe';
      else if (Math.hypot(dx, dy) > DRAG_SLOP) g.mode = 'cancelled';
      if (g.mode !== 'pending') {
        clearTimeout(g.timer);
        setPressed(false);
      }
    } else if (g.mode === 'swipe') {
      const { steps, tick } = g.swipe.move(pageX - g.x, timestamp - g.t);
      if (steps) onSwipe?.(steps);
      if (tick) haptic('select');
    } else if (g.mode === 'variants' && g.box) {
      const selected = variantAt(g.box, pageX, pageY);
      if (selected !== g.selected) {
        g.selected = selected;
        host.select(selected);
        if (selected !== null) haptic('select');
      }
    }
    g.x = pageX;
    g.y = pageY;
    g.t = timestamp;
  };

  const release = () => {
    const g = gesture.current;
    end();
    if (g?.mode === 'pending') {
      haptic('tap');
      item.onPress();
    } else if (g?.mode === 'variants' && g.selected !== null) {
      haptic('tap');
      item.variants?.[g.selected]?.onPress();
    }
  };

  // VoiceOver can't hold a key, so variants are custom actions too.
  const onAction = (e: AccessibilityActionEvent) => {
    const name = e.nativeEvent.actionName;
    if (name === 'activate') return item.onPress();
    item.variants?.[Number(name.slice('variant-'.length))]?.onPress();
  };

  return (
    <View
      accessible
      accessibilityRole="button"
      accessibilityLabel={item.a11y}
      accessibilityState={item.active === undefined ? undefined : { selected: item.active }}
      accessibilityActions={[{ name: 'activate' }, ...(item.variants ?? []).map((v, i) => ({ name: `variant-${i}`, label: v.a11y }))]}
      onAccessibilityAction={onAction}
      onStartShouldSetResponder={() => true}
      onResponderGrant={grant}
      onResponderMove={move}
      onResponderRelease={release}
      onResponderTerminate={end}
      // In a scrolling row, a drag that isn't a swipe or a hold goes to the scroll view.
      onResponderTerminationRequest={() => gesture.current?.mode !== 'swipe' && gesture.current?.mode !== 'variants'}
      style={[styles.key, (pressed || item.active) && styles.pressed, item.active && styles.active]}
    >
      <KeyFace item={item} />
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  bar: {
    height: KEY_BAR_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.card,
    borderTopWidth: borderWidth,
    borderColor: colors.border,
  },
  keys: { alignItems: 'center', gap: spacing.xs, paddingHorizontal: spacing.sm },
  key: {
    minWidth: 36,
    height: KEY_HEIGHT,
    paddingHorizontal: spacing.sm,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.sm,
    backgroundColor: colors.secondary,
  },
  pressed: { backgroundColor: colors.border },
  active: { backgroundColor: colors.brandSoft },
  label: { fontFamily: fonts.mono.semibold, fontSize: fontSizes.md, color: colors.foreground },
  divider: { width: borderWidth, height: 20, backgroundColor: colors.border, marginHorizontal: spacing.xs },
  edge: { height: KEY_BAR_HEIGHT, alignItems: 'center', justifyContent: 'center', borderLeftWidth: borderWidth, borderColor: colors.border },
  more: { width: 36 },
  hide: { width: KEY_BAR_HEIGHT },
  popover: {
    position: 'absolute',
    bottom: (KEY_BAR_HEIGHT + KEY_HEIGHT) / 2 + POPOVER_GAP,
    flexDirection: 'row',
    padding: POPOVER_INSET - borderWidth,
    borderRadius: radius.md,
    backgroundColor: colors.secondary,
    borderWidth,
    borderColor: colors.border,
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 6,
  },
  cell: { width: CELL, height: CELL, paddingHorizontal: 2, alignItems: 'center', justifyContent: 'center', borderRadius: radius.sm },
}));
