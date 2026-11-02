import { useEffect, useMemo, useState } from 'react';
import { Linking, StyleSheet, View } from 'react-native';
import WebView from 'react-native-webview';

import { buffersStore, useBuffers, useSettings, workspace } from '../../state';
import { bufferKey } from '../../state/buffers';
import { useColors, useColorScheme } from '../../theme/theme';
import { Asset } from 'expo-asset';
import { File } from 'expo-file-system';

import { hasMermaid, imageType, jsonToHtml, localImages, markdownToHtml, mermaidScripts, notebookToHtml, PageScripts, previewKind, previewPage } from './render';

const RENDER_DELAY_MS = 250;
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;

// The HTML for a file's preview. The page can't read project files, so local
// images go in as data URIs.
export async function previewBody(project: string, path: string, content: string): Promise<string> {
  const kind = previewKind(path);
  let body = kind === 'notebook' ? notebookToHtml(content) : kind === 'json' ? jsonToHtml(content) : markdownToHtml(content);
  for (const img of localImages(body, path)) {
    const type = imageType(img.path);
    if (!type) continue;
    const size = await workspace.fileSize(project, img.path).catch(() => Infinity);
    if (size > MAX_IMAGE_BYTES) continue;
    const data = await workspace.readBase64(project, img.path).catch(() => null);
    if (data) body = body.split(`src="${img.src}"`).join(`src="data:${type};base64,${data}"`);
  }
  return body;
}

// Read once, the first time a document has a diagram.
let mermaidLibrary: Promise<string> | null = null;
function loadMermaid(): Promise<string> {
  mermaidLibrary ??= (async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const asset = Asset.fromModule(require('../../../assets/mermaid/mermaid.js.txt'));
    await asset.downloadAsync();
    return new File(asset.localUri ?? asset.uri).text();
  })().catch((e) => {
    mermaidLibrary = null;
    throw e;
  });
  return mermaidLibrary;
}

const nonce = () => Array.from({ length: 4 }, () => Math.random().toString(36).slice(2)).join('');

// Rendered Markdown, notebook or JSON tree for the open file, following edits as you
// type. Scripts are off; links open in the browser.
export function PreviewPane({ project, path }: { project: string; path: string }) {
  const colors = useColors();
  const fontSize = useSettings((s) => s.editorFontSize);
  const content = useBuffers((s) => s.buffers[bufferKey(project, path)]?.content);
  const [html, setHtml] = useState<string | null>(null);
  const [mermaid, setMermaid] = useState<string | null>(null);
  const diagrams = html !== null && hasMermaid(html);

  useEffect(() => {
    if (diagrams && mermaid === null) loadMermaid().then(setMermaid, () => undefined);
  }, [diagrams, mermaid]);

  useEffect(() => {
    if (content === undefined) buffersStore.getState().load(project, path).catch(() => setHtml('<p>This file could not be opened.</p>'));
  }, [content, project, path]);

  useEffect(() => {
    if (content === undefined) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      const body = await previewBody(project, path, content);
      if (!cancelled) setHtml(body);
    }, RENDER_DELAY_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [content, path, project]);

  const scheme = useColorScheme();
  // Scripts run only for diagrams, and only Mermaid's (see mermaidScripts).
  const run = useMemo<PageScripts | undefined>(() => (diagrams && mermaid ? mermaidScripts(mermaid, scheme === 'dark', nonce()) : undefined), [diagrams, mermaid, scheme]);
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
        run,
      ),
    [html, colors, fontSize, run],
  );

  return (
    <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.background }]} testID="preview">
      {html !== null && (
        <WebView<object>
          source={{ html: page }}
          originWhitelist={['about:blank']}
          javaScriptEnabled={!!run}
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
