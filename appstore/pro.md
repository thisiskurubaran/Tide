# Tide Pro on the App Store

How to set up Tide Pro and the extensions in App Store Connect, test them,
and get them through review. The app side is in `app/src/features/pro`
(plans, entitlement, paywall) and `app/src/extensions` (extensions).

## What is sold

| Product | Type | Product ID | Price (US) | Notes |
|---|---|---|---|---|
| Tide Pro Yearly | Auto-renewable subscription | `com.thisiskurubaran.tide.pro.yearly` | $24.99 / year | 7-day free trial (introductory offer) |
| Tide Pro Monthly | Auto-renewable subscription | `com.thisiskurubaran.tide.pro.monthly` | $2.99 / month | No trial |
| Tide Pro Lifetime | Non-consumable | `com.thisiskurubaran.tide.pro.lifetime` | $59.99 | Family Sharing on |
| Themes & Icons Pack | Non-consumable | `com.thisiskurubaran.tide.ext.themes` | $2.99 | Included with Pro |
| Format & Lint | Non-consumable | `com.thisiskurubaran.tide.ext.format_lint` | $4.99 | Included with Pro |
| Git Pro | Non-consumable | `com.thisiskurubaran.tide.ext.git_pro` | $6.99 | Included with Pro |
| IntelliSense Pro | Non-consumable | `com.thisiskurubaran.tide.ext.intellisense` | $9.99 | Included with Pro |
| Debugger | Non-consumable | `com.thisiskurubaran.tide.ext.debugger` | $9.99 | Included with Pro |

The product IDs and fallback prices live in `features/pro/plans.ts` and
`extensions/manifests.ts`; `app/storekit/Tide.storekit` mirrors them and a
test keeps the two in step.

Pro unlocks Remote mode, linked folders, compare and merge, the test
runner, preview dev tools, the split editor on iPad, up to 6 terminals
(free: 2), 10 snapshots per project (free: 3) and every extension.

Family Sharing, decided: subscriptions off (each person subscribes),
Lifetime on (shared with up to five family members), extensions off.

## App Store Connect

1. **Agreements, Tax, and Banking**: the Paid Apps agreement must be
   active, with tax forms and a bank account. Nothing can be sold before.
2. **Small Business Program**: enrol, so Apple takes 15% instead of 30%
   (for developers earning under $1M a year).
3. **Subscriptions > Subscription Groups > Create**, named "Tide Pro".
   Add Yearly and Monthly with the IDs above, duration 1 year and 1 month,
   at the same level (one group level means they're alternatives; the
   user can switch between them).
   - Prices: pick the US price; Apple fills in the other storefronts.
   - Yearly > **Introductory Offers**: Free, 1 week, all territories.
     New subscribers only (Apple gives it once per group).
   - Family Sharing: **off** for both.
   - A display name and description per product, and a group display name.
4. **In-App Purchases > Create** Tide Pro Lifetime (Non-Consumable) and
   the five extensions, with the IDs and prices above.
   - Family Sharing: **on for Lifetime only**, off for the five
     extensions. Once turned on it can't be turned off.
5. Each product needs a **review screenshot** (the paywall for Pro, the
   Extensions screen for extensions) and **review notes**, below.
6. Add the products to the app version under **In-App Purchases and
   Subscriptions** before submitting it. The first ones have to be
   submitted together with an app version.
7. **App Privacy**: purchases are handled by Apple and Tide collects no
   payment data. If crash reports are enabled in the build, declare Crash
   Data (not linked to the user, not used for tracking).
8. **App Information > Privacy Policy URL**: required. Host
   `appstore/privacy-policy.md` (after review) and use the same URL for the
   build, below. For subscriptions, put links to the Terms of Use (EULA)
   and Privacy Policy in the app description too (Guideline 3.1.2).

## Build settings

Set at build time, like `EXPO_PUBLIC_SENTRY_DSN`:

| Variable | Needed | What for |
|---|---|---|
| `EXPO_PUBLIC_PRIVACY_URL` | Yes | Privacy Policy link on the paywall |
| `EXPO_PUBLIC_TERMS_URL` | No | Terms of Use link; defaults to Apple's standard EULA |
| `EXPO_PUBLIC_SUPPORT_EMAIL` | Recommended | Report a problem and Suggest a feature |

## Testing

- **In Xcode with the StoreKit file** (no App Store Connect needed): after
  `npx expo prebuild`, open the workspace, Product > Scheme > Edit Scheme
  > Run > Options > StoreKit Configuration > `app/storekit/Tide.storekit`.
  Purchases are local; Debug > StoreKit > Manage Transactions refunds,
  expires and renews them. Subscriptions renew every few minutes there.
- **Sandbox**: create a Sandbox Apple Account in App Store Connect (Users
  and Access > Sandbox), sign in under Settings > App Store on a device,
  and use a development or TestFlight build. Sandbox renews subscriptions
  on an accelerated clock (a month is about 5 minutes).

Worth checking each release:

- Yearly shows "Start 7 days free trial" for a new sandbox account, and
  "Subscribe" once the trial has been used
- Buying unlocks Pro straight away; Settings shows the plan and renewal date
- Cancel in Settings > Apple ID > Subscriptions: Pro stays until the
  period ends, then the features ask for Pro again and Remote mode
  falls back to Local
- Restore purchases on a second device, and after deleting the app
- Lifetime with a second Family Sharing member
- Extensions bought alone keep working without Pro; with Pro, all of them
  show "Included with Pro"

## Review notes

Paste into App Review Information > Notes (adjust as needed):

> Tide is a code editor with a terminal. Tide Pro (monthly or yearly
> subscription, or lifetime purchase) unlocks Remote mode, linked
> folders, compare and merge, the test runner, preview dev tools, the
> split editor on iPad, more terminals and snapshots, and every
> extension. The paywall opens from Settings > Tide Pro, or from any Pro
> feature, e.g. Command palette > Run tests.
>
> Extensions are sold individually as non-consumable in-app purchases.
> Their code ships inside the app binary and a purchase only unlocks it;
> nothing executable is downloaded (Guideline 2.5.2).
>
> Remote mode connects to a server the user hosts. Everything else works
> without an account or a network connection.
