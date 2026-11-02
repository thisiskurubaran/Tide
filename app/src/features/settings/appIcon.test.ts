const mockIcon = { name: null as string | null };
jest.mock('expo-alternate-app-icons', () => ({
  supportsAlternateIcons: true,
  getAppIconName: () => mockIcon.name,
  setAlternateAppIcon: jest.fn(async (name: string | null) => (mockIcon.name = name)),
}));

import { setMidnightIcon, usingMidnightIcon } from './appIcon';

describe('Midnight app icon', () => {
  beforeEach(() => {
    mockIcon.name = null;
  });

  it('switches to the Midnight icon and back', async () => {
    await setMidnightIcon(true);
    expect(mockIcon.name).toBe('Midnight');
    expect(usingMidnightIcon()).toBe(true);
    await setMidnightIcon(false);
    expect(mockIcon.name).toBeNull();
  });
});
