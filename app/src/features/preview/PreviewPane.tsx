import { useEffect, useMemo, useState } from 'react';
import { Linking, StyleSheet, View } from 'react-native';
import WebView from 'react-native-webview';

import { buffersStore, useBuffers, useSettings, workspace } from '../../state';
import { bufferKey } from '../../state/buffers';
import { useColors } from '../../theme/theme';
import { imageType, localImages, markdownToHtml, notebookToHtml, previewKind, previewPage } from './render';

const RENDER_DELAY_MS = 250;
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;

// Rendered Markdown or notebook for the open file, following edits as you
// type. Scripts are off; links open in the browser.
export function PreviewPane({ project, path }: { project: string; path: string }) {
  const colors = useColors();
  const fontSize = useSettings((s) => s.editorFontSize);
  const content = useBuffers((s) => s.buffers[bufferKey(project, path)]?.content);
  const [html, setHtml] = useState<string | null>(null);

  useEffect(() => {
    if (content === undefined) buffersStore.getState().load(project, path).catch(() => setHtml('<p>This file could not be opened.</p>'));
  }, [content, project, path]);

  useEffect(() => {
    if (content === undefined) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      let body = previewKind(path) === 'notebook' ? notebookToHtml(content) : markdownToHtml(content);
      // The page can't read project files, so local images go in as data URIs.
      for (const img of localImages(body, path)) {
        const type = imageType(img.path);
        if (!type) continue;
        const size = await workspace.fileSize(project, img.path).catch(() => Infinity);
        if (size > MAX_IMAGE_BYTES) continue;
        const data = await workspace.readBase64(project, img.path).catch(() => null);
        if (data) body = body.split(`src="${img.src}"`).join(`src="data:${type};base64,${data}"`);
      }
      if (!cancelled) setHtml(body);
    }, RENDER_DELAY_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [content, path, project]);

  const page = useMemo(
    () =>
      previewPage(
        html ?? '',
        {
          background: colors.background,
          foreground: colors.foreground,
          muted: colors.mutedForeground,
          border: colors.border,
          code: colors.secondary,
          link: colors.brand,
          error: colors.destructive,
        },
        fontSize,
      ),
    [html, colors, fontSize],
  );

  return (
    <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.background }]} testID="preview">
      {html !== null && (
        <WebView<object>
          source={{ html: page }}
          originWhitelist={['about:blank']}
          javaScriptEnabled={false}
          allowFileAccess={false}
          setSupportMultipleWindows={false}
          style={{ backgroundColor: colors.background }}
          onShouldStartLoadWithRequest={(req) => {
            if (req.url === 'about:blank' || req.url.startsWith('data:')) return true;
            if (/^(https?|mailto):/i.test(req.url)) Linking.openURL(req.url).catch(() => undefined);
            return false;
          }}
        />
      )}
    </View>
  );
}
