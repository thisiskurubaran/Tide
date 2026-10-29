const mockIcon = { name: null as string | null };
jest.mock('expo-alternate-app-icons', () => ({
  supportsAlternateIcons: true,
  getAppIconName: () => mockIcon.name,
  setAlternateAppIcon: jest.fn(async (name: string | null) => (mockIcon.name = name)),
}));
const mockAlert = jest.fn();
jest.mock('react-native', () => ({ Alert: { alert: (...args: unknown[]) => mockAlert(...args) } }));

import { offerProIcon, setProIcon, usingProIcon } from './appIcon';

describe('Pro app icon', () => {
  beforeEach(() => {
    mockIcon.name = null;
    mockAlert.mockClear();
  });

  it('switches to the Pro icon and back', async () => {
    await setProIcon(true);
    expect(usingProIcon()).toBe(true);
    await setProIcon(false);
    expect(mockIcon.name).toBeNull();
  });

  it('offers the icon after a purchase, unless it is already in use', async () => {
    offerProIcon();
    expect(mockAlert).toHaveBeenCalledWith('Use the Pro icon?', expect.any(String), expect.any(Array));
    const [, , buttons] = mockAlert.mock.calls[0];
    await buttons[1].onPress();
    expect(usingProIcon()).toBe(true);
    mockAlert.mockClear();
    offerProIcon();
    expect(mockAlert).not.toHaveBeenCalled();
  });
});
