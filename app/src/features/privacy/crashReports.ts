import * as Sentry from '@sentry/react-native';

import { documentsPath } from '../../runtime/paths';
import type { settingsStore as SettingsStore } from '../../state';
import { scrubEvent } from './scrub';

// Set at build time. Builds without it never report anything and hide the setting.
const DSN = process.env.EXPO_PUBLIC_SENTRY_DSN ?? '';

export const crashReportsAvailable = DSN !== '';

let running = false;

function apply(on: boolean) {
  if (!crashReportsAvailable || on === running) return;
  running = on;
  if (!on) {
    void Sentry.close();
    return;
  }
  const documents = documentsPath();
  Sentry.init({
    dsn: DSN,
    sendDefaultPii: false,
    // Breadcrumbs record taps, console output and requests, which can include
    // code and terminal input. Zero also stops the native SDK collecting them,
    // since native crash reports don't pass through beforeSend.
    maxBreadcrumbs: 0,
    enableAutoSessionTracking: false,
    enableAutoPerformanceTracing: false,
    attachScreenshot: false,
    attachViewHierarchy: false,
    beforeSend: (event) => scrubEvent(event, documents),
  });
}

// Follows the setting for the life of the app, so turning it off stops reporting at once.
export function startCrashReports(store: typeof SettingsStore) {
  apply(store.getState().crashReports);
  store.subscribe((s) => apply(s.crashReports));
}
