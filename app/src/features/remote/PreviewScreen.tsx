import { router, useLocalSearchParams } from 'expo-router';
import { useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import WebView from 'react-native-webview';

import { IconButton } from '../../components/Button';
import { Text } from '../../components/Text';
import { borderWidth, colors, spacing } from '../../theme/tokens';

// Shows a port from the container through the server's preview proxy.
export function PreviewScreen() {
  const insets = useSafeAreaInsets();
  const { url, port } = useLocalSearchParams<{ url: string; port: string }>();
  const webview = useRef<WebView<object>>(null);
  const [error, setError] = useState<string | null>(null);

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <IconButton icon="x" label="Close preview" onPress={() => router.back()} testID="preview-close" />
        <Text variant="title" numberOfLines={1} style={styles.title}>
          Port {port}
        </Text>
        <IconButton
          icon="refresh-cw"
          label="Reload"
          onPress={() => {
            setError(null);
            webview.current?.reload();
          }}
          testID="preview-reload"
        />
      </View>
      {error ? (
        <View style={styles.error}>
          <Text variant="error">{error}</Text>
        </View>
      ) : (
        <WebView<object>
          ref={webview}
          testID="preview-webview"
          source={{ uri: url }}
          style={styles.webview}
          onError={(e) => setError(e.nativeEvent.description)}
          setSupportMultipleWindows={false}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderBottomWidth: borderWidth,
    borderColor: colors.border,
  },
  title: { flex: 1, marginLeft: spacing.xs },
  webview: { flex: 1, backgroundColor: colors.background },
  error: { padding: spacing.md },
});
