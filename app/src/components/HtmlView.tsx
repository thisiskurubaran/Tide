import { useMemo } from 'react';
import { Linking } from 'react-native';
import WebView from 'react-native-webview';

import { previewPage } from '../features/preview/render';
import { useSettings } from '../state';
import { useColors } from '../theme/theme';

// Read-only HTML (rendered Markdown, diffs) in the app's colors. Scripts are
// off; links open in Safari.
export function HtmlView({ body, testID }: { body: string; testID?: string }) {
  const colors = useColors();
  const fontSize = useSettings((s) => s.editorFontSize);
  const page = useMemo(
    () =>
      previewPage(
        body,
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
    [body, colors, fontSize],
  );
  return (
    <WebView<object>
      testID={testID}
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
  );
}
