import { useEffect, useRef, useState } from 'react';
import { FlatList, TextInput, View } from 'react-native';

import { Button } from '../../components/Button';
import { Sheet } from '../../components/Sheet';
import { Text } from '../../components/Text';
import { makeStyles, useColors } from '../../theme/theme';
import { borderWidth, fonts, fontSizes, radius, spacing } from '../../theme/tokens';
import { HttpRequest, webSocketMessages } from './http';
import { WsEntry, WsSession } from './ws';

const time = (at: number) => new Date(at).toTimeString().slice(0, 8);

// A live WebSocket connection for a WEBSOCKET request: what was sent and
// received, and a box to send more. Closing the sheet closes the connection.
export function WsSheet({ request, onClose }: { request: HttpRequest | null; onClose(): void }) {
  const styles = useStyles();
  const colors = useColors();
  const session = useRef<WsSession | null>(null);
  const [log, setLog] = useState<WsEntry[]>([]);
  const [state, setState] = useState<WsSession['state']>('connecting');
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!request) return;
    const s = new WsSession(request.url, request.headers, webSocketMessages(request.body), (session) => {
      setLog(session.log);
      setState(session.state);
    });
    session.current = s;
    return () => {
      s.close();
      session.current = null;
      setLog([]);
      setMessage('');
    };
  }, [request]);

  const color = (d: WsEntry['direction']) => (d === 'out' ? colors.brand : d === 'in' ? colors.success : d === 'error' ? colors.destructive : colors.mutedForeground);

  return (
    <Sheet visible={request !== null} onClose={onClose}>
      <Text variant="title" numberOfLines={1}>
        {request?.name}
      </Text>
      <Text variant="muted" numberOfLines={1}>
        {state === 'open' ? 'Connected' : state === 'connecting' ? 'Connecting…' : 'Closed'} · {request?.url}
      </Text>
      <FlatList
        data={log}
        style={styles.log}
        keyExtractor={(_, i) => String(i)}
        ref={(l) => l?.scrollToEnd({ animated: false })}
        renderItem={({ item }) => (
          <Text variant="mono" selectable style={styles.line}>
            <Text variant="mono" style={[styles.line, { color: colors.mutedForeground }]}>
              {time(item.at)}{' '}
            </Text>
            <Text variant="mono" style={[styles.line, { color: color(item.direction) }]}>
              {item.direction === 'out' ? '→ ' : item.direction === 'in' ? '← ' : '· '}
            </Text>
            {item.text}
          </Text>
        )}
        testID="ws-log"
      />
      <View style={styles.row}>
        <TextInput
          value={message}
          onChangeText={setMessage}
          placeholder="Message"
          placeholderTextColor={colors.mutedForeground}
          autoCapitalize="none"
          autoCorrect={false}
          multiline
          style={styles.input}
          testID="ws-message"
        />
        <Button
          title="Send"
          icon="send"
          disabled={state !== 'open' || !message}
          onPress={() => {
            session.current?.send(message);
            setMessage('');
          }}
          testID="ws-send"
        />
      </View>
      <View style={styles.actions}>
        <Button title={state === 'closed' ? 'Done' : 'Disconnect'} variant="outline" onPress={onClose} testID="ws-close" />
      </View>
    </Sheet>
  );
}

const useStyles = makeStyles((colors) => ({
  log: { height: 280, borderRadius: radius.md, borderWidth, borderColor: colors.border, backgroundColor: colors.background, padding: spacing.xs },
  line: { fontSize: fontSizes.xs + 1 },
  row: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.sm },
  input: {
    flex: 1,
    minHeight: 44,
    maxHeight: 120,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    borderWidth,
    borderColor: colors.border,
    color: colors.foreground,
    fontFamily: fonts.mono.regular,
    fontSize: fontSizes.sm,
  },
  actions: { flexDirection: 'row', justifyContent: 'flex-end' },
}));
