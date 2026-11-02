# Releasing Tide on the App Store

How to set Tide up in App Store Connect and get it through review. Tide is
free: there are no subscriptions or in-app purchases to create.

## App Store Connect

1. **Pricing and Availability**: price **Free**, all territories.
2. **App Privacy** (the questionnaire behind the label on the store page):
   - Builds **without** `EXPO_PUBLIC_SENTRY_DSN`: "Data Not Collected".
   - Builds **with** it: Diagnostics > **Crash Data**, used for App
     Functionality, **not linked** to the user, **not used for tracking**.
   - Tide doesn't track (no App Tracking Transparency prompt needed).
     Problem reports are emails the user chooses to write, which Apple's
     "optional disclosure" rules cover; if you'd rather be conservative,
     add Diagnostics > Other Diagnostic Data, not linked, App Functionality.
3. **Privacy Policy URL** (App Privacy) and **Support URL** (the version
   page), from the pages published below:
   `https://thisiskurubaran.github.io/tide/privacy/` and
   `https://thisiskurubaran.github.io/tide/support/`.
4. The Paid Apps agreement isn't needed; the Free Apps agreement is enough.

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
5. Put the Tide URLs in App Store Connect (step 3 above).

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

## Review notes

Paste into App Review Information > Notes (adjust as needed):

> Tide is a free code editor with a terminal. Everything in the app is
> free; there are no subscriptions or in-app purchases.
>
> Extensions (Settings > Extensions) are free. Their code ships inside the
> app binary and installing one only switches it on; nothing executable is
> downloaded (Guideline 2.5.2).
>
> Remote mode connects to a server the user hosts. The AI assistant uses
> the user's own Anthropic API key. Everything else works without an
> account or a network connection.
