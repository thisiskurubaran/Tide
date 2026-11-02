import { File, Paths } from 'expo-file-system';
import { useLocalSearchParams } from 'expo-router';
import * as Sharing from 'expo-sharing';
import { useState } from 'react';
import { View } from 'react-native';

import { Screen } from '../../../components/Screen';
import { DatabaseView } from '../DatabaseView';
import { KIND_LABEL, useConnections } from './connections';
import { MongoView } from './MongoView';
import { openMongo, openRedis, openServer } from './open';
import { RedisView } from './RedisView';

// One saved server: SQL ones in the database viewer (exports go to the share
// sheet), Redis and MongoDB in views of their own.
export function ServerScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const conn = useConnections((s) => s.connections.find((c) => c.id === id));
  const loaded = useConnections((s) => s.loaded);
  const [version, setVersion] = useState<string | null>(null);

  return (
    <Screen title={conn?.name ?? 'Database'} subtitle={version ?? (conn ? `Connecting to ${KIND_LABEL[conn.kind]}…` : loaded ? 'Not found' : '')} scroll={false} testID="db-server">
      <View style={{ flex: 1 }}>
        {conn?.kind === 'redis' ? (
          <RedisView
            openKey={conn.id}
            open={async () => {
              const r = await openRedis(conn);
              setVersion(r.version);
              return r;
            }}
          />
        ) : conn?.kind === 'mongo' ? (
          <MongoView
            openKey={conn.id}
            database={conn.database || undefined}
            open={async () => {
              const r = await openMongo(conn);
              setVersion(r.version);
              return r.browser;
            }}
          />
        ) : conn ? (
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
        ) : null}
      </View>
    </Screen>
  );
}
