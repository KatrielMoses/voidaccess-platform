# Checkout product images (Creem)

Images live in `apps/site/public/assets/checkout/` (served at `https://voidaccess.pro/assets/checkout/<file>.png`, which
is the URL set on each Creem product). One square image (1200×1200) per Creem product, in the site's design system (ink, hairlines, one violet accent).
No prices on the images, so a price change never needs a new one.

| Creem product | Image |
|---|---|
| VoidAccess Pro | `voidaccess-pro-monthly.png` |
| VoidAccess Pro (annual) | `voidaccess-pro-annual.png` |
| VoidAccess Pro+ | `voidaccess-pro-plus-monthly.png` |
| VoidAccess Pro+ (annual) | `voidaccess-pro-plus-annual.png` |
| VoidAccess Pro (Founder) | `voidaccess-pro-founder.png` |
| VoidAccess credits | `voidaccess-credits.png` |

Set on each product (live and test) through the Creem API: `PATCH /v1/products/{id}` with `image_url` and `description`.

To regenerate: `build.mjs` writes one HTML page per product (needs the site's fonts and `logo.png` next to it, from
`apps/site/public/fonts` and `apps/site/public/assets`); screenshot each at 1200×1200 with Playwright.
