// ---------- Category color groups (shared across all scenarios) ----------
// Loaded with everything else by loadInitial() (scenarios.js).

function queueColorSave(){
  clearTimeout(colorSaveTimer);
  colorSaveTimer = setTimeout(()=> store.saveColorGroups(colorGroups), 400);
}

function colorFor(key){
  const g = colorGroups.find(g=>g.key===key);
  return g ? g.color : '#9AA3B5';
}

function addColorGroup(name, color){
  name = (name||'').trim() || 'New category';
  const key = 'g' + Math.random().toString(36).slice(2,8);
  colorGroups.push({ key, name, color: color || '#7BAFD4' });
  queueColorSave(); render();
}

function renameColorGroup(key, name){
  const g = colorGroups.find(g=>g.key===key);
  if(!g) return;
  g.name = (name||'').trim() || g.name;
  queueColorSave(); render();
}

function recolorGroup(key, color){
  const g = colorGroups.find(g=>g.key===key);
  if(!g) return;
  g.color = color;
  queueColorSave(); render();
}

function deleteColorGroup(key){
  if(colorGroups.length <= 1){
    alert('You need at least one category color.');
    return;
  }
  const inUse = state.categories.some(c=>c.colorType===key);
  if(inUse && !confirm('Categories using this color will be moved to another color. Continue?')) return;
  colorGroups = colorGroups.filter(g=>g.key!==key);
  hiddenColors.delete(key);
  const fallback = colorGroups[0].key;
  state.categories.forEach(c=>{ if(c.colorType===key) c.colorType = fallback; });
  queueColorSave();
  if(inUse) queueSave();
  render();
}
