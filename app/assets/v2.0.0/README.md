# Tide 2.0.0 App Store images

All files are RGB PNGs with no alpha channel.

| File | Size (px) | App Store Connect slot |
|---|---|---|
| `iphone/01-code-and-run.png` | 1206 × 2622 | iPhone 6.3" display, screenshot 1 |
| `iphone/02-your-ai.png` | 1206 × 2622 | iPhone 6.3" display, screenshot 2 |
| `iphone/03-real-ide.png` | 1206 × 2622 | iPhone 6.3" display, screenshot 3 |
| `iphone/04-git.png` | 1206 × 2622 | iPhone 6.3" display, screenshot 4 |
| `iphone/05-preview.png` | 1206 × 2622 | iPhone 6.3" display, screenshot 5 |
| `iphone/06-deploy.png` | 1206 × 2622 | iPhone 6.3" display, screenshot 6 |
| `iphone/07-tools.png` | 1206 × 2622 | iPhone 6.3" display, screenshot 7 |
| `iphone/08-free.png` | 1206 × 2622 | iPhone 6.3" display, screenshot 8 |
| `ipad/01-workspace.png` | 2064 × 2752 | iPad 13" display, screenshot 1 |
| `ipad/02-split.png` | 2064 × 2752 | iPad 13" display, screenshot 2 |
| `ipad/03-your-ai.png` | 2064 × 2752 | iPad 13" display, screenshot 3 |
| `ipad/04-preview.png` | 2064 × 2752 | iPad 13" display, screenshot 4 |
| `ipad/05-git.png` | 2064 × 2752 | iPad 13" display, screenshot 5 |
| `ipad/06-free.png` | 2064 × 2752 | iPad 13" display, screenshot 6 |
| `header/header.png` | 3840 × 1646 | Product page header image |
| `search/search-results.png` | 3840 × 2560 | Search results image |

## Regenerating

The images are rendered from the HTML/CSS templates in `app/scripts/store-assets/` with Playwright's Chromium:

```bash
cd app
node scripts/store-assets/build.js            # all images
node scripts/store-assets/build.js iphone/03  # only templates whose path contains this
```

The build stops if a page has a script error, if a code or terminal line is clipped, or if a PNG doesn't come out at the exact size.
