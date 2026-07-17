// ---- Constants ----
const CATEGORIES = [
  { id: 'shopping', label: '购物', var: '--series-7' },
  { id: 'transport', label: '交通', var: '--series-1' },
  { id: 'food', label: '食物', var: '--series-2' },
  { id: 'entertainment', label: '娱乐', var: '--series-3' },
  { id: 'tickets', label: '门票', var: '--series-6' },
  { id: 'lodging_tax', label: '住宿税', var: '--series-4' },
  { id: 'other', label: '其他', var: '--series-5' },
];
const CATEGORY_MAP = Object.fromEntries(CATEGORIES.map((c) => [c.id, c]));
const PAYMENT_METHODS = [
  { id: 'cash', label: '现金' },
  { id: 'card', label: '卡' },
];

// ---- Line icons (stroke=currentColor so they follow text/theme color automatically) ----
const ICON_PATHS = {
  wallet: '<path d="M3 7a2 2 0 0 1 2-2h13a1 1 0 0 1 1 1v3"/><path d="M3 7v11a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-8a2 2 0 0 0-2-2H5"/><circle cx="16.5" cy="14" r="1.4"/>',
  card: '<rect x="3" y="6" width="18" height="13" rx="2"/><line x1="3" y1="10.5" x2="21" y2="10.5"/><line x1="6" y1="15" x2="10" y2="15"/>',
  users: '<circle cx="9" cy="8" r="3"/><path d="M3.5 19c0-3 2.5-5 5.5-5s5.5 2 5.5 5"/><circle cx="17" cy="9" r="2.3"/><path d="M14.5 12.2c2.6.3 4.5 2.1 4.8 4.8"/>',
  camera: '<path d="M4 8a2 2 0 0 1 2-2h1.2l.9-1.5a1 1 0 0 1 .86-.5h6.08a1 1 0 0 1 .86.5L16.8 6H18a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8Z"/><circle cx="12" cy="13" r="3.2"/>',
};
function icon(name, size = 18) {
  return `<svg class="icon" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ICON_PATHS[name]}</svg>`;
}

// ---- App state (in-memory cache, source of truth is IndexedDB) ----
const State = {
  settings: null,
  people: [],
  expenses: [],
  activeView: 'overview',
};

const FormState = {
  id: null,
  date: '',
  category: 'food',
  amount: '',
  paymentMethod: 'cash',
  note: '',
  isSplit: false,
  payerId: null,
  splitType: 'equal',
  participantIds: new Set(),
  customAmounts: new Map(), // personId -> string (base consumption amount in custom split mode)
  taxAmount: '', // optional service charge/tax, split proportionally to customAmounts
  settledMap: new Map(), // personId -> {settled, settledMethod, settledDate}, carried over when editing
  photo: null, // compressed data URL, or null
};

// Resizes+recompresses a picked photo before storing it, so a multi-MB camera
// shot doesn't bloat IndexedDB — receipts stay legible well under this size.
function compressImage(file, maxSize = 1280, quality = 0.72) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => {
      const img = new Image();
      img.onerror = reject;
      img.onload = () => {
        let { width, height } = img;
        if (width > height && width > maxSize) {
          height = Math.round(height * (maxSize / width));
          width = maxSize;
        } else if (height >= width && height > maxSize) {
          width = Math.round(width * (maxSize / height));
          height = maxSize;
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        canvas.getContext('2d').drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

// ---- Utilities ----
function byId(id) { return document.getElementById(id); }
function yen(n) { return '¥' + Math.round(n).toLocaleString('ja-JP'); }
function todayStr() {
  const d = new Date();
  const tz = d.getTimezoneOffset() * 60000;
  return new Date(d - tz).toISOString().slice(0, 10);
}
function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}
function personName(id) {
  const p = State.people.find((p) => p.id === id);
  return p ? p.name : '(已删除成员)';
}
function activePeople() { return State.people.filter((p) => !p.archived); }
// Active people, plus any archived people already referenced by the expense being
// edited — so an archived payer/participant doesn't silently get swapped out.
function relevantPeople() {
  const referencedIds = new Set([FormState.payerId, ...FormState.participantIds].filter((id) => id != null));
  const extra = State.people.filter((p) => p.archived && referencedIds.has(p.id));
  return [...activePeople(), ...extra];
}
function toast(msg) {
  const el = byId('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.remove('show'), 2200);
}

// ---- Init ----
async function init() {
  registerSW();
  State.settings = await DB.getSettings();
  State.people = await DB.getPeople();
  State.expenses = await DB.getExpenses();

  if (!State.settings) {
    showOnboarding();
  } else {
    showApp();
  }

  wireGlobalEvents();
}

function registerSW() {
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    });
  }
}

// ---- Onboarding ----
let onboardingPeople = [];

function showOnboarding() {
  byId('onboarding').classList.remove('hidden');
  byId('app').classList.add('hidden');
  onboardingPeople = ['我', 'A', 'B', 'C'];
  renderOnboardingPeople();
  byId('ob-step-1').classList.remove('hidden');
  byId('ob-step-2').classList.add('hidden');
}

function renderOnboardingPeople() {
  const wrap = byId('ob-people-list');
  wrap.innerHTML = onboardingPeople.map((name, i) => `
    <div class="person-row">
      <input type="text" class="ob-person-input" data-idx="${i}" value="${escapeHtml(name)}" placeholder="姓名">
      <button type="button" class="icon-btn ob-remove-person" data-idx="${i}" aria-label="移除">✕</button>
    </div>`).join('');
}

function wireOnboarding() {
  byId('ob-next').addEventListener('click', () => {
    const cash = parseInt(byId('ob-cash').value, 10);
    if (!cash || cash < 0) {
      toast('请输入携带现金总额');
      return;
    }
    byId('ob-step-1').classList.add('hidden');
    byId('ob-step-2').classList.remove('hidden');
  });
  byId('ob-back').addEventListener('click', () => {
    byId('ob-step-2').classList.add('hidden');
    byId('ob-step-1').classList.remove('hidden');
  });
  byId('ob-people-list').addEventListener('input', (e) => {
    if (e.target.classList.contains('ob-person-input')) {
      onboardingPeople[+e.target.dataset.idx] = e.target.value;
    }
  });
  byId('ob-people-list').addEventListener('click', (e) => {
    const btn = e.target.closest('.ob-remove-person');
    if (!btn) return;
    onboardingPeople.splice(+btn.dataset.idx, 1);
    renderOnboardingPeople();
  });
  byId('ob-add-person').addEventListener('click', () => {
    onboardingPeople.push('');
    renderOnboardingPeople();
  });
  byId('ob-finish').addEventListener('click', async () => {
    const cash = parseInt(byId('ob-cash').value, 10) || 0;
    const cardEnabled = byId('ob-card-enabled').checked;
    const cardVal = byId('ob-card').value;
    const names = onboardingPeople.map((n) => n.trim()).filter(Boolean);
    if (names.length === 0) {
      toast('请至少添加一位同行伙伴');
      return;
    }
    let selfPersonId = null;
    for (const name of names) {
      const newId = await DB.addPerson(name);
      if (selfPersonId == null) selfPersonId = newId;
    }
    await DB.saveSettings({
      initialCash: cash,
      initialCard: cardEnabled && cardVal !== '' ? parseInt(cardVal, 10) : null,
      cardEnabled,
      selfPersonId,
    });
    State.settings = await DB.getSettings();
    State.people = await DB.getPeople();
    showApp();
  });
  byId('ob-card-enabled').addEventListener('change', (e) => {
    byId('ob-card').disabled = !e.target.checked;
  });
}

// ---- App shell / navigation ----
function showApp() {
  byId('onboarding').classList.add('hidden');
  byId('app').classList.remove('hidden');
  navigate('overview');
}

function navigate(view) {
  State.activeView = view;
  document.querySelectorAll('.view').forEach((v) => v.classList.add('hidden'));
  byId('view-' + view).classList.remove('hidden');
  document.querySelectorAll('.bottom-nav button').forEach((b) => {
    b.classList.toggle('active', b.dataset.view === view);
  });
  const titles = { overview: '总览', expenses: '记录', stats: '统计', split: '分账', settings: '设置' };
  byId('page-title').textContent = titles[view] || '';
  renderCurrentView();
}

function renderCurrentView() {
  if (State.activeView === 'overview') renderOverview();
  else if (State.activeView === 'expenses') renderExpensesList();
  else if (State.activeView === 'stats') renderStats();
  else if (State.activeView === 'split') renderSplit();
  else if (State.activeView === 'settings') renderSettings();
}

async function refreshData() {
  State.expenses = await DB.getExpenses();
  State.people = await DB.getPeople();
  renderCurrentView();
}

// ---- Overview ----
function budgetBarHtml(spent, total) {
  const pct = total > 0 ? Math.round((spent / total) * 100) : 0;
  const width = Math.min(100, Math.max(0, pct));
  const over = spent > total;
  return `
    <div class="bar-track stat-bar">
      <div class="bar-fill" style="width:${width}%;background:${over ? 'var(--bad)' : 'var(--accent)'}"></div>
    </div>
    <div class="stat-pct ${over ? 'negative' : ''}">已用 ${pct}%</div>
  `;
}

// A non-split expense is assumed paid out of my own pocket (no payer field is
// ever collected for it). A split expense only touches my wallet if I'm the
// one who actually fronted the money.
function isMyExpense(e) {
  const selfId = State.settings.selfPersonId;
  if (!selfId) return true; // no self set yet — fall back to old "everything is mine" behavior
  return !e.isSplit || e.payerId === selfId;
}

// What this expense actually cost ME — as opposed to isMyExpense's "money that
// left my wallet," which for a split expense I fronted includes everyone else's
// share too. A non-split expense is assumed entirely personal, same as above.
function myShare(e) {
  const selfId = State.settings.selfPersonId;
  if (!e.isSplit) return e.amount;
  if (!selfId) return e.amount;
  const mine = (e.participants || []).find((p) => p.personId === selfId);
  return mine ? mine.amount : 0;
}

function signedYen(n) { return (n > 0 ? '+' : '') + yen(n); }

// Money that has physically moved into/out of my cash or card because someone
// settled up on a split expense (either they paid me back, or I paid my own
// share back to whoever fronted it).
function settlementFlows() {
  const selfId = State.settings.selfPersonId;
  let cash = 0;
  let card = 0;
  if (!selfId) return { cash, card };
  for (const exp of State.expenses) {
    if (!exp.isSplit || !Array.isArray(exp.participants)) continue;
    for (const p of exp.participants) {
      if (!p.settled || p.personId === exp.payerId) continue;
      const sign = exp.payerId === selfId ? 1 : p.personId === selfId ? -1 : 0;
      if (sign === 0) continue;
      if (p.settledMethod === 'card') card += sign * p.amount;
      else cash += sign * p.amount;
    }
  }
  return { cash, card };
}

function renderOverview() {
  const s = State.settings;
  const flows = settlementFlows();
  const cashSpent = State.expenses.filter((e) => e.paymentMethod === 'cash' && isMyExpense(e)).reduce((a, e) => a + e.amount, 0);
  const cardSpent = State.expenses.filter((e) => e.paymentMethod === 'card' && isMyExpense(e)).reduce((a, e) => a + e.amount, 0);
  const cashLeft = s.initialCash - cashSpent + flows.cash;
  const myTotalSpend = State.expenses.reduce((a, e) => a + myShare(e), 0);

  const flowLine = (flow, label) => flow !== 0
    ? `<div class="stat-sub flow-line ${flow > 0 ? 'positive' : 'negative'}">${label}${flow > 0 ? '收回' : '付出'} ${signedYen(flow)}</div>`
    : '';

  let cardHtml;
  if (s.cardEnabled && s.initialCard != null) {
    const cardLeft = s.initialCard - cardSpent + flows.card;
    cardHtml = `<div class="stat-value ${cardLeft < 0 ? 'negative' : ''}">${yen(cardLeft)}</div>
      <div class="stat-sub">已花费 ${yen(cardSpent)} / 初始 ${yen(s.initialCard)}</div>
      ${budgetBarHtml(cardSpent, s.initialCard)}
      ${flowLine(flows.card, '分账')}`;
  } else {
    cardHtml = `<div class="stat-value muted">未设置</div><div class="stat-sub">已花费 ${yen(cardSpent)}</div>`;
  }

  const balances = computeNetBalances(State.expenses);
  const debtRows = [...balances.entries()]
    .filter(([, v]) => Math.abs(v) > 0.5)
    .sort((a, b) => b[1] - a[1])
    .map(([id, v]) => `
      <div class="balance-row">
        <span>${escapeHtml(personName(id))}</span>
        <span class="${v > 0 ? 'positive' : 'negative'}">${v > 0 ? '应收 ' + yen(v) : '应付 ' + yen(-v)}</span>
      </div>`).join('');
  const debtCardHtml = debtRows ? `
    <div class="stat-card total-card">
      <div class="stat-label">${icon('users')} 分账未结</div>
      <div class="balance-list">${debtRows}</div>
    </div>` : '';

  byId('view-overview').innerHTML = `
    <div class="stat-card">
      <div class="stat-label">${icon('wallet')} 剩余现金</div>
      <div class="stat-value ${cashLeft < 0 ? 'negative' : ''}">${yen(cashLeft)}</div>
      <div class="stat-sub">已花费 ${yen(cashSpent)} / 初始 ${yen(s.initialCash)}</div>
      ${budgetBarHtml(cashSpent, s.initialCash)}
      ${flowLine(flows.cash, '分账')}
    </div>
    <div class="stat-card">
      <div class="stat-label">${icon('card')} 剩余卡内余额</div>
      ${cardHtml}
    </div>
    <div class="stat-card total-card">
      <div class="stat-label">我的个人花费</div>
      <div class="stat-value">${yen(myTotalSpend)}</div>
      <div class="stat-sub">共 ${State.expenses.length} 笔记录${s.selfPersonId ? '（不含代垫他人的部分）' : ''}</div>
    </div>
    ${debtCardHtml}
    <button class="secondary-btn" id="ov-add-btn">＋ 记一笔开销</button>
  `;
  byId('ov-add-btn').addEventListener('click', () => openExpenseModal());
}

// ---- Expenses list ----
function sortByDateDesc(a, b) { return a.date < b.date ? 1 : a.date > b.date ? -1 : b.id - a.id; }

function renderExpensesList() {
  const view = byId('view-expenses');
  if (State.expenses.length === 0) {
    view.innerHTML = `<p class="empty-hint">还没有记录，点击右下角「＋」开始记账</p>`;
    return;
  }
  const section = (title, iconName, list) => {
    if (list.length === 0) return '';
    const total = list.reduce((a, e) => a + e.amount, 0);
    return `
      <h3 class="section-title"><span class="section-title-label">${icon(iconName)} ${title}</span><span class="section-total">${yen(total)}</span></h3>
      <div class="expense-list">${list.map(renderExpenseRow).join('')}</div>`;
  };
  const cash = State.expenses.filter((e) => e.paymentMethod === 'cash').sort(sortByDateDesc);
  const card = State.expenses.filter((e) => e.paymentMethod === 'card').sort(sortByDateDesc);
  view.innerHTML = section('现金', 'wallet', cash) + section('卡', 'card', card);
  view.querySelectorAll('.expense-row').forEach((row) => {
    row.addEventListener('click', () => openExpenseModal(+row.dataset.id));
  });
}

function renderExpenseRow(e) {
  const cat = CATEGORY_MAP[e.category];
  const pm = PAYMENT_METHODS.find((p) => p.id === e.paymentMethod);
  const mine = e.isSplit ? myShare(e) : null;
  return `
    <div class="expense-row" data-id="${e.id}">
      <div class="expense-cat-dot" style="background:var(${cat.var})"></div>
      <div class="expense-main">
        <div class="expense-top">
          <span class="expense-cat">${cat.label}</span>
          <span class="expense-amount">${yen(e.amount)}${mine != null ? `<span class="expense-my-share">我的份 ${yen(mine)}</span>` : ''}</span>
        </div>
        <div class="expense-sub">
          <span>${e.date}</span>
          <span>${pm.label}</span>
          ${e.note ? `<span class="expense-note">${escapeHtml(e.note)}</span>` : ''}
          ${e.isSplit ? '<span class="split-badge">分账</span>' : ''}
          ${e.photo ? `<span class="expense-photo-badge">${icon('camera', 13)}</span>` : ''}
        </div>
      </div>
    </div>`;
}

// ---- Category stats ----
function renderStats() {
  const totals = new Map();
  for (const e of State.expenses) {
    totals.set(e.category, (totals.get(e.category) || 0) + myShare(e));
  }
  const grandTotal = [...totals.values()].reduce((a, b) => a + b, 0);
  const rows = CATEGORIES
    .map((c) => ({ ...c, amount: totals.get(c.id) || 0 }))
    .sort((a, b) => b.amount - a.amount);

  const view = byId('view-stats');
  if (grandTotal === 0) {
    view.innerHTML = `<p class="empty-hint">还没有花费记录</p>`;
    return;
  }
  view.innerHTML = `
    <p class="hint-text">以下为你的个人花费${State.settings.selfPersonId ? '（不含代垫他人的部分）' : ''}</p>
    <div class="stats-list">
      ${rows.map((r) => {
        const pct = grandTotal ? Math.round((r.amount / grandTotal) * 100) : 0;
        return `
        <div class="stats-row">
          <div class="stats-row-top">
            <span class="stats-cat">${r.label}</span>
            <span class="stats-amount">${yen(r.amount)} <span class="stats-pct">${pct}%</span></span>
          </div>
          <div class="bar-track">
            <div class="bar-fill" style="width:${pct}%;background:var(${r.var})"></div>
          </div>
        </div>`;
      }).join('')}
    </div>
    <div class="stat-card total-card"><div class="stat-label">合计</div><div class="stat-value">${yen(grandTotal)}</div></div>
  `;
}

// ---- Split summary (per-expense, so each dinner/ticket can be settled individually) ----
function renderSplit() {
  const view = byId('view-split');
  const splitExpenses = State.expenses.filter((e) => e.isSplit).sort(sortByDateDesc);

  if (splitExpenses.length === 0) {
    view.innerHTML = `<p class="empty-hint">还没有分账记录。记账时打开「需要分账」开关即可。</p>`;
    return;
  }

  const balances = computeNetBalances(State.expenses);
  const balanceRows = [...balances.entries()]
    .filter(([, v]) => Math.abs(v) > 0.5)
    .sort((a, b) => b[1] - a[1])
    .map(([id, v]) => `
      <div class="balance-row">
        <span>${escapeHtml(personName(id))}</span>
        <span class="${v > 0 ? 'positive' : 'negative'}">${v > 0 ? '应收 ' + yen(v) : '应付 ' + yen(-v)}</span>
      </div>`).join('') || `<p class="empty-hint">收支相抵，无人欠款</p>`;

  view.innerHTML = `
    <h3 class="section-title">每人净额</h3>
    <div class="balance-list">${balanceRows}</div>
    <h3 class="section-title">按笔标记还款</h3>
    <div class="debt-expense-list">${splitExpenses.map(renderSplitExpenseCard).join('')}</div>
    <button class="secondary-btn" id="export-split-btn">导出分账总结 CSV</button>
  `;

  wireSplitPageEvents();
  byId('export-split-btn').addEventListener('click', () => exportSplitCSV(balances));
}

function renderSplitExpenseCard(exp) {
  const cat = CATEGORY_MAP[exp.category];
  const payerName = personName(exp.payerId);
  const rows = exp.participants.map((p) => {
    const name = personName(p.personId);
    if (p.personId === exp.payerId) {
      return `<div class="debt-item debt-item-muted">
        <div class="debt-item-row"><span>${escapeHtml(name)}（垫付人）自己的一份</span><span class="tx-amount">${yen(p.amount)}</span></div>
      </div>`;
    }
    if (p.settled) {
      const methodLabel = p.settledMethod === 'card' ? '卡' : '现金';
      return `<div class="debt-item debt-item-settled">
        <div class="debt-item-row">
          <span class="tx-text">${escapeHtml(name)} 欠 ${escapeHtml(payerName)}（已还，${methodLabel}）</span>
          <span class="tx-amount">${yen(p.amount)}</span>
        </div>
        <button type="button" class="text-btn undo-debt-btn" data-expense="${exp.id}" data-person="${p.personId}">撤销</button>
      </div>`;
    }
    return `<div class="debt-item">
      <div class="debt-item-row">
        <span class="tx-text">${escapeHtml(name)} 欠 ${escapeHtml(payerName)}</span>
        <span class="tx-amount">${yen(p.amount)}</span>
      </div>
      <div class="settle-action">
        <span class="settle-label">标记已还款</span>
        <div class="settle-btns">
          <button type="button" class="settle-method-btn" data-expense="${exp.id}" data-person="${p.personId}" data-method="cash">现金</button>
          <button type="button" class="settle-method-btn" data-expense="${exp.id}" data-person="${p.personId}" data-method="card">卡</button>
        </div>
      </div>
    </div>`;
  }).join('');

  return `
    <div class="expense-debt-card">
      <div class="expense-debt-header">
        <div class="expense-cat-dot" style="background:var(${cat.var})"></div>
        <div class="expense-debt-title">${cat.label}${exp.note ? ' · ' + escapeHtml(exp.note) : ''}</div>
      </div>
      <div class="expense-debt-meta">${exp.date} · 共 ${yen(exp.amount)} · ${escapeHtml(payerName)} 垫付</div>
      <div class="debt-items">${rows}</div>
    </div>`;
}

function wireSplitPageEvents() {
  const view = byId('view-split');
  view.querySelectorAll('.settle-method-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const exp = State.expenses.find((e) => e.id === +btn.dataset.expense);
      const participant = exp && exp.participants.find((p) => p.personId === +btn.dataset.person);
      if (!participant) return;
      participant.settled = true;
      participant.settledMethod = btn.dataset.method;
      participant.settledDate = todayStr();
      await DB.updateExpense(exp);
      await refreshData();
      toast('已标记为还款');
    });
  });
  view.querySelectorAll('.undo-debt-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const exp = State.expenses.find((e) => e.id === +btn.dataset.expense);
      const participant = exp && exp.participants.find((p) => p.personId === +btn.dataset.person);
      if (!participant) return;
      participant.settled = false;
      participant.settledMethod = null;
      participant.settledDate = null;
      await DB.updateExpense(exp);
      await refreshData();
    });
  });
}

// ---- Settings ----
function renderSettings() {
  const s = State.settings;
  const view = byId('view-settings');
  const selfOptions = activePeople().some((p) => p.id === s.selfPersonId) || !s.selfPersonId
    ? activePeople()
    : [...activePeople(), ...State.people.filter((p) => p.id === s.selfPersonId)];
  view.innerHTML = `
    <h3 class="section-title">初始金额</h3>
    <div class="form-group">
      <label>携带现金总额 (JPY)</label>
      <input type="number" id="set-cash" value="${s.initialCash}" min="0" step="1">
    </div>
    <div class="form-group">
      <label class="checkbox-label"><input type="checkbox" id="set-card-enabled" ${s.cardEnabled ? 'checked' : ''}> 追踪卡内余额</label>
      <input type="number" id="set-card" value="${s.initialCard ?? ''}" min="0" step="1" placeholder="卡内可用余额" ${s.cardEnabled ? '' : 'disabled'}>
    </div>
    <div class="form-group">
      <label>本人（我）</label>
      <select id="set-self">
        ${selfOptions.map((p) => `<option value="${p.id}" ${s.selfPersonId === p.id ? 'selected' : ''}>${escapeHtml(p.name)}${p.archived ? '（已归档）' : ''}</option>`).join('')}
      </select>
      <p class="hint-text">用来判断哪些开销和还款是你自己的现金/卡余额变化</p>
    </div>
    <button class="secondary-btn" id="save-settings-btn">保存</button>

    <h3 class="section-title">同行伙伴</h3>
    <div class="person-manage-list">
      ${activePeople().map((p) => `
        <div class="person-row">
          <input type="text" class="person-name-input" data-id="${p.id}" value="${escapeHtml(p.name)}">
          <button type="button" class="icon-btn remove-person-btn" data-id="${p.id}" aria-label="删除">✕</button>
        </div>`).join('')}
    </div>
    <button class="secondary-btn" id="add-person-btn">＋ 新增伙伴</button>

    <h3 class="section-title">数据导出</h3>
    <button class="secondary-btn" id="export-csv-btn">导出全部开销 CSV</button>
    <button class="secondary-btn" id="export-json-btn">导出 JSON 备份</button>
  `;

  byId('save-settings-btn').addEventListener('click', async () => {
    const cash = parseInt(byId('set-cash').value, 10) || 0;
    const cardEnabled = byId('set-card-enabled').checked;
    const cardVal = byId('set-card').value;
    const selfPersonId = byId('set-self').value ? +byId('set-self').value : null;
    await DB.saveSettings({
      ...State.settings,
      initialCash: cash,
      cardEnabled,
      initialCard: cardEnabled && cardVal !== '' ? parseInt(cardVal, 10) : null,
      selfPersonId,
    });
    State.settings = await DB.getSettings();
    toast('已保存');
    renderCurrentView();
  });
  byId('set-card-enabled').addEventListener('change', (e) => {
    byId('set-card').disabled = !e.target.checked;
  });

  view.querySelectorAll('.person-name-input').forEach((input) => {
    input.addEventListener('change', async () => {
      const person = State.people.find((p) => p.id === +input.dataset.id);
      if (!person) return;
      person.name = input.value.trim() || person.name;
      await DB.updatePerson(person);
      State.people = await DB.getPeople();
      toast('已更新');
    });
  });
  view.querySelectorAll('.remove-person-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = +btn.dataset.id;
      if (id === State.settings.selfPersonId) {
        toast('不能删除「本人」，请先在上面改选本人');
        return;
      }
      const referenced = State.expenses.some((e) => e.payerId === id || (e.participants || []).some((p) => p.personId === id));
      const person = State.people.find((p) => p.id === id);
      if (referenced) {
        if (!confirm(`「${person.name}」已出现在历史记录中，删除后将从新记录的选择列表中隐藏，但历史记录不受影响。确定继续？`)) return;
        person.archived = true;
        await DB.updatePerson(person);
      } else {
        await DB.deletePerson(id);
      }
      State.people = await DB.getPeople();
      renderCurrentView();
    });
  });
  byId('add-person-btn').addEventListener('click', async () => {
    const name = prompt('输入新伙伴姓名：');
    if (!name || !name.trim()) return;
    await DB.addPerson(name.trim());
    State.people = await DB.getPeople();
    renderCurrentView();
  });
  byId('export-csv-btn').addEventListener('click', exportExpensesCSV);
  byId('export-json-btn').addEventListener('click', exportJSON);
}

// ---- Expense modal ----
function openExpenseModal(id = null) {
  const modal = byId('expense-modal');
  if (id != null) {
    const e = State.expenses.find((e) => e.id === id);
    FormState.id = e.id;
    FormState.date = e.date;
    FormState.category = e.category;
    FormState.amount = String(e.amount);
    FormState.paymentMethod = e.paymentMethod;
    FormState.note = e.note || '';
    FormState.isSplit = e.isSplit;
    FormState.payerId = e.payerId ?? (activePeople()[0] && activePeople()[0].id);
    FormState.splitType = e.splitType || 'equal';
    FormState.participantIds = new Set((e.participants || []).map((p) => p.personId));
    FormState.customAmounts = new Map((e.participants || []).map((p) => [p.personId, String(p.amount)]));
    FormState.taxAmount = '';
    FormState.settledMap = new Map((e.participants || []).map((p) => [p.personId, {
      settled: !!p.settled, settledMethod: p.settledMethod || null, settledDate: p.settledDate || null,
    }]));
    FormState.photo = e.photo || null;
  } else {
    FormState.id = null;
    FormState.date = todayStr();
    FormState.category = 'food';
    FormState.amount = '';
    FormState.paymentMethod = 'cash';
    FormState.note = '';
    FormState.isSplit = false;
    FormState.payerId = State.settings.lastPayerId && State.people.some((p) => p.id === State.settings.lastPayerId)
      ? State.settings.lastPayerId
      : (State.settings.selfPersonId && State.people.some((p) => p.id === State.settings.selfPersonId)
        ? State.settings.selfPersonId
        : (activePeople()[0] && activePeople()[0].id));
    FormState.splitType = 'equal';
    FormState.participantIds = new Set(activePeople().map((p) => p.id));
    FormState.customAmounts = new Map();
    FormState.taxAmount = '';
    FormState.settledMap = new Map();
    FormState.photo = null;
  }
  renderExpenseModal();
  modal.classList.remove('hidden');
}

function closeExpenseModal() {
  byId('expense-modal').classList.add('hidden');
}

function renderExpenseModal() {
  const modal = byId('expense-modal');
  const isEdit = FormState.id != null;
  modal.innerHTML = `
    <div class="modal-sheet">
      <div class="modal-header">
        <h2>${isEdit ? '编辑开销' : '记一笔开销'}</h2>
        <button type="button" class="icon-btn" id="modal-close-btn" aria-label="关闭">✕</button>
      </div>
      <div class="modal-body">
        <div class="form-group">
          <label>日期</label>
          <input type="date" id="f-date" value="${FormState.date}">
        </div>
        <div class="form-group">
          <label>分类</label>
          <div class="pill-group" id="f-category-group">
            ${CATEGORIES.map((c) => `<button type="button" class="pill ${FormState.category === c.id ? 'selected' : ''}" data-value="${c.id}" style="--pill-color:var(${c.var})">${c.label}</button>`).join('')}
          </div>
        </div>
        <div class="form-group">
          <label>金额 (JPY)</label>
          <input type="number" id="f-amount" inputmode="numeric" min="0" step="1" placeholder="0" value="${FormState.amount}">
        </div>
        <div class="form-group">
          <label>付款方式</label>
          <div class="pill-group" id="f-payment-group">
            ${PAYMENT_METHODS.map((p) => `<button type="button" class="pill ${FormState.paymentMethod === p.id ? 'selected' : ''}" data-value="${p.id}">${p.label}</button>`).join('')}
          </div>
        </div>
        <div class="form-group">
          <label>备注</label>
          <input type="text" id="f-note" placeholder="选填，例如「熊本城门票」" value="${escapeHtml(FormState.note)}">
        </div>
        <div class="form-group">
          <label>照片（选填）</label>
          <div id="photo-picker"></div>
          <input type="file" accept="image/*" id="f-photo-input" class="visually-hidden">
        </div>
        <div class="form-group">
          <label class="checkbox-label"><input type="checkbox" id="f-split-toggle" ${FormState.isSplit ? 'checked' : ''}> 需要分账</label>
        </div>
        <div id="split-detail"></div>
      </div>
      <div class="modal-footer">
        <button type="button" class="primary-btn" id="f-save-btn">保存</button>
        ${isEdit ? '<button type="button" class="danger-btn" id="f-delete-btn">删除</button>' : ''}
      </div>
    </div>
  `;
  renderPhotoPicker();
  renderSplitDetail();
  wireExpenseModal();
}

function renderPhotoPicker() {
  const el = byId('photo-picker');
  if (!el) return;
  el.innerHTML = FormState.photo
    ? `<div class="photo-preview">
        <img src="${FormState.photo}" alt="照片" id="photo-thumb">
        <button type="button" class="remove-photo-btn" aria-label="移除照片">✕</button>
      </div>`
    : `<label class="photo-add-btn" for="f-photo-input">${icon('camera', 22)}<span>添加照片</span></label>`;
}

function renderSplitDetail() {
  const container = byId('split-detail');
  if (!FormState.isSplit) {
    container.innerHTML = '';
    return;
  }
  const people = relevantPeople();
  container.innerHTML = `
    <div class="form-group">
      <label>垫付人</label>
      <select id="f-payer">
        ${people.map((p) => `<option value="${p.id}" ${FormState.payerId === p.id ? 'selected' : ''}>${escapeHtml(p.name)}${p.archived ? '（已归档）' : ''}</option>`).join('')}
      </select>
    </div>
    <div class="form-group">
      <label>参与分摊</label>
      <div class="checkbox-grid" id="f-participants">
        ${people.map((p) => `
          <label class="checkbox-label">
            <input type="checkbox" class="participant-checkbox" value="${p.id}" ${FormState.participantIds.has(p.id) ? 'checked' : ''}>
            ${escapeHtml(p.name)}${p.archived ? '（已归档）' : ''}
          </label>`).join('')}
      </div>
    </div>
    <div class="form-group">
      <label>分摊方式</label>
      <div class="pill-group" id="f-splittype-group">
        <button type="button" class="pill ${FormState.splitType === 'equal' ? 'selected' : ''}" data-value="equal">平均分摊</button>
        <button type="button" class="pill ${FormState.splitType === 'custom' ? 'selected' : ''}" data-value="custom">按比例/自定义</button>
      </div>
    </div>
    <div id="split-shares"></div>
  `;
  renderSplitShares();
  wireSplitDetailEvents();
}

function renderSplitShares() {
  const el = byId('split-shares');
  const participantIds = [...FormState.participantIds];
  const total = parseInt(FormState.amount, 10) || 0;

  if (participantIds.length === 0) {
    el.innerHTML = `<p class="hint-text">请至少选择一位分摊人</p>`;
    return;
  }

  if (FormState.splitType === 'equal') {
    const shares = splitEqual(total, participantIds.length);
    el.innerHTML = `<div class="share-preview">${participantIds.map((id, i) => `
      <div class="share-preview-row"><span>${escapeHtml(personName(id))}</span><span>${yen(shares[i])}</span></div>`).join('')}</div>`;
  } else {
    el.innerHTML = `
      <div class="cshare-list">
        ${participantIds.map((id) => `
          <div class="cshare-row">
            <div class="cshare-name">${escapeHtml(personName(id))}</div>
            <div class="cshare-input-wrap">
              <input type="number" class="custom-share-input" data-id="${id}" min="0" step="1" placeholder="0" value="${FormState.customAmounts.get(id) ?? ''}">
              <span class="cshare-final" data-id="${id}"></span>
            </div>
          </div>`).join('')}
      </div>
      <div class="form-group tax-field">
        <label>服务费 / 税（可选，按上面各自消费金额比例分摊）</label>
        <input type="number" id="f-tax" min="0" step="1" placeholder="0" value="${FormState.taxAmount}">
      </div>
      <p class="hint-text" id="share-diff-text"></p>
    `;
    updateShareComputation();
  }
}

function updateShareComputation() {
  const diffEl = byId('share-diff-text');
  if (!diffEl) return;
  const total = parseInt(FormState.amount, 10) || 0;
  const participantIds = [...FormState.participantIds];
  const bases = participantIds.map((id) => parseInt(FormState.customAmounts.get(id), 10) || 0);
  const tax = parseInt(FormState.taxAmount, 10) || 0;
  const baseSum = bases.reduce((a, b) => a + b, 0);
  const finalShares = tax > 0 ? splitProportional(bases, tax) : bases;

  participantIds.forEach((id, i) => {
    const span = document.querySelector(`.cshare-final[data-id="${id}"]`);
    if (span) span.textContent = tax > 0 ? `= ${yen(finalShares[i])}` : '';
  });

  const sum = baseSum + tax;
  const diff = total - sum;
  diffEl.textContent = diff === 0 ? `合计 ${yen(sum)}，与总额一致 ✓` : `合计 ${yen(sum)}，与总额相差 ${yen(diff)}`;
  diffEl.classList.toggle('error-text', diff !== 0);
}

function wireSplitDetailEvents() {
  byId('f-payer').addEventListener('change', (e) => { FormState.payerId = +e.target.value; });

  byId('f-participants').addEventListener('change', (e) => {
    if (!e.target.classList.contains('participant-checkbox')) return;
    const id = +e.target.value;
    if (e.target.checked) FormState.participantIds.add(id);
    else FormState.participantIds.delete(id);
    renderSplitShares();
  });

  byId('f-splittype-group').querySelectorAll('.pill').forEach((btn) => {
    btn.addEventListener('click', () => {
      FormState.splitType = btn.dataset.value;
      byId('f-splittype-group').querySelectorAll('.pill').forEach((b) => b.classList.toggle('selected', b === btn));
      renderSplitShares();
    });
  });

  const sharesEl = byId('split-shares');
  sharesEl.addEventListener('input', (e) => {
    if (e.target.classList.contains('custom-share-input')) {
      FormState.customAmounts.set(+e.target.dataset.id, e.target.value);
      updateShareComputation();
    } else if (e.target.id === 'f-tax') {
      FormState.taxAmount = e.target.value;
      updateShareComputation();
    }
  });
}

function wireExpenseModal() {
  byId('modal-close-btn').addEventListener('click', closeExpenseModal);
  byId('f-date').addEventListener('change', (e) => { FormState.date = e.target.value; });
  byId('f-note').addEventListener('input', (e) => { FormState.note = e.target.value; });
  byId('f-amount').addEventListener('input', (e) => {
    FormState.amount = e.target.value;
    if (FormState.isSplit) renderSplitShares();
  });

  byId('f-category-group').querySelectorAll('.pill').forEach((btn) => {
    btn.addEventListener('click', () => {
      FormState.category = btn.dataset.value;
      byId('f-category-group').querySelectorAll('.pill').forEach((b) => b.classList.toggle('selected', b === btn));
    });
  });
  byId('f-payment-group').querySelectorAll('.pill').forEach((btn) => {
    btn.addEventListener('click', () => {
      FormState.paymentMethod = btn.dataset.value;
      byId('f-payment-group').querySelectorAll('.pill').forEach((b) => b.classList.toggle('selected', b === btn));
    });
  });

  byId('f-split-toggle').addEventListener('change', (e) => {
    FormState.isSplit = e.target.checked;
    if (FormState.isSplit && FormState.participantIds.size === 0) {
      FormState.participantIds = new Set(activePeople().map((p) => p.id));
    }
    renderSplitDetail();
  });

  byId('f-photo-input').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      FormState.photo = await compressImage(file);
    } catch (err) {
      toast('照片处理失败，请重试');
      return;
    }
    renderPhotoPicker();
  });
  byId('photo-picker').addEventListener('click', (e) => {
    if (e.target.closest('.remove-photo-btn')) {
      FormState.photo = null;
      renderPhotoPicker();
    } else if (e.target.id === 'photo-thumb') {
      openPhotoViewer(FormState.photo);
    }
  });

  byId('f-save-btn').addEventListener('click', saveExpenseFromForm);
  const delBtn = byId('f-delete-btn');
  if (delBtn) delBtn.addEventListener('click', deleteExpenseFromForm);
}

async function saveExpenseFromForm() {
  const amount = parseInt(FormState.amount, 10);
  if (!FormState.date) { toast('请选择日期'); return; }
  if (!amount || amount <= 0) { toast('请输入有效金额'); return; }

  let participants = [];
  if (FormState.isSplit) {
    const ids = [...FormState.participantIds];
    if (ids.length === 0) { toast('请至少选择一位分摊人'); return; }
    if (!FormState.payerId) { toast('请选择垫付人'); return; }
    const withSettleInfo = (id, amount) => {
      const prev = FormState.settledMap.get(id) || {};
      return { personId: id, amount, settled: !!prev.settled, settledMethod: prev.settledMethod || null, settledDate: prev.settledDate || null };
    };
    if (FormState.splitType === 'equal') {
      const shares = splitEqual(amount, ids.length);
      participants = ids.map((id, i) => withSettleInfo(id, shares[i]));
    } else {
      const bases = ids.map((id) => parseInt(FormState.customAmounts.get(id), 10) || 0);
      const tax = parseInt(FormState.taxAmount, 10) || 0;
      const baseSum = bases.reduce((a, b) => a + b, 0);
      if (baseSum + tax !== amount) { toast('各人消费金额之和加上服务费/税须等于总金额'); return; }
      const finalShares = tax > 0 ? splitProportional(bases, tax) : bases;
      participants = ids.map((id, i) => withSettleInfo(id, finalShares[i]));
    }
  }

  const expense = {
    date: FormState.date,
    category: FormState.category,
    amount,
    paymentMethod: FormState.paymentMethod,
    note: FormState.note.trim(),
    isSplit: FormState.isSplit,
    payerId: FormState.isSplit ? FormState.payerId : null,
    splitType: FormState.isSplit ? FormState.splitType : null,
    participants,
    photo: FormState.photo || null,
  };

  if (FormState.id != null) {
    expense.id = FormState.id;
    await DB.updateExpense(expense);
  } else {
    await DB.addExpense(expense);
  }
  if (FormState.isSplit && FormState.payerId) {
    await DB.saveSettings({ ...State.settings, lastPayerId: FormState.payerId });
    State.settings = await DB.getSettings();
  }
  closeExpenseModal();
  await refreshData();
  toast('已保存');
}

async function deleteExpenseFromForm() {
  if (!confirm('确定删除这笔记录？')) return;
  await DB.deleteExpense(FormState.id);
  closeExpenseModal();
  await refreshData();
  toast('已删除');
}

// ---- CSV / JSON export ----
function downloadFile(filename, content, mime) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function csvEscape(v) {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

function exportExpensesCSV() {
  const header = ['日期', '分类', '金额', '付款方式', '备注', '是否分账', '参与分账人员', '各自分摊金额', '各自还款状态', '垫付人', '是否有照片'];
  const rows = [header];
  const sorted = [...State.expenses].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.id - b.id));
  for (const e of sorted) {
    const cat = CATEGORY_MAP[e.category]?.label || e.category;
    const pm = PAYMENT_METHODS.find((p) => p.id === e.paymentMethod)?.label || e.paymentMethod;
    const names = (e.participants || []).map((p) => personName(p.personId)).join('/');
    const amounts = (e.participants || []).map((p) => p.amount).join('/');
    const status = (e.participants || []).map((p) => {
      if (p.personId === e.payerId) return '本人垫付';
      return p.settled ? `已还(${p.settledMethod === 'card' ? '卡' : '现金'})` : '未还';
    }).join('/');
    const payer = e.payerId ? personName(e.payerId) : '';
    rows.push([e.date, cat, e.amount, pm, e.note || '', e.isSplit ? '是' : '否', names, amounts, status, payer, e.photo ? '是' : '否']);
  }
  const csv = rows.map((r) => r.map(csvEscape).join(',')).join('\r\n');
  downloadFile(`九州旅行开销_${todayStr()}.csv`, '﻿' + csv, 'text/csv;charset=utf-8');
}

function exportSplitCSV(balances) {
  const rows = [['日期', '类型', '说明', '金额', '状态']];
  for (const [id, v] of balances.entries()) {
    if (Math.abs(v) <= 0.5) continue;
    rows.push(['', '净额', personName(id), v > 0 ? `应收 ${v}` : `应付 ${-v}`, '']);
  }
  for (const exp of State.expenses) {
    if (!exp.isSplit) continue;
    const payerName = personName(exp.payerId);
    for (const p of exp.participants) {
      if (p.personId === exp.payerId) continue;
      const status = p.settled ? `已还(${p.settledMethod === 'card' ? '卡' : '现金'})` : '未还';
      rows.push([exp.date, '分账明细', `${personName(p.personId)} 欠 ${payerName}（${exp.note || CATEGORY_MAP[exp.category].label}）`, p.amount, status]);
    }
  }
  const csv = rows.map((r) => r.map(csvEscape).join(',')).join('\r\n');
  downloadFile(`九州旅行分账总结_${todayStr()}.csv`, '﻿' + csv, 'text/csv;charset=utf-8');
}

function exportJSON() {
  const data = { settings: State.settings, people: State.people, expenses: State.expenses, exportedAt: new Date().toISOString() };
  downloadFile(`九州旅行开销备份_${todayStr()}.json`, JSON.stringify(data, null, 2), 'application/json');
}

// ---- Global events ----
function wireGlobalEvents() {
  wireOnboarding();
  document.querySelectorAll('.bottom-nav button').forEach((btn) => {
    btn.addEventListener('click', () => navigate(btn.dataset.view));
  });
  byId('fab-add').addEventListener('click', () => openExpenseModal());
  byId('expense-modal').addEventListener('click', (e) => {
    if (e.target.id === 'expense-modal') closeExpenseModal();
  });
  byId('photo-viewer').addEventListener('click', closePhotoViewer);
}

function openPhotoViewer(src) {
  const el = byId('photo-viewer');
  el.innerHTML = `<img src="${src}" alt="照片">`;
  el.classList.remove('hidden');
}
function closePhotoViewer() {
  byId('photo-viewer').classList.add('hidden');
}

document.addEventListener('DOMContentLoaded', init);
