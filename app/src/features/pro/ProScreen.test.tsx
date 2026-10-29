import { act, fireEvent, render, screen } from '@testing-library/react-native';

jest.mock('@expo/vector-icons/Feather', () => 'Feather');
jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default);
jest.mock('../../components/haptics', () => ({ haptic: () => undefined }));
jest.mock('expo-router', () => ({ router: { back: jest.fn(), push: jest.fn() }, useLocalSearchParams: () => ({ feature: 'remote' }) }));
jest.mock('../../state', () => {
  const { createStore, useStore } = jest.requireActual('zustand');
  const settings = createStore(() => ({ theme: 'dark', contrast: 'standard' }));
  return { useSettings: (sel: (s: unknown) => unknown) => useStore(settings, sel) };
});
jest.mock('./index', () => {
  const { useStore } = jest.requireActual('zustand');
  const { createFakePurchases } = jest.requireActual('../../extensions/purchases');
  const { createProStore } = jest.requireActual('./store');
  const { PLANS, planFor } = jest.requireActual('./plans');
  const storage = { getItem: () => null, setItem: () => undefined, removeItem: () => undefined };
  const prices = Object.fromEntries(PLANS.map((p: { productId: string; fallbackPrice: string }) => [p.productId, p.fallbackPrice]));
  const proStore = createProStore(storage, createFakePurchases(prices, { trials: { [planFor('yearly').productId]: '7 days' } }));
  return { proStore, useProState: (sel: (s: unknown) => unknown) => useStore(proStore, sel) };
});

import { router } from 'expo-router';

import { proStore } from './index';
import { ProScreen } from './ProScreen';

const settle = () => act(() => new Promise((r) => setTimeout(r, 0)));

it('sells Pro with the trial, renewal terms and required links', async () => {
  await render(<ProScreen />);
  await settle();
  expect(screen.getByTestId('pro-needs')).toBeTruthy();
  expect(screen.getByText('$24.99 / year')).toBeTruthy();
  expect(screen.getByText('$2.99 / month')).toBeTruthy();
  expect(screen.getByText('$59.99 once')).toBeTruthy();
  expect(screen.getByText('Start 7 days free trial')).toBeTruthy();
  expect(screen.getByTestId('pro-terms').props.children).toMatch(/^Free for 7 days, then \$24\.99 per year\..*renews automatically.*24 hours/);
  expect(screen.getByTestId('pro-restore')).toBeTruthy();
  expect(screen.getByTestId('pro-terms-link')).toBeTruthy();
  expect(screen.getByTestId('pro-privacy-link')).toBeTruthy();

  await fireEvent.press(screen.getByTestId('plan-lifetime'));
  expect(screen.getByText('Buy for $59.99')).toBeTruthy();
  expect(screen.getByTestId('pro-terms').props.children).toMatch(/one-time purchase.*Family Sharing/);

  await fireEvent.press(screen.getByTestId('plan-monthly'));
  await fireEvent.press(screen.getByTestId('pro-buy'));
  await settle();
  expect(proStore.getState().subscription).not.toBeNull();
  expect(router.back).toHaveBeenCalled();
  expect(screen.getByTestId('pro-manage')).toBeTruthy();
});
