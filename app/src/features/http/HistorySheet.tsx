import { useState } from 'react';
import { Pressable, View } from 'react-native';

import { Button } from '../../components/Button';
import { Segmented } from '../../components/Segmented';
import { Sheet } from '../../components/Sheet';
import { Text } from '../../components/Text';
import { makeStyles, useColors } from '../../theme/theme';
import { borderWidth, fonts, fontSizes, radius, spacing } from '../../theme/tokens';
import { diffText } from '../../extensions/gitPro/diff';
import { DiffView } from '../../extensions/gitPro/DiffView';
import { timeAgo } from '../github/api';
import type { HistoryEntry } from './history';
import { formatBody } from './http';

interface HistorySheetProps {
  name: string;
  entries: HistoryEntry[] | null;
  onResend(entry: HistoryEntry): void;
  onClear(): void;
  onClose(): void;
}

// A request's recent responses: read one, compare it with the latest, or send
// that request again. Free for everyone.
export function HistorySheet({ name, entries, onResend, onClear, onClose }: HistorySheetProps) {
  const styles = useStyles();
  const colors = useColors();
  const [picked, setPicked] = useState<number | null>(null);
  const [view, setView] = useState<'body' | 'compare'>('body');
  const entry = entries && picked !== null ? entries[picked] : null;
  const latest = entries?.[0];
  const statusColor = (status: number) => (status < 300 ? colors.success : status < 400 ? colors.warning : colors.destructive);
  const close = () => {
    setPicked(null);
    setView('body');
    onClose();
  };

  return (
    <Sheet visible={entries !== null} onClose={close} scrollable>
      <Text variant="title">{entry ? `${entry.response.status} · ${timeAgo(new Date(entry.at).toISOString())}` : `History: ${name}`}</Text>
      {!entry ? (
        <>
          {entries?.length === 0 && <Text variant="muted">Responses show up here after you send this request.</Text>}
          {entries?.map((e, i) => (
            <Pressable key={e.at} onPress={() => setPicked(i)} accessibilityRole="button" style={styles.row} testID={`http-history-${i}`}>
              <Text style={[styles.status, { color: statusColor(e.response.status) }]}>{e.response.status}</Text>
              <View style={styles.flex}>
                <Text variant="mono" numberOfLines={1}>
                  {e.request.method} {e.request.url}
                </Text>
                <Text variant="muted">
                  {timeAgo(new Date(e.at).toISOString())} · {e.response.ms} ms{i === 0 ? ' · latest' : ''}
                </Text>
              </View>
            </Pressable>
          ))}
          <View style={styles.actions}>
            {!!entries?.length && <Button title="Clear history" variant="outline" icon="trash-2" onPress={onClear} />}
            <Button title="Done" onPress={close} />
          </View>
        </>
      ) : (
        <>
          <Text variant="mono" numberOfLines={2}>
            {entry.request.method} {entry.request.url}
          </Text>
          {picked !== 0 && (
            <Segmented<'body' | 'compare'>
              value={view}
              onChange={setView}
              options={[
                { value: 'body', label: 'Response' },
                { value: 'compare', label: 'Compare with latest' },
              ]}
              testID="http-history-view"
            />
          )}
          {view === 'compare' && latest && picked !== 0 ? (
            <DiffView hunks={diffText(formatBody(entry.response.body, entry.response.headers), formatBody(latest.response.body, latest.response.headers))} empty="Same as the latest response." />
          ) : (
            <Text variant="mono" selectable style={styles.body}>
              {formatBody(entry.response.body, entry.response.headers) || '(empty body)'}
            </Text>
          )}
          {entry.response.truncated && <Text variant="muted">Only the start of this response was kept.</Text>}
          <View style={styles.actions}>
            <Button title="Back" variant="outline" onPress={() => (setPicked(null), setView('body'))} />
            <Button
              title="Send again"
              icon="send"
              onPress={() => {
                onResend(entry);
                close();
              }}
              testID="http-history-resend"
            />
          </View>
        </>
      )}
    </Sheet>
  );
}

const useStyles = makeStyles((colors) => ({
  flex: { flex: 1, gap: 2 },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.sm, borderRadius: radius.md, borderWidth, borderColor: colors.border },
  status: { fontFamily: fonts.mono.semibold, fontSize: fontSizes.sm, minWidth: 36 },
  body: { fontSize: fontSizes.xs + 1, backgroundColor: colors.background, borderRadius: radius.sm, padding: spacing.sm },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.sm },
}));
