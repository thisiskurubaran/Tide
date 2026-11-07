const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const config = getDefaultConfig(__dirname);

// /shared lives next to /app so the server and Node supervisor can use it too.
config.watchFolders = [...(config.watchFolders ?? []), path.resolve(__dirname, '../shared')];

// Ruby and PHP ship as WebAssembly files next to their page (assets/runtimes).
if (!config.resolver.assetExts.includes('wasm')) config.resolver.assetExts.push('wasm');
// Mermaid ships as text (assets/mermaid), read by the preview when it needs it.
if (!config.resolver.assetExts.includes('txt')) config.resolver.assetExts.push('txt');

module.exports = config;
