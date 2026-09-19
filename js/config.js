// ---------- Storage keys & shared mutable state ----------
// These files load as ordered classic scripts and share one global scope, just
// as the original single-file app did. config.js declares every cross-file
// variable up front so the other modules can read and mutate them freely.

const LEGACY_KEY = 'budget-state-v1';
const INDEX_KEY = 'scenario-index';
const ACTIVE_KEY = 'active-scenario';
const COLOR_GROUPS_KEY = 'color-groups';
const scenarioKey = id => 'scenario:' + id;

let state = null;          // the currently-edited scenario's data
let scenarioIndex = [];    // [{id, name, updatedAt}]
let activeId = null;
let saveTimer = null;      // debounce for the save pipeline (scenarios.js)
let pendingSaves = new Map(); // scenario id → its state object, edited but not yet saved
let colorsDirty = false;   // color groups edited but not yet saved
let saveChain = Promise.resolve(); // saves run one at a time, in order
let colorGroups = [];      // [{key, name, color}] — shared across all scenarios
let mainMenuOpen = false;
let addMenuZone = null; // zone key whose "+ Add" menu is open, else null
let searchOpen = false;
let searchQuery = '';
let searchFocusPending = false;
let hiddenColors = new Set(); // colorType keys currently toggled off (hidden)
let breakdownOpen = false; // whether the category-group breakdown panel is shown

// Mobile (compact) view state — see mobile.js
let viewPref = null;            // 'mobile' | 'full' | null (null = follow the viewport)
let expandedGroups = new Set(); // color-group keys expanded in the compact budget list
let shelfOpen = false;          // whether the "Not in budget" list is expanded
let inlineEditId = null;        // category whose amount is being edited in place
let swipedRowId = null;         // category row swiped open to reveal its Delete action

// Accounts — see api.js and account.js
// Where the account API lives: beside the dev server locally, the api.
// subdomain in production, and nowhere when the page is opened from disk or
// runs inside Claude, which means guest mode only (no Sign in button).
const API_BASE = (()=>{
  const host = location.hostname;
  if(host === 'localhost' || host === '127.0.0.1') return `${location.protocol}//${host}:8500`;
  if(host === 'budget.msmccoy.com') return 'https://api.budget.msmccoy.com';
  return null;
})();
const SIGNED_IN_KEY = 'signed-in'; // device-local hint: an email means "try the account first on load"

let account = null;         // {email} while signed in; null = guest, saving to this browser
let accountSheet = null;    // 'signin' | 'password' | 'conflict' | null — the account dialog showing
let sessionLost = false;    // signed in, but the server says the session ended
let saveStatus = 'saved';   // 'saving' | 'saved' | 'error' — shown in account mode
let conflict = null;        // {id, theirs} when a save hit a newer copy from elsewhere
let notice = null;          // one-line message across the top, dismissable

// Edit/form state (used by categories.js, render.js, events.js)
let editingId = null; // category currently being edited, or 'new-left' / 'new-right' / 'new-budget'
let editDraft = null;
let editingZoneTitle = null; // 'left' or 'right' when that column title is being edited
let bulkZone = null; // zone key when the "add multiple" textarea is open, else null
let menuOpenId = null; // category id whose chip options menu is open, else null

function uid(){ return 'c' + Math.random().toString(36).slice(2,9); }

function seedState(){
  return {
    income: { amount: 7560, period: 'monthly' },
    currency: 'USD',
    zoneTitles: { left: 'Available', right: 'Available' },
    categories: [
      { id: uid(), name:'Netflix', colorType:'expense', amountType:'fixed', value:10, period:'monthly', location:'left' },
      { id: uid(), name:'Property Tax', colorType:'obligation', amountType:'fixed', value:3300, period:'yearly', location:'left' },
      { id: uid(), name:'Auto Registration', colorType:'obligation', amountType:'fixed', value:120, period:'yearly', location:'left' },
      { id: uid(), name:'Car Replacement Fund', colorType:'savings', amountType:'fixed', value:100, period:'monthly', location:'left' },

      { id: uid(), name:'Food — groceries', colorType:'expense', amountType:'fixed', value:700, period:'monthly', location:'budget' },
      { id: uid(), name:'Food — eating out', colorType:'expense', amountType:'fixed', value:200, period:'monthly', location:'budget' },
      { id: uid(), name:'House projects', colorType:'expense', amountType:'fixed', value:250, period:'monthly', location:'budget' },
      { id: uid(), name:'Gas', colorType:'expense', amountType:'fixed', value:400, period:'monthly', location:'budget' },
      { id: uid(), name:'Clothing', colorType:'expense', amountType:'fixed', value:200, period:'monthly', location:'budget' },
      { id: uid(), name:'Savings — Emergency Fund', colorType:'savings', amountType:'percent', value:10, period:'monthly', location:'budget' },
      { id: uid(), name:'Car Insurance', colorType:'obligation', amountType:'fixed', value:140, period:'monthly', location:'budget' },

      { id: uid(), name:'Kids College', colorType:'savings', amountType:'percent', value:5, period:'monthly', location:'right' },
      { id: uid(), name:'Tithe', colorType:'savings', amountType:'percent', value:10, period:'monthly', location:'right' },
      { id: uid(), name:'Michael — Slush', colorType:'savings', amountType:'fixed', value:150, period:'monthly', location:'right' },
      { id: uid(), name:'Sarah — Slush', colorType:'savings', amountType:'fixed', value:150, period:'monthly', location:'right' },
      { id: uid(), name:'Entertainment', colorType:'expense', amountType:'fixed', value:75, period:'monthly', location:'right' },
      { id: uid(), name:'Student Loan', colorType:'obligation', amountType:'fixed', value:220, period:'monthly', location:'right' },
    ]
  };
}

function defaultColorGroups(){
  return [
    { key:'expense', name:'Everyday expense', color:'#7BAFD4' },
    { key:'obligation', name:'Fixed obligation', color:'#E2918C' },
    { key:'savings', name:'Savings & giving', color:'#ECC163' },
  ];
}
