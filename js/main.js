// ---------- Bootstrap ----------

(async function init(){
  await Promise.all([loadInitial(), loadColorGroups()]);
  render();
  maybeStartTour();
})();

let resizeTimer = null;
window.addEventListener('resize', ()=>{
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(clampPositions, 150);
});
