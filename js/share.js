// ---------- Sharing a scenario by link ----------
// The whole scenario travels inside the URL, so there is still no backend and
// nothing to host. Two decisions shape the encoding:
//
//   * It goes in the fragment (#s=…), never a query string. Fragments are not
//     sent to the server, so household income and debt figures never reach a
//     request log — GitHub Pages' or anyone else's along the way.
//   * Layout and ids are stripped, and everything else is packed into
//     positional tuples. A 17-category budget is ~3.6kB as plain JSON+base64,
//     ~1.1kB as tuples, and ~520 characters once deflated — an ordinary-looking
//     link. Compression is an optimization, not a dependency: the tuple form
//     alone already fits well inside the ~2000-character limit that chat and
//     mail clients start truncating at, so the uncompressed path is a fine
//     fallback wherever CompressionStream is missing.
//
// What arrives is a snapshot, not a live document. The recipient gets their own
// copy; edits on either side never meet again. Without a backend there is no
// version of this that isn't a copy, so the UI says so plainly.

const SHARE_LOCATIONS = ['left', 'budget', 'right'];

// ---------- base64url ----------

function bytesToB64url(bytes){
  let bin = '';
  for(let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlToBytes(str){
  const padded = str.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(padded);
  const out = new Uint8Array(bin.length);
  for(let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// ---------- Optional deflate ----------

async function deflateBytes(bytes){
  if(typeof CompressionStream === 'undefined') return null;
  try{
    const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }catch(e){ return null; }
}

async function inflateBytes(bytes){
  if(typeof DecompressionStream === 'undefined') return null;
  try{
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }catch(e){ return null; }
}

// ---------- Payload shape ----------

// Card x/y and category ids are deliberately left out. Positions are per-window
// desktop layout that ensurePositions() regenerates anyway, and reusing ids
// across two people's storage invites collisions.
function scenarioToPayload(){
  const name = (scenarioIndex.find(s => s.id === activeId) || {}).name || 'Shared budget';

  // Only the color groups this scenario actually references need to travel.
  const usedKeys = [];
  state.categories.forEach(c => { if(usedKeys.indexOf(c.colorType) === -1) usedKeys.push(c.colorType); });
  const groups = usedKeys
    .map(key => colorGroups.find(g => g.key === key))
    .filter(Boolean)
    .map(g => [g.key, g.name, g.color]);
  const groupSlot = {};
  groups.forEach((g, i) => { groupSlot[g[0]] = i; });

  return {
    n: name,
    i: [state.income.amount, state.income.period === 'yearly' ? 1 : 0],
    c: state.currency || 'USD',
    z: [(state.zoneTitles && state.zoneTitles.left) || 'Available',
        (state.zoneTitles && state.zoneTitles.right) || 'Available'],
    g: groups,
    k: state.categories.map(c => [
      c.name,
      groupSlot[c.colorType] === undefined ? -1 : groupSlot[c.colorType],
      c.amountType === 'percent' ? 1 : 0,
      c.value,
      c.period === 'yearly' ? 1 : 0,
      Math.max(0, SHARE_LOCATIONS.indexOf(c.location)),
    ]),
  };
}

// Rebuilds a scenario from a payload. Everything is treated as untrusted: a
// link can be edited by hand or truncated in transit, and a malformed one
// should produce a sane budget rather than a broken app.
function payloadToScenario(p){
  if(!p || typeof p !== 'object') return null;
  const groups = Array.isArray(p.g)
    ? p.g.filter(g => Array.isArray(g) && g.length >= 3)
         .map(g => ({ key: String(g[0]), name: String(g[1]), color: String(g[2]) }))
    : [];

  const fallbackKey = colorGroups[0] ? colorGroups[0].key : 'expense';
  const categories = (Array.isArray(p.k) ? p.k : [])
    .filter(t => Array.isArray(t) && t.length >= 6)
    .map(t => {
      const group = groups[t[1]];
      const value = Number(t[3]);
      return {
        id: uid(),
        name: String(t[0] || 'Untitled').slice(0, 120),
        colorType: group ? group.key : fallbackKey,
        amountType: t[2] ? 'percent' : 'fixed',
        value: isFinite(value) && value >= 0 ? value : 0,
        period: t[4] ? 'yearly' : 'monthly',
        location: SHARE_LOCATIONS[t[5]] || 'budget',
      };
    });

  const income = Number(p.i && p.i[0]);
  return {
    name: String(p.n || 'Shared budget').slice(0, 80),
    groups,
    state: {
      income: {
        amount: isFinite(income) && income >= 0 ? income : 0,
        period: (p.i && p.i[1]) ? 'yearly' : 'monthly',
      },
      currency: ['USD', 'EUR', 'JPY'].indexOf(p.c) === -1 ? 'USD' : p.c,
      zoneTitles: {
        left: String((p.z && p.z[0]) || 'Available').slice(0, 40),
        right: String((p.z && p.z[1]) || 'Available').slice(0, 40),
      },
      categories,
    },
  };
}

// ---------- Encoding ----------
// Prefix marks the format: "1z" deflated, "1r" raw. Both are base64url.

async function encodeSharePayload(obj){
  const bytes = new TextEncoder().encode(JSON.stringify(obj));
  const deflated = await deflateBytes(bytes);
  return deflated && deflated.length < bytes.length
    ? '1z' + bytesToB64url(deflated)
    : '1r' + bytesToB64url(bytes);
}

async function decodeSharePayload(str){
  const flag = str.slice(0, 2);
  if(flag !== '1z' && flag !== '1r') return null;
  let bytes = b64urlToBytes(str.slice(2));
  if(flag === '1z'){
    bytes = await inflateBytes(bytes);
    if(!bytes) return null;
  }
  return JSON.parse(new TextDecoder().decode(bytes));
}

// ---------- Share sheet ----------

async function openShare(){
  mainMenuOpen = false;
  shareOpen = true;
  shareUrl = null;
  shareCopied = false;
  render(); // show the sheet immediately; the link fills in when it's ready

  try{
    const payload = await encodeSharePayload(scenarioToPayload());
    shareUrl = location.origin + location.pathname + '#s=' + payload;
  }catch(e){
    shareUrl = '';
  }
  if(shareOpen) render();
}

function closeShare(){
  shareOpen = false;
  shareUrl = null;
  shareCopied = false;
  render();
}

async function copyShareUrl(){
  const input = document.getElementById('share-url');
  if(!input) return;
  try{
    await navigator.clipboard.writeText(input.value);
  }catch(e){
    // Clipboard API needs a secure context and permission; selecting the text
    // at least leaves it one keystroke away.
    input.focus();
    input.select();
    try{ document.execCommand('copy'); }catch(e2){}
  }
  shareCopied = true;
  render();
}

// ---------- Import ----------

// Reads #s=… on load. The hash is cleared straight away so a refresh doesn't
// offer the same import a second time.
async function maybeImportFromHash(){
  const match = /(?:^|[#&])s=([^&]+)/.exec(location.hash || '');
  if(!match) return;
  history.replaceState(null, '', location.pathname + location.search);
  try{
    const payload = await decodeSharePayload(decodeURIComponent(match[1]));
    const scenario = payloadToScenario(payload);
    if(scenario && scenario.state.categories.length) pendingImport = scenario;
    else pendingImport = { broken: true };
  }catch(e){
    pendingImport = { broken: true };
  }
}

function uniqueScenarioName(name){
  if(!scenarioIndex.some(s => s.name === name)) return name;
  for(let n = 2; ; n++){
    const candidate = `${name} (${n})`;
    if(!scenarioIndex.some(s => s.name === candidate)) return candidate;
  }
}

async function acceptPendingImport(){
  const incoming = pendingImport;
  pendingImport = null;
  if(!incoming || incoming.broken){ render(); return; }

  // Color groups are shared across scenarios, so an import must not silently
  // repaint the recipient's existing ones: keep every group they already have
  // and only add keys they're missing.
  let addedGroup = false;
  incoming.groups.forEach(g => {
    if(!colorGroups.some(existing => existing.key === g.key)){
      colorGroups.push({ key: g.key, name: g.name, color: g.color });
      addedGroup = true;
    }
  });
  if(addedGroup) queueColorSave();

  const id = uid();
  const name = uniqueScenarioName(incoming.name);
  scenarioIndex.push({ id, name, updatedAt: Date.now() });
  activeId = id;
  state = incoming.state;
  editingId = null; editDraft = null; menuOpenId = null;
  expandedGroups = new Set();

  await safeSet(scenarioKey(id), JSON.stringify(state));
  await safeSet(INDEX_KEY, JSON.stringify(scenarioIndex));
  await safeSet(ACTIVE_KEY, id);
  render();
}

function dismissPendingImport(){
  pendingImport = null;
  render();
}

// ---------- Markup ----------

function renderShareSheet(){
  const ready = shareUrl !== null;
  const tooLong = ready && shareUrl.length > 2000;
  return `
    <div class="modal-backdrop" data-act="sharecancel"><div class="modal-box" data-act="noop">
      <div class="edit-form share-sheet">
        <div class="share-title">Share this budget</div>
        <div class="share-note">Anyone with this link gets their own copy of
          <strong>${escapeHtml((scenarioIndex.find(s => s.id === activeId) || {}).name || '')}</strong>.
          It's a snapshot — their changes won't come back to you, and yours won't reach them.</div>

        ${ready ? `
          <label>Link</label>
          <input type="text" id="share-url" readonly value="${escapeHtml(shareUrl)}" />
          <div class="share-meta">
            ${shareUrl.length} characters · the budget travels in the link itself, so it never reaches a server
            ${tooLong ? '<br><strong>This link is long enough that some chat and mail clients may truncate it.</strong>' : ''}
          </div>
          <div class="form-actions">
            <button class="btn-secondary" data-act="sharecancel">Close</button>
            <button class="btn-primary" data-act="sharecopy">${shareCopied ? '✓ Copied' : 'Copy link'}</button>
          </div>
        ` : `
          <div class="share-pending">Preparing link…</div>
          <div class="form-actions">
            <button class="btn-secondary" data-act="sharecancel">Close</button>
          </div>
        `}
      </div>
    </div></div>`;
}

function renderImportPrompt(){
  if(pendingImport.broken){
    return `
      <div class="modal-backdrop" data-act="importcancel"><div class="modal-box" data-act="noop">
        <div class="edit-form share-sheet">
          <div class="share-title">That link didn't work</div>
          <div class="share-note">The shared budget couldn't be read — the link was probably
            cut short somewhere along the way. Ask for it again, and paste the whole thing.</div>
          <div class="form-actions">
            <button class="btn-primary" data-act="importcancel">OK</button>
          </div>
        </div>
      </div></div>`;
  }

  const s = pendingImport.state;
  const monthly = s.income.period === 'monthly' ? s.income.amount : s.income.amount / 12;
  const budgeted = s.categories
    .filter(c => c.location === 'budget')
    .reduce((sum, c) => sum + (c.amountType === 'percent'
      ? monthly * (c.value / 100)
      : (c.period === 'yearly' ? c.value / 12 : c.value)), 0);
  // fmt() reads the active scenario's currency, so format against the incoming one.
  const symbol = { USD: '$', EUR: '€', JPY: '¥' }[s.currency] || '$';
  const money = n => symbol + Math.round(n).toLocaleString();

  return `
    <div class="modal-backdrop" data-act="importcancel"><div class="modal-box" data-act="noop">
      <div class="edit-form share-sheet">
        <div class="share-title">Someone shared a budget with you</div>
        <div class="import-summary">
          <div class="import-name">${escapeHtml(pendingImport.name)}</div>
          <div class="import-stats">
            ${s.categories.length} categories · ${money(monthly)}/mo income · ${money(budgeted)}/mo budgeted
          </div>
        </div>
        <div class="share-note">This adds a new scenario alongside your own. Nothing you already
          have is changed, and it stays a separate copy from here on.</div>
        <div class="form-actions">
          <button class="btn-secondary" data-act="importcancel">Not now</button>
          <button class="btn-primary" data-act="importconfirm">Add to my budgets</button>
        </div>
      </div>
    </div></div>`;
}
