import { useState } from 'react';
import { Alert } from 'react-native';

import { Button } from '../../components/Button';
import { haptic } from '../../components/haptics';
import { useAiSetup } from './AiSetupSheet';
import { describeError } from './client';
import { ChangedFile, formatChanges, suggestCommitMessage } from './commitMessage';

// At most this many files' contents are read for the diff.
const MAX_FILES = 40;

// "Suggest message" next to a commit box: reads the change, asks the chat
// model with the user's own key, and fills in the message (still editable).
export function SuggestMessageButton({ changes, onMessage, disabled, testID }: { changes(): Promise<ChangedFile[]>; onMessage(message: string): void; disabled?: boolean; testID?: string }) {
  const [busy, setBusy] = useState(false);
  const setup = useAiSetup();
  const run = async () => {
    setBusy(true);
    try {
      const files = (await changes()).slice(0, MAX_FILES);
      onMessage(await suggestCommitMessage(formatChanges(files)));
      haptic('success');
    } catch (e) {
      haptic('error');
      Alert.alert("Couldn't suggest a message", describeError(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <Button title={busy ? 'Writing…' : 'Suggest message'} variant="outline" icon="cpu" onPress={() => setup.ensure('chat', run)} disabled={disabled || busy} testID={testID} />
      {setup.sheet}
    </>
  );
}
