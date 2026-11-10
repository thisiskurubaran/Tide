jest.mock('@expo/vector-icons/Feather', () => 'Feather');

import { fireEvent, render, screen, within } from '@testing-library/react-native';

import { IconButton } from './Button';
import { ListRow } from './Screen';

it('keeps a button on the right outside the row button, so VoiceOver can reach it', async () => {
  const open = jest.fn();
  const more = jest.fn();
  await render(<ListRow title="Account" subtitle="GitLab" onPress={open} right={<IconButton icon="more-horizontal" label="Actions for me" onPress={more} testID="more" />} testID="row" />);
  const row = screen.getByTestId('row');
  expect(within(row).queryByTestId('more')).toBeNull();
  expect(within(row).getByText('Account')).toBeTruthy();

  await fireEvent.press(screen.getByRole('button', { name: 'Actions for me' }));
  expect(more).toHaveBeenCalledTimes(1);
  expect(open).not.toHaveBeenCalled();

  await fireEvent.press(row);
  // The chevron still opens the row, but is hidden from VoiceOver (the row button covers it).
  await fireEvent.press(screen.getByTestId('row-chevron', { includeHiddenElements: true }));
  expect(open).toHaveBeenCalledTimes(2);
});

it('is a single button when nothing is on the right', async () => {
  const open = jest.fn();
  await render(<ListRow title="Repo" onPress={open} testID="row" />);
  await fireEvent.press(screen.getByRole('button'));
  expect(open).toHaveBeenCalledTimes(1);
  expect(screen.queryByTestId('row-chevron', { includeHiddenElements: true })).toBeNull();
});
