import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Linking, StyleSheet, View } from 'react-native';
import WebView from 'react-native-webview';

import { Screen } from '../../components/Screen';
import { Text } from '../../components/Text';
import { useSettings } from '../../state';
import { useColors } from '../../theme/theme';
import { escapeHtml, previewPage } from '../preview/render';
import { docs } from '.';
import { DOC_LINK, InstalledDoc, rewriteLinks } from './docs';

// One page of an offline doc, with its license at the end.
export function DocPageScreen() {
  const { slug, path } = useLocalSearchParams<{ slug: string; path: string }>();
  const colors = useColors();
  const fontSize = useSettings((s) => s.editorFontSize);
  const [body, setBody] = useState<string | null>(null);
  const [doc, setDoc] = useState<InstalledDoc | null>(null);

  useEffect(() => {
    docs.installed().then((all) => setDoc(all.find((d) => d.slug === slug) ?? null), () => undefined);
    docs.page(slug, path).then(
      (html) => setBody(html ?? '<p>This page isn\'t in the downloaded doc.</p>'),
      (e: Error) => setBody(`<p>${escapeHtml(e.message)}</p>`),
    );
  }, [slug, path]);

  const anchor = path.includes('#') ? path.slice(path.indexOf('#') + 1) : null;
  const page = useMemo(() => {
    if (body === null) return null;
    const footer = doc?.attribution ? `<hr><div class="note">${doc.attribution}</div>` : '';
    return previewPage(
      rewriteLinks(body, path) + footer,
      { background: colors.background, foreground: colors.foreground, muted: colors.mutedForeground, border: colors.border, code: colors.secondary, link: colors.brand, error: colors.destructive },
      fontSize,
      anchor ? { nonce: 'docs', scripts: [`document.getElementById(${JSON.stringify(anchor)})&&document.getElementById(${JSON.stringify(anchor)}).scrollIntoView()`] } : undefined,
    );
  }, [body, doc, path, anchor, colors, fontSize]);

  const title = /<h1[^>]*>([\s\S]*?)<\/h1>/.exec(body ?? '')?.[1]?.replace(/<[^>]+>/g, '') ?? path.split('/').pop() ?? '';
  return (
    <Screen title={title} subtitle={doc ? doc.name : undefined} scroll={false} testID="doc-page">
      {page === null ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.mutedForeground} />
        </View>
      ) : (
        <WebView<object>
          source={{ html: page }}
          originWhitelist={['about:blank']}
          javaScriptEnabled={!!anchor}
          style={{ backgroundColor: colors.background }}
          onShouldStartLoadWithRequest={(req) => {
            if (req.url === 'about:blank' || req.url.startsWith('about:blank#')) return true;
            if (req.url.startsWith(DOC_LINK)) {
              router.push({ pathname: '/docs/page', params: { slug, path: decodeURIComponent(req.url.slice(DOC_LINK.length)) } });
              return false;
            }
            if (/^(https?|mailto):/i.test(req.url)) Linking.openURL(req.url).catch(() => undefined);
            return false;
          }}
          testID="doc-webview"
        />
      )}
      {page !== null && body === '' && <Text variant="muted">Empty page.</Text>}
    </Screen>
  );
}

const styles = StyleSheet.create({ center: { flex: 1, alignItems: 'center', justifyContent: 'center' } });
