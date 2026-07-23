// ---------- Guided tour ----------
// A lightweight, dependency-free spotlight tour that introduces new users to
// the key areas of the planner. Completion is tracked in sessionStorage so the
// tour shows once per browser session and doesn't reappear on every reload.
//
// The tour DOM lives directly on <body>, NOT inside #app — render() rewrites
// #app.innerHTML wholesale, which would otherwise wipe the overlay. The overlay
// also blocks clicks to the app underneath while it's open, so the highlighted
// elements stay put as the user steps through.

const TOUR_DONE_KEY = 'budget-tour-done';

// Each step spotlights an element (by CSS selector) and shows a popover next to
// it. A null selector renders a centered popover with no spotlight (the intro).
const tourSteps = [
  {
    selector: null,
    title: 'Welcome to your Budget Planner 👋',
    body: "Let's take a quick tour of the main areas. It only takes a few seconds — you can skip anytime.",
  },
  {
    selector: '.income-hero',
    title: 'Your household income',
    body: 'Everything is planned against this number. Click it to set your monthly or yearly income.',
  },
  {
    selector: '.board > .col:first-child',
    title: 'Available categories',
    body: 'These side shelves hold categories that aren\'t in your plan yet. Drag one into the middle to budget for it.',
  },
  {
    selector: '.col-budget',
    title: 'Your Budget',
    body: 'This is your active plan for the month. Drop categories here and rearrange them freely — or use “Snap to grid” to tidy up.',
  },
  {
    selector: '.col-budget .add-card',
    title: 'Add your own categories',
    body: 'Use “+ Add” to create a single category or paste several at once with “Add multiple”.',
  },
  {
    selector: '.balance-card',
    title: 'What’s left over',
    body: 'This card tracks what remains after everything you\'ve budgeted. Expand the breakdown below to see spending by group.',
  },
  {
    selector: '[data-act="togglemainmenu"]',
    title: 'Scenarios, currency & colors',
    body: 'The menu is where you switch scenarios, change currency, and manage category colors. That\'s the tour — happy planning!',
  },
];

let tourIndex = 0;
let tourActive = false;

function tourIsDone(){
  try{ return sessionStorage.getItem(TOUR_DONE_KEY) === '1'; }catch(e){ return false; }
}
function markTourDone(){
  try{ sessionStorage.setItem(TOUR_DONE_KEY, '1'); }catch(e){}
}

// Called once after the first render. Starts the tour unless it's already been
// completed (or dismissed) this session.
function maybeStartTour(){
  if(tourIsDone()) return;
  startTour();
}

function startTour(){
  if(tourActive) return;
  tourActive = true;
  tourIndex = 0;

  const overlay = document.createElement('div');
  overlay.id = 'tour-overlay';
  overlay.innerHTML = `
    <div id="tour-spotlight"></div>
    <div id="tour-popover" role="dialog" aria-modal="true" aria-labelledby="tour-title">
      <div id="tour-progress"></div>
      <h3 id="tour-title"></h3>
      <p id="tour-body"></p>
      <div id="tour-controls">
        <button type="button" class="tour-skip" data-tour="skip">Skip tour</button>
        <div class="tour-nav">
          <button type="button" class="tour-btn tour-secondary" data-tour="back">Back</button>
          <button type="button" class="tour-btn tour-primary" data-tour="next">Next</button>
        </div>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  overlay.addEventListener('click', onTourClick);
  window.addEventListener('resize', positionTour);
  window.addEventListener('keydown', onTourKey);

  showTourStep();
}

function onTourClick(e){
  const btn = e.target.closest('[data-tour]');
  if(!btn) return;
  const act = btn.dataset.tour;
  if(act === 'skip'){ endTour(); return; }
  if(act === 'back'){ if(tourIndex > 0){ tourIndex--; showTourStep(); } return; }
  if(act === 'next'){
    if(tourIndex < tourSteps.length - 1){ tourIndex++; showTourStep(); }
    else { endTour(); }
  }
}

function onTourKey(e){
  if(!tourActive) return;
  if(e.key === 'Escape'){ endTour(); }
  else if(e.key === 'ArrowRight' || e.key === 'Enter'){
    if(tourIndex < tourSteps.length - 1){ tourIndex++; showTourStep(); } else { endTour(); }
  }
  else if(e.key === 'ArrowLeft'){ if(tourIndex > 0){ tourIndex--; showTourStep(); } }
}

function showTourStep(){
  const step = tourSteps[tourIndex];
  const overlay = document.getElementById('tour-overlay');
  if(!overlay) return;

  // Skip a step whose target element isn't on the page (e.g. hidden by a filter).
  if(step.selector && !document.querySelector(step.selector)){
    if(tourIndex < tourSteps.length - 1){ tourIndex++; showTourStep(); return; }
    endTour(); return;
  }

  overlay.querySelector('#tour-title').textContent = step.title;
  overlay.querySelector('#tour-body').textContent = step.body;
  overlay.querySelector('#tour-progress').textContent = `Step ${tourIndex + 1} of ${tourSteps.length}`;

  const backBtn = overlay.querySelector('[data-tour="back"]');
  backBtn.style.visibility = tourIndex === 0 ? 'hidden' : 'visible';
  overlay.querySelector('[data-tour="next"]').textContent =
    tourIndex === tourSteps.length - 1 ? 'Done' : 'Next';

  positionTour();
}

function positionTour(){
  const overlay = document.getElementById('tour-overlay');
  if(!overlay) return;
  const step = tourSteps[tourIndex];
  const spotlight = overlay.querySelector('#tour-spotlight');
  const popover = overlay.querySelector('#tour-popover');
  const vw = window.innerWidth, vh = window.innerHeight;
  const margin = 12;

  const target = step.selector ? document.querySelector(step.selector) : null;

  if(!target){
    // Centered popover, no spotlight.
    spotlight.style.opacity = '0';
    popover.style.left = Math.round((vw - popover.offsetWidth) / 2) + 'px';
    popover.style.top = Math.round((vh - popover.offsetHeight) / 2) + 'px';
    return;
  }

  const r = target.getBoundingClientRect();
  const pad = 6;
  spotlight.style.opacity = '1';
  spotlight.style.left = (r.left - pad) + 'px';
  spotlight.style.top = (r.top - pad) + 'px';
  spotlight.style.width = (r.width + pad * 2) + 'px';
  spotlight.style.height = (r.height + pad * 2) + 'px';

  const pw = popover.offsetWidth, ph = popover.offsetHeight;

  // Prefer placing the popover below the target; flip above if it won't fit.
  let top = r.bottom + margin + pad;
  if(top + ph > vh - margin) top = r.top - pad - margin - ph;
  // If it fits neither below nor above, pin it into the viewport.
  if(top < margin) top = Math.min(Math.max(margin, r.bottom + margin), vh - ph - margin);

  let left = r.left + r.width / 2 - pw / 2;
  left = Math.max(margin, Math.min(left, vw - pw - margin));

  popover.style.left = Math.round(left) + 'px';
  popover.style.top = Math.round(top) + 'px';
}

function endTour(){
  tourActive = false;
  markTourDone();
  window.removeEventListener('resize', positionTour);
  window.removeEventListener('keydown', onTourKey);
  const overlay = document.getElementById('tour-overlay');
  if(overlay) overlay.remove();
}
