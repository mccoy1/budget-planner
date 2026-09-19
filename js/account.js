// ---------- Accounts: sign in/out, startup, save status ----------
// Guests keep using this browser's storage (localStore) exactly as before.
// Signing in switches `store` to apiStore (api.js), and the first sign-in to
// an empty account offers to upload this browser's budgets.
//
// On load, the account is tried only if this device signed in last time
// (SIGNED_IN_KEY), so guests never wait on a server that may be asleep. If
// the account can't be reached, the app says so and lets you retry or carry
// on with this browser's budgets. It never drops into guest mode silently,
// where edits would land somewhere other than you think.

let signinNote = null; // explanation at the top of the sign-in sheet, when there is one

// ---------- Full-page screens (before there's a budget to draw) ----------

// Resolves with the `value` of the button pressed. `body` is trusted HTML.
function showBootScreen({ title, body = '', actions = [] }){
  if(isMobileView()) document.body.classList.add('mobile-mode');
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="boot-card" role="status">
      <div class="boot-title">${escapeHtml(title)}</div>
      ${body ? `<div class="boot-body">${body}</div>` : ''}
      ${actions.length ? `<div class="form-actions boot-actions">${actions.map(a =>
        `<button class="${a.primary ? 'btn-primary' : 'btn-secondary'}" data-boot="${a.value}">${escapeHtml(a.label)}</button>`
      ).join('')}</div>` : ''}
    </div>`;
  return new Promise(resolve => {
    app.querySelectorAll('[data-boot]').forEach(b =>
      b.addEventListener('click', ()=> resolve(b.dataset.boot), { once: true }));
  });
}

function showConnecting(slow){
  showBootScreen({
    title: 'Connecting to your account…',
    body: slow ? 'The server sleeps when nobody has used it for a while. Waking it can take up to a minute.' : '',
  });
}

// This device was signed in last time. Returns true once the account is
// loaded, false to carry on as a guest (with a notice or the sign-in sheet
// saying why).
async function bootIntoAccount(){
  for(;;){
    showConnecting(false);
    // Only the session check waits on a sleeping server. The timer must stop
    // when it answers: enterAccount may show the empty-account question,
    // which this screen would otherwise replace while it waits for a click.
    const slow = setTimeout(()=> showConnecting(true), 3000);
    let session = null;
    let failure = null;
    try{ session = await apiSession(); }
    catch(e){ failure = e; }
    finally{ clearTimeout(slow); }
    if(!failure && session.user){
      try{ await enterAccount(session.user); }
      catch(e){ failure = e; }
    }
    if(!failure){
      if(session.user) return true;
      lsDelete(SIGNED_IN_KEY);
      accountSheet = 'signin';
      signinNote = 'Your session has ended. Sign in again, or close this to use the budgets saved in this browser.';
      return false;
    }
    const choice = await showBootScreen({
      title: "Couldn't reach your account",
      body: failure.status === 0
        ? "The server didn't answer. It may still be waking up, or you may be offline."
        : `The server answered with an error: ${escapeHtml(failure.message)}`,
      actions: [
        { value: 'retry', label: 'Try again', primary: true },
        { value: 'guest', label: "Use this browser's budgets" },
      ],
    });
    if(choice === 'guest'){
      notice = "Showing the budgets saved in this browser, not your account's. Reload to try your account again.";
      return false;
    }
  }
}

// Switch to the account's budgets. On failure, puts this browser's back and throws.
async function enterAccount(user){
  await flushSaves(); // a guest's last edits land in this browser first
  account = user;
  sessionLost = false;
  store = apiStore;
  try{
    await loadInitial();
  }catch(e){
    account = null;
    store = localStore;
    await loadInitial();
    throw e;
  }
  lsSet(SIGNED_IN_KEY, user.email);
  editingId = null; editDraft = null; menuOpenId = null; inlineEditId = null;
  setSaveStatus('saved');
}

// An account with no budgets yet: offer this browser's, else start from the
// example. Returns the account's bootstrap once it has something in it.
async function setUpEmptyAccount(){
  const local = await exportLocalBudgets();
  if(local.scenarios.length){
    const n = local.scenarios.length;
    const names = local.scenarios.map(s => `<strong>${escapeHtml(s.name)}</strong>`).join(', ');
    const choice = await showBootScreen({
      title: 'Your account has no budgets yet',
      body: `This browser has ${n === 1 ? 'one budget' : n + ' budgets'}: ${names}. ` +
            `Upload ${n === 1 ? 'it' : 'them'} to your account? ${n === 1 ? 'It stays' : 'They stay'} in this browser too.`,
      actions: [
        { value: 'upload', label: n === 1 ? 'Upload it' : `Upload all ${n}`, primary: true },
        { value: 'fresh', label: 'Start with an example' },
      ],
    });
    if(choice === 'upload') return importIntoAccount(local);
  }
  return importIntoAccount({
    scenarios: [{ name: 'Example Budget', data: seedState() }],
    colorGroups: defaultColorGroups(),
    activeIndex: 0,
  });
}

async function importIntoAccount(payload){
  showBootScreen({ title: 'Setting up your account…' });
  try{
    return await apiFetch('/api/import', { method: 'POST', body: payload });
  }catch(e){
    // Something else filled the account in the meantime; use what's there.
    if(e.status === 409) return apiFetch('/api/bootstrap');
    throw e;
  }
}

// ---------- Signing in and out ----------

async function signIn(email, password){
  const res = await apiSignIn(email.trim(), password);
  const user = res.user;
  const renewing = sessionLost && account && account.email === user.email;
  accountSheet = null;
  signinNote = null;
  if(renewing){
    // Same account, fresh session: keep everything on screen and retry the
    // saves that failed while signed out.
    sessionLost = false;
    render();
    await flushSaves();
    return;
  }
  if(sessionLost){
    // A different account than the one whose session ended. Its unsaved
    // edits have nowhere to go now.
    pendingSaves.clear();
    colorsDirty = false;
  }
  try{
    await enterAccount(user);
  }catch(e){
    accountSheet = 'signin';
    render();
    throw e;
  }
  render();
}

async function signOut(){
  mainMenuOpen = false;
  await flushSaves();
  if((pendingSaves.size || colorsDirty || saveStatus === 'error') &&
     !confirm("Some changes haven't reached your account yet. Sign out anyway? They'll be lost.")){
    render();
    return;
  }
  try{ await apiSignOut(); }catch(e){} // ending the session here is what matters
  await leaveAccount('Signed out. These are the budgets saved in this browser.');
}

async function leaveAccount(message){
  account = null;
  sessionLost = false;
  lsDelete(SIGNED_IN_KEY);
  store = localStore;
  scenarioVersions.clear();
  pendingSaves.clear();
  colorsDirty = false;
  conflict = null;
  accountSheet = null;
  editingId = null; editDraft = null; menuOpenId = null; inlineEditId = null;
  await loadInitial();
  showNotice(message);
}

async function changePassword(current, next, confirmNext){
  if(next !== confirmNext) throw new ApiError(400, { error: "The new passwords don't match." });
  await apiChangePassword(current, next);
  accountSheet = null;
  showNotice('Password changed.');
}

// ---------- Save outcomes (called from the save pipeline in scenarios.js) ----------

function setSaveStatus(status){
  saveStatus = status;
  // In place, not via render(): a save finishing mustn't rebuild the page
  // under someone who is typing.
  document.querySelectorAll('.sync-badge').forEach(el => { el.outerHTML = renderSyncBadge(); });
}

function onSaveFailed(e){
  if(e.status === 401){ onSessionLost(); return; }
  if(e.status === 404){
    resyncFromServer('A scenario you were editing was deleted somewhere else, so your budgets have been reloaded.');
    return;
  }
  setSaveStatus('error');
}

// Saves are refused because the session ended (expired, or signed out on
// another device). Keep what's on screen, ask to sign in, and retry after.
function onSessionLost(){
  if(!account) return;
  sessionLost = true;
  setSaveStatus('error');
  if(accountSheet !== 'signin'){
    accountSheet = 'signin';
    signinNote = 'Your session has ended. Sign in again to keep saving; your latest changes are still on this screen.';
    render();
  }
}

// A save found a newer copy saved from another device or tab.
function showConflict(id, mine, theirs){
  if(!theirs){
    resyncFromServer('A scenario changed somewhere else, so your budgets have been reloaded.');
    return;
  }
  conflict = { id, mine, theirs };
  accountSheet = 'conflict';
  setSaveStatus('error');
  render();
}

function resolveConflict(keepMine){
  if(!conflict) return;
  const { id, mine, theirs } = conflict;
  conflict = null;
  accountSheet = null;
  scenarioVersions.set(id, theirs.version); // either way, we've now seen their copy
  if(keepMine){
    pendingSaves.set(id, mine);
    flushSaves();
  }else{
    syncIndexEntry(theirs);
    if(id === activeId) state = theirs.data;
    pendingSaves.delete(id);
    if(!pendingSaves.size && !colorsDirty) setSaveStatus('saved');
  }
  render();
}

// Something failed in a way that leaves this copy out of step: reload it all.
async function resyncFromServer(message){
  try{ await loadInitial(); }
  catch(e){ reportStoreError(e, 'reload your budgets'); return; }
  editingId = null; editDraft = null; menuOpenId = null; inlineEditId = null;
  setSaveStatus('saved');
  showNotice(message);
}

// A scenario operation (switch, create, rename, delete) failed.
function reportStoreError(e, action){
  if(e && e.status === 401){ onSessionLost(); return; }
  if(e && (e.status === 404 || e.status === 409)){
    resyncFromServer('That scenario changed somewhere else, so your budgets have been reloaded. Try again if you still need to.');
    return;
  }
  const why = !e || e.status === 0 ? 'The server couldn’t be reached; check your connection and try again.' : e.message;
  showNotice(`Couldn't ${action}. ${why}`);
}

function showNotice(message){
  notice = message;
  render();
}

// ---------- Rendering ----------

function renderNotice(){
  if(!notice) return '';
  return `
    <div class="notice" role="status">
      <span>${escapeHtml(notice)}</span>
      <button class="icon-btn" data-act="noticeclose" aria-label="Dismiss">✕</button>
    </div>`;
}

// Where edits are going: "This browser", or the account's save state.
function renderSyncBadge(){
  if(!account){
    if(!API_BASE) return '';
    return `<button class="sync-badge guest" data-act="signin" data-tip="Budgets are saved in this browser only. Sign in to keep them in your account.">This browser</button>`;
  }
  if(sessionLost) return `<button class="sync-badge err" data-act="signin">Signed out · Sign in</button>`;
  if(saveStatus === 'error') return `<button class="sync-badge err" data-act="retrysave" data-tip="Your latest changes haven't reached your account">Not saved · Retry</button>`;
  if(saveStatus === 'saving') return `<span class="sync-badge busy">Saving…</span>`;
  return `<span class="sync-badge ok" data-tip="Saved to ${escapeHtml(account.email)}">✓ Saved</span>`;
}

// The Account section at the top of the menu, in both views.
function renderAccountMenuSection(){
  if(!API_BASE && !account) return '';
  const body = account ? `
      <div class="account-email">${escapeHtml(account.email)}</div>
      <div class="menu-btn-row">
        <button class="bar-btn" data-act="changepassword">Change password</button>
        <button class="bar-btn" data-act="signout">Sign out</button>
      </div>
      <div class="m-menu-hint">Your budgets are saved to your account.</div>` : `
      <button class="bar-btn m-wide" data-act="signin">Sign in</button>
      <div class="m-menu-hint">Budgets are saved in this browser only. Sign in to keep them in your account and see them on other devices.</div>`;
  return `
      <div class="menu-section">
        <div class="menu-section-title">Account</div>
        ${body}
      </div>
      <div class="menu-divider"></div>`;
}

function accountModal(inner, dismissable = true){
  return `<div class="modal-backdrop" data-act="${dismissable ? 'accountclose' : 'noop'}"><div class="modal-box" data-act="noop">${inner}</div></div>`;
}

// The account dialogs; renderModal() shows these ahead of anything else.
function renderAccountSheet(){
  if(accountSheet === 'signin'){
    const email = account ? account.email : '';
    return accountModal(`
      <form id="account-form" class="edit-form account-form" data-form="signin" novalidate>
        <div class="sheet-title">${sessionLost ? 'Sign in again' : 'Sign in'}</div>
        <div class="sheet-note">${escapeHtml(signinNote || 'Keep your budgets in your account, and see them on any device. Accounts are by invitation.')}</div>
        <label for="acct-email">Email</label>
        <input type="email" id="acct-email" autocomplete="username" value="${escapeHtml(email)}" />
        <label for="acct-password">Password</label>
        <input type="password" id="acct-password" autocomplete="current-password" />
        <div class="sheet-error" id="acct-error" role="alert"></div>
        <div class="form-actions">
          <button type="button" class="btn-secondary" data-act="accountclose">${sessionLost ? 'Not now' : 'Cancel'}</button>
          <button type="submit" class="btn-primary" id="acct-submit">Sign in</button>
        </div>
      </form>`);
  }
  if(accountSheet === 'password'){
    return accountModal(`
      <form id="account-form" class="edit-form account-form" data-form="password" novalidate>
        <div class="sheet-title">Change password</div>
        <input type="email" autocomplete="username" value="${escapeHtml(account ? account.email : '')}" hidden />
        <label for="acct-current">Current password</label>
        <input type="password" id="acct-current" autocomplete="current-password" />
        <label for="acct-new">New password</label>
        <input type="password" id="acct-new" autocomplete="new-password" />
        <label for="acct-confirm">New password again</label>
        <input type="password" id="acct-confirm" autocomplete="new-password" />
        <div class="sheet-note">At least 10 characters, and not a common password.</div>
        <div class="sheet-error" id="acct-error" role="alert"></div>
        <div class="form-actions">
          <button type="button" class="btn-secondary" data-act="accountclose">Cancel</button>
          <button type="submit" class="btn-primary" id="acct-submit">Change password</button>
        </div>
      </form>`);
  }
  if(accountSheet === 'conflict' && conflict){
    const name = (scenarioIndex.find(s => s.id === conflict.id) || conflict.theirs).name;
    return accountModal(`
      <div class="edit-form account-form">
        <div class="sheet-title">Changed somewhere else</div>
        <div class="sheet-note"><strong>${escapeHtml(name)}</strong> was saved from another device or tab since you opened it here, so your latest change wasn't saved.</div>
        <div class="form-actions stacked">
          <button class="btn-primary" data-act="conflictmine">Keep my version</button>
          <button class="btn-secondary" data-act="conflicttheirs">Use the other version</button>
        </div>
        <div class="sheet-note">Keeping yours replaces the other version.</div>
      </div>`, false);
  }
  return '';
}

// Called from attachHandlers() after every render.
function attachAccountHandlers(){
  const form = document.getElementById('account-form');
  if(!form) return;
  form.addEventListener('submit', e => { e.preventDefault(); submitAccountForm(form.dataset.form); });
  // Enter submits from any field. Handled on keydown, like the app's other
  // inputs, rather than relying on implicit submission, which some browsers
  // and on-screen keyboards only perform on a later keypress event.
  // preventDefault keeps a real keyboard from submitting twice.
  form.addEventListener('keydown', e => {
    if(e.key !== 'Enter' || e.isComposing || e.target.tagName !== 'INPUT') return;
    e.preventDefault();
    const button = document.getElementById('acct-submit');
    if(button && !button.disabled) submitAccountForm(form.dataset.form);
  });
  const inputs = [...form.querySelectorAll('input:not([hidden])')];
  const first = inputs.find(i => !i.value) || inputs[0];
  if(first) first.focus();
}

function accountErrorMessage(e, kind){
  if(e.status === 0) return "Couldn't reach the server. Check your connection and try again.";
  if(kind === 'signin' && e.status === 401) return 'Email or password is incorrect.';
  return e.message;
}

async function submitAccountForm(kind){
  const val = id => { const el = document.getElementById(id); return el ? el.value : ''; };
  const button = document.getElementById('acct-submit');
  const errorEl = document.getElementById('acct-error');
  const idleLabel = button.textContent;
  button.disabled = true;
  button.textContent = kind === 'signin' ? 'Signing in…' : 'Saving…';
  errorEl.textContent = '';
  const slow = setTimeout(()=>{
    const el = document.getElementById('acct-error');
    if(el){ el.classList.add('info'); el.textContent = 'Still working. The server can take up to a minute to wake up.'; }
  }, 4000);
  try{
    if(kind === 'signin'){
      if(!val('acct-email').trim() || !val('acct-password')) throw new ApiError(400, { error: 'Enter your email and password.' });
      await signIn(val('acct-email'), val('acct-password'));
    }else{
      await changePassword(val('acct-current'), val('acct-new'), val('acct-confirm'));
    }
  }catch(e){
    // The form may have been redrawn meanwhile; look everything up again.
    const el = document.getElementById('acct-error');
    if(el){ el.classList.remove('info'); el.textContent = accountErrorMessage(e, kind); }
    const btn = document.getElementById('acct-submit');
    if(btn){ btn.disabled = false; btn.textContent = idleLabel; }
    const pw = document.querySelector('#account-form input[type=password]');
    if(pw && kind === 'signin'){ pw.value = ''; pw.focus(); }
  }finally{
    clearTimeout(slow);
  }
}

// Clicks with an account data-act. Returns true when it handled one.
function handleAccountAction(a){
  switch(a){
    case 'signin': mainMenuOpen = false; accountSheet = 'signin'; render(); return true;
    case 'changepassword': mainMenuOpen = false; accountSheet = 'password'; render(); return true;
    case 'signout': signOut(); return true;
    case 'accountclose': accountSheet = null; signinNote = null; render(); return true;
    case 'retrysave':
      setSaveStatus('saving');
      if(pendingSaves.size || colorsDirty) flushSaves(); else setSaveStatus('saved');
      return true;
    case 'conflictmine': resolveConflict(true); return true;
    case 'conflicttheirs': resolveConflict(false); return true;
    case 'noticeclose': notice = null; render(); return true;
  }
  return false;
}
