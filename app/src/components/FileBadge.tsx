import { Text, View } from 'react-native';

import { fonts } from '../theme/tokens';
import { useColors } from '../theme/theme';

// A small colored label for a file's type (<> for HTML, TS, # for CSS), so
// tabs, the file tree and recent files read at a glance like a desktop IDE.
// The Themes & Icons extension's icons replace it when installed.
const BADGES: [RegExp, string, string][] = [
  [/\.(html?|vue|svelte)$/i, '<>', '#f0835f'],
  [/\.(css|scss|sass|less)$/i, '#', '#6fb3ff'],
  [/\.(tsx?|mts|cts)$/i, 'TS', '#6f9dff'],
  [/\.(jsx?|mjs|cjs)$/i, 'JS', '#e8d44d'],
  [/\.(json|jsonc|ipynb)$/i, '{}', '#e8b04f'],
  [/\.(md|mdx|markdown)$/i, 'M↓', '#a3aaa7'],
  [/\.py$/i, 'Py', '#3fc095'],
  [/\.rb$/i, 'Rb', '#f2776d'],
  [/\.php$/i, 'php', '#a78bfa'],
  [/\.lua$/i, 'Lua', '#7c9bff'],
  [/\.(sh|bash|zsh)$|^\.(bashrc|bash_profile|zshrc|zprofile|profile)$/i, '$', '#3fc095'],
  [/\.(ps1|psm1|psd1)$/i, 'PS', '#5391fe'],
  [/^(docker|container)file(\..+)?$|\.dockerfile$/i, 'Dk', '#2496ed'],
  [/^(gnu)?makefile$|\.mk$/i, 'Mk', '#d4a72c'],
  [/\.go$/i, 'Go', '#00add8'],
  [/\.rs$/i, 'Rs', '#dea584'],
  [/\.java$/i, 'Jv', '#e76f00'],
  [/\.(c|h)$/i, 'C', '#5c8dbc'],
  [/\.(cpp|cc|cxx|hpp|hh|hxx)$/i, 'C+', '#00599c'],
  [/\.(m|mm)$/i, 'OC', '#438eff'],
  [/\.cs$/i, 'C#', '#9b4f96'],
  [/\.kts?$/i, 'Kt', '#a97bff'],
  [/\.swift$/i, 'Sw', '#f05138'],
  [/\.dart$/i, 'Dt', '#00b4ab'],
  [/\.(ya?ml|toml|ini|cfg|conf|properties|env)$|^\.env/i, '⚙', '#a3aaa7'],
  [/\.(xml|plist|xsd|xslt?|xaml|csproj)$/i, '<>', '#8bc34a'],
  [/\.(sql|sqlite3?|db)$/i, 'DB', '#4fc6d6'],
  [/\.(csv|tsv|parquet)$/i, '▦', '#3fc095'],
  [/\.(png|jpe?g|gif|svg|webp|ico)$/i, '◩', '#c49bff'],
  [/\.http$/i, '→', '#4fc6d6'],
];

export function fileBadge(name: string): { text: string; color: string } | null {
  const hit = BADGES.find(([re]) => re.test(name));
  return hit ? { text: hit[1], color: hit[2] } : null;
}

export function FileBadge({ name, size = 16 }: { name: string; size?: number }) {
  const colors = useColors();
  const badge = fileBadge(name) ?? { text: '·', color: colors.mutedForeground };
  return (
    <View
      style={{ width: size + 2, height: size - 2, borderRadius: 3, alignItems: 'center', justifyContent: 'center', backgroundColor: badge.color + '22' }}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Text
        allowFontScaling={false}
        numberOfLines={1}
        style={{ color: badge.color, fontFamily: fonts.mono.semibold, fontSize: badge.text.length > 2 ? size * 0.42 : size * 0.55, letterSpacing: -0.3 }}
      >
        {badge.text}
      </Text>
    </View>
  );
}
