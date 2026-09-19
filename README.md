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

To work on accounts locally, run the API too (setup in
[backend/README.md](backend/README.md)) and serve the frontend on port 5500,
using the same hostname for both (`localhost` and `127.0.0.1` count as
different sites, and the session cookie isn't sent between them):

```bash
python3 -m http.server 5500          # then visit http://localhost:5500
backend/venv/bin/python backend/manage.py runserver 8500
```

## Backend

`backend/` is a small Django API that stores budgets per account, so they
follow you between devices. It runs on Render's free tier with SQLite, and
Litestream streams the database to Cloudflare R2 so restarts lose nothing.
Local setup, the API and deploy steps are in
[backend/README.md](backend/README.md). How the planner uses it is under
"Accounts" below.

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
    ├── api.js        # account API client (fetch, CSRF, timeouts) and apiStore
    ├── colors.js     # category color groups (shared across scenarios)
    ├── scenarios.js  # initial load, the save pipeline, scenario CRUD (switch/duplicate/new/rename/delete)
    ├── categories.js # money math, category editing, positioning, search, bulk add
    ├── render.js     # all HTML rendering, including the top-level render()
    ├── mobile.js     # the compact (mobile) view: view switching + list rendering
    ├── drag.js       # free-form pointer-based card dragging
    ├── events.js     # event wiring + the data-act click dispatcher
    ├── tour.js       # the first-run guided tour
    ├── account.js    # sign in/out, startup, save badge, conflicts, account dialogs
    └── main.js       # bootstrap (init), resize handling, saving on tab close
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

There are two implementations. `localStore` is for guests: it detects
`window.storage` (Claude's shared cloud storage) and, when present, scenarios
are shared with anyone who opens the planner; otherwise it uses this browser's
`localStorage`. A legacy single-budget save under `budget-state-v1` is
migrated to a scenario automatically on first load. `apiStore` (in `api.js`)
is for a signed-in account and saves to `backend/`.

Edits are debounced by 400 ms, and what's waiting is kept per scenario, so
every scenario operation (switch, create, rename, delete) saves it first.
Before this, an edit followed quickly by a switch was lost. Pending edits are
also saved when the tab is hidden or closed.

Device-local preferences (the view override, whether the tour has run) are not
budget data, so they stay in `localStorage` via `lsGet`/`lsSet` whichever store
is active.

## Accounts

Signing in is optional. Logged out, the planner works exactly as it always
has, saving to this browser; the badge in the top bar says **This browser**.
Accounts are invite-only (created in the backend's admin), and **Menu → Sign
in** or the badge opens the sign-in dialog. The API's address is picked in
`config.js` (`API_BASE`): the `api.` subdomain on the live site, port 8500
locally, and none when the page is opened from disk, which hides sign-in.

- **First sign-in to an empty account** offers to upload this browser's
  budgets (they stay in the browser too), or to start from the example.
- **Signed in**, the badge shows the save state: *Saving…*, *✓ Saved*, or
  *Not saved · Retry* when a save fails. Failed saves are kept and retried.
- **Startup doesn't wait for the server unless it has to.** Only a device that
  was signed in last time (`budget:signed-in` in localStorage) checks the
  account on load. The free server sleeps, so that check can take up to a
  minute; after 3 seconds the screen says so. If the server can't be reached,
  you choose between trying again and using this browser's budgets. It never
  switches to the browser's budgets silently, where edits would go somewhere
  you don't expect.
- **Two devices editing the same scenario:** every save carries the version it
  was based on. If another device or tab saved in between, the server refuses
  and the planner asks: keep your version, or use the other one.
- **An expired session** brings up the sign-in dialog without leaving the
  page; after signing in, the edits made in the meantime are saved.
- **Signing out** returns to this browser's budgets. The account's budgets
  aren't copied into the browser.

Sharing a scenario with another account is planned; the backend's access
check (`Scenario.objects.for_user()`) is the one place it will change.
