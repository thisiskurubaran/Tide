// The Tide Pro app icon (midnight tile, gold wave, PRO badge), an alternate
// icon declared in app.json. iOS shows its own alert whenever the icon
// changes, so it's only ever changed when the user asks, or when Pro ends.
import { Alert } from 'react-native';

export const PRO_ICON = 'Pro';

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
export const usingProIcon = () => icons()?.getAppIconName() === PRO_ICON;

export async function setProIcon(on: boolean): Promise<void> {
  const mod = icons();
  if (!mod?.supportsAlternateIcons || usingProIcon() === on) return;
  await mod.setAlternateAppIcon(on ? PRO_ICON : null);
}

// Right after buying Pro.
export function offerProIcon(): void {
  if (!iconsSupported() || usingProIcon()) return;
  Alert.alert('Use the Pro icon?', 'A midnight Tide icon with a gold PRO badge. You can change it any time in Settings > App icon.', [
    { text: 'Not now', style: 'cancel' },
    { text: 'Use Pro icon', onPress: () => setProIcon(true).catch(() => undefined) },
  ]);
}
