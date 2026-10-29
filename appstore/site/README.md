# thisiskurubaran.github.io

Privacy policies and support pages for my apps, published with GitHub
Pages. Each app has its own directory:

```
_config.yml            site settings
_data/apps.yml         every app: name, tagline, platforms, colors, icon
_layouts/default.html  the layout every page uses (light and dark, no gradients)
icon.svg               the site's own icon, for the home page and 404
index.md               https://thisiskurubaran.github.io/  (the apps, as cards)
404.md                 shown for any address that doesn't exist
tide/
  icon.svg             the app's icon, shown in the header and on cards
  index.md             /tide/
  privacy.md           /tide/privacy/   App Store "Privacy Policy URL"
  support.md           /tide/support/   App Store "Support URL"
_template/             copied for each new app; not published
```

## Adding an app

1. Copy `_template/` to a directory named after the app, lowercase with
   hyphens, e.g. `my-app/`. That name is the app's URL path (its "slug").
2. In the three files, replace `APP_NAME`, `APP_SLUG` (the directory
   name) and `DATE`, and write the privacy policy from what the app
   actually does.
3. Add the app to `_data/apps.yml`: slug, name, tagline, platforms, its
   brand color for light and dark mode (flat colors), and an icon. Put
   the icon in the app's directory as `icon.svg` (or `.png`, 256 px or
   more); without one, the app's initial is shown in its color.
4. Commit and push. The home page lists it automatically, and its pages
   are live a minute or two later at
   `https://thisiskurubaran.github.io/<app>/privacy/` and `/<app>/support/`.

Never rename an app's directory after it ships: the app and its App Store
listing link to these URLs.

## Tide

Tide's pages are kept in the Tide repo, in `appstore/site/tide/`, next to
the code they describe. Update them there and copy the directory here.
