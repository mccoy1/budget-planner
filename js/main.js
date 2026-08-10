// ---------- Bootstrap ----------

(async function init(){
  viewPref = lsGet(VIEW_PREF_KEY); // device-local view override, read before the first render
  await Promise.all([loadInitial(), loadColorGroups()]);
  await maybeImportFromHash(); // a shared link opens straight into its import prompt
  render();
  // The tour spotlights the desktop board, so it only runs in the full view —
  // and never on top of an import someone is being asked to confirm.
  if(!isMobileView() && !pendingImport) maybeStartTour();
})();

let resizeTimer = null;
window.addEventListener('resize', ()=>{
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(()=>{
    if(isMobileView()) return; // no cards to keep in bounds in the compact view
    clampPositions();
  }, 150);
});

// Pasting a share link into a tab that's already on the planner only changes
// the fragment — the page never reloads, so init() would not see it. Catch that
// case here so the import prompt still appears.
window.addEventListener('hashchange', async ()=>{
  if(!state) return;
  await maybeImportFromHash();
  if(pendingImport){
    if(tourActive) endTour(); // the overlay would sit on top of the prompt
    render();
  }
});

// Re-render when crossing the breakpoint (rotation, window resize) — but only
// while following the viewport, so an explicit view choice isn't overridden.
const mobileMediaQuery = window.matchMedia(MOBILE_BREAKPOINT);
const onBreakpointChange = ()=>{ if(!viewPref && state) render(); };
if(mobileMediaQuery.addEventListener) mobileMediaQuery.addEventListener('change', onBreakpointChange);
else mobileMediaQuery.addListener(onBreakpointChange); // Safari < 14
