# Who's Who — Seven Hills Pre-K + 1st

An offline, face-first directory for Wells's and Aletta's grades. You open it walking up
someone's driveway, recognise the kid, and get the parents' names, what they do, where they
live, and whatever you and Janice have learned about them.

**58 students · 109 parents · 53 households · works with no signal.**

---

## The one rule

`data/` holds 109 families' names, addresses, phone numbers and emails. It is gitignored and
must stay that way. `docs/` is the shell — it contains **zero** personal data and is the only
thing that ever gets published. That split is what lets the app live on free public hosting
while the directory itself never leaves your devices.

The Seven Hills directory is confidential and provided for personal use between member
families. Keep this to you and Janice: no sharing, no publishing, nothing commercial.

---

## Refreshing the data (twice a year, ~2 minutes)

1. In Chrome, open the **Students** directory, logged in:
   <https://sevenhillsschool.myschoolapp.com/app/parent?svcid=edu#directory/1428>
2. Open the console (⌘⌥J). First time only, type `allow pasting` and press enter.
3. Paste all of [`tools/collect.js`](tools/collect.js) and press enter. Wait ~60s; a file downloads.
4. Move it into place and rebuild:

```bash
mv ~/Downloads/seven-hills-raw.json data/raw/ && node tools/normalize.mjs && node tools/bundle-data.mjs
```

`normalize.mjs` refuses to write if anything looks wrong — a student with no parents, an
asymmetric sibling link, a missing photo. If it exits non-zero, don't ship the bundle.

> If Chrome silently blocks the download (it does this on repeat auto-downloads), allow
> downloads for the site in the address bar, or re-run the paste in a fresh tab.

---

## Running it on your Mac

```bash
node tools/serve.mjs
```

Then <http://localhost:8747/docs/>. `localhost` counts as a secure context, so the service
worker behaves exactly as it will in production.

While developing, the service worker will happily serve you a stale copy of `app.js`. Either
use a private window, or bump `VERSION` in [`docs/sw.js`](docs/sw.js).

---

## Getting it onto the phones

The shell needs to be on **HTTPS** — iOS refuses to register a service worker otherwise, and
without one there is no offline. A LAN IP won't do. So the shell gets published, and the data
gets carried across by hand.

The shell is already published: **<https://seanpduffy.github.io/sevenhills/>**

**One-time, per phone:**

1. Open <https://seanpduffy.github.io/sevenhills/> in **Safari** (not Chrome — only Safari
   can add to the home screen).
2. Share → **Add to Home Screen**. Launch it once from the icon so the service worker caches
   the shell.
3. AirDrop `data/bundle/shs-data.json` from the Mac, save it to Files.
4. Open the app → **Import data file** → pick it.

After that it's fully offline. To push new data later: AirDrop the new bundle, then
**More → Replace data file**.

---

## Notes, and syncing them with Janice

Notes are the part that actually compounds — "dad coaches the Thursday soccer thing" beats
any amount of automated research. They're stored per-device.

iOS Safari can't write to iCloud Drive on its own, so syncing is manual: **More → Export
notes** writes a file you drop in your shared iCloud folder; the other phone uses **Import &
merge notes**. Merging is additive and keyed by note id, so nothing is overwritten and it's
safe to run in either direction, any number of times.

Set who you are under **More → Who's writing notes** so entries are attributed.

---

## Backgrounds on parents

Two sources, deliberately kept distinct in the UI:

| Source | Where it comes from | How it renders |
|---|---|---|
| **Job title** | The school's own Current Parents directory | plain, tagged `school directory` |
| **Bio** | Web research, in `data/bios.json` | tagged `high` / `medium` / `unsure` |

Low-confidence bios render grey and italic, so you never confidently repeat something wrong
to someone's face.

**What the research actually yields.** This was measured, not guessed:

- **10 parents** have a job title straight from the school directory. Free and authoritative.
- **5 parents** have a corporate email domain. Nearly all resolve — the domain names the
  employer, and the search confirms the person.
- **93 parents use only Gmail.** Name + town returns nothing usable. Three were tested; all
  three came back with a wall of same-named strangers.

So realistically ~15 of 109 get a real background. The remaining 94 are what your own notes
are for. To work the queue:

```bash
node tools/research-queue.mjs
```

It ranks who's worth searching and prints the query to run, then you add entries to
`data/bios.json` keyed by parent id:

```json
{ "6577016": { "bio": "…", "confidence": "high", "sources": ["https://…"], "method": "email domain" } }
```

Then re-run `node tools/bundle-data.mjs`.

LinkedIn is not scraped — it blocks automation and has no API for this. Where a search
surfaces a profile URL it's stored as a tappable source link, nothing more.

---

## Layout

```
docs/                 the shell — publishable, no personal data
  index.html app.js styles.css sw.js manifest.webmanifest icon-*.png
tools/
  collect.js          paste into the portal console; pulls roster, families, photos
  normalize.mjs       raw → families.json, with assertions
  bundle-data.mjs     families + bios + photos → the file you AirDrop
  research-queue.mjs  who's worth researching, and the query to run
  make-icons.mjs      regenerates the home-screen icons
  serve.mjs           local dev server
data/                 GITIGNORED — every byte of personal data
```

**Why the collector is a console paste rather than a scraper:** it borrows the session you're
already logged into. No password handling, no stored credentials, and nothing to break when
Blackbaud changes their login flow.

---

## Known limits

- **No parent photos.** The school directory has none — verified across all 590 parents. The
  kid's face is the only recognition key, which is why the app is built around it.
- **Notes sync is manual.** Automatic iCloud sync needs a native app; see below.
- **Distances are straight-line miles**, not drive times.
- **`custom_2`** (class section) is only filled in for some students, so grade is the unit.

If this earns it, the natural next step is a SwiftUI wrapper on TestFlight — that buys Face ID
locking and real iCloud note sync, at the cost of re-uploading a build every 90 days.
