// ---------- Bootstrap ----------

(async function init(){
  viewPref = lsGet(VIEW_PREF_KEY); // device-local view override, read before the first render
  // Only a device that was signed in last time waits on the account server
  // (which may be asleep); everyone else starts from this browser at once.
  const signedInHere = API_BASE && lsGet(SIGNED_IN_KEY);
  if(!(signedInHere && await bootIntoAccount())) await loadInitial();
  render();
  // The tour spotlights the desktop board, so it only runs in the full view,
  // and not on top of a sign-in prompt.
  if(!isMobileView() && !accountSheet) maybeStartTour();
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
// while following the viewport, so an explicit view choice isn't overridden,
// and not over a full-page account screen that is waiting for an answer.
const mobileMediaQuery = window.matchMedia(MOBILE_BREAKPOINT);
const onBreakpointChange = ()=>{ if(!viewPref && state && !document.querySelector('.boot-card')) render(); };
if(mobileMediaQuery.addEventListener) mobileMediaQuery.addEventListener('change', onBreakpointChange);
else mobileMediaQuery.addListener(onBreakpointChange); // Safari < 14

// Don't leave edits sitting in the save debounce when the page goes away.
// keepalive lets an account save finish after the tab has closed. Phones may
// never fire pagehide, hence visibilitychange too.
document.addEventListener('visibilitychange', ()=>{
  if(document.visibilityState === 'hidden') flushSaves({ keepalive: true });
});
window.addEventListener('pagehide', ()=> flushSaves({ keepalive: true }));
window.addEventListener('beforeunload', e=>{
  flushSaves({ keepalive: true });
  // Changes that already failed to reach the account: ask before leaving.
  if(account && (saveStatus === 'error' || sessionLost)){ e.preventDefault(); e.returnValue = ''; }
});
