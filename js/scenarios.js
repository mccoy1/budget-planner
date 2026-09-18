// ---------- Scenario loading, saving & management ----------
// Persistence goes through `store` (storage.js), which also keeps
// scenarioIndex up to date.

async function loadInitial(){
  const loaded = await store.load();
  scenarioIndex = loaded.scenarioIndex;
  activeId = loaded.activeId;
  state = loaded.state;
  colorGroups = loaded.colorGroups;
}

function queueSave(){
  clearTimeout(saveTimer);
  saveTimer = setTimeout(()=> store.saveScenario(activeId, state), 400);
}

async function switchScenario(id){
  if(id === activeId) return;
  activeId = id;
  await store.setActive(id);
  state = (await store.loadScenario(id)) || seedState();
  editingId = null; editDraft = null; menuOpenId = null;
  render();
}

// Creates a scenario from `data` and makes it the active one.
async function openNewScenario(name, data){
  const entry = await store.createScenario(name, data);
  activeId = entry.id;
  state = data;
  editingId = null; editDraft = null; menuOpenId = null;
  await store.setActive(entry.id);
  render();
}

async function duplicateScenario(){
  const current = scenarioIndex.find(s=>s.id===activeId);
  const defaultName = 'Copy of ' + (current ? current.name : 'Budget');
  const name = (prompt('Name this new scenario:', defaultName) || '').trim();
  if(!name) return;
  await openNewScenario(name, JSON.parse(JSON.stringify(state)));
}

async function newBlankScenario(){
  const name = (prompt('Name this scenario:', 'New scenario') || '').trim();
  if(!name) return;
  await openNewScenario(name, { income: { amount: 0, period: 'monthly' }, categories: [], currency: state.currency || 'USD' });
}

async function renameScenario(){
  const entry = scenarioIndex.find(s=>s.id===activeId);
  if(!entry) return;
  const name = (prompt('Rename scenario:', entry.name) || '').trim();
  if(!name) return;
  await store.renameScenario(activeId, name);
  render();
}

async function deleteScenario(){
  if(scenarioIndex.length <= 1){
    alert("You need at least one scenario — create another before deleting this one.");
    return;
  }
  const entry = scenarioIndex.find(s=>s.id===activeId);
  if(!confirm(`Delete "${entry ? entry.name : 'this scenario'}"? This can't be undone.`)) return;
  await store.deleteScenario(activeId);
  activeId = scenarioIndex[0].id;
  await store.setActive(activeId);
  state = (await store.loadScenario(activeId)) || seedState();
  editingId = null; editDraft = null; menuOpenId = null;
  render();
}
