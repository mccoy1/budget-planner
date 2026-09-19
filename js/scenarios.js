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

const MAX_SCENARIO_NAME = 100; // the account API's limit

function cleanScenarioName(name){
  return String(name == null ? '' : name).trim().slice(0, MAX_SCENARIO_NAME);
}

// ---------- Saving ----------
// Edits are debounced, then saved through `store`. What's waiting is kept per
// scenario (pendingSaves: id → that scenario's state object), and every
// scenario operation below saves it first, so switching away right after an
// edit can't lose it. Saves run one at a time (saveChain): each account save
// must send the version the previous one returned.

function queueSave(){
  pendingSaves.set(activeId, state);
  scheduleSave();
}

function scheduleSave(){
  if(account) setSaveStatus('saving');
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flushSaves, 400);
}

// Save everything waiting, now. Resolves once it has all been attempted.
// {keepalive: true} lets an account save outlive the page (tab closing).
function flushSaves(opts = {}){
  clearTimeout(saveTimer);
  saveTimer = null;
  const jobs = [...pendingSaves];
  pendingSaves.clear();
  const colors = colorsDirty;
  colorsDirty = false;
  if(jobs.length || colors){
    // The catch keeps one unexpected error from stalling every later save.
    saveChain = saveChain
      .catch(e => console.error('save pipeline', e))
      .then(()=> runSaves(jobs, colors, opts));
  }
  return saveChain;
}

async function runSaves(jobs, colors, opts){
  let failure = null;
  for(const [id, data] of jobs){
    try{
      await store.saveScenario(id, data, opts);
    }catch(e){
      if(e.status === 409){ showConflict(id, data, e.body && e.body.scenario); continue; } // account.js
      failure = failure || e;
      if(!pendingSaves.has(id)) pendingSaves.set(id, data); // keep it for a retry
    }
  }
  if(colors){
    try{ await store.saveColorGroups(colorGroups, opts); }
    catch(e){ failure = failure || e; colorsDirty = true; }
  }
  if(failure) onSaveFailed(failure); // account.js
  else if(!conflict && !pendingSaves.size && !colorsDirty && saveTimer === null) setSaveStatus('saved');
}

// ---------- Scenario operations ----------
// Each saves pending edits first. Nothing on screen changes until the store
// has done its part, so a failed request leaves the app where it was.

async function switchScenario(id){
  if(id === activeId) return;
  await flushSaves();
  let data;
  try{ data = await store.loadScenario(id); }
  catch(e){ reportStoreError(e, 'open that scenario'); render(); return; }
  activeId = id;
  state = data || seedState();
  editingId = null; editDraft = null; menuOpenId = null;
  render();
  rememberActive(id);
}

// Tell the store which scenario is open. Not awaited: nothing depends on it.
function rememberActive(id){
  Promise.resolve(store.setActive(id)).catch(e => reportStoreError(e, 'remember which scenario is open'));
}

// Creates a scenario from `data` and makes it the active one.
async function openNewScenario(name, data){
  await flushSaves();
  let entry;
  try{ entry = await store.createScenario(cleanScenarioName(name), data); }
  catch(e){ reportStoreError(e, 'create the scenario'); return; }
  activeId = entry.id;
  state = data;
  editingId = null; editDraft = null; menuOpenId = null;
  render();
  rememberActive(entry.id);
}

async function duplicateScenario(){
  const current = scenarioIndex.find(s=>s.id===activeId);
  const defaultName = 'Copy of ' + (current ? current.name : 'Budget');
  const name = cleanScenarioName(prompt('Name this new scenario:', defaultName));
  if(!name) return;
  await openNewScenario(name, JSON.parse(JSON.stringify(state)));
}

async function newBlankScenario(){
  const name = cleanScenarioName(prompt('Name this scenario:', 'New scenario'));
  if(!name) return;
  await openNewScenario(name, { income: { amount: 0, period: 'monthly' }, categories: [], currency: state.currency || 'USD' });
}

async function renameScenario(){
  const entry = scenarioIndex.find(s=>s.id===activeId);
  if(!entry) return;
  const name = cleanScenarioName(prompt('Rename scenario:', entry.name));
  if(!name) return;
  await flushSaves();
  if(conflict) return; // the save just hit a newer copy; that has to be settled first
  try{ await store.renameScenario(activeId, name); }
  catch(e){ reportStoreError(e, 'rename the scenario'); return; }
  render();
}

async function deleteScenario(){
  if(scenarioIndex.length <= 1){
    alert("You need at least one scenario — create another before deleting this one.");
    return;
  }
  const entry = scenarioIndex.find(s=>s.id===activeId);
  if(!confirm(`Delete "${entry ? entry.name : 'this scenario'}"? This can't be undone.`)) return;
  const doomed = activeId;
  await flushSaves();
  pendingSaves.delete(doomed);
  try{ await store.deleteScenario(doomed); }
  catch(e){ reportStoreError(e, 'delete the scenario'); return; }
  const next = scenarioIndex[0].id;
  let data;
  try{ data = await store.loadScenario(next); }
  catch(e){ await resyncFromServer("The scenario was deleted, but the next one couldn't be opened, so your budgets have been reloaded."); return; }
  activeId = next;
  state = data || seedState();
  editingId = null; editDraft = null; menuOpenId = null;
  render();
  rememberActive(next);
}
