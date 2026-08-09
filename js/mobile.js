// ---------- Compact (mobile) view ----------
// A tap-driven, single-column alternative to the desktop drag board, meant for
// quick "what's left?" checks and small tweaks on a phone.
//
// Only the rendering differs. All of the money math, category editing, scenario
// handling and persistence is shared with the desktop view, so a change made on
// a phone shows up on the desktop board and vice versa.
//
// Two deliberate simplifications:
//   * No dragging, and therefore no card x/y coordinates. moveCat() already
//     clears x/y, so anything moved here gets a fresh spot the next time the
//     desktop board lays it out.
//   * The left/right shelves are purely spatial on desktop and carry no meaning
//     for the math, so they collapse into one "Not in budget" list here.

const MOBILE_BREAKPOINT = '(max-width: 700px)';
const VIEW_PREF_KEY = 'view-pref'; // device-local, so it stays out of the shared scenario data

function isMobileView(){
  if(viewPref === 'mobile') return true;
  if(viewPref === 'full') return false;
  return window.matchMedia(MOBILE_BREAKPOINT).matches;
}

function setViewPref(pref){
  viewPref = pref;
  if(pref) lsSet(VIEW_PREF_KEY, pref); else lsDelete(VIEW_PREF_KEY);
  mainMenuOpen = false;
  inlineEditId = null;
  render();
}

// ---------- Inline amount editing ----------
// Tapping an amount swaps it for a numeric field so a quick "what if groceries
// were $800?" takes one tap instead of opening the full edit form. The field
// edits the raw stored value (a percent stays a percent, a yearly amount stays
// yearly); the row goes back to showing the monthly equivalent once committed.

function startInlineAmount(id){
  inlineEditId = id;
  menuOpenId = null;
  mainMenuOpen = false;
  render();
}

function commitInlineAmount(id, raw){
  if(inlineEditId !== id) return; // already committed or cancelled — ignore a late blur
  const cat = state.categories.find(c => c.id === id);
  const value = parseFloat(raw);
  if(cat && !isNaN(value) && value >= 0 && value !== cat.value){
    cat.value = value;
    queueSave();
  }
  inlineEditId = null;
  render();
}

function cancelInlineAmount(){
  inlineEditId = null;
  render();
}

// ---------- Grouping ----------

// Budgeted categories bucketed by color group, biggest group first. Categories
// pointing at a deleted color group still need a home, so they land in "Other".
function mobileBudgetGroups(){
  const cats = state.categories.filter(c => c.location === 'budget');
  const known = new Set(colorGroups.map(g => g.key));
  const groups = colorGroups.map(g => ({
    key: g.key,
    name: g.name,
    color: g.color,
    cats: cats.filter(c => c.colorType === g.key),
  }));
  const orphans = cats.filter(c => !known.has(c.colorType));
  if(orphans.length) groups.push({ key:'__other', name:'Other', color:'#B9B2A2', cats:orphans });

  return groups
    .filter(g => g.cats.length)
    .map(g => Object.assign(g, { total: g.cats.reduce((s,c) => s + monthlyValue(c), 0) }))
    .sort((a,b) => b.total - a.total);
}

function byMonthlyDesc(a,b){ return monthlyValue(b) - monthlyValue(a); }

// ---------- Rows ----------

function renderMobileRow(cat){
  const editing = inlineEditId === cat.id;

  if(editing){
    const unit = cat.amountType === 'percent'
      ? '%'
      : (cat.period === 'yearly' ? '/yr' : '/mo');
    // The row normally shows a monthly equivalent, but the field edits the raw
    // stored value — so name what's actually being typed when they differ.
    const note = cat.amountType === 'percent'
      ? 'Percent of income'
      : (cat.period === 'yearly' ? 'Yearly amount' : '');
    return `
      <div class="m-row m-row-editing" data-id="${cat.id}">
        <div class="m-row-main">
          <span class="m-name m-name-static">${escapeHtml(cat.name)}</span>
          <div class="m-inline">
            <input type="number" id="m-inline-input" inputmode="decimal" step="any" min="0" value="${cat.value}" />
            <span class="m-inline-unit">${unit}</span>
            <button class="m-icon m-icon-ok" data-act="minlinesave" data-id="${cat.id}" aria-label="Save amount">✓</button>
          </div>
        </div>
        ${note ? `<div class="m-row-note">${note}</div>` : ''}
      </div>`;
  }

  return `
    <div class="m-row" data-id="${cat.id}">
      <div class="m-row-main">
        <button class="m-name" data-act="edit" data-id="${cat.id}">${escapeHtml(cat.name)}</button>
        <button class="m-amt" data-act="minline" data-id="${cat.id}" aria-label="Edit amount for ${escapeHtml(cat.name)}">
          ${fmt(monthlyValue(cat))}<span class="m-amt-per">/mo</span>
        </button>
        <button class="m-icon" data-act="move" data-id="${cat.id}" data-to="left" aria-label="Remove ${escapeHtml(cat.name)} from budget">−</button>
      </div>
    </div>`;
}

function renderMobileGroup(g){
  const open = expandedGroups.has(g.key);
  const rows = open
    ? `<div class="m-rows">${g.cats.slice().sort(byMonthlyDesc).map(renderMobileRow).join('')}</div>`
    : '';
  return `
    <div class="m-group ${open ? 'open' : ''}">
      <button class="m-group-head" data-act="mgroup" data-key="${g.key}" aria-expanded="${open}">
        <span class="m-dot" style="background:${g.color}"></span>
        <span class="m-group-name">${escapeHtml(g.name)}</span>
        <span class="m-group-count">${g.cats.length}</span>
        <span class="m-group-total">${fmt(g.total)}</span>
        <span class="m-chev">${open ? '▴' : '▾'}</span>
      </button>
      ${rows}
    </div>`;
}

function renderMobileShelf(){
  const cats = state.categories.filter(c => c.location !== 'budget');
  const total = cats.reduce((s,c) => s + monthlyValue(c), 0);
  const rows = shelfOpen ? `
    <div class="m-rows">
      ${cats.slice().sort(byMonthlyDesc).map(cat => `
        <div class="m-row" data-id="${cat.id}">
          <div class="m-row-main">
            <button class="m-name" data-act="edit" data-id="${cat.id}">${escapeHtml(cat.name)}</button>
            <span class="m-amt m-amt-muted">${fmt(monthlyValue(cat))}<span class="m-amt-per">/mo</span></span>
            <button class="m-icon m-icon-add" data-act="move" data-id="${cat.id}" data-to="budget" aria-label="Add ${escapeHtml(cat.name)} to budget">+</button>
          </div>
        </div>`).join('')}
      ${cats.length ? '' : '<div class="m-empty">Nothing on the shelf.</div>'}
      <button class="m-add" data-act="addnew" data-zone="left">+ Add to shelf</button>
    </div>` : '';

  return `
    <div class="m-section m-shelf ${shelfOpen ? 'open' : ''}">
      <button class="m-group-head" data-act="mshelf" aria-expanded="${shelfOpen}">
        <span class="m-dot m-dot-hollow"></span>
        <span class="m-group-name">Not in budget</span>
        <span class="m-group-count">${cats.length}</span>
        <span class="m-group-total m-group-total-muted">${fmt(total)}</span>
        <span class="m-chev">${shelfOpen ? '▴' : '▾'}</span>
      </button>
      ${rows}
    </div>`;
}

// ---------- Menu ----------

function renderMobileMenu(){
  if(!mainMenuOpen) return '';

  const scenarioOptions = scenarioIndex
    .slice()
    .sort((a,b) => (a.name||'').localeCompare(b.name||''))
    .map(s => `<option value="${s.id}" ${s.id===activeId ? 'selected' : ''}>${escapeHtml(s.name)}</option>`)
    .join('');

  return `
    <div class="menu-panel m-menu" data-act="noop">
      <div class="menu-section">
        <div class="menu-section-title">Scenario</div>
        <select id="scenario-select" title="Switch scenarios">${scenarioOptions}</select>
        <div class="menu-btn-row">
          <button class="bar-btn" data-act="dup">⧉ Duplicate</button>
          <button class="bar-btn" data-act="rename">✎ Rename</button>
        </div>
      </div>
      <div class="menu-divider"></div>
      <div class="menu-section">
        <div class="menu-section-title">Currency</div>
        <div class="currency-options">
          ${[['USD','$ US Dollar'],['EUR','€ Euro'],['JPY','¥ Japanese Yen']].map(([code,label]) => `
          <label class="currency-option">
            <input type="radio" name="currency" value="${code}" data-act="setcurrency" ${(state.currency||'USD')===code ? 'checked' : ''}>
            ${label}
          </label>`).join('')}
        </div>
      </div>
      <div class="menu-divider"></div>
      <div class="menu-section">
        <div class="menu-section-title">View</div>
        <button class="bar-btn m-wide" data-act="setview" data-pref="full">Switch to full view</button>
        <div class="m-menu-hint">The full board has drag-and-drop, category colors and multi-add.</div>
      </div>
    </div>`;
}

// ---------- Top-level ----------

function renderMobile(){
  document.body.classList.add('mobile-mode');
  if(typeof tourActive !== 'undefined' && tourActive) endTour(); // desktop-only selectors

  const app = document.getElementById('app');
  const mInc = monthlyIncome();
  const budgetTotal = state.categories
    .filter(c => c.location === 'budget')
    .reduce((s,c) => s + monthlyValue(c), 0);
  const remaining = mInc - budgetTotal;
  const pct = mInc > 0 ? Math.min(100, (budgetTotal/mInc)*100) : 0;
  const isPos = remaining >= 0;
  const scenarioName = (scenarioIndex.find(s => s.id === activeId) || {}).name || '';
  const groups = mobileBudgetGroups();

  const incomeBlock = editingId === 'income' ? `
    <div class="m-income-edit">
      <input type="number" id="f-income" inputmode="decimal" step="any" min="0" value="${state.income.amount}" />
      <div class="seg m-seg">
        <button data-act="incperiod" data-key="monthly" class="${state.income.period==='monthly' ? 'active' : ''}">Monthly</button>
        <button data-act="incperiod" data-key="yearly" class="${state.income.period==='yearly' ? 'active' : ''}">Yearly</button>
      </div>
      <button class="btn-primary m-wide" data-act="incsave">Save income</button>
    </div>
  ` : `
    <button class="m-income" data-act="editincome">
      <span class="m-income-label">Income</span>
      <span class="m-income-amt">${fmt(state.income.amount)}<span class="m-income-per">/${state.income.period==='monthly' ? 'mo' : 'yr'}</span></span>
    </button>`;

  app.innerHTML = `
    <div class="m-view">
      <div class="m-top">
        <div class="m-title-group">
          <span class="m-title">Budget</span>
          <span class="m-scenario">${escapeHtml(scenarioName)}</span>
        </div>
        <div class="menu-wrap">
          <button class="bar-btn" data-act="togglemainmenu">☰ Menu</button>
          ${renderMobileMenu()}
        </div>
      </div>

      <div class="m-summary">
        ${incomeBlock}
        <div class="m-remaining ${isPos ? 'pos' : 'neg'}">
          <div class="m-remaining-label">Remaining this month</div>
          <div class="m-remaining-amt">${fmt(remaining)}</div>
          <div class="m-remaining-sub">${fmt(budgetTotal)} budgeted of ${fmt(mInc)}</div>
          <div class="balance-track"><div class="balance-fill" style="width:${pct}%"></div></div>
        </div>
      </div>

      <div class="m-section">
        <div class="m-section-head">
          <span class="m-section-title">In your budget</span>
          <span class="m-section-total">${fmt(budgetTotal)}/mo</span>
        </div>
        ${groups.length
          ? groups.map(renderMobileGroup).join('')
          : '<div class="m-empty">Nothing budgeted yet — add a category or pull one off the shelf below.</div>'}
        <button class="m-add" data-act="addnew" data-zone="budget">+ Add to budget</button>
      </div>

      ${renderMobileShelf()}

      <div class="m-footer">
        <button class="breakdown-toggle" data-act="togglebreakdown">${breakdownOpen ? '▴ Hide' : '▾ Show'} breakdown by group</button>
        ${renderBreakdownPanel(mInc)}
      </div>
    </div>

    ${renderModal()}
  `;

  attachHandlers();
}
