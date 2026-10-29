jest.mock('expo-haptics', () => ({
  impactAsync: jest.fn(async () => undefined),
  selectionAsync: jest.fn(async () => undefined),
  notificationAsync: jest.fn(async () => undefined),
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium' },
  NotificationFeedbackType: { Success: 'success', Warning: 'warning', Error: 'error' },
}));
jest.mock('../state', () => {
  const { createStore } = jest.requireActual('zustand');
  return { settingsStore: createStore(() => ({ haptics: true })) };
});

import * as Haptics from 'expo-haptics';

import { settingsStore } from '../state';
import { haptic } from './haptics';

it('plays feedback only while haptics are on', () => {
  haptic('success');
  haptic('tap');
  expect(Haptics.notificationAsync).toHaveBeenCalledWith('success');
  expect(Haptics.impactAsync).toHaveBeenCalledWith('light');

  settingsStore.setState({ haptics: false });
  haptic('select');
  expect(Haptics.selectionAsync).not.toHaveBeenCalled();
});
