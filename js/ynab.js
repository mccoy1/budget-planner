// ---------- YNAB: anchored income ----------
// The planner is unchanged except for one thing. An *anchored* scenario takes
// its income from YNAB instead of a typed number: income is the sum of
// `budgeted` (what was assigned that month) across the YNAB categories the
// scenario points at. Everything else — moving categories in and out of the
// budget, percentages, the breakdown — works exactly as before, off that number.
//
// Read-only. Nothing here ever writes to YNAB, so the worst a bug can do is
// show a wrong number; it can't damage the real budget.
//
// An anchor is the server's data, not part of the scenario's `state`, so it
// doesn't ride along in saves and can't collide with them. The typed income is
// left untouched underneath, and comes back if the anchor is removed.
//
// A scenario's month is pinned when it's anchored and never edited: a September
// scenario keeps reading September's assignments forever. A new month is a new
// scenario, which is what duplicating an anchored scenario does.

// A scenario that was pulled this recently isn't pulled again just for being
// opened. Switching back and forth shouldn't spend YNAB's hourly allowance.
const YNAB_REFRESH_MIN_GAP = 30000;

function ynabFetch(path, opts){
  return apiFetch('/api/ynab' + path, opts);
}

// ---------- Reading the current state ----------

function anchorFor(id){
  return ynabAnchors.get(id) || null;
}

function activeAnchor(){
  return anchorFor(activeId);
}

// Whether to offer YNAB at all: it needs an account (there's nowhere safe to
// keep a token otherwise) and a server with the encryption key set.
function ynabOffered(){
  return !!(account && ynab && ynab.configured);
}

function milliToAmount(milli){
  return (milli || 0) / 1000;
}

// ---------- Loading ----------

// Called once per account load, right after the budgets arrive. One request,
// no YNAB call: it reads this account's connection and anchors from our own
// database, so startup never waits on YNAB.
async function loadYnabState(){
  try{
    const body = await ynabFetch('/state');
    ynab = body.connection;
    ynabAnchors = new Map(Object.entries(body.anchors || {}));
  }catch(e){
    // A server that predates this feature has no such endpoint. That's a
    // definite answer — no anchors can exist there — so carry on without it.
    if(e.status === 404){ ynab = { configured: false, connected: false }; ynabAnchors = new Map(); return; }
    // Anything else leaves us unable to tell whether a scenario is anchored,
    // and showing its typed income instead would be a wrong number shown
    // silently. Let the caller treat the account as unreachable.
    throw e;
  }
}

function forgetYnab(){
  ynab = null;
  ynabAnchors = new Map();
  ynabSheet = null;
  ynabPicker = null;
  ynabPlans = [];
  ynabPick = new Set();
  ynabBusy = false;
}

// ---------- Refreshing ----------

// Opening an anchored scenario picks up changes made in YNAB since last time.
// Quiet: a failure leaves the last known amounts on screen and says so there,
// rather than interrupting with a message nobody asked for.
function maybeRefreshAnchor(id){
  const anchor = anchorFor(id);
  if(!anchor || !ynab || !ynab.connected) return;
  if(anchor.lastPulledAt && Date.now() - anchor.lastPulledAt < YNAB_REFRESH_MIN_GAP) return;
  refreshAnchorNow(id, { quiet: true });
}

async function refreshAnchorNow(id, opts = {}){
  if(ynabBusy || !anchorFor(id)) return;
  ynabBusy = true;
  render();
  try{
    const body = await ynabFetch(`/scenarios/${encodeURIComponent(id)}/refresh`, { method: 'POST' });
    ynabAnchors.set(id, body.anchor);
    ynabBusy = false;
    render();
  }catch(e){
    ynabBusy = false;
    // Keep the numbers that are on screen, and mark them as the last ones we
    // managed to read. The income itself never changes without a reason shown.
    const anchor = anchorFor(id);
    if(anchor) ynabAnchors.set(id, { ...anchor, staleError: ynabErrorMessage(e) });
    if(opts.quiet && !(e.body && e.body.reconnect) && e.status !== 401){ render(); return; }
    reportYnabError(e, 'refresh from YNAB');
  }
}

// ---------- Connecting ----------

async function connectYnab(token){
  const body = await ynabFetch('/connection', { method: 'PUT', body: { token }, timeout: WAKE_TIMEOUT });
  ynab = body.connection;
  ynabPlans = body.connection.plans || [];
  // With one plan there's nothing to ask; with several, which one comes next.
  if(!ynab.planId && ynabPlans.length > 1){ ynabSheet = 'plan'; render(); return; }
  ynabSheet = null;
  showNotice(`Connected to YNAB${ynab.planName ? ` (${ynab.planName})` : ''}. Anchor a scenario's income from the menu.`);
}

async function chooseYnabPlan(planId){
  const body = await ynabFetch('/connection', { method: 'PATCH', body: { planId } });
  ynab = body.connection;
  ynabSheet = null;
  showNotice(`Using your “${ynab.planName}” plan.`);
}

async function disconnectYnab(){
  mainMenuOpen = false;
  const anchored = ynabAnchors.size;
  if(!confirm(anchored
    ? `Disconnect YNAB? ${anchored === 1 ? 'One scenario is' : anchored + ' scenarios are'} anchored to it. `
      + 'They keep the income they last read, but can\'t be refreshed until you reconnect.'
    : 'Disconnect YNAB? Your token is deleted from the server.')) return;
  try{
    await ynabFetch('/connection', { method: 'DELETE' });
  }catch(e){ reportYnabError(e, 'disconnect YNAB'); return; }
  ynab = { ...ynab, connected: false, planId: null, planName: null, lastError: null };
  showNotice('Disconnected from YNAB.');
}

// ---------- Anchoring a scenario ----------

async function openYnabPicker(){
  mainMenuOpen = false;
  const existing = activeAnchor();
  ynabSheet = 'pick';
  ynabPicker = null; // the sheet shows "reading…" until the categories arrive
  ynabMonthDraft = existing ? existing.month.slice(0, 7) : currentMonthValue();
  ynabPick = new Set(existing ? existing.categories.map(c => c.id) : []);
  render();
  await loadPickerCategories();
}

async function loadPickerCategories(){
  const month = ynabMonthDraft;
  try{
    ynabPicker = await ynabFetch('/categories?month=' + encodeURIComponent(month));
  }catch(e){
    ynabPicker = { error: ynabErrorMessage(e), groups: [] };
    if(e.status === 401 || (e.body && e.body.reconnect)){ reportYnabError(e, 'read your YNAB categories'); return; }
  }
  if(ynabSheet === 'pick') render();
}

async function saveAnchor(){
  if(!ynabPick.size) return;
  const existing = activeAnchor();
  const id = activeId;
  // Take the month from the field itself: on a browser without a month picker
  // it's a plain text box, and saving the last valid draft instead of what's
  // on screen would pin the scenario to a month nobody chose.
  const field = document.getElementById('ynab-month');
  const month = field ? field.value.trim() : ynabMonthDraft;
  const errorEl = document.getElementById('ynab-error');
  if(!existing && !validMonthValue(month)){
    if(errorEl) errorEl.textContent = 'Enter the month as YYYY-MM, e.g. 2026-09.';
    return;
  }
  const button = document.getElementById('ynab-save');
  if(button){ button.disabled = true; button.textContent = 'Saving…'; }
  try{
    const body = await ynabFetch(`/scenarios/${encodeURIComponent(id)}/anchor`, {
      method: 'PUT',
      body: { month: existing ? undefined : month, categoryIds: [...ynabPick] },
    });
    ynabAnchors.set(id, body.anchor);
  }catch(e){
    ynabSheet = null;
    reportYnabError(e, existing ? 'change the categories' : 'anchor this scenario');
    return;
  }
  ynabSheet = null;
  ynabPicker = null;
  const anchor = anchorFor(id);
  showNotice(existing
    ? `Income now follows ${anchor.categories.length} YNAB ${anchor.categories.length === 1 ? 'category' : 'categories'}.`
    : `Income comes from YNAB for ${anchor.monthLabel}: ${fmt(milliToAmount(anchor.incomeMilli))}.`);
}

async function removeAnchor(){
  mainMenuOpen = false;
  const anchor = activeAnchor();
  if(!anchor) return;
  if(!confirm(`Stop taking this scenario's income from YNAB? It goes back to the typed income, ${fmt(state.income.amount)}/${state.income.period === 'monthly' ? 'mo' : 'yr'}.`)) return;
  const id = activeId;
  try{
    await ynabFetch(`/scenarios/${encodeURIComponent(id)}/anchor`, { method: 'DELETE' });
  }catch(e){
    if(e.status !== 404){ reportYnabError(e, 'remove the anchor'); return; }
  }
  ynabAnchors.delete(id);
  showNotice('This scenario uses its typed income again.');
}

// ---------- Duplicating an anchored scenario ----------
// Duplicating is how the next month gets started, so the month is deliberately
// not copied: two scenarios pinned to September is the opposite of what pinning
// is for. The categories carry over and the new month is pulled fresh.

function openYnabDuplicate(){
  const anchor = activeAnchor();
  if(!anchor) return;
  mainMenuOpen = false;
  ynabSheet = 'duplicate';
  ynabMonthDraft = nextMonthValue(anchor.month);
  render();
}

async function duplicateAnchored(name, monthValue){
  const anchor = activeAnchor();
  if(!anchor) return;
  const ids = anchor.categories.map(c => c.id);
  const data = JSON.parse(JSON.stringify(state));
  const sourceId = activeId;
  ynabSheet = null;
  await openNewScenario(name, data); // scenarios.js — also makes it the active one
  const id = activeId;
  if(id === sourceId) return; // creating it failed, and openNewScenario said why
  try{
    const body = await ynabFetch(`/scenarios/${encodeURIComponent(id)}/anchor`, {
      method: 'PUT', body: { month: monthValue, categoryIds: ids },
    });
    ynabAnchors.set(id, body.anchor);
  }catch(e){
    reportYnabError(e, 'anchor the new scenario — it was created with the income copied across');
    return;
  }
  const made = anchorFor(id);
  showNotice(`“${name}” reads YNAB for ${made.monthLabel}: ${fmt(milliToAmount(made.incomeMilli))}.`);
}

// ---------- Months ----------

function currentMonthValue(){
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

// "2026-09-01" → "2026-10", the month a duplicate most likely wants.
function nextMonthValue(monthIso){
  const [year, month] = monthIso.split('-').map(Number);
  return month === 12 ? `${year + 1}-01` : `${year}-${String(month + 1).padStart(2, '0')}`;
}

function validMonthValue(value){
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(String(value || '').trim());
}

function monthLabelFor(value){
  if(!validMonthValue(value)) return '';
  const [year, month] = value.split('-').map(Number);
  return new Date(year, month - 1, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
}

// "just now" / "12 minutes ago" / "3 hours ago" / "on 19 Sep"
function timeAgo(ms){
  if(!ms) return 'never';
  const seconds = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if(seconds < 45) return 'just now';
  const minutes = Math.round(seconds / 60);
  if(minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  const hours = Math.round(minutes / 60);
  if(hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  return 'on ' + new Date(ms).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

// ---------- Errors ----------

function ynabErrorMessage(e){
  if(!e || e.status === 0) return 'YNAB couldn’t be reached.';
  if(e.status === 429) return e.message; // the server's wording already explains the limit
  return e.message;
}

function reportYnabError(e, action){
  if(e && e.status === 401){ onSessionLost(); return; } // our session, not YNAB's
  if(e && e.body && e.body.reconnect){
    ynab = { ...(ynab || {}), lastError: e.message };
    ynabSheet = 'connect';
    showNotice('YNAB refused the saved token. Paste a new one to carry on.');
    return;
  }
  showNotice(`Couldn't ${action}. ${ynabErrorMessage(e)}`);
}

// ---------- Rendering: the income hero ----------

// Replaces the typed-income block on an anchored scenario. Tapping the amount
// opens the picker rather than an edit field: the number isn't ours to type.
function renderAnchoredIncome(anchor, compact){
  const amount = fmt(milliToAmount(anchor.incomeMilli));
  const count = anchor.categories.length;
  const missing = anchor.categories.filter(c => c.missing);
  const lines = [];
  // The line below already says when these amounts were read, so the note only
  // has to explain why they haven't changed since.
  if(anchor.staleError) lines.push(`Couldn’t refresh — ${escapeHtml(anchor.staleError)}`);
  if(missing.length){
    // Rare, but it must never look like the income changed on its own.
    lines.push(missing.length === 1
      ? `${escapeHtml(missing[0].name)} is no longer in YNAB; still counting its last assigned ${escapeHtml(fmt(milliToAmount(missing[0].budgetedMilli)))}.`
      : `${missing.length} categories are no longer in YNAB; still counting their last assigned amounts.`);
  }
  if(ynab && !ynab.connected){
    lines.push('YNAB is disconnected, so this can’t be refreshed. Reconnect from the menu.');
  }
  const notes = lines.map(line => `<div class="ynab-note">${line}</div>`).join('');
  const refresh = `<button class="ynab-refresh" data-act="ynabrefresh" ${ynabBusy ? 'disabled' : ''} data-tip="Read this month's assigned amounts from YNAB again">${ynabBusy ? '↻ Refreshing…' : '↻ Refresh'}</button>`;

  return `
    <div class="ynab-income ${compact ? 'ynab-income-compact' : ''}">
      <button class="${compact ? 'm-income-amt-btn' : 'income-amount'} ynab-amount" data-act="ynabpick" data-tip="Change which YNAB categories feed this income">
        ${amount}<span class="ynab-per">/mo</span>
      </button>
      <div class="ynab-meta">
        <span class="ynab-tag">YNAB · ${escapeHtml(anchor.monthLabel)}</span>
        <span class="ynab-sub">${count} ${count === 1 ? 'category' : 'categories'} · read ${escapeHtml(timeAgo(anchor.lastPulledAt))}</span>
        ${refresh}
      </div>
      ${notes}
    </div>`;
}

// ---------- Rendering: the menu section ----------

function renderYnabMenuSection(){
  if(!API_BASE) return '';
  // Signed out: still show it, so the feature is discoverable, with the reason.
  if(!account){
    return `
      <div class="menu-section">
        <div class="menu-section-title">YNAB</div>
        <button class="bar-btn m-wide" disabled>Anchor income to YNAB</button>
        <div class="m-menu-hint">Sign in to take a scenario's income from YNAB. Guest budgets stay in this browser, and there's nowhere safe here to keep a YNAB token.</div>
      </div>
      <div class="menu-divider"></div>`;
  }
  if(!ynab) return '';
  if(!ynab.configured){
    return `
      <div class="menu-section">
        <div class="menu-section-title">YNAB</div>
        <button class="bar-btn m-wide" disabled>Anchor income to YNAB</button>
        <div class="m-menu-hint">${escapeHtml(ynab.keyProblem || "This server can't store a YNAB token safely. See backend/README.md.")}</div>
      </div>
      <div class="menu-divider"></div>`;
  }
  if(!ynab.connected){
    return `
      <div class="menu-section">
        <div class="menu-section-title">YNAB</div>
        <button class="bar-btn m-wide" data-act="ynabconnect">Connect YNAB</button>
        <div class="m-menu-hint">Take a scenario's income from the amounts you've assigned in YNAB, instead of typing it.</div>
      </div>
      <div class="menu-divider"></div>`;
  }

  const anchor = activeAnchor();
  const body = anchor ? `
      <div class="ynab-menu-state">Income from YNAB · <strong>${escapeHtml(anchor.monthLabel)}</strong></div>
      <div class="menu-btn-row">
        <button class="bar-btn" data-act="ynabpick">Change categories</button>
        <button class="bar-btn" data-act="ynabrefresh">↻ Refresh</button>
      </div>
      <button class="bar-btn m-wide" data-act="ynabunanchor">Use typed income again</button>
      <div class="m-menu-hint">This scenario is pinned to ${escapeHtml(anchor.monthLabel)}. Duplicate it to plan another month.</div>` : `
      <button class="bar-btn m-wide" data-act="ynabpick">Anchor this scenario's income…</button>
      <div class="m-menu-hint">Pick a month and the YNAB categories whose assigned amounts add up to this scenario's income.</div>`;

  return `
      <div class="menu-section">
        <div class="menu-section-title">YNAB</div>
        ${body}
        <div class="ynab-menu-foot">
          <span>${escapeHtml(ynab.planName || 'Connected')}</span>
          <button class="link-btn" data-act="ynabdisconnect">Disconnect</button>
        </div>
      </div>
      <div class="menu-divider"></div>`;
}

// ---------- Rendering: the sheets ----------

function renderYnabSheet(){
  if(ynabSheet === 'connect') return renderYnabConnectSheet();
  if(ynabSheet === 'plan') return renderYnabPlanSheet();
  if(ynabSheet === 'pick') return renderYnabPickSheet();
  if(ynabSheet === 'duplicate') return renderYnabDuplicateSheet();
  return '';
}

function renderYnabConnectSheet(){
  return accountModal(`
    <form id="ynab-form" class="edit-form account-form" data-form="connect" novalidate>
      <div class="sheet-title">Connect YNAB</div>
      <div class="sheet-note">
        In YNAB, open <strong>Account Settings → Developer Settings</strong> and create a
        <strong>personal access token</strong>, then paste it here.
        It is stored on your own server, encrypted, and never sent back to this page.
        This app only ever reads from YNAB.
      </div>
      <label for="ynab-token">Personal access token</label>
      <input type="password" id="ynab-token" autocomplete="off" spellcheck="false" />
      ${ynab && ynab.lastError ? `<div class="sheet-note ynab-last-error">Last error from YNAB: ${escapeHtml(ynab.lastError)}</div>` : ''}
      <div class="sheet-error" id="ynab-error" role="alert"></div>
      <div class="form-actions">
        <button type="button" class="btn-secondary" data-act="ynabclose">Cancel</button>
        <button type="submit" class="btn-primary" id="ynab-submit">Connect</button>
      </div>
    </form>`);
}

function renderYnabPlanSheet(){
  const rows = ynabPlans.map(plan => `
    <button class="copy-row" data-act="ynabplan" data-id="${escapeHtml(plan.id)}">
      <span class="copy-name">${escapeHtml(plan.name)}</span>
    </button>`).join('');
  return accountModal(`
    <div class="edit-form account-form">
      <div class="sheet-title">Which YNAB plan?</div>
      <div class="sheet-note">Your token can see more than one. Pick the one this planner should read.</div>
      <div class="copy-list">${rows}</div>
      <div class="sheet-error" id="ynab-error" role="alert"></div>
      <div class="form-actions">
        <button class="btn-secondary" data-act="ynabclose">Cancel</button>
      </div>
    </div>`);
}

function renderYnabPickSheet(){
  const existing = activeAnchor();
  const monthField = existing
    ? `<div class="sheet-note">Pinned to <strong>${escapeHtml(existing.monthLabel)}</strong>. A scenario keeps its month for good — duplicate it to plan another one.</div>`
    : `
      <label for="ynab-month">Month</label>
      <input type="month" id="ynab-month" data-act="ynabmonth" value="${escapeHtml(ynabMonthDraft)}" />
      <div class="sheet-note">This scenario stays pinned to that month, so it always shows what you actually assigned then.</div>`;

  let listHtml;
  const amounts = new Map((existing ? existing.categories : []).map(c => [c.id, c.budgetedMilli]));
  if(!ynabPicker){
    listHtml = '<div class="sheet-note">Reading your YNAB categories…</div>';
  }else if(ynabPicker.error){
    listHtml = `<div class="sheet-error">${escapeHtml(ynabPicker.error)} <button class="link-btn" data-act="ynabpickretry">Try again</button></div>`;
  }else if(!ynabPicker.groups.length){
    listHtml = `<div class="sheet-note">That month has no categories with anything assigned.</div>`;
  }else{
    listHtml = ynabPicker.groups.map(group => `
      <div class="ynab-group">
        <div class="ynab-group-name">${escapeHtml(group.name)}</div>
        ${group.categories.map(category => {
          const picked = ynabPick.has(category.id);
          amounts.set(category.id, category.budgetedMilli);
          return `
          <div class="copy-row ynab-cat" role="checkbox" tabindex="0" aria-checked="${picked}" data-act="ynabtoggle" data-id="${escapeHtml(category.id)}">
            <input type="checkbox" tabindex="-1" ${picked ? 'checked' : ''} />
            <span>
              <span class="copy-name">${escapeHtml(category.name)}</span>
              <span class="copy-meta">${escapeHtml(fmt(milliToAmount(category.budgetedMilli)))} assigned</span>
            </span>
          </div>`;
        }).join('')}
      </div>`).join('');
  }

  const total = [...ynabPick].reduce((sum, id) => sum + (amounts.get(id) || 0), 0);
  const picked = ynabPick.size;
  return accountModal(`
    <div class="edit-form account-form ynab-pick">
      <div class="sheet-title">${existing ? 'Which YNAB categories?' : 'Anchor income to YNAB'}</div>
      ${monthField}
      <div class="copy-list ynab-list">${listHtml}</div>
      <div class="ynab-total">
        <span>${picked} ${picked === 1 ? 'category' : 'categories'}</span>
        <strong>${escapeHtml(fmt(milliToAmount(total)))}/mo</strong>
      </div>
      <div class="sheet-error" id="ynab-error" role="alert"></div>
      <div class="form-actions">
        <button class="btn-secondary" data-act="ynabclose">Cancel</button>
        <button class="btn-primary" id="ynab-save" data-act="ynabsave" ${picked ? '' : 'disabled'}>${existing ? 'Save categories' : 'Use as income'}</button>
      </div>
    </div>`);
}

function renderYnabDuplicateSheet(){
  const anchor = activeAnchor();
  if(!anchor) return '';
  const current = scenarioIndex.find(s => s.id === activeId);
  const suggested = monthLabelFor(ynabMonthDraft) || 'Next month';
  return accountModal(`
    <form id="ynab-form" class="edit-form account-form" data-form="duplicate" novalidate>
      <div class="sheet-title">Duplicate for another month</div>
      <div class="sheet-note">
        <strong>${escapeHtml(current ? current.name : 'This scenario')}</strong> is pinned to
        ${escapeHtml(anchor.monthLabel)}. The copy keeps the same
        ${anchor.categories.length === 1 ? 'category' : `${anchor.categories.length} categories`} and reads the month you pick here.
      </div>
      <label for="ynab-dup-name">Name</label>
      <input type="text" id="ynab-dup-name" value="${escapeHtml(suggested)}" maxlength="100" />
      <label for="ynab-month">Month</label>
      <input type="month" id="ynab-month" value="${escapeHtml(ynabMonthDraft)}" />
      <div class="sheet-error" id="ynab-error" role="alert"></div>
      <div class="form-actions">
        <button type="button" class="btn-secondary" data-act="ynabclose">Cancel</button>
        <button type="submit" class="btn-primary" id="ynab-submit">Duplicate</button>
      </div>
    </form>`);
}

// ---------- Handlers ----------

// Called from attachHandlers() after every render.
function attachYnabHandlers(){
  // The picker's rows are custom checkboxes/radios, so they need the keys a
  // real one would handle.
  document.querySelectorAll('.copy-row[data-act="ynabtoggle"]').forEach(row => {
    row.addEventListener('keydown', e => {
      if(e.key !== ' ' && e.key !== 'Enter') return;
      e.preventDefault();
      row.click();
    });
  });

  // Changing the month reloads that month's assigned amounts.
  const month = document.querySelector('[data-act="ynabmonth"]');
  if(month){
    month.addEventListener('change', e => {
      if(!validMonthValue(e.target.value)) return;
      ynabMonthDraft = e.target.value;
      ynabPicker = null;
      render();
      loadPickerCategories();
    });
  }

  const form = document.getElementById('ynab-form');
  if(!form) return;
  form.addEventListener('submit', e => { e.preventDefault(); submitYnabForm(form.dataset.form); });
  // Enter submits from any field, for the same reason the account forms do it
  // this way: implicit submission isn't reliable across keyboards.
  form.addEventListener('keydown', e => {
    if(e.key !== 'Enter' || e.isComposing || e.target.tagName !== 'INPUT') return;
    e.preventDefault();
    const button = document.getElementById('ynab-submit');
    if(button && !button.disabled) submitYnabForm(form.dataset.form);
  });
  const first = form.querySelector('input:not([hidden])');
  if(first) first.focus();
}

async function submitYnabForm(kind){
  const value = id => { const el = document.getElementById(id); return el ? el.value : ''; };
  const button = document.getElementById('ynab-submit');
  const errorEl = document.getElementById('ynab-error');
  const idleLabel = button.textContent;
  errorEl.textContent = '';
  button.disabled = true;
  button.textContent = kind === 'connect' ? 'Connecting…' : 'Duplicating…';
  try{
    if(kind === 'connect'){
      const token = value('ynab-token').trim();
      if(!token) throw new ApiError(400, { error: 'Paste your YNAB personal access token.' });
      await connectYnab(token);
    }else{
      const month = value('ynab-month');
      if(!validMonthValue(month)) throw new ApiError(400, { error: 'Pick the month this copy should read, as YYYY-MM.' });
      const name = cleanScenarioName(value('ynab-dup-name')) || monthLabelFor(month);
      await duplicateAnchored(name, month);
    }
    render();
  }catch(e){
    if(e.status === 401 && !(e.body && e.body.reconnect)){ onSessionLost(); return; }
    // The sheet may have been redrawn meanwhile; look everything up again.
    const el = document.getElementById('ynab-error');
    if(el) el.textContent = ynabErrorMessage(e);
    const btn = document.getElementById('ynab-submit');
    if(btn){ btn.disabled = false; btn.textContent = idleLabel; }
  }
}

// Clicks with a YNAB data-act. Returns true when it handled one.
function handleYnabAction(a, act){
  switch(a){
    case 'ynabconnect': mainMenuOpen = false; ynabSheet = 'connect'; render(); return true;
    case 'ynabclose': ynabSheet = null; ynabPicker = null; render(); return true;
    case 'ynabdisconnect': disconnectYnab(); return true;
    case 'ynabpick': openYnabPicker(); return true;
    case 'ynabpickretry': ynabPicker = null; render(); loadPickerCategories(); return true;
    case 'ynabsave': saveAnchor(); return true;
    case 'ynabunanchor': removeAnchor(); return true;
    case 'ynabrefresh': mainMenuOpen = false; refreshAnchorNow(activeId); return true;
    case 'ynabplan': chooseYnabPlan(act.dataset.id).catch(e => reportYnabError(e, 'choose that plan')); return true;
    case 'ynabtoggle': {
      const id = act.dataset.id;
      if(ynabPick.has(id)) ynabPick.delete(id); else ynabPick.add(id);
      render();
      return true;
    }
  }
  return false;
}
