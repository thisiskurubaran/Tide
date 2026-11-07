import { useEffect, useMemo, useState } from 'react';
import { Linking, StyleSheet, View } from 'react-native';
import WebView from 'react-native-webview';

import { buffersStore, useBuffers, useSettings, workspace } from '../../state';
import { bufferKey } from '../../state/buffers';
import { useColors, useColorScheme } from '../../theme/theme';
import { Asset } from 'expo-asset';
import { File } from 'expo-file-system';

import { hasMath, KatexAssets, mathAssets } from './math';
import { hasMermaid, imageType, jsonToHtml, localImages, markdownToHtml, mermaidScripts, notebookToHtml, PageScripts, previewKind, previewPage, svgToHtml } from './render';

const RENDER_DELAY_MS = 250;
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;

// The HTML for a file's preview. The page can't read project files, so local
// images go in as data URIs.
export async function previewBody(project: string, path: string, content: string): Promise<string> {
  const kind = previewKind(path);
  if (kind === 'svg') return svgToHtml(content);
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

// KaTeX's script and its CSS (fonts inlined), read once, the first time a
// document has math.
let katexAssets: Promise<KatexAssets> | null = null;
export function loadKatex(): Promise<KatexAssets> {
  katexAssets ??= (async () => {
    /* eslint-disable @typescript-eslint/no-require-imports */
    const assets = [require('../../../assets/katex/katex.js.txt'), require('../../../assets/katex/katex.css.txt')].map((m) => Asset.fromModule(m));
    /* eslint-enable @typescript-eslint/no-require-imports */
    await Promise.all(assets.map((a) => a.downloadAsync()));
    const [script, css] = await Promise.all(assets.map((a) => new File(a.localUri ?? a.uri).text()));
    return { script, css };
  })().catch((e) => {
    katexAssets = null;
    throw e;
  });
  return katexAssets;
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
  const [katex, setKatex] = useState<KatexAssets | null>(null);
  const math = html !== null && hasMath(html);

  useEffect(() => {
    if (diagrams && mermaid === null) loadMermaid().then(setMermaid, () => undefined);
  }, [diagrams, mermaid]);

  useEffect(() => {
    if (math && katex === null) loadKatex().then(setKatex, () => undefined);
  }, [math, katex]);

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
  const extras = useMemo(() => (html !== null ? mathAssets(html, katex) : null), [html, katex]);
  // Scripts run only for diagrams and math, and only Mermaid's and KaTeX's (see mermaidScripts).
  const run = useMemo<PageScripts | undefined>(() => {
    const n = nonce();
    const scripts = [...(diagrams && mermaid ? mermaidScripts(mermaid, scheme === 'dark', n).scripts : []), ...(extras?.scripts ?? [])];
    return scripts.length ? { nonce: n, scripts } : undefined;
  }, [diagrams, mermaid, scheme, extras]);
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
        extras?.css,
      ),
    [html, colors, fontSize, run, extras],
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
