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

## Project layout

```
budget-planner/
├── index.html        # markup + ordered <script>/<link> tags
├── css/
│   └── styles.css    # all styling (design tokens, layout, components)
└── js/
    ├── config.js     # storage keys + shared mutable state, uid(), seed data
    ├── storage.js    # persistence: Claude cloud storage or localStorage fallback
    ├── colors.js     # category color groups (shared across scenarios)
    ├── scenarios.js  # load/save + scenario CRUD (switch/duplicate/new/rename/delete)
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

## Data persistence

`storage.js` detects `window.storage` (Claude's shared cloud storage). When
present, scenarios are shared with anyone who opens the planner; otherwise it
falls back to this browser's `localStorage`. A legacy single-budget save under
`budget-state-v1` is migrated to a scenario automatically on first load.
