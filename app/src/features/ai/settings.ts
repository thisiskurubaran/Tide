// The AI assistant's settings: the Anthropic API key, kept in the Keychain,
// and which model to use.
import * as SecureStore from 'expo-secure-store';
import { createStore, useStore } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { storage } from '../../state';
import { AiModel, DEFAULT_MODEL } from './assistant';

const KEY = 'tide.ai.anthropic-key';

export const getApiKey = () => SecureStore.getItemAsync(KEY).catch(() => null);

export async function setApiKey(value: string) {
  if (value.trim()) await SecureStore.setItemAsync(KEY, value.trim());
  else await SecureStore.deleteItemAsync(KEY);
  aiSettings.setState({ hasKey: !!value.trim() });
}

interface AiSettings {
  model: AiModel;
  // Whether a key is saved; the key itself is only read when sending.
  hasKey: boolean | null;
  setModel(model: AiModel): void;
}

export const aiSettings = createStore<AiSettings>()(
  persist(
    (set) => ({
      model: DEFAULT_MODEL,
      hasKey: null,
      setModel: (model) => set({ model }),
    }),
    { name: 'ai', version: 1, storage: createJSONStorage(() => storage), partialize: ({ model }) => ({ model }) },
  ),
);

export const useAiSettings = <T>(selector: (s: AiSettings) => T) => {
  if (aiSettings.getState().hasKey === null) getApiKey().then((k) => aiSettings.setState({ hasKey: !!k }));
  return useStore(aiSettings, selector);
};
