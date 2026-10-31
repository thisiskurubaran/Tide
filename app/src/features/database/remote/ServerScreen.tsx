import { File, Paths } from 'expo-file-system';
import { useLocalSearchParams } from 'expo-router';
import * as Sharing from 'expo-sharing';
import { useState } from 'react';
import { View } from 'react-native';

import { Screen } from '../../../components/Screen';
import { DatabaseView } from '../DatabaseView';
import { KIND_LABEL, useConnections } from './connections';
import { openServer } from './open';

// One saved server in the database viewer. Exports go to the share sheet.
export function ServerScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const conn = useConnections((s) => s.connections.find((c) => c.id === id));
  const loaded = useConnections((s) => s.loaded);
  const [version, setVersion] = useState<string | null>(null);

  return (
    <Screen title={conn?.name ?? 'Database'} subtitle={version ?? (conn ? `Connecting to ${KIND_LABEL[conn.kind]}…` : loaded ? 'Not found' : '')} scroll={false} testID="db-server">
      <View style={{ flex: 1 }}>
        {conn && (
          <DatabaseView
            openKey={conn.id}
            open={async () => {
              const { source, version: v } = await openServer(conn);
              setVersion(v);
              return source;
            }}
            saveCsv={async (name, csv) => {
              const out = new File(Paths.cache, name);
              if (out.exists) out.delete();
              out.create();
              out.write(csv);
              await Sharing.shareAsync(out.uri, { mimeType: 'text/csv', UTI: 'public.comma-separated-values-text', dialogTitle: name });
              return null;
            }}
          />
        )}
      </View>
    </Screen>
  );
}
