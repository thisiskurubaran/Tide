// The parts of Help & feedback that need native modules: mail, the store
// review prompt and the share sheet.
import Constants from 'expo-constants';
import { File, Paths } from 'expo-file-system';
import * as MailComposer from 'expo-mail-composer';
import * as Sharing from 'expo-sharing';
import * as StoreReview from 'expo-store-review';
import { Linking, Platform } from 'react-native';

import { documentsPath } from '../../runtime/paths';
import { runnerStore } from '../../state';
import { recentLogs } from './logs';
import { buildReport, DeviceInfo, mailBody } from './report';
import { shouldAskForReview } from './review';
import { supportStore } from './store';

// Set at build time, like the Sentry DSN. Without it, reports go to the share sheet.
const SUPPORT_EMAIL = process.env.EXPO_PUBLIC_SUPPORT_EMAIL ?? '';

export const appVersion = () => Constants.expoConfig?.version ?? '0.0.0';

export function deviceInfo(): DeviceInfo {
  return {
    appVersion: appVersion(),
    build: Platform.OS === 'ios' ? (Constants.expoConfig?.ios?.buildNumber ?? null) : String(Constants.expoConfig?.android?.versionCode ?? '') || null,
    platform: Platform.OS === 'ios' ? (Platform.isPad ? 'iPadOS' : 'iOS') : Platform.OS,
    osVersion: String(Platform.Version),
    device: Constants.deviceName ?? null,
    runtime: runnerStore.getState().mode,
  };
}

function writeReport(info: DeviceInfo): string {
  const file = new File(Paths.cache, 'tide-report.txt');
  if (file.exists) file.delete();
  file.create();
  file.write(buildReport(info, recentLogs(), documentsPath()));
  return file.uri;
}

// Opens a mail draft with device details and recent logs attached; the user
// sees and edits everything before it is sent. Without mail set up, the
// report goes to the share sheet instead.
export async function contactSupport(kind: 'bug' | 'feature'): Promise<void> {
  const info = deviceInfo();
  const subject = kind === 'bug' ? `Tide ${info.appVersion}: problem report` : `Tide ${info.appVersion}: feature idea`;
  const attachment = kind === 'bug' ? writeReport(info) : null;
  if (SUPPORT_EMAIL && (await MailComposer.isAvailableAsync())) {
    await MailComposer.composeAsync({ recipients: [SUPPORT_EMAIL], subject, body: mailBody(kind, info), attachments: attachment ? [attachment] : [] });
    return;
  }
  if (attachment && (await Sharing.isAvailableAsync())) {
    await Sharing.shareAsync(attachment, { mimeType: 'text/plain', UTI: 'public.plain-text', dialogTitle: subject });
    return;
  }
  if (SUPPORT_EMAIL) await Linking.openURL(`mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(mailBody(kind, info))}`);
  else throw new Error('Mail is not set up on this device');
}

// From Settings: straight to the store's review page when there is one.
export async function rateApp(): Promise<void> {
  const url = StoreReview.storeUrl();
  if (url) {
    await Linking.openURL(Platform.OS === 'ios' ? `${url}${url.includes('?') ? '&' : '?'}action=write-review` : url);
    return;
  }
  if (await StoreReview.hasAction()) await StoreReview.requestReview();
}

// Counts a run, and now and then asks for a rating (the system decides
// whether the prompt actually shows).
export function countRun(): void {
  supportStore.getState().countRun();
  const version = appVersion();
  if (!shouldAskForReview(supportStore.getState(), version, Date.now())) return;
  supportStore.getState().asked(version);
  StoreReview.hasAction()
    .then((ok) => (ok ? StoreReview.requestReview() : undefined))
    .catch(() => undefined);
}
