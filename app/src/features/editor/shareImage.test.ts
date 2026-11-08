const mockFiles: { name: string; content?: string; encoding?: string; deleted?: boolean }[] = [];
jest.mock('expo-file-system', () => ({
  Paths: { cache: 'cache' },
  File: class {
    uri: string;
    exists = false;
    fileName: string;
    constructor(_dir: string, fileName: string) {
      this.fileName = fileName;
      this.uri = `file:///cache/${fileName}`;
    }
    delete() {}
    create() {}
    async write(content: string, opts: { encoding?: string }) {
      mockFiles.push({ name: this.fileName, content, encoding: opts.encoding });
    }
  },
}));
const mockShareAsync = jest.fn(async () => undefined);
let mockAvailable = true;
jest.mock('expo-sharing', () => ({ isAvailableAsync: async () => mockAvailable, shareAsync: (...a: unknown[]) => mockShareAsync(...(a as [])) }));

import { shareCodeImage } from './shareImage';

it('writes the PNG to the cache and opens the share sheet', async () => {
  await shareCodeImage('app.png', 'iVBOR');
  expect(mockFiles).toEqual([{ name: 'app.png', content: 'iVBOR', encoding: 'base64' }]);
  expect(mockShareAsync).toHaveBeenCalledWith('file:///cache/app.png', { mimeType: 'image/png', UTI: 'public.png', dialogTitle: 'app.png' });
});

it('says when sharing is not available', async () => {
  mockAvailable = false;
  await expect(shareCodeImage('app.png', 'x')).rejects.toThrow('Sharing is not available');
});
