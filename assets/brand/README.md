# Brand assets

`banner.png` (1280×640) opens the README and is the repository's social
preview. `banner.html` is the source; it uses the same tokens as
`app/globals.css` and pulls its fonts from Google Fonts, so regenerating it
needs a network connection.

```bash
node assets/brand/render.mjs        # banner.html  → assets/brand/banner.png
npm run e2e                         # refill e2e/shots/ from a real game
node assets/brand/screenshots.mjs   # e2e/shots/   → assets/screenshots/
```

`../fonts/` holds the typefaces `app/opengraph-image.tsx` hands to
`next/og`, which cannot fetch a stylesheet at render time. Shrikhand and
Barlow Condensed are both under the SIL Open Font License; the licences sit
beside them.
