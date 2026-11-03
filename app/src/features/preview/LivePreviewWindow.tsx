import Feather from '@expo/vector-icons/Feather';
import { router } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, LayoutChangeEvent, PanResponder, Pressable, StyleSheet, View } from 'react-native';
import WebView from 'react-native-webview';

import { useReduceMotion } from '../../components/a11y';
import { haptic } from '../../components/haptics';
import { Text } from '../../components/Text';
import { useLocalPorts } from '../../runtime/ports';
import { buffersStore, useRunner } from '../../state';
import { makeStyles, useColors } from '../../theme/theme';
import { borderWidth, fonts, radius } from '../../theme/tokens';
import { basename } from '../files/fs';
import { onlyStyles, RELOAD_KEEPING_SCROLL_SCRIPT, savedPaths, SWAP_CSS_SCRIPT } from '../remote/livePreview';
import { previewKind } from './render';

const MIN_W = 150;
const MIN_H = 160;
const MARGIN = 10;
const RELOAD_DELAY_MS = 300;

export type LiveSource = { kind: 'server'; port: number; url: string } | { kind: 'file'; path: string } | null;

// What the window shows: a dev server running on the device wins, since it's
// usually the app being built; otherwise the open HTML, Markdown or notebook file.
export function liveSource(path: string | null, ports: number[]): LiveSource {
  if (ports.length) return { kind: 'server', port: ports[0], url: `http://127.0.0.1:${ports[0]}/` };
  const kind = path ? previewKind(path) : null;
  if (path && kind && ['html', 'markdown', 'notebook', 'json'].includes(kind)) return { kind: 'file', path };
  return null;
}

// The corner nearest to where a dragged window was let go.
export function snapCorner(x: number, y: number, w: number, h: number, area: { width: number; height: number }) {
  const left = x + w / 2 < area.width / 2;
  const top = y + h / 2 < area.height / 2;
  return { x: left ? MARGIN : area.width - w - MARGIN, y: top ? MARGIN : area.height - h - MARGIN };
}

interface LivePreviewWindowProps {
  project: string;
  path: string | null;
  onClose(): void;
}

// A floating picture-in-picture preview over the editor on phones. Edits
// autosave, and each save reloads it (swapping only stylesheets for CSS), so
// it follows your typing. Drag the bar to move it; it settles in the nearest
// corner. Drag the corner to resize.
export function LivePreviewWindow({ project, path, onClose }: LivePreviewWindowProps) {
  const styles = useStyles();
  const colors = useColors();
  const reduceMotion = useReduceMotion();
  const mode = useRunner((s) => s.mode);
  const ports = useLocalPorts(project);
  const source = useMemo(() => liveSource(path, mode === 'local' ? ports : []), [path, ports, mode]);
  const [area, setArea] = useState({ width: 0, height: 0 });
  const [size, setSize] = useState({ w: 200, h: 260 });
  const pos = useRef(new Animated.ValueXY({ x: 0, y: 0 })).current;
  const placed = useRef(false);
  const latest = useRef({ area, size });
  latest.current = { area, size };

  // Starts in the bottom-right corner, above the status bar.
  const onLayout = (e: LayoutChangeEvent) => {
    const next = { width: e.nativeEvent.layout.width, height: e.nativeEvent.layout.height };
    setArea(next);
    if (!placed.current && next.width > 0) {
      placed.current = true;
      pos.setValue({ x: next.width - size.w - MARGIN, y: next.height - size.h - MARGIN });
    }
  };

  const settle = (x: number, y: number) => {
    const { area: a, size: s } = latest.current;
    const to = snapCorner(x, y, s.w, s.h, a);
    if (reduceMotion) pos.setValue(to);
    else Animated.spring(pos, { toValue: to, damping: 20, stiffness: 220, useNativeDriver: false }).start();
  };

  const start = useRef({ x: 0, y: 0, w: 0, h: 0 });
  const move = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: () => {
          start.current = { ...start.current, x: (pos.x as unknown as { _value: number })._value, y: (pos.y as unknown as { _value: number })._value };
        },
        onPanResponderMove: (_e, g) => pos.setValue({ x: start.current.x + g.dx, y: start.current.y + g.dy }),
        onPanResponderRelease: (_e, g) => {
          haptic('select');
          settle(start.current.x + g.dx, start.current.y + g.dy);
        },
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  const resize = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: () => {
          start.current = { ...start.current, w: latest.current.size.w, h: latest.current.size.h };
        },
        onPanResponderMove: (_e, g) => {
          const { area: a } = latest.current;
          setSize({
            w: Math.max(MIN_W, Math.min(a.width - MARGIN * 2, start.current.w + g.dx)),
            h: Math.max(MIN_H, Math.min(a.height - MARGIN * 2, start.current.h + g.dy)),
          });
        },
        onPanResponderRelease: () => {
          haptic('select');
          settle((pos.x as unknown as { _value: number })._value, (pos.y as unknown as { _value: number })._value);
        },
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const title = source?.kind === 'server' ? `:${source.port}` : source ? basename(source.path) : 'Live preview';
  const expand = () => {
    if (source?.kind === 'server') router.push({ pathname: '/preview', params: { url: source.url, port: String(source.port), project } });
    else if (source?.kind === 'file' && previewKind(source.path) === 'html') {
      const { projectFileUrl } = require('./fileUrl') as typeof import('./fileUrl');
      router.push({ pathname: '/preview', params: { url: projectFileUrl(project, source.path), project } });
    }
  };

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none" onLayout={onLayout}>
      {area.width > 0 && (
        <Animated.View style={[styles.window, { width: size.w, height: size.h, transform: pos.getTranslateTransform() }]} testID="live-preview">
          <View {...move.panHandlers} style={styles.bar} accessibilityRole="header" accessibilityLabel={`Live preview, ${title}. Drag to move.`}>
            <View style={[styles.dot, { backgroundColor: colors.success }]} />
            <Text style={[styles.live, { color: colors.success }]}>Live</Text>
            <Text style={styles.title} numberOfLines={1}>
              {title}
            </Text>
            {source && (source.kind === 'server' || previewKind(source.path) === 'html') && (
              <Pressable onPress={expand} hitSlop={8} accessibilityRole="button" accessibilityLabel="Open full screen" testID="live-preview-expand">
                <Feather name="maximize-2" size={13} color={colors.mutedForeground} />
              </Pressable>
            )}
            <Pressable onPress={onClose} hitSlop={8} accessibilityRole="button" accessibilityLabel="Close live preview" testID="live-preview-close">
              <Feather name="x" size={14} color={colors.mutedForeground} />
            </Pressable>
          </View>
          <View style={styles.body}>
            {source?.kind === 'server' ? (
              <ServerFrame project={project} url={source.url} />
            ) : source?.kind === 'file' ? (
              (() => {
                // Loaded on first use, like the project screen's viewers.
                if (previewKind(source.path) === 'html') {
                  const { HtmlFilePreview } = require('./HtmlFilePreview') as typeof import('./HtmlFilePreview');
                  return <HtmlFilePreview project={project} path={source.path} compact />;
                }
                const { PreviewPane } = require('./PreviewPane') as typeof import('./PreviewPane');
                return <PreviewPane project={project} path={source.path} />;
              })()
            ) : (
              <View style={styles.empty}>
                <Feather name="eye-off" size={18} color={colors.mutedForeground} />
                <Text variant="muted" style={styles.emptyText}>
                  Open an HTML or Markdown file, or start a dev server.
                </Text>
              </View>
            )}
          </View>
          <View {...resize.panHandlers} style={styles.corner} accessibilityLabel="Resize" testID="live-preview-resize">
            <View style={[styles.cornerMark, { borderColor: colors.brand }]} />
          </View>
        </Animated.View>
      )}
    </View>
  );
}

// A dev server's page, reloaded whenever a project file is saved.
function ServerFrame({ project, url }: { project: string; url: string }) {
  const webview = useRef<WebView<object>>(null);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let pending: string[] = [];
    const unsubscribe = buffersStore.subscribe((s, prev) => {
      const paths = savedPaths(prev.buffers, s.buffers, project);
      if (!paths.length) return;
      pending = [...pending, ...paths];
      clearTimeout(timer);
      timer = setTimeout(() => {
        webview.current?.injectJavaScript(onlyStyles(pending) ? SWAP_CSS_SCRIPT : RELOAD_KEEPING_SCROLL_SCRIPT);
        pending = [];
      }, RELOAD_DELAY_MS);
    });
    return () => {
      clearTimeout(timer);
      unsubscribe();
    };
  }, [project]);
  return <WebView<object> ref={webview} source={{ uri: url }} originWhitelist={['http://*', 'https://*']} style={{ flex: 1, backgroundColor: '#ffffff' }} />;
}

const useStyles = makeStyles((colors) => ({
  window: {
    position: 'absolute',
    left: 0,
    top: 0,
    borderRadius: radius.lg + 2,
    overflow: 'hidden',
    backgroundColor: '#ffffff',
    borderWidth,
    borderColor: colors.brand,
    shadowColor: '#000',
    shadowOpacity: 0.5,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    elevation: 12,
    zIndex: 20,
  },
  bar: { height: 28, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 8, backgroundColor: colors.card },
  dot: { width: 6, height: 6, borderRadius: 3 },
  live: { fontFamily: fonts.sans.semibold, fontSize: 11 },
  title: { flex: 1, fontFamily: fonts.sans.regular, fontSize: 11, color: colors.mutedForeground },
  body: { flex: 1 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 6, padding: 12, backgroundColor: colors.background },
  emptyText: { textAlign: 'center', fontSize: 12 },
  corner: { position: 'absolute', right: 0, bottom: 0, width: 28, height: 28, alignItems: 'flex-end', justifyContent: 'flex-end', padding: 5 },
  cornerMark: { width: 12, height: 12, borderRightWidth: 2, borderBottomWidth: 2, borderBottomRightRadius: 4 },
}));
