// Links Apple requires next to subscriptions (Guideline 3.1.2). Terms default
// to Apple's standard EULA; the privacy policy has to be hosted by you and
// set at build time, like the Sentry DSN.
export const TERMS_URL = process.env.EXPO_PUBLIC_TERMS_URL || 'https://www.apple.com/legal/internet-services/itunes/dev/stdeula/';
export const PRIVACY_URL = process.env.EXPO_PUBLIC_PRIVACY_URL ?? '';

const PERIOD: Record<string, string> = { yearly: 'year', monthly: 'month' };

// The renewal terms under the buy button, for the selected plan.
export function renewalTerms(plan: 'yearly' | 'monthly' | 'lifetime', price: string, trial: string | null): string {
  if (plan === 'lifetime') return `A one-time purchase of ${price}, charged to your Apple ID. No subscription. Shared with your family through Family Sharing.`;
  const period = PERIOD[plan];
  const start = trial
    ? `Free for ${trial}, then ${price} per ${period}. Payment is charged to your Apple ID when the trial ends, unless you cancel before then.`
    : `${price} per ${period}, charged to your Apple ID when you confirm.`;
  return `${start} The subscription renews automatically unless it is cancelled at least 24 hours before the end of the current period. Manage or cancel it in Settings > Apple ID > Subscriptions.`;
}
