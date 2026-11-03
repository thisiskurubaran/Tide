// The projects home with nothing in it yet: an illustration, three samples
// that create a project in one tap, and the other ways to start.
import Feather from '@expo/vector-icons/Feather';
import { useState } from 'react';
import { Pressable, View } from 'react-native';

import type { IconName } from '../../components/Button';
import { Text } from '../../components/Text';
import { makeStyles, useColors } from '../../theme/theme';
import { borderWidth, fonts, fontSizes, radius, spacing } from '../../theme/tokens';

export interface Sample {
  // The template in files/templates.ts.
  template: string;
  // The project's name; a number is added when it's taken.
  name: string;
  title: string;
  subtitle: string;
  icon: IconName;
}

// Closest existing templates; the subtitles say what each really creates.
export const SAMPLES: Sample[] = [
  { template: 'static-site', name: 'portfolio', title: 'Portfolio website', subtitle: 'HTML, CSS and live preview', icon: 'globe' },
  { template: 'python-hello', name: 'python-script', title: 'Python script', subtitle: 'Asks your name and says hello', icon: 'terminal' },
  { template: 'express-api', name: 'node-api', title: 'Node API', subtitle: 'Express server on port 3000', icon: 'server' },
];

// "portfolio", then "portfolio-2", "portfolio-3"…
export function uniqueProjectName(base: string, taken: readonly string[]): string {
  const used = new Set(taken.map((t) => t.toLowerCase()));
  if (!used.has(base.toLowerCase())) return base;
  let n = 2;
  while (used.has(`${base}-${n}`.toLowerCase())) n++;
  return `${base}-${n}`;
}

interface EmptyProjectsProps {
  onSample(sample: Sample): Promise<void>;
  onOpenFolder(): void;
  onClone(): void;
}

export function EmptyProjects({ onSample, onOpenFolder, onClone }: EmptyProjectsProps) {
  const styles = useStyles();
  const colors = useColors();
  // One sample at a time, so a double tap doesn't make portfolio and portfolio-2.
  const [busy, setBusy] = useState<string | null>(null);

  async function start(sample: Sample) {
    if (busy) return;
    setBusy(sample.template);
    try {
      await onSample(sample);
    } finally {
      setBusy(null);
    }
  }

  return (
    <View style={styles.root} testID="projects-empty">
      <Illustration />
      <View style={styles.intro}>
        <Text variant="heading" style={styles.title}>
          Write and run code anywhere
        </Text>
        <Text variant="muted" style={styles.subtitle}>
          JavaScript, Python, HTML and more run right on this device, offline.
        </Text>
      </View>

      <Text style={styles.section} accessibilityRole="header">
        Start with
      </Text>
      <View style={styles.samples}>
        {SAMPLES.map((s) => (
          <Pressable
            key={s.template}
            testID={`sample-${s.template}`}
            onPress={() => start(s)}
            disabled={busy !== null}
            accessibilityRole="button"
            accessibilityLabel={`${s.title}, ${s.subtitle}`}
            accessibilityHint="Creates the project and opens it"
            accessibilityState={{ busy: busy === s.template, disabled: busy !== null }}
            style={({ pressed }) => [styles.sample, pressed && { backgroundColor: colors.secondary }, busy !== null && busy !== s.template && styles.faded]}
          >
            <View style={[styles.sampleIcon, { backgroundColor: colors.brandSoft }]}>
              <Feather name={s.icon} size={16} color={colors.brand} />
            </View>
            <View style={styles.sampleBody}>
              <Text style={styles.sampleTitle} numberOfLines={1}>
                {s.title}
              </Text>
              <Text variant="muted" style={styles.sampleSubtitle} numberOfLines={2}>
                {s.subtitle}
              </Text>
            </View>
            <Feather name={busy === s.template ? 'loader' : 'chevron-right'} size={16} color={colors.mutedForeground} />
          </Pressable>
        ))}
      </View>

      <View style={styles.more}>
        <Pressable
          testID="empty-open-folder"
          onPress={onOpenFolder}
          accessibilityRole="button"
          accessibilityLabel="Open from Files"
          accessibilityHint="Links a folder from the Files app as a project"
          style={({ pressed }) => [styles.moreButton, pressed && { backgroundColor: colors.secondary }]}
        >
          <Feather name="folder" size={15} color={colors.foreground} />
          <Text style={styles.moreText}>Open from Files</Text>
        </Pressable>
        <Pressable
          testID="empty-clone"
          onPress={onClone}
          accessibilityRole="button"
          accessibilityLabel="Clone repo"
          style={({ pressed }) => [styles.moreButton, pressed && { backgroundColor: colors.secondary }]}
        >
          <Feather name="git-branch" size={15} color={colors.foreground} />
          <Text style={styles.moreText}>Clone repo</Text>
        </Pressable>
      </View>
    </View>
  );
}

// The gradient runs sky to teal; without react-native-svg or a gradient
// module, each wave is a row of overlapping ellipses whose colour steps along it.
const SKY = [0x0e, 0xa5, 0xe9];
const TEAL = [0x2d, 0xd4, 0xbf];
const BUMPS = 6;
const mix = (t: number, alpha: number) => `rgba(${SKY.map((c, i) => Math.round(c + (TEAL[i] - c) * t)).join(',')},${alpha})`;

function Wave({ alpha, bottom, height, offset }: { alpha: number; bottom: number; height: number; offset: number }) {
  const styles = useStyles();
  return (
    <View style={[styles.wave, { bottom, height }]}>
      {Array.from({ length: BUMPS }, (_, i) => (
        <View
          key={i}
          style={[
            styles.bump,
            { left: `${(i * 100) / (BUMPS - 1) - 14 + offset}%`, width: '32%', height: height * 1.6, backgroundColor: mix(i / (BUMPS - 1), alpha) },
          ]}
        />
      ))}
    </View>
  );
}

function Illustration() {
  const styles = useStyles();
  const colors = useColors();
  const bars = [
    { width: '58%', color: colors.brand },
    { width: '78%', color: colors.success, indent: true },
    { width: '44%', color: colors.warning, indent: true },
    { width: '30%', color: colors.mutedForeground },
  ] as const;
  return (
    <View style={[styles.art, { backgroundColor: colors.card }]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Wave alpha={0.25} bottom={-34} height={78} offset={6} />
      <Wave alpha={0.45} bottom={-48} height={70} offset={-4} />
      <View style={styles.window}>
        <View style={styles.dots}>
          {/* The traffic lights read as "a window" in any theme. */}
          {['#ff5f57', '#febc2e', '#28c840'].map((c) => (
            <View key={c} style={[styles.dot, { backgroundColor: c }]} />
          ))}
        </View>
        <View style={styles.code}>
          {bars.map((b, i) => (
            <View key={i} style={[styles.bar, { width: b.width, backgroundColor: b.color }, 'indent' in b && styles.indent]} />
          ))}
        </View>
      </View>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  root: { gap: spacing.sm + 2 },
  art: {
    height: 168,
    borderRadius: radius.xl,
    borderWidth,
    borderColor: colors.border,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  wave: { position: 'absolute', left: 0, right: 0 },
  bump: { position: 'absolute', top: 0, borderRadius: 999 },
  window: {
    width: 168,
    marginBottom: spacing.md,
    borderRadius: radius.md,
    borderWidth,
    borderColor: colors.border,
    backgroundColor: colors.background,
    overflow: 'hidden',
    // Lifts the card off the waves.
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  dots: { flexDirection: 'row', gap: 5, paddingHorizontal: spacing.sm, paddingVertical: 7, borderBottomWidth: borderWidth, borderBottomColor: colors.border },
  dot: { width: 8, height: 8, borderRadius: 4 },
  code: { gap: 7, padding: spacing.sm + 2 },
  bar: { height: 6, borderRadius: 3, opacity: 0.85 },
  indent: { marginLeft: spacing.sm + 4 },
  intro: { alignItems: 'center', gap: spacing.xs, paddingHorizontal: spacing.md, marginTop: spacing.xs },
  title: { textAlign: 'center', fontSize: fontSizes.xl + 2 },
  subtitle: { textAlign: 'center', fontSize: fontSizes.sm, lineHeight: fontSizes.sm * 1.5 },
  section: {
    marginTop: spacing.sm,
    color: colors.mutedForeground,
    fontFamily: fonts.sans.semibold,
    fontSize: 11,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  samples: { gap: spacing.xs + 2 },
  sample: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm + 4,
    minHeight: 60,
    paddingHorizontal: spacing.sm + 4,
    paddingVertical: spacing.sm + 2,
    borderRadius: radius.lg,
    borderWidth,
    borderColor: colors.border,
    backgroundColor: colors.card,
  },
  faded: { opacity: 0.5 },
  sampleIcon: { width: 34, height: 34, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center' },
  sampleBody: { flex: 1, minWidth: 0, gap: 2 },
  sampleTitle: { color: colors.foreground, fontFamily: fonts.sans.semibold, fontSize: 15 },
  sampleSubtitle: { fontSize: fontSizes.xs },
  more: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xs },
  moreButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs + 2,
    minHeight: 44,
    borderRadius: radius.md,
    borderWidth,
    borderColor: colors.border,
  },
  moreText: { color: colors.foreground, fontFamily: fonts.sans.semibold, fontSize: fontSizes.sm },
}));
