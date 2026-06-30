// ---------- Money math ----------

function monthlyIncome(){
  return state.income.period === 'monthly' ? state.income.amount : state.income.amount/12;
}
function monthlyValue(cat){
  if(cat.amountType === 'percent'){
    return monthlyIncome() * (cat.value/100);
  }
  return cat.period === 'yearly' ? cat.value/12 : cat.value;
}
function fmt(n){
  const sign = n < 0 ? '-' : '';
  const currency = (state && state.currency) || 'USD';
  const symbol = { USD: '$', EUR: '€', JPY: '¥' }[currency] || '$';
  const decimals = currency === 'JPY' ? 0 : (Math.abs(n) < 100 ? 2 : 0);
  return sign + symbol + Math.abs(n).toLocaleString(undefined, { maximumFractionDigits: decimals });
}

// ---------- Editing a single category ----------

function startEdit(catOrZone, isNew){
  bulkZone = null;
  menuOpenId = null;
  addMenuZone = null;
  mainMenuOpen = false;
  if(isNew){
    editingId = 'new';
    const defaultColor = colorGroups[0] ? colorGroups[0].key : 'expense';
    editDraft = { id:null, name:'', colorType:defaultColor, amountType:'fixed', value:'', period:'monthly', location: catOrZone };
  } else {
    editingId = catOrZone.id;
    editDraft = Object.assign({}, catOrZone);
  }
  render();
}
function cancelEdit(){ editingId=null; editDraft=null; render(); }

// Pulls the live name/value inputs into editDraft. Needed before any re-render
// triggered by clicking color/type/period toggles, since those only rebuild the
// form from editDraft — without this, whatever the person just typed would be lost.
function syncEditDraftFromForm(){
  if(!editDraft) return;
  const nameEl = document.getElementById('f-name');
  const valueEl = document.getElementById('f-value');
  if(nameEl) editDraft.name = nameEl.value;
  if(valueEl) editDraft.value = valueEl.value;
}

function saveEdit(){
  const name = (editDraft.name||'').trim() || 'Untitled';
  const value = parseFloat(editDraft.value) || 0;
  if(editDraft.id){
    const cat = state.categories.find(c=>c.id===editDraft.id);
    Object.assign(cat, editDraft, { name, value });
  } else {
    state.categories.push(Object.assign({}, editDraft, { id: uid(), name, value }));
  }
  editingId = null; editDraft = null; menuOpenId = null;
  queueSave(); render();
}
function deleteCat(id){
  state.categories = state.categories.filter(c=>c.id!==id);
  if(menuOpenId === id) menuOpenId = null;
  queueSave(); render();
}
function moveCat(id, newLocation){
  const cat = state.categories.find(c=>c.id===id);
  if(cat && cat.location !== newLocation){
    cat.location = newLocation;
    delete cat.x; delete cat.y; // get a fresh, non-overlapping spot in the new column
    menuOpenId = null;
    queueSave(); render();
  }
}

// ---------- Card positioning ----------

// Assigns x/y to any category missing them (new categories, migrated data, or
// categories that just changed zones), using a simple non-overlapping grid guess.
function ensurePositions(){
  ['left','budget','right'].forEach(zone=>{
    const cardW = zone==='budget' ? 184 : 182;
    const cardH = zone==='budget' ? 54 : 116;
    const gap = 12;
    const perRow = 2;
    let idx = 0;
    state.categories.filter(c=>c.location===zone).forEach(c=>{
      if(typeof c.x !== 'number' || typeof c.y !== 'number'){
        const col = idx % perRow;
        const row = Math.floor(idx / perRow);
        c.x = 12 + col*(cardW+gap) + Math.round((Math.random()-0.5)*8);
        c.y = 12 + row*(cardH+gap) + Math.round((Math.random()-0.5)*8);
      }
      idx++;
    });
  });
}

// Keeps cards from drifting off the right/bottom edge of their column after a resize.
function clampPositions(){
  let changed = false;
  document.querySelectorAll('.dropzone').forEach(zone=>{
    const zoneW = zone.clientWidth;
    zone.querySelectorAll('.card').forEach(cardEl=>{
      const cat = state.categories.find(c=>c.id===cardEl.dataset.id);
      if(!cat) return;
      const w = cardEl.offsetWidth;
      const limit = Math.max(4, zoneW - w - 4);
      if(cat.x > limit){
        cat.x = limit;
        cardEl.style.left = limit + 'px';
        changed = true;
      }
    });
  });
  if(changed) queueSave();
}

// Updates dimming live as the person types, without a full re-render — a full
// render() would rebuild the search input itself and steal focus mid-keystroke.
function applySearchFilter(query){
  searchQuery = query;
  const q = query.trim().toLowerCase();
  document.querySelectorAll('.card').forEach(cardEl=>{
    const cat = state.categories.find(c=>c.id===cardEl.dataset.id);
    if(!cat) return;
    const matches = !q || cat.name.toLowerCase().includes(q);
    cardEl.classList.toggle('dimmed', !matches);
  });
}

// Sorts every chip in the budget by its color group, then lays them out into a
// tidy grid (with a small random offset per chip so it doesn't look too rigid).
function snapToGridBudget(){
  const cats = state.categories.filter(c=>c.location==='budget');
  if(!cats.length) return;

  const order = colorGroups.map(g=>g.key);
  cats.sort((a,b)=>{
    const ai = order.indexOf(a.colorType);
    const bi = order.indexOf(b.colorType);
    if(ai !== bi) return ai - bi;
    return a.name.localeCompare(b.name);
  });

  const zoneEl = document.querySelector('.dropzone[data-zone="budget"]');
  const width = zoneEl ? zoneEl.clientWidth : 560;
  const cardW = 184, cardH = 54, gap = 14;
  const perRow = Math.max(1, Math.floor((width - gap) / (cardW + gap)));

  cats.forEach((c, idx)=>{
    const col = idx % perRow;
    const row = Math.floor(idx / perRow);
    const jitterX = Math.round((Math.random() - 0.5) * 8);
    const jitterY = Math.round((Math.random() - 0.5) * 8);
    c.x = Math.max(4, gap + col*(cardW+gap) + jitterX);
    c.y = Math.max(4, gap + row*(cardH+gap) + jitterY);
  });

  menuOpenId = null;
  queueSave();
  render();
}

// ---------- Quick / bulk add ----------

// Parses a single "Name" or "Name, $1000" or "Name, 10%" line into a category draft.
function parseQuickAddLine(line){
  const parts = line.split(',');
  const name = (parts[0]||'').trim();
  if(!name) return null;
  let amountType='fixed', value=0, period='monthly', colorType='expense';
  if(parts.length > 1){
    let raw = parts.slice(1).join(',').trim();
    const isYearly = /\/?\s*y(r|ear|ears)?\.?\b/i.test(raw) && !/%/.test(raw);
    raw = raw.replace(/\/?\s*y(r|ear|ears)?\.?\b/i, '').trim();
    if(raw.includes('%')){
      amountType = 'percent';
      value = parseFloat(raw.replace(/[^0-9.]/g,'')) || 0;
      colorType = 'savings';
    } else if(raw.replace(/[^0-9.]/g,'').length){
      amountType = 'fixed';
      value = parseFloat(raw.replace(/[^0-9.]/g,'')) || 0;
      period = isYearly ? 'yearly' : 'monthly';
    }
  }
  return { id: uid(), name, colorType, amountType, value, period };
}

function saveBulkAdd(zoneKey, text, colorKey){
  const lines = (text||'').split('\n');
  let added = 0;
  lines.forEach(line=>{
    const trimmed = line.trim();
    if(!trimmed) return;
    const parsed = parseQuickAddLine(trimmed);
    if(parsed){
      if(colorKey) parsed.colorType = colorKey;
      state.categories.push(Object.assign(parsed, { location: zoneKey }));
      added++;
    }
  });
  bulkZone = null;
  if(added > 0) queueSave();
  render();
}
