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

Pro unlocks linked folders, compare and merge, the test
runner, preview dev tools, the split editor on iPad, up to 6 terminals
(free: 2), 10 snapshots per project (free: 3), every extension and the
Pro app icon. Remote mode is free at launch: it needs a server the user
hosts, so it can't be sold as part of Pro until Tide hosts one.

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
7. **App Privacy** (the questionnaire behind the label on the store page):
   - Builds **without** `EXPO_PUBLIC_SENTRY_DSN`: "Data Not Collected".
   - Builds **with** it: Diagnostics > **Crash Data**, used for App
     Functionality, **not linked** to the user, **not used for tracking**.
   - Tide doesn't track (no App Tracking Transparency prompt needed).
     Purchases are handled by Apple and aren't declared. Problem reports
     are emails the user chooses to write, which Apple's "optional
     disclosure" rules cover; if you'd rather be conservative, add
     Diagnostics > Other Diagnostic Data, not linked, App Functionality.
8. **Privacy Policy URL** (App Privacy) and **Support URL** (the version
   page), from the pages published below:
   `https://thisiskurubaran.github.io/tide/privacy/` and
   `https://thisiskurubaran.github.io/tide/support/`. For subscriptions,
   also put links to the Terms of Use (Apple's standard EULA,
   `https://www.apple.com/legal/internet-services/itunes/dev/stdeula/`)
   and the Privacy Policy at the end of the app description
   (Guideline 3.1.2).

## Publishing the privacy policy and support pages

`appstore/site/` is a complete GitHub Pages site for all your apps, one
directory per app:

```
appstore/site/
  _config.yml
  _data/apps.yml    every app: name, tagline, colors, icon
  _layouts/         the page layout (light and dark, no gradients)
  index.md          /              the apps, as cards
  tide/             /tide/         Tide's page
    icon.svg
    privacy.md      /tide/privacy/ Privacy Policy URL
    support.md      /tide/support/ Support URL
  _template/        copied for each new app (not published)
  README.md         how to add an app (not published)
```

This repo is private, and GitHub Pages on a free plan only publishes
public repos, so the site goes in a public repo of its own:

1. On github.com, **New repository** named exactly
   `thisiskurubaran.github.io`, **Public**. A repo with that name becomes
   your site at `https://thisiskurubaran.github.io`.
2. Copy the site into it:

   ```bash
   git clone https://github.com/thisiskurubaran/thisiskurubaran.github.io.git
   cp -R Tide/appstore/site/. thisiskurubaran.github.io/
   cd thisiskurubaran.github.io
   git add . && git commit -m "Add app privacy policies and support pages" && git push
   ```

   Or drag the contents of `appstore/site/` into **Add file > Upload
   files** on GitHub (keep the folders).
3. In that repo: **Settings > Pages > Build and deployment**, Source
   **Deploy from a branch**, Branch **main** / **(root)**, **Save** (user
   sites usually have this on already).
4. After a minute or two, the **Actions** tab shows "pages build and
   deployment" finish, and these open:
   - `https://thisiskurubaran.github.io/`
   - `https://thisiskurubaran.github.io/tide/privacy/`
   - `https://thisiskurubaran.github.io/tide/support/`
5. Put the Tide URLs in App Store Connect (step 8 above). The app's
   paywall already links to the privacy URL.

**Other apps**: copy `_template/` to a directory named after the app
(lowercase, hyphens, e.g. `my-app/`), fill in the placeholders, and add
the app to `_data/apps.yml`; the site's README.md has the details. You can do this
straight in the public repo; only Tide's directory is kept here.

**Changing Tide's policy**: edit `appstore/site/tide/` here, update the
effective date, copy the `tide/` directory over again and push. Keep the
URLs: the app and App Store Connect point at them.

## Build settings

All optional; set at build time, like `EXPO_PUBLIC_SENTRY_DSN`, to
override the defaults:

| Variable | Default | What for |
|---|---|---|
| `EXPO_PUBLIC_PRIVACY_URL` | `https://thisiskurubaran.github.io/tide/privacy/` | Privacy Policy link on the paywall |
| `EXPO_PUBLIC_TERMS_URL` | Apple's standard EULA | Terms of Use link on the paywall |
| `EXPO_PUBLIC_SUPPORT_EMAIL` | `thisiskurubaran@gmail.com` | Report a problem and Suggest a feature |
| `EXPO_PUBLIC_GITHUB_CLIENT_ID` | none | "Sign in with GitHub". Without it, GitHub sign-in only offers pasting a token. |

### GitHub sign-in (OAuth App)

"Sign in with GitHub" uses GitHub's device flow, which needs only a Client
ID (no secret goes in the app):

1. github.com → Settings → Developer settings → OAuth Apps → **New OAuth App**.
2. Application name `Tide`, Homepage URL
   `https://thisiskurubaran.github.io/tide/`, Authorization callback URL
   the same (device flow doesn't use it, but the form requires one).
3. Register, then tick **Enable Device Flow** and save.
4. Copy the **Client ID** and build with it, e.g. in `app/.env.local`:
   `EXPO_PUBLIC_GITHUB_CLIENT_ID=Ov23li…`, then `npx expo prebuild --clean`
   and archive as usual. `.env*.local` is gitignored.

The app asks for the `repo`, `workflow` and `read:org` scopes. The token is
the same one Settings → Git uses, so signing in also makes push work.

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
  period ends, then the features ask for Pro again
- Restore purchases on a second device, and after deleting the app
- Lifetime with a second Family Sharing member
- Extensions bought alone keep working without Pro; with Pro, all of them
  show "Included with Pro"

## Review notes

Paste into App Review Information > Notes (adjust as needed):

> Tide is a code editor with a terminal. Tide Pro (monthly or yearly
> subscription, or lifetime purchase) unlocks linked folders, compare and merge, the test runner, preview dev tools, the
> split editor on iPad, more terminals and snapshots, and every
> extension. The paywall opens from Settings > Tide Pro, or from any Pro
> feature, e.g. Command palette > Run tests.
>
> Extensions are sold individually as non-consumable in-app purchases.
> Their code ships inside the app binary and a purchase only unlocks it;
> nothing executable is downloaded (Guideline 2.5.2).
>
> Remote mode (free) connects to a server the user hosts. Everything else works
> without an account or a network connection.
