// ---------- Category color groups (shared across all scenarios) ----------
// Loaded with everything else by loadInitial() (scenarios.js).

function queueColorSave(){
  colorsDirty = true;
  scheduleSave(); // scenarios.js
}

// Groups as the account API accepts them (backend/budgets/validation.py):
// keys are 1–24 lowercase letters/digits, colors are #rrggbb, names at most
// 60 characters. Keys and colors are written into HTML attributes unescaped,
// so anything else is dropped or replaced rather than sent.
const COLOR_KEY_RE = /^[a-z0-9]{1,24}$/;
const COLOR_RE = /^#[0-9a-fA-F]{6}$/;
const MAX_GROUP_NAME = 60;

function sanitizeColorGroups(groups){
  const seen = new Set();
  return (Array.isArray(groups) ? groups : []).filter(g =>
    g && typeof g.key === 'string' && COLOR_KEY_RE.test(g.key) && !seen.has(g.key) && seen.add(g.key)
  ).map(g => ({
    key: g.key,
    name: String(g.name == null ? '' : g.name).slice(0, MAX_GROUP_NAME),
    color: COLOR_RE.test(g.color) ? g.color : '#9AA3B5',
  }));
}

function colorFor(key){
  const g = colorGroups.find(g=>g.key===key);
  return g ? g.color : '#9AA3B5';
}

function addColorGroup(name, color){
  name = (name||'').trim().slice(0, MAX_GROUP_NAME) || 'New category';
  const key = 'g' + Math.random().toString(36).slice(2,8);
  colorGroups.push({ key, name, color: color || '#7BAFD4' });
  queueColorSave(); render();
}

function renameColorGroup(key, name){
  const g = colorGroups.find(g=>g.key===key);
  if(!g) return;
  g.name = (name||'').trim().slice(0, MAX_GROUP_NAME) || g.name;
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
