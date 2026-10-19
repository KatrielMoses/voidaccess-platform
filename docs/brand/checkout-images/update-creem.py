# Sets each Creem product's image_url and description (live and test), matched by product name. Prints no keys.
# Run: CREEM_LIVE="$(gcloud secrets versions access latest --secret=creem-api-key-live)" \
#      CREEM_TEST="$(gcloud secrets versions access latest --secret=creem-api-key-test)" python3 update-creem.py
import json, os, sys, urllib.request
BASE = {"live": "https://api.creem.io", "test": "https://test-api.creem.io"}
IMG = "https://voidaccess.pro/assets/checkout/voidaccess-{}.png"
P = {
  "VoidAccess Pro": ("pro-monthly",
    "Pro plan, billed monthly. 2,000 credits every month for VoidAccess threat-intelligence investigations (about 50 Standard runs), all exports including STIX 2.1 and MISP, and unlimited history. Cancel anytime from Billing; the plan runs to the end of the period you've paid for."),
  "VoidAccess Pro (annual)": ("pro-annual",
    "Pro plan, billed yearly with two months free. 2,000 credits every month for 12 months, all exports including STIX 2.1 and MISP, and unlimited history. Cancel anytime from Billing; the plan runs to the end of the year you've paid for."),
  "VoidAccess Pro+": ("pro-plus-monthly",
    "Pro+ plan, billed monthly. 4,500 credits every month (about 112 Standard investigations), all exports, unlimited history, and first access to new features as they launch. Cancel anytime from Billing; the plan runs to the end of the period you've paid for."),
  "VoidAccess Pro+ (annual)": ("pro-plus-annual",
    "Pro+ plan, billed yearly with two months free. 4,500 credits every month for 12 months, all exports, unlimited history, and first access to new features as they launch. Cancel anytime from Billing; the plan runs to the end of the year you've paid for."),
  "VoidAccess Pro (Founder)": ("pro-founder",
    "Pro at the founding price, for the first 100 subscribers, billed monthly. Everything in Pro: 2,000 credits every month, all exports and unlimited history. The founding price is held for 12 months and renews each year you stay active. Cancel anytime from Billing."),
  "VoidAccess credits": ("credits",
    "VoidAccess credits, pay as you go: choose any whole-dollar amount. $1 buys 100 credits, with a volume bonus from $25 and an extra bonus for subscribers. Credits last 12 months and are used after your monthly plan credits."),
}
def call(mode, key, method, path, body=None):
    req = urllib.request.Request(BASE[mode] + path, method=method, headers={"x-api-key": key, "content-type": "application/json", "accept": "application/json", "user-agent": "voidaccess-ops/1.0"},
                                 data=json.dumps(body).encode() if body is not None else None)
    with urllib.request.urlopen(req, timeout=30) as r: return json.load(r)
for mode in ("live", "test"):
    key = os.environ[f"CREEM_{mode.upper()}"].strip()
    items = [p for p in call(mode, key, "GET", "/v1/products/search?page_size=50").get("items", []) if p.get("status") == "active"]
    for p in items:
        if p["name"] not in P: print(mode, "skip", p["name"]); continue
        img, desc = P[p["name"]]
        try:
            r = call(mode, key, "PATCH", f"/v1/products/{p['id']}", {"image_url": IMG.format(img), "description": desc})
            ok = r.get("image_url", "").endswith(f"{img}.png") and r.get("description") == desc
            print(mode, "updated" if ok else "check", p["name"], "| price unchanged:", r.get("price") == p.get("price"))
        except urllib.error.HTTPError as e:
            print(mode, "FAILED", p["name"], e.code, e.read()[:200])
