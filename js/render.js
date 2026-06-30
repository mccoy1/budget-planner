// ---------- Rendering ----------

function escapeHtml(s){
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function renderCard(cat){
  const mv = monthlyValue(cat);
  const unit = cat.amountType === 'percent' ? '% of income' : (cat.period === 'yearly' ? '/yr' : '/mo');
  const displayVal = cat.amountType === 'percent' ? cat.value + '%' : fmt(cat.value);
  const isBudget = cat.location === 'budget';
  const posStyle = `left:${cat.x||0}px; top:${cat.y||0}px; border-left-color:${colorFor(cat.colorType)};`;
  const groupName = (colorGroups.find(g=>g.key===cat.colorType) || {}).name || 'Uncategorized';
  const isDimmed = searchQuery.trim() && !cat.name.toLowerCase().includes(searchQuery.trim().toLowerCase());

  if(isBudget){
    let tooltip;
    if(cat.amountType === 'percent') tooltip = `${cat.value}% of income`;
    else if(cat.period === 'yearly') tooltip = `${fmt(cat.value)}/yr`;
    else tooltip = `${fmt(cat.value)}/mo`;
    tooltip += ` · ${groupName}`;
    const menuOpen = menuOpenId === cat.id;
    const menuHtml = menuOpen ? `
      <div class="chip-menu">
        <button data-act="edit" data-id="${cat.id}">✎ Edit</button>
        <button data-act="move" data-id="${cat.id}" data-to="left">← Move to shelf</button>
        <button class="danger" data-act="del" data-id="${cat.id}">✕ Delete</button>
      </div>` : '';
    return `
      <div class="card chip ${menuOpen?'menu-open':''} ${isDimmed?'dimmed':''}" style="${posStyle}" data-id="${cat.id}" data-tip="${escapeHtml(tooltip)}">
        <div class="chip-name">${escapeHtml(cat.name)}</div>
        <div class="card-amount">${fmt(mv)}<span class="unit">/mo</span></div>
        <button class="icon-btn chip-menu-btn" data-act="togglemenu" data-id="${cat.id}" data-tip="Options">⋮</button>
        ${menuHtml}
      </div>`;
  }

  const moves = `<button class="move-btn" data-act="move" data-id="${cat.id}" data-to="budget">→ budget</button>`;
  const yearlyNote = (cat.amountType==='fixed' && cat.period==='yearly')
    ? `<div class="card-yearly-note">${fmt(mv)}/mo equivalent</div>` : '';
  return `
    <div class="card ${isDimmed?'dimmed':''}" style="${posStyle}" data-id="${cat.id}" data-tip="${escapeHtml(groupName)}">
      <div class="card-top">
        <div class="card-name">${escapeHtml(cat.name)}</div>
        <div class="card-icons">
          <button class="icon-btn" data-act="edit" data-id="${cat.id}" data-tip="Edit">✎</button>
          <button class="icon-btn" data-act="del" data-id="${cat.id}" data-tip="Delete">✕</button>
        </div>
      </div>
      <div class="card-amount">${displayVal}<span class="unit">${unit}</span></div>
      ${yearlyNote}
      <div class="card-moves">${moves}</div>
    </div>`;
}

function renderEditForm(){
  const d = editDraft;
  return `
  <div class="edit-form">
    <label>Category name</label>
    <input type="text" id="f-name" value="${escapeHtml(d.name)}" placeholder="e.g. Internet bill" />

    <label>Type</label>
    <div class="swatches">
      ${colorGroups.map(c=>`<div class="swatch ${d.colorType===c.key?'sel':''}" style="background:${c.color}" data-act="color" data-key="${c.key}" data-tip="${escapeHtml(c.name)}"></div>`).join('')}
    </div>

    <label>Amount is</label>
    <div class="seg">
      <button data-act="amtType" data-key="fixed" class="${d.amountType==='fixed'?'active':''}">Fixed $</button>
      <button data-act="amtType" data-key="percent" class="${d.amountType==='percent'?'active':''}">% of income</button>
    </div>

    <div class="row2">
      <div>
        <label>${d.amountType==='percent' ? 'Percent' : 'Amount'}</label>
        <input type="number" id="f-value" value="${d.value}" min="0" step="any" />
      </div>
      ${d.amountType==='fixed' ? `
      <div>
        <label>Period</label>
        <div class="seg">
          <button data-act="period" data-key="monthly" class="${d.period==='monthly'?'active':''}">Monthly</button>
          <button data-act="period" data-key="yearly" class="${d.period==='yearly'?'active':''}">Yearly</button>
        </div>
      </div>` : ''}
    </div>

    <div class="form-actions">
      <button class="btn-secondary" data-act="cancel">Cancel</button>
      <button class="btn-primary" data-act="save">${d.id ? 'Save changes' : 'Add category'}</button>
    </div>
  </div>`;
}

function renderBulkForm(zoneKey){
  const colorOptions = colorGroups.map(g=>`<option value="${g.key}">${escapeHtml(g.name)}</option>`).join('');
  return `
  <div class="edit-form bulk-form">
    <label>One category per line</label>
    <textarea id="bulk-textarea" rows="5" placeholder="Kid school, $1000&#10;Savings, 10%&#10;Streaming bundle"></textarea>
    <div class="bulk-hint">Add an amount after a comma — <code>$1000</code> for a dollar amount, <code>10%</code> for a percent of income, or <code>$1000/yr</code> for a yearly amount. Leave it off to fill in later.</div>

    <label>Category color</label>
    <select id="bulk-color-select">${colorOptions}</select>
    <div class="bulk-hint">Every category in this list will be added with this color. You can always recolor one afterward.</div>

    <div class="form-actions">
      <button class="btn-secondary" data-act="bulkcancel">Cancel</button>
      <button class="btn-primary" data-act="bulksave" data-zone="${zoneKey}">Add categories</button>
    </div>
  </div>`;
}

function canvasHeight(zoneKey){
  const cardH = zoneKey==='budget' ? 54 : 116;
  let maxBottom = 220;
  state.categories.filter(c=>c.location===zoneKey && !hiddenColors.has(c.colorType)).forEach(c=>{
    maxBottom = Math.max(maxBottom, (c.y||0) + cardH + 16);
  });
  return maxBottom;
}

function renderZone(zoneKey, title, hint){
  const cats = state.categories.filter(c=>c.location===zoneKey && !hiddenColors.has(c.colorType));
  const cardsHtml = cats.map(c => renderCard(c)).join('');
  const addMenuHtml = addMenuZone === zoneKey ? `
    <div class="add-menu-panel" data-act="noop">
      <button data-act="addnew" data-zone="${zoneKey}">+ Add category</button>
      <button data-act="bulknew" data-zone="${zoneKey}">+ Add multiple</button>
    </div>` : '';
  return `
    <div class="col ${zoneKey==='budget'?'col-budget':''}">
      <div class="col-head">
        <div class="col-title">${title}</div>
        <span class="help-icon" data-tip="${escapeHtml(hint)}">?</span>
      </div>
      <div class="dropzone-toolbar">
        <button class="add-card" data-act="toggleaddmenu" data-zone="${zoneKey}">+ Add ▾</button>
        ${addMenuHtml}
        ${zoneKey==='budget' ? `<button class="add-card" data-act="snapgrid" data-tip="Sort by color and arrange into a tidy grid">⊞ Snap to grid</button>` : ''}
      </div>
      <div class="dropzone" data-zone="${zoneKey}">
        <div class="canvas" style="height:${canvasHeight(zoneKey)}px;">${cardsHtml}</div>
      </div>
    </div>`;
}

function renderMainMenu(){
  if(!mainMenuOpen) return '';

  const scenarioOptions = scenarioIndex
    .slice()
    .sort((a,b)=> (a.name||'').localeCompare(b.name||''))
    .map(s=>`<option value="${s.id}" ${s.id===activeId?'selected':''}>${escapeHtml(s.name)}</option>`)
    .join('');

  const colorRows = colorGroups.map(g => {
    const hidden = hiddenColors.has(g.key);
    return `
    <div class="color-row">
      <button class="icon-btn" data-act="togglecolorvis" data-key="${g.key}" data-tip="${hidden ? 'Show' : 'Hide'} this category">${hidden ? '🚫' : '👁'}</button>
      <input type="color" value="${g.color}" data-act="colorchange" data-key="${g.key}" title="Change color" />
      <input type="text" value="${escapeHtml(g.name)}" data-act="colorrename" data-key="${g.key}" />
      <button class="icon-btn" data-act="colordelete" data-key="${g.key}" data-tip="Delete this color">✕</button>
    </div>`;
  }).join('');

  return `
    <div class="menu-panel" data-act="noop">
      <div class="menu-section">
        <div class="menu-section-title">Scenario</div>
        <select id="scenario-select" title="Switch scenarios">${scenarioOptions}</select>
        <div class="menu-btn-row">
          <button class="bar-btn" data-act="dup">⧉ Duplicate</button>
          <button class="bar-btn" data-act="newblank">+ New</button>
        </div>
        <div class="menu-btn-row">
          <button class="bar-btn" data-act="rename">✎ Rename</button>
          <button class="bar-btn" data-act="delscenario">✕ Delete</button>
        </div>
      </div>
      <div class="menu-divider"></div>
      <div class="menu-section">
        <div class="menu-section-title">Category colors</div>
        <div class="color-rows">${colorRows}</div>
        <div class="color-add-row">
          <input type="color" id="new-color-input" value="#7BAFD4" />
          <input type="text" id="new-color-name" placeholder="New category name" />
          <button class="bar-btn" data-act="coloradd">+ Add</button>
        </div>
      </div>
    </div>`;
}

function renderBreakdownPanel(mInc){
  if(!breakdownOpen) return '';
  const totals = colorGroups.map(g=>{
    const amount = state.categories
      .filter(c=>c.location==='budget' && c.colorType===g.key)
      .reduce((s,c)=>s+monthlyValue(c), 0);
    return { name:g.name, color:g.color, amount };
  }).sort((a,b)=> b.amount - a.amount);

  const rows = totals.map(t=>{
    const pct = mInc > 0 ? (t.amount / mInc * 100) : 0;
    return `
      <div class="breakdown-row">
        <span class="breakdown-swatch" style="background:${t.color}"></span>
        <span class="breakdown-name">${escapeHtml(t.name)}</span>
        <span class="breakdown-amount">${fmt(t.amount)}</span>
        <span class="breakdown-pct">${pct.toFixed(1)}%</span>
      </div>`;
  }).join('');

  return `
    <div class="breakdown-panel">
      <div class="breakdown-head">
        <span></span><span>Category group</span><span>Monthly</span><span>% income</span>
      </div>
      ${rows}
    </div>`;
}

function renderModal(){
  if(bulkZone){
    return `<div class="modal-backdrop" data-act="bulkcancel"><div class="modal-box" data-act="noop">${renderBulkForm(bulkZone)}</div></div>`;
  }
  if(editingId && editingId !== 'income'){
    return `<div class="modal-backdrop" data-act="cancel"><div class="modal-box" data-act="noop">${renderEditForm()}</div></div>`;
  }
  return '';
}

function render(){
  ensurePositions();
  const scrollMap = {};
  document.querySelectorAll('.dropzone').forEach(z=>{ scrollMap[z.dataset.zone] = z.scrollTop; });
  const app = document.getElementById('app');
  const mInc = monthlyIncome();
  const budgetTotal = state.categories.filter(c=>c.location==='budget').reduce((s,c)=>s+monthlyValue(c),0);
  const remaining = mInc - budgetTotal;
  const pct = mInc > 0 ? Math.min(100, (budgetTotal/mInc)*100) : 0;
  const isPos = remaining >= 0;

  const incomeBlock = editingId==='income' ? `
    <div class="income-edit-row">
      <input type="number" id="f-income" value="${state.income.amount}" min="0" step="any" />
      <div class="period-toggle">
        <button data-act="incperiod" data-key="monthly" class="${state.income.period==='monthly'?'active':''}">Monthly</button>
        <button data-act="incperiod" data-key="yearly" class="${state.income.period==='yearly'?'active':''}">Yearly</button>
      </div>
      <button class="reset-btn" data-act="incsave" style="background:#fff;">Save</button>
    </div>
  ` : `<div class="income-amount" data-act="editincome">${fmt(state.income.amount)}<span style="font-size:16px;font-weight:500;"> /${state.income.period==='monthly'?'mo':'yr'}</span></div>`;

  app.innerHTML = `
    <div class="top-row">
      <div class="title-group">
        <span class="title">Household Budget Planner</span>
        <span class="help-icon title-help" data-tip="${HAS_CLOUD_STORAGE
          ? 'Drag categories into your budget, or use the move option in a chip menu. Shared with anyone who opens this planner.'
          : 'Drag categories into your budget, or use the move option in a chip menu. Saving locally in this browser only — open this inside Claude to share scenarios with your spouse.'}">?</span>
      </div>
      <div class="top-actions">
        ${searchOpen ? `
          <div class="search-box">
            <input type="text" id="search-input" placeholder="Search categories…" value="${escapeHtml(searchQuery)}" />
            <button class="icon-btn" data-act="closesearch" data-tip="Close search">✕</button>
          </div>
        ` : `<button class="bar-btn icon-only" data-act="togglesearch" data-tip="Search categories">🔍</button>`}
        <div class="menu-wrap">
          <button class="bar-btn" data-act="togglemainmenu">☰ Menu</button>
          ${renderMainMenu()}
        </div>
      </div>
    </div>

    <div class="income-hero">
      <div style="text-align:center;">
        <div class="income-label">Household Income <span class="scenario-tag">${escapeHtml((scenarioIndex.find(s=>s.id===activeId)||{}).name || '')}</span></div>
        ${incomeBlock}
      </div>
    </div>

    <div class="board">
      ${renderZone('left', 'Available', 'Drag into your budget →')}
      ${renderZone('budget', 'Your Budget', "This month's plan")}
      ${renderZone('right', 'Available', '← Drag into your budget')}
    </div>

    <div class="balance-wrap">
      <div class="balance-card ${isPos ? 'pos' : 'neg'}">
        <div class="balance-label">Remaining this month</div>
        <div class="balance-amount">${fmt(remaining)}</div>
        <div class="balance-sub">${fmt(budgetTotal)} budgeted of ${fmt(mInc)} income</div>
        <div class="balance-track"><div class="balance-fill" style="width:${pct}%"></div></div>
      </div>
      <button class="breakdown-toggle" data-act="togglebreakdown">${breakdownOpen ? '▴ Hide' : '▾ Show'} breakdown by category group</button>
      ${renderBreakdownPanel(mInc)}
    </div>

    ${renderModal()}
  `;

  attachHandlers();
  clampPositions();
  document.querySelectorAll('.dropzone').forEach(z=>{
    if(scrollMap[z.dataset.zone] != null) z.scrollTop = scrollMap[z.dataset.zone];
  });

  const bulkTa = document.getElementById('bulk-textarea');
  if(bulkTa) bulkTa.focus();

  if(searchFocusPending){
    const searchInput = document.getElementById('search-input');
    if(searchInput) searchInput.focus();
    searchFocusPending = false;
  }
}
