// The Midnight app icon (midnight tile, gold wave), an alternate icon declared
// in app.json. iOS shows its own alert whenever the icon changes, so it's only
// ever changed when the user asks.
export const MIDNIGHT_ICON = 'Midnight';

type IconsModule = typeof import('expo-alternate-app-icons');
// Loaded lazily: the native module is missing in tests and older dev builds.
function icons(): IconsModule | null {
  try {
    return require('expo-alternate-app-icons') as IconsModule;
  } catch {
    return null;
  }
}

export const iconsSupported = () => icons()?.supportsAlternateIcons ?? false;
export const usingMidnightIcon = () => icons()?.getAppIconName() === MIDNIGHT_ICON;

export async function setMidnightIcon(on: boolean): Promise<void> {
  const mod = icons();
  if (!mod?.supportsAlternateIcons || usingMidnightIcon() === on) return;
  await mod.setAlternateAppIcon(on ? MIDNIGHT_ICON : null);
}
