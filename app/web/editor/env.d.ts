declare module '*.ttf' {
  const url: string;
  export default url;
}

interface Window {
  ReactNativeWebView?: { postMessage(message: string): void };
  tide?: { receive(raw: string): void };
}
