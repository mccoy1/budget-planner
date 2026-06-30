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

## Data persistence

`storage.js` detects `window.storage` (Claude's shared cloud storage). When
present, scenarios are shared with anyone who opens the planner; otherwise it
falls back to this browser's `localStorage`. A legacy single-budget save under
`budget-state-v1` is migrated to a scenario automatically on first load.
