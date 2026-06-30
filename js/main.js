// ---------- Bootstrap ----------

(async function init(){
  await Promise.all([loadInitial(), loadColorGroups()]);
  render();
})();

let resizeTimer = null;
window.addEventListener('resize', ()=>{
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(clampPositions, 150);
});
