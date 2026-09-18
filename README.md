# Household Budget Planner

A drag-and-drop household budgeting app. Categories live on "shelf" columns
(left/right) and you drag them into the center **Your Budget** column to plan a
month. Supports multiple saved scenarios, custom category colors, percent- or
dollar-based amounts, monthly/yearly periods, and a category-group breakdown.

This is a dependency-free vanilla-JS app — no build step, no framework. It was
split out of a single HTML file into segmented files for maintainability.

## Running

It's static files, so any of these work:

```bash
# Option 1 — just open it
open index.html

# Option 2 — serve over HTTP (recommended)
python3 -m http.server 8000
# then visit http://localhost:8000
```

Google Fonts are loaded from a CDN, so a network connection gives the intended
typography (it degrades gracefully without one).

## Backend

`backend/` is a small Django API that will store budgets per account, so they
follow you between devices. It runs on Render's free tier with SQLite, and
Litestream streams the database to Cloudflare R2 so restarts lose nothing.
The frontend doesn't call it yet. Local setup, the API and deploy steps are
in [backend/README.md](backend/README.md).

## Project layout

```
budget-planner/
├── backend/          # the API: Django + SQLite + Litestream (see backend/README.md)
├── render.yaml       # Render Blueprint that deploys backend/
├── _config.yml       # keeps backend/ and render.yaml off the GitHub Pages site
├── index.html        # markup + ordered <script>/<link> tags
├── favicon.ico       # 16/32/48 fallback for browsers that request it by default
├── site.webmanifest  # name, theme colors and icons for installable/home-screen use
├── icons/
│   ├── source.png    # the master artwork (1254px, transparent) — see "Icons"
│   └── *.png         # flattened renditions: 16/32/48, 180, 192, 512
├── css/
│   └── styles.css    # all styling (design tokens, layout, components)
└── js/
    ├── config.js     # storage keys + shared mutable state, uid(), seed data
    ├── storage.js    # persistence: the `store` interface and localStore (Claude cloud storage or localStorage)
    ├── colors.js     # category color groups (shared across scenarios)
    ├── scenarios.js  # initial load, debounced save, scenario CRUD (switch/duplicate/new/rename/delete)
    ├── categories.js # money math, category editing, positioning, search, bulk add
    ├── render.js     # all HTML rendering, including the top-level render()
    ├── mobile.js     # the compact (mobile) view: view switching + list rendering
    ├── drag.js       # free-form pointer-based card dragging
    ├── events.js     # event wiring + the data-act click dispatcher
    └── main.js       # bootstrap (init) + window resize handling
```

## How it's wired

The scripts are plain (non-module) `<script>` tags loaded in dependency order
and share one global scope, exactly as the original single-file version did.
`config.js` declares every cross-file variable up front; `main.js` loads last
and boots the app. The UI uses event delegation — interactive elements carry a
`data-act` attribute that `handleClick` in `events.js` dispatches on — so no
inline event handlers or global function lookups from HTML are needed.

## Compact (mobile) view

Below 700px the app renders a second, tap-driven layout instead of the drag
board — a single scrolling column built for quick "what's left?" checks rather
than full planning. `render()` branches to `renderMobile()` at the top; every
other layer (money math, category editing, scenarios, storage) is shared, so a
change made on a phone shows up on the desktop board and vice versa.

What's different:

- **Budgeted categories are grouped by color group and collapsed by default**,
  showing a count and subtotal per group. A twenty-category budget reads as
  three rows until you tap into one.
- **Income and Remaining stay pinned** to the top of the screen.
- **No dragging.** Categories move in and out of the budget with a `+` / `−`
  button. Nothing here reads or writes card `x`/`y` coordinates; `moveCat()`
  clears them, so the desktop board lays anything moved here out fresh.
- **The left/right shelves collapse into one "Not in budget" list** — the split
  is purely spatial on desktop and means nothing to the math.
- **Tapping an amount edits it in place** with a numeric keypad, so a quick
  "what if groceries were $800?" is one tap. The field edits the raw stored
  value (a percent stays a percent, a yearly amount stays yearly); the row shows
  the monthly equivalent once committed.
- **Swiping a row left brings in a Delete panel** from the right edge, in either
  list. Deleting takes a deliberate tap on it, so a stray sideways drag while
  scrolling can't destroy anything, and one row is open at a time. The row's own
  contents stay put under the panel: sliding the whole row (the iOS Mail model)
  pushes short category names off the left edge, and you shouldn't be one tap
  from deleting something whose name you can no longer read.
- The guided tour spotlights desktop selectors, so it only runs in the full view.

Either view can be forced from **Menu → View**, which stores a device-local
preference in `localStorage` (deliberately not in the shared scenario data).
With no preference set, the view follows the viewport and switches on rotate.

## Icons

`icons/source.png` is the master artwork: 1254px, RGBA, a rounded-square icon
with transparent padding around it and a soft drop shadow. The shipped renditions
are *not* just that file resized, because iOS has two rules that would each
break it:

- **It composites transparency onto black.** The transparent corners and the
  shadow would come back as a dark ring, still visible after iOS applies its own
  rounded mask on top.
- **It doesn't inset the artwork.** The source's ~4% transparent padding would
  make the icon look shrunken inside its tile.

So the renditions are built by cropping to the artwork's own bounds (the pixels
at alpha ≥ 250 — the body sits at 252–253, comfortably above the shadow),
squaring that crop, scaling it to fill, then rebuilding every non-opaque pixel
from the nearest opaque pixel along the ray to the centre. That continues the
background gradient out into the corners and discards the shadow rather than
compositing it, so iOS's mask cuts through clean gradient. Downscaling is done
by progressive halving, and every output is fully opaque.

`apple-touch-icon.png` (180×180) is the one iOS reads for "Add to Home Screen" —
it ignores the manifest icons and won't take an SVG. `apple-mobile-web-app-title`
sets the label under it.

Because the artwork is an illustration rather than a flat mark, the 16px favicon
is inherently soft; it reads as a white wallet on teal rather than as detail.

## Data persistence

Everything the app saves goes through one object, `store` (in `storage.js`),
which has a method per operation: `load`, `loadScenario`, `createScenario`,
`saveScenario`, `renameScenario`, `deleteScenario`, `setActive` and
`saveColorGroups`. The rest of the app never touches storage keys. The store is
also the only thing that changes `scenarioIndex`; callers set `activeId`,
`state` and `colorGroups` and then ask the store to save them.

Today there is one implementation, `localStore`. It detects `window.storage`
(Claude's shared cloud storage). When present, scenarios are shared with
anyone who opens the planner; otherwise it falls back to this browser's
`localStorage`. A legacy single-budget save under `budget-state-v1` is
migrated to a scenario automatically on first load. An account-backed store
that talks to `backend/` is next, and will plug in beside it.

Device-local preferences (the view override, whether the tour has run) are not
budget data, so they stay in `localStorage` via `lsGet`/`lsSet` whichever store
is active.
