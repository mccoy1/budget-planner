// ---------- Scenario loading, saving & management ----------

async function loadInitial(){
  const idxRaw = await safeGet(INDEX_KEY);
  if(idxRaw){
    scenarioIndex = JSON.parse(idxRaw);
    const savedActive = await safeGet(ACTIVE_KEY);
    activeId = (savedActive && scenarioIndex.some(s=>s.id===savedActive)) ? savedActive : (scenarioIndex[0] && scenarioIndex[0].id);
    const sdata = activeId ? await safeGet(scenarioKey(activeId)) : null;
    state = sdata ? JSON.parse(sdata) : seedState();
    return;
  }
  // No scenarios yet — migrate the old single-budget save if present, else seed an example.
  const legacy = await safeGet(LEGACY_KEY);
  const firstState = legacy ? JSON.parse(legacy) : seedState();
  const firstName = legacy ? 'My Budget' : 'Example Budget';
  const id = uid();
  scenarioIndex = [{ id, name: firstName, updatedAt: Date.now() }];
  activeId = id;
  state = firstState;
  await safeSet(scenarioKey(id), JSON.stringify(firstState));
  await safeSet(INDEX_KEY, JSON.stringify(scenarioIndex));
  await safeSet(ACTIVE_KEY, id);
}

function queueSave(){
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async ()=>{
    await safeSet(scenarioKey(activeId), JSON.stringify(state));
    const entry = scenarioIndex.find(s=>s.id===activeId);
    if(entry) entry.updatedAt = Date.now();
    await safeSet(INDEX_KEY, JSON.stringify(scenarioIndex));
  }, 400);
}

async function switchScenario(id){
  if(id === activeId) return;
  activeId = id;
  await safeSet(ACTIVE_KEY, id);
  const sdata = await safeGet(scenarioKey(id));
  state = sdata ? JSON.parse(sdata) : seedState();
  editingId = null; editDraft = null; menuOpenId = null;
  render();
}

async function duplicateScenario(){
  const current = scenarioIndex.find(s=>s.id===activeId);
  const defaultName = 'Copy of ' + (current ? current.name : 'Budget');
  const name = (prompt('Name this new scenario:', defaultName) || '').trim();
  if(!name) return;
  const id = uid();
  const copy = JSON.parse(JSON.stringify(state));
  scenarioIndex.push({ id, name, updatedAt: Date.now() });
  activeId = id;
  state = copy;
  editingId = null; editDraft = null; menuOpenId = null;
  await safeSet(scenarioKey(id), JSON.stringify(copy));
  await safeSet(INDEX_KEY, JSON.stringify(scenarioIndex));
  await safeSet(ACTIVE_KEY, id);
  render();
}

async function newBlankScenario(){
  const name = (prompt('Name this scenario:', 'New scenario') || '').trim();
  if(!name) return;
  const id = uid();
  const blank = { income: { amount: 0, period: 'monthly' }, categories: [] };
  scenarioIndex.push({ id, name, updatedAt: Date.now() });
  activeId = id;
  state = blank;
  editingId = null; editDraft = null; menuOpenId = null;
  await safeSet(scenarioKey(id), JSON.stringify(blank));
  await safeSet(INDEX_KEY, JSON.stringify(scenarioIndex));
  await safeSet(ACTIVE_KEY, id);
  render();
}

async function renameScenario(){
  const entry = scenarioIndex.find(s=>s.id===activeId);
  if(!entry) return;
  const name = (prompt('Rename scenario:', entry.name) || '').trim();
  if(!name) return;
  entry.name = name; entry.updatedAt = Date.now();
  await safeSet(INDEX_KEY, JSON.stringify(scenarioIndex));
  render();
}

async function deleteScenario(){
  if(scenarioIndex.length <= 1){
    alert("You need at least one scenario — create another before deleting this one.");
    return;
  }
  const entry = scenarioIndex.find(s=>s.id===activeId);
  if(!confirm(`Delete "${entry ? entry.name : 'this scenario'}"? This can't be undone.`)) return;
  await safeDelete(scenarioKey(activeId));
  scenarioIndex = scenarioIndex.filter(s=>s.id!==activeId);
  await safeSet(INDEX_KEY, JSON.stringify(scenarioIndex));
  activeId = scenarioIndex[0].id;
  await safeSet(ACTIVE_KEY, activeId);
  const sdata = await safeGet(scenarioKey(activeId));
  state = sdata ? JSON.parse(sdata) : seedState();
  editingId = null; editDraft = null; menuOpenId = null;
  render();
}
