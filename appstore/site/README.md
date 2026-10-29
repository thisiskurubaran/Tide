# thisiskurubaran.github.io

Privacy policies and support pages for my apps, published with GitHub
Pages. Each app has its own directory:

```
_config.yml          site settings
_layouts/default.html  the layout every page uses (light and dark)
index.md             https://thisiskurubaran.github.io/  (list of apps)
tide/
  index.md           /tide/
  privacy.md         /tide/privacy/   App Store "Privacy Policy URL"
  support.md         /tide/support/   App Store "Support URL"
_template/           copied for each new app; not published
```

## Adding an app

1. Copy `_template/` to a directory named after the app, lowercase with
   hyphens, e.g. `my-app/`. That name is the app's URL path.
2. In the three files, replace `APP_NAME` (e.g. "My App"), `APP_SLUG`
   (the directory name), `PLATFORMS` and `DATE`, and write the privacy
   policy from what the app actually does.
3. Add a row for the app to the table in `index.md`.
4. Commit and push. The pages are live a minute or two later at
   `https://thisiskurubaran.github.io/<app>/privacy/` and `/<app>/support/`.

Never rename an app's directory after it ships: the app and its App Store
listing link to these URLs.

## Tide

Tide's pages are kept in the Tide repo, in `appstore/site/tide/`, next to
the code they describe. Update them there and copy the directory here.
