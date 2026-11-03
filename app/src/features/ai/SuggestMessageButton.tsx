import { router } from 'expo-router';
import { useState } from 'react';
import { Alert } from 'react-native';

import { Button } from '../../components/Button';
import { haptic } from '../../components/haptics';
import { createClient, describeError } from './assistant';
import { ChangedFile, formatChanges, suggestCommitMessage } from './commitMessage';
import { aiSettings, getApiKey } from './settings';

// At most this many files' contents are read for the diff.
const MAX_FILES = 40;

// "Suggest message" next to a commit box: reads the change, asks Claude with
// the user's own key, and fills in the message (still editable).
export function SuggestMessageButton({ changes, onMessage, disabled, testID }: { changes(): Promise<ChangedFile[]>; onMessage(message: string): void; disabled?: boolean; testID?: string }) {
  const [busy, setBusy] = useState(false);
  const run = async () => {
    const key = await getApiKey();
    if (!key) {
      Alert.alert('Add your Anthropic API key', 'Suggested messages are written by Claude with your own key, set in Settings, AI assistant.', [
        { text: 'Not now', style: 'cancel' },
        { text: 'Open settings', onPress: () => router.push('/settings/ai') },
      ]);
      return;
    }
    setBusy(true);
    try {
      const files = (await changes()).slice(0, MAX_FILES);
      onMessage(await suggestCommitMessage(createClient(key), aiSettings.getState().model, formatChanges(files)));
      haptic('success');
    } catch (e) {
      haptic('error');
      Alert.alert("Couldn't suggest a message", describeError(e));
    } finally {
      setBusy(false);
    }
  };
  return <Button title={busy ? 'Writing…' : 'Suggest message'} variant="outline" icon="cpu" onPress={run} disabled={disabled || busy} testID={testID} />;
}
