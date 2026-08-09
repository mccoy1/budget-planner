// ---------- Bootstrap ----------

(async function init(){
  viewPref = lsGet(VIEW_PREF_KEY); // device-local view override, read before the first render
  await Promise.all([loadInitial(), loadColorGroups()]);
  render();
  // The tour spotlights the desktop board, so it only runs in the full view.
  if(!isMobileView()) maybeStartTour();
})();

let resizeTimer = null;
window.addEventListener('resize', ()=>{
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(()=>{
    if(isMobileView()) return; // no cards to keep in bounds in the compact view
    clampPositions();
  }, 150);
});

// Re-render when crossing the breakpoint (rotation, window resize) — but only
// while following the viewport, so an explicit view choice isn't overridden.
const mobileMediaQuery = window.matchMedia(MOBILE_BREAKPOINT);
const onBreakpointChange = ()=>{ if(!viewPref && state) render(); };
if(mobileMediaQuery.addEventListener) mobileMediaQuery.addEventListener('change', onBreakpointChange);
else mobileMediaQuery.addListener(onBreakpointChange); // Safari < 14
