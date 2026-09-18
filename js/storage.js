// ---------- Persistence ----------
// Everything the app saves goes through `store`: one method per operation
// (load, create, save, rename, delete…) rather than raw keys, so a second
// implementation backed by the account API can sit beside this one without
// the rest of the app changing.
//
// The store is the only writer of `scenarioIndex`. Callers set `activeId`,
// `state` and `colorGroups` themselves, then tell the store to persist them.

const HAS_CLOUD_STORAGE = !!(window.storage && typeof window.storage.get === 'function' && typeof window.storage.set === 'function');

// Device-local values (view preference, tour flag) always use these directly:
// they describe this browser, not the budget, so they never go through `store`.
function lsGet(key){
  try{ return localStorage.getItem('budget:'+key); }catch(e){ return null; }
}
function lsSet(key, value){
  try{ localStorage.setItem('budget:'+key, value); return true; }catch(e){ console.error('local save failed', key, e); return false; }
}
function lsDelete(key){
  try{ localStorage.removeItem('budget:'+key); }catch(e){}
}

// Key-value access for localStore: Claude's shared cloud storage
// (window.storage) when the planner runs inside Claude, else localStorage.
async function safeGet(key){
  if(HAS_CLOUD_STORAGE){
    try{
      const res = await window.storage.get(key, true);
      return res ? res.value : null;
    }catch(e){ return null; }
  }
  return lsGet(key);
}
async function safeSet(key, value){
  if(HAS_CLOUD_STORAGE){
    try{ await window.storage.set(key, value, true); return true; }
    catch(e){ console.error('save failed', key, e); return false; }
  }
  return lsSet(key, value);
}
async function safeDelete(key){
  if(HAS_CLOUD_STORAGE){
    try{ await window.storage.delete(key, true); }catch(e){}
    return;
  }
  lsDelete(key);
}

// ---------- localStore: this browser (or Claude's shared storage) ----------
// Key layout (see config.js): the index, the active id and the color groups
// each under their own key, and each scenario's state under scenario:<id>.

function saveLocalIndex(index){
  return safeSet(INDEX_KEY, JSON.stringify(index));
}

async function loadLocalScenarios(){
  const idxRaw = await safeGet(INDEX_KEY);
  if(idxRaw){
    const index = JSON.parse(idxRaw);
    const savedActive = await safeGet(ACTIVE_KEY);
    const active = (savedActive && index.some(s=>s.id===savedActive)) ? savedActive : (index[0] && index[0].id);
    const sdata = active ? await safeGet(scenarioKey(active)) : null;
    return { scenarioIndex: index, activeId: active, state: sdata ? JSON.parse(sdata) : seedState() };
  }
  // No scenarios yet — migrate the old single-budget save if present, else seed an example.
  const legacy = await safeGet(LEGACY_KEY);
  const firstState = legacy ? JSON.parse(legacy) : seedState();
  const firstName = legacy ? 'My Budget' : 'Example Budget';
  const id = uid();
  const index = [{ id, name: firstName, updatedAt: Date.now() }];
  await safeSet(scenarioKey(id), JSON.stringify(firstState));
  await saveLocalIndex(index);
  await safeSet(ACTIVE_KEY, id);
  return { scenarioIndex: index, activeId: id, state: firstState };
}

async function loadLocalColorGroups(){
  const raw = await safeGet(COLOR_GROUPS_KEY);
  if(raw){
    try{ return JSON.parse(raw); }catch(e){}
  }
  const groups = defaultColorGroups();
  await safeSet(COLOR_GROUPS_KEY, JSON.stringify(groups));
  return groups;
}

const localStore = {
  // → { scenarioIndex, activeId, state, colorGroups }
  async load(){
    const [scenarios, groups] = await Promise.all([loadLocalScenarios(), loadLocalColorGroups()]);
    return { ...scenarios, colorGroups: groups };
  },

  // → the scenario's state, or null if it's missing
  async loadScenario(id){
    const raw = await safeGet(scenarioKey(id));
    return raw ? JSON.parse(raw) : null;
  },

  // Adds the scenario to scenarioIndex and returns its index entry.
  async createScenario(name, data){
    const entry = { id: uid(), name, updatedAt: Date.now() };
    scenarioIndex.push(entry);
    await safeSet(scenarioKey(entry.id), JSON.stringify(data));
    await saveLocalIndex(scenarioIndex);
    return entry;
  },

  async saveScenario(id, data){
    await safeSet(scenarioKey(id), JSON.stringify(data));
    const entry = scenarioIndex.find(s=>s.id===id);
    if(entry) entry.updatedAt = Date.now();
    await saveLocalIndex(scenarioIndex);
  },

  async renameScenario(id, name){
    const entry = scenarioIndex.find(s=>s.id===id);
    if(!entry) return;
    entry.name = name; entry.updatedAt = Date.now();
    await saveLocalIndex(scenarioIndex);
  },

  // Removes the scenario from scenarioIndex too.
  async deleteScenario(id){
    await safeDelete(scenarioKey(id));
    scenarioIndex = scenarioIndex.filter(s=>s.id!==id);
    await saveLocalIndex(scenarioIndex);
  },

  setActive(id){
    return safeSet(ACTIVE_KEY, id);
  },

  saveColorGroups(groups){
    return safeSet(COLOR_GROUPS_KEY, JSON.stringify(groups));
  },
};

let store = localStore;
