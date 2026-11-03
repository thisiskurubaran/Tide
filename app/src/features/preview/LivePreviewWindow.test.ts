jest.mock('react-native-webview', () => 'WebView');
jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));
jest.mock('../../runtime/ports', () => ({ useLocalPorts: () => [] }));
jest.mock('../../state', () => ({ buffersStore: { subscribe: () => () => undefined }, useRunner: () => 'local' }));

import { liveSource, snapCorner } from './LivePreviewWindow';

describe('liveSource', () => {
  it('prefers a running dev server', () => {
    expect(liveSource('index.html', [5173])).toEqual({ kind: 'server', port: 5173, url: 'http://127.0.0.1:5173/' });
  });
  it('shows previewable files', () => {
    expect(liveSource('public/index.html', [])).toEqual({ kind: 'file', path: 'public/index.html' });
    expect(liveSource('README.md', [])).toEqual({ kind: 'file', path: 'README.md' });
  });
  it('has nothing for other files', () => {
    expect(liveSource('main.py', [])).toBeNull();
    expect(liveSource(null, [])).toBeNull();
  });
});

describe('snapCorner', () => {
  const area = { width: 390, height: 700 };
  it('goes to the nearest corner', () => {
    expect(snapCorner(20, 30, 200, 260, area)).toEqual({ x: 10, y: 10 });
    expect(snapCorner(250, 500, 200, 260, area)).toEqual({ x: 180, y: 430 });
  });
});
