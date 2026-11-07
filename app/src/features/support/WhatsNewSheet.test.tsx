import { fireEvent, render, screen } from '@testing-library/react-native';

import appJson from '../../../app.json';
import pkg from '../../../package.json';
import { CHANGELOG } from './changelog';
import { WhatsNewSheet } from './WhatsNewSheet';

jest.mock('@expo/vector-icons/Feather', () => 'Feather');
jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default);

describe('changelog', () => {
  it('has notes for the version being shipped', () => {
    expect(CHANGELOG[0].version).toBe(appJson.expo.version);
    expect(pkg.version).toBe(appJson.expo.version);
  });

  it('keeps highlights short and every line unique', () => {
    for (const r of CHANGELOG) {
      expect(r.highlights?.length ?? 0).toBeLessThanOrEqual(8);
      expect(new Set(r.items).size).toBe(r.items.length);
    }
  });
});

describe('WhatsNewSheet', () => {
  const release = { version: '9.0.0', highlights: ['Big thing'], items: ['Big thing in detail', 'Small fix'] };

  it('shows the highlights first and the full list on request', async () => {
    await render(<WhatsNewSheet releases={[release]} onClose={() => {}} />);
    expect(screen.getByText('Big thing')).toBeTruthy();
    expect(screen.queryByText('Small fix')).toBeNull();
    await fireEvent.press(screen.getByTestId('whats-new-all-9.0.0'));
    expect(screen.getByText('Small fix')).toBeTruthy();
    expect(screen.queryByTestId('whats-new-all-9.0.0')).toBeNull();
  });

  it('shows every item for a release without highlights', async () => {
    await render(<WhatsNewSheet releases={[{ version: '9.0.1', items: ['Small fix'] }]} onClose={() => {}} />);
    expect(screen.getByText('Small fix')).toBeTruthy();
    expect(screen.queryByTestId('whats-new-all-9.0.1')).toBeNull();
  });
});
