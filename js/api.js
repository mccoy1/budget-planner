// ---------- Account API client & apiStore ----------
// Talks to backend/ (see backend/README.md for the endpoints). Sign-in is a
// session cookie on the API's own domain, so every request sends credentials.
// That domain's cookies can't be read from here, so the CSRF token comes back
// in JSON bodies instead; it is kept in memory and sent on every write.

class ApiError extends Error {
  constructor(status, body){
    super((body && body.error) || (status ? `The server answered ${status}.` : "The server couldn't be reached."));
    this.status = status; // 0 = no response at all (offline, timed out, server down)
    this.body = body;
  }
}

let csrfToken = null;

// Browsers cap keepalive requests at 64 KB in flight; a budget is a few KB.
const KEEPALIVE_LIMIT = 60000;

async function apiFetch(path, { method = 'GET', body, keepalive = false, timeout = 30000, retried = false } = {}){
  const json = body === undefined ? undefined : JSON.stringify(body);
  const headers = {};
  if(json !== undefined) headers['Content-Type'] = 'application/json';
  if(method !== 'GET' && csrfToken) headers['X-CSRFToken'] = csrfToken;
  const ctrl = new AbortController();
  const timer = setTimeout(()=> ctrl.abort(), timeout);
  let res;
  try{
    res = await fetch(API_BASE + path, {
      method, headers, body: json, credentials: 'include', signal: ctrl.signal,
      keepalive: keepalive && (json || '').length < KEEPALIVE_LIMIT,
    });
  }catch(e){
    throw new ApiError(0, null);
  }finally{
    clearTimeout(timer);
  }
  let data = null;
  if(res.status !== 204){ try{ data = await res.json(); }catch(e){} }
  if(data && data.csrfToken) csrfToken = data.csrfToken;
  // A write refused for CSRF (a token we never had, or one rotated elsewhere):
  // fetch a fresh token and try once more.
  if(res.status === 403 && method !== 'GET' && !retried){
    await apiFetch('/api/auth/session');
    return apiFetch(path, { method, body, keepalive, timeout, retried: true });
  }
  if(!res.ok) throw new ApiError(res.status, data);
  return data;
}

// The first request after the free server has slept waits for it to wake,
// which can take most of a minute, so sign-in and the session check get
// longer timeouts than ordinary saves.
const WAKE_TIMEOUT = 90000;

function apiSession(){
  return apiFetch('/api/auth/session', { timeout: WAKE_TIMEOUT });
}

async function apiSignIn(email, password){
  if(!csrfToken) await apiSession();
  return apiFetch('/api/auth/login', { method: 'POST', body: { email, password }, timeout: WAKE_TIMEOUT });
}

function apiSignOut(){
  return apiFetch('/api/auth/logout', { method: 'POST' });
}

function apiChangePassword(currentPassword, newPassword){
  return apiFetch('/api/auth/password', { method: 'POST', body: { currentPassword, newPassword } });
}

// ---------- apiStore: the signed-in account ----------
// The same interface as localStore (storage.js). Each save sends the version
// of the copy it's based on; a newer copy saved from another device or tab
// comes back as a 409, which the save pipeline turns into a choice.

const scenarioVersions = new Map(); // scenario id → version we last read or wrote

function bootstrapToLoaded(b){
  scenarioVersions.clear();
  b.scenarios.forEach(s => scenarioVersions.set(s.id, s.version));
  if(b.activeScenario) scenarioVersions.set(b.activeScenario.id, b.activeScenario.version);
  return {
    scenarioIndex: b.scenarios.map(s => ({ id: s.id, name: s.name, updatedAt: s.updatedAt })),
    activeId: b.activeScenarioId,
    state: b.activeScenario ? b.activeScenario.data : seedState(),
    colorGroups: b.colorGroups.length ? b.colorGroups : defaultColorGroups(),
  };
}

// Keep the index entry in step with a scenario the server just returned.
function syncIndexEntry(s){
  const entry = scenarioIndex.find(e => e.id === s.id);
  if(entry){ entry.name = s.name; entry.updatedAt = s.updatedAt; }
}

const scenarioPath = id => '/api/scenarios/' + encodeURIComponent(id);

const apiStore = {
  async load(){
    let b = await apiFetch('/api/bootstrap');
    if(!b.scenarios.length) b = await setUpEmptyAccount(); // account.js: upload this browser's budgets, or start fresh
    return bootstrapToLoaded(b);
  },

  async loadScenario(id){
    const s = await apiFetch(scenarioPath(id));
    scenarioVersions.set(s.id, s.version);
    syncIndexEntry(s);
    return s.data;
  },

  async createScenario(name, data){
    const s = await apiFetch('/api/scenarios', { method: 'POST', body: { name, data } });
    scenarioVersions.set(s.id, s.version);
    const entry = { id: s.id, name: s.name, updatedAt: s.updatedAt };
    scenarioIndex.push(entry);
    return entry;
  },

  async saveScenario(id, data, opts = {}){
    const s = await apiFetch(scenarioPath(id), {
      method: 'PATCH', body: { version: scenarioVersions.get(id), data }, keepalive: opts.keepalive,
    });
    scenarioVersions.set(id, s.version);
    syncIndexEntry(s);
  },

  async renameScenario(id, name){
    const s = await apiFetch(scenarioPath(id), { method: 'PATCH', body: { version: scenarioVersions.get(id), name } });
    scenarioVersions.set(id, s.version);
    syncIndexEntry(s);
  },

  async deleteScenario(id){
    try{ await apiFetch(scenarioPath(id), { method: 'DELETE' }); }
    catch(e){ if(e.status !== 404) throw e; } // already gone is what we wanted
    scenarioVersions.delete(id);
    scenarioIndex = scenarioIndex.filter(s => s.id !== id);
  },

  setActive(id){
    return apiFetch('/api/prefs', { method: 'PATCH', body: { activeScenarioId: id } });
  },

  saveColorGroups(groups, opts = {}){
    return apiFetch('/api/prefs', {
      method: 'PATCH', body: { colorGroups: sanitizeColorGroups(groups) }, keepalive: opts.keepalive,
    });
  },
};
