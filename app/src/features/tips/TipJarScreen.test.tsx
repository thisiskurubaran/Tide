import { act, fireEvent, render, screen } from '@testing-library/react-native';

jest.mock('expo-router', () => ({ router: { back: jest.fn(), push: jest.fn() } }));
jest.mock('@expo/vector-icons/Feather', () => 'Feather');
jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default);
jest.mock('./purchases', () => {
  const actual = jest.requireActual('./purchases');
  return { ...actual, createStoreTips: () => actual.createFakeTips({ 'com.thisiskurubaran.tide.tip.small': '₹169' }) };
});

import { tipsStore } from '.';
import { TipJarScreen } from './TipJarScreen';

beforeEach(() => tipsStore.setState({ given: 0, prices: {}, busy: null, thanked: null, error: null }));

it('lists the tips with store prices and thanks the user', async () => {
  await render(<TipJarScreen />);
  await act(async () => undefined);
  expect(screen.getByTestId('tip-small-price')).toHaveTextContent('₹169');
  expect(screen.getByTestId('tip-large-price')).toHaveTextContent('$9.99');
  expect(screen.getByText(/Tips don't unlock anything/)).toBeTruthy();
  await fireEvent.press(screen.getByTestId('tip-medium'));
  expect(screen.getByTestId('tip-thanks')).toBeTruthy();
  expect(screen.getByText(/You've left 1 tip/)).toBeTruthy();
});

it('shows errors and clears them on tap', async () => {
  await render(<TipJarScreen />);
  await act(async () => tipsStore.setState({ error: 'Payment declined' }));
  await fireEvent.press(screen.getByTestId('tip-error'));
  expect(tipsStore.getState().error).toBeNull();
});
