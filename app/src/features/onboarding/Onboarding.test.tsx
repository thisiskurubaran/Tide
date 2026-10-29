import { fireEvent, render, screen } from '@testing-library/react-native';

jest.mock('@expo/vector-icons/Feather', () => 'Feather');
jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default);
jest.mock('../../components/haptics', () => ({ haptic: () => undefined }));

import { Onboarding } from './Onboarding';
import { STEPS } from './steps';

describe('Onboarding', () => {
  it('walks through every step and can start a project at the end', async () => {
    const onDone = jest.fn();
    await render(<Onboarding visible onDone={onDone} />);
    expect(screen.getByText(STEPS[0].title)).toBeTruthy();
    for (let i = 1; i < STEPS.length; i++) {
      await fireEvent.press(screen.getByTestId('onboarding-next'));
      expect(screen.getByText(STEPS[i].title)).toBeTruthy();
    }
    expect(screen.queryByTestId('onboarding-skip')).toBeNull();
    await fireEvent.press(screen.getByTestId('onboarding-back'));
    expect(screen.getByText(STEPS[STEPS.length - 2].title)).toBeTruthy();
    await fireEvent.press(screen.getByTestId('onboarding-next'));
    await fireEvent.press(screen.getByTestId('onboarding-create'));
    expect(onDone).toHaveBeenCalledWith(true);
  });

  it('can be skipped', async () => {
    const onDone = jest.fn();
    await render(<Onboarding visible onDone={onDone} />);
    await fireEvent.press(screen.getByTestId('onboarding-skip'));
    expect(onDone).toHaveBeenCalledWith(false);
  });
});
