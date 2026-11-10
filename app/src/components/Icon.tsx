import Feather from '@expo/vector-icons/Feather';
import { SymbolView } from 'expo-symbols';
import type { ComponentProps } from 'react';
import { Platform, StyleProp, StyleSheet, TextStyle, ViewStyle } from 'react-native';
import type { SFSymbols5_0 } from 'sf-symbols-typescript';

// Icons are named with Feather's names everywhere in the app. On iOS they render
// as the matching SF Symbol, so they line up with system icons in weight and
// style; anything without a match (brand logos, the spinner) stays Feather.
// Android and tests render Feather.

export type IconName = ComponentProps<typeof Feather>['name'];

// Typed against SF Symbols 5.0 so every symbol exists on iOS 17, the deployment target.
const SF_SYMBOLS: Partial<Record<IconName, SFSymbols5_0>> = {
  activity: 'waveform.path.ecg',
  'alert-circle': 'exclamationmark.circle',
  'alert-triangle': 'exclamationmark.triangle',
  'align-justify': 'text.justify',
  'align-left': 'text.alignleft',
  archive: 'archivebox',
  'arrow-down': 'arrow.down',
  'arrow-down-right': 'arrow.down.right',
  'arrow-left': 'arrow.left',
  'arrow-right': 'arrow.right',
  'arrow-up': 'arrow.up',
  'arrow-up-left': 'arrow.up.left',
  'at-sign': 'at',
  award: 'rosette',
  book: 'book',
  'book-open': 'book.pages',
  bookmark: 'bookmark',
  box: 'shippingbox',
  camera: 'camera',
  check: 'checkmark',
  'check-circle': 'checkmark.circle',
  'check-square': 'checkmark.square',
  'chevron-down': 'chevron.down',
  'chevron-left': 'chevron.left',
  'chevron-right': 'chevron.right',
  'chevron-up': 'chevron.up',
  'chevrons-left': 'chevron.left.2',
  'chevrons-right': 'chevron.right.2',
  circle: 'circle',
  clipboard: 'clipboard',
  clock: 'clock',
  cloud: 'cloud',
  code: 'chevron.left.forwardslash.chevron.right',
  columns: 'rectangle.split.2x1',
  command: 'command',
  compass: 'safari',
  copy: 'doc.on.doc',
  'corner-down-left': 'arrow.turn.down.left',
  'corner-down-right': 'arrow.turn.down.right',
  'corner-left-up': 'arrow.turn.left.up',
  'corner-up-left': 'arrow.turn.up.left',
  'corner-up-right': 'arrow.turn.up.right',
  cpu: 'cpu',
  crosshair: 'scope',
  database: 'cylinder.split.1x2',
  delete: 'delete.left',
  download: 'square.and.arrow.down',
  droplet: 'drop',
  edit: 'square.and.pencil',
  'edit-2': 'pencil',
  'edit-3': 'pencil.line',
  'external-link': 'arrow.up.right.square',
  eye: 'eye',
  'eye-off': 'eye.slash',
  'fast-forward': 'forward',
  file: 'doc',
  'file-plus': 'doc.badge.plus',
  'file-text': 'doc.text',
  filter: 'line.3.horizontal.decrease',
  folder: 'folder',
  'folder-plus': 'folder.badge.plus',
  'git-branch': 'arrow.triangle.branch',
  'git-commit': 'smallcircle.filled.circle',
  'git-merge': 'arrow.triangle.merge',
  'git-pull-request': 'arrow.triangle.pull',
  globe: 'globe',
  grid: 'square.grid.2x2',
  hash: 'number',
  'help-circle': 'questionmark.circle',
  home: 'house',
  image: 'photo',
  info: 'info.circle',
  italic: 'italic',
  key: 'key',
  layers: 'square.3.layers.3d',
  layout: 'rectangle.3.group',
  link: 'link',
  'link-2': 'link',
  list: 'list.bullet',
  lock: 'lock',
  'log-out': 'rectangle.portrait.and.arrow.right',
  map: 'map',
  'map-pin': 'mappin',
  maximize: 'arrow.up.left.and.arrow.down.right',
  'maximize-2': 'arrow.up.left.and.arrow.down.right',
  'message-square': 'bubble.left',
  'minimize-2': 'arrow.down.right.and.arrow.up.left',
  minus: 'minus',
  'minus-circle': 'minus.circle',
  'minus-square': 'minus.square',
  monitor: 'display',
  'more-horizontal': 'ellipsis',
  move: 'arrow.up.and.down.and.arrow.left.and.right',
  navigation: 'location.north',
  package: 'shippingbox',
  pause: 'pause',
  phone: 'phone',
  play: 'play',
  'play-circle': 'play.circle',
  plus: 'plus',
  'plus-circle': 'plus.circle',
  'plus-square': 'plus.square',
  radio: 'dot.radiowaves.left.and.right',
  'refresh-cw': 'arrow.clockwise',
  repeat: 'repeat',
  'rotate-ccw': 'arrow.counterclockwise',
  'rotate-cw': 'arrow.clockwise',
  save: 'square.and.arrow.down',
  scissors: 'scissors',
  search: 'magnifyingglass',
  send: 'paperplane',
  server: 'server.rack',
  settings: 'gearshape',
  share: 'square.and.arrow.up',
  'shield-off': 'shield.slash',
  shuffle: 'shuffle',
  sidebar: 'sidebar.left',
  slash: 'slash.circle',
  smartphone: 'iphone',
  square: 'square',
  table: 'tablecells',
  tablet: 'ipad',
  tag: 'tag',
  target: 'target',
  terminal: 'terminal',
  tool: 'wrench.and.screwdriver',
  'trash-2': 'trash',
  type: 'textformat',
  underline: 'underline',
  unlock: 'lock.open',
  upload: 'square.and.arrow.up',
  'upload-cloud': 'icloud.and.arrow.up',
  user: 'person',
  users: 'person.2',
  watch: 'applewatch',
  x: 'xmark',
  'x-circle': 'xmark.circle',
  'x-square': 'xmark.square',
  zap: 'bolt',
  'zap-off': 'bolt.slash',
};

export function sfSymbolFor(name: IconName): SFSymbols5_0 | undefined {
  return SF_SYMBOLS[name];
}

type IconProps = Omit<ComponentProps<typeof Feather>, 'name' | 'style'> & {
  name: IconName;
  style?: StyleProp<TextStyle>;
};

export function Icon({ name, size = 24, color, style, ...rest }: IconProps) {
  const symbol = Platform.OS === 'ios' && process.env.NODE_ENV !== 'test' ? SF_SYMBOLS[name] : undefined;
  if (!symbol) return <Feather name={name} size={size} color={color} style={style} {...rest} />;
  // SF Symbols are drawn a little larger than Feather's glyphs at the same size.
  const box = Math.round(size * 0.92);
  const flat = StyleSheet.flatten(style) as ViewStyle | undefined;
  return (
    <SymbolView
      {...rest}
      name={symbol}
      size={box}
      tintColor={color}
      weight="regular"
      resizeMode="scaleAspectFit"
      style={[{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }, flat]}
      fallback={<Feather name={name} size={size} color={color} style={style} />}
    />
  );
}
