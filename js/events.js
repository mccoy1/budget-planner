// ---------- Event wiring & click dispatch ----------

// Closes any open panel/menu when the click lands outside it — checked at the
// document level (capture phase) so it also catches clicks outside #app itself
// (e.g. in the page margins on a wide screen), not just clicks inside the app.
function closeOpenPanelsIfOutside(e){
  if(menuOpenId && !e.target.closest('.card.menu-open')){
    menuOpenId = null;
    render();
  }
  if(mainMenuOpen && !e.target.closest('.menu-panel') && !e.target.closest('[data-act="togglemainmenu"]')){
    mainMenuOpen = false;
    render();
  }
  if(addMenuZone && !e.target.closest('.add-menu-panel') && !e.target.closest('[data-act="toggleaddmenu"]')){
    addMenuZone = null;
    render();
  }
}

function saveZoneTitle(zone, value){
  if(!state.zoneTitles) state.zoneTitles = {};
  state.zoneTitles[zone] = value.trim() || 'Available';
  editingZoneTitle = null;
  queueSave(); render();
}

function attachHandlers(){
  const app = document.getElementById('app');

  // free-form dragging (mouse + touch via Pointer Events)
  app.addEventListener('pointerdown', onCardPointerDown);

  // clicks
  app.addEventListener('click', handleClick);
  document.addEventListener('click', closeOpenPanelsIfOutside, true);

  // zone title inline editing
  ['left','right'].forEach(zone=>{
    const inp = document.getElementById(`zone-title-${zone}`);
    if(inp){
      inp.focus(); inp.select();
      inp.addEventListener('blur', ()=> saveZoneTitle(zone, inp.value));
      inp.addEventListener('keydown', e=>{
        if(e.key==='Enter') inp.blur();
        if(e.key==='Escape'){ editingZoneTitle=null; render(); }
      });
    }
  });

  // scenario switcher
  const sel = document.getElementById('scenario-select');
  if(sel) sel.addEventListener('change', e=> switchScenario(e.target.value));

  // color panel: color pickers and rename fields commit on change (not every keystroke,
  // so the panel doesn't lose focus mid-edit on every re-render)
  app.querySelectorAll('[data-act="colorchange"]').forEach(inp=>{
    inp.addEventListener('change', e=> recolorGroup(inp.dataset.key, e.target.value));
  });
  app.querySelectorAll('[data-act="colorrename"]').forEach(inp=>{
    inp.addEventListener('change', e=> renameColorGroup(inp.dataset.key, e.target.value));
  });

  // search: filter live as you type, without a full re-render (keeps focus in the box)
  const searchInput = document.getElementById('search-input');
  if(searchInput){
    searchInput.addEventListener('input', e=> applySearchFilter(e.target.value));
  }
}

function handleClick(e){
  const act = e.target.closest('[data-act]');
  if(!act) return;
  const a = act.dataset.act;

  if(a==='noop'){ return; }
  if(a==='togglemainmenu'){ mainMenuOpen = !mainMenuOpen; render(); return; }
  if(a==='toggleaddmenu'){ addMenuZone = (addMenuZone===act.dataset.zone) ? null : act.dataset.zone; render(); return; }
  if(a==='snapgrid'){ snapToGridBudget(); return; }
  if(a==='starttour'){ startTour(); return; }
  if(a==='togglesearch'){ searchOpen = true; searchFocusPending = true; render(); return; }
  if(a==='togglebreakdown'){ breakdownOpen = !breakdownOpen; render(); return; }
  if(a==='closesearch'){ searchOpen = false; searchQuery = ''; render(); return; }
  if(a==='togglecolorvis'){
    const key = act.dataset.key;
    if(hiddenColors.has(key)) hiddenColors.delete(key); else hiddenColors.add(key);
    render();
    return;
  }
  if(a==='colordelete'){ deleteColorGroup(act.dataset.key); return; }
  if(a==='coloradd'){
    const colorInput = document.getElementById('new-color-input');
    const nameInput = document.getElementById('new-color-name');
    addColorGroup(nameInput ? nameInput.value : '', colorInput ? colorInput.value : '#7BAFD4');
    return;
  }
  if(a==='togglemenu'){ menuOpenId = (menuOpenId===act.dataset.id) ? null : act.dataset.id; render(); return; }
  if(a==='edit'){ const c = state.categories.find(c=>c.id===act.dataset.id); startEdit(c,false); return; }
  if(a==='del'){ deleteCat(act.dataset.id); return; }
  if(a==='move'){ moveCat(act.dataset.id, act.dataset.to); return; }
  if(a==='addnew'){ addMenuZone=null; startEdit(act.dataset.zone, true); return; }
  if(a==='bulknew'){ addMenuZone=null; editingId=null; editDraft=null; bulkZone = act.dataset.zone; render(); return; }
  if(a==='bulkcancel'){ bulkZone = null; render(); return; }
  if(a==='bulksave'){
    const ta = document.getElementById('bulk-textarea');
    const colorSel = document.getElementById('bulk-color-select');
    saveBulkAdd(act.dataset.zone, ta ? ta.value : '', colorSel ? colorSel.value : null);
    return;
  }
  if(a==='cancel'){ cancelEdit(); return; }
  if(a==='save'){
    const name = document.getElementById('f-name').value;
    const value = document.getElementById('f-value').value;
    editDraft.name = name; editDraft.value = value;
    saveEdit();
    return;
  }
  if(a==='color'){ syncEditDraftFromForm(); editDraft.colorType = act.dataset.key; render(); return; }
  if(a==='amtType'){ syncEditDraftFromForm(); editDraft.amountType = act.dataset.key; render(); return; }
  if(a==='period'){ syncEditDraftFromForm(); editDraft.period = act.dataset.key; render(); return; }
  if(a==='editincome'){ editingId='income'; render(); return; }
  if(a==='incperiod'){ state.income.period = act.dataset.key; render(); return; }
  if(a==='incsave'){
    const val = parseFloat(document.getElementById('f-income').value) || 0;
    state.income.amount = val;
    editingId = null;
    queueSave(); render();
    return;
  }
  if(a==='edittitle'){ editingZoneTitle = act.dataset.zone; render(); return; }
  if(a==='setcurrency'){ state.currency = act.value; queueSave(); render(); return; }
  if(a==='dup'){ duplicateScenario(); return; }
  if(a==='newblank'){ newBlankScenario(); return; }
  if(a==='rename'){ renameScenario(); return; }
  if(a==='delscenario'){ deleteScenario(); return; }
}
