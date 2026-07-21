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
const PAYMENT_METHOD_LABELS = { cash: '现金', card: '卡' };
const TRANSIT_MODES = ['巴士', '地铁', '新干线', '电车', '脚踏车', '渡轮', '其它'];
const TRANSIT_USAGE_LABELS = { card: '交通卡扣款', pass: '套票' };

// ---- Line icons (stroke=currentColor so they follow text/theme color automatically) ----
const ICON_PATHS = {
  wallet: '<path d="M3 7a2 2 0 0 1 2-2h13a1 1 0 0 1 1 1v3"/><path d="M3 7v11a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-8a2 2 0 0 0-2-2H5"/><circle cx="16.5" cy="14" r="1.4"/>',
  card: '<rect x="3" y="6" width="18" height="13" rx="2"/><line x1="3" y1="10.5" x2="21" y2="10.5"/><line x1="6" y1="15" x2="10" y2="15"/>',
  users: '<circle cx="9" cy="8" r="3"/><path d="M3.5 19c0-3 2.5-5 5.5-5s5.5 2 5.5 5"/><circle cx="17" cy="9" r="2.3"/><path d="M14.5 12.2c2.6.3 4.5 2.1 4.8 4.8"/>',
  camera: '<path d="M4 8a2 2 0 0 1 2-2h1.2l.9-1.5a1 1 0 0 1 .86-.5h6.08a1 1 0 0 1 .86.5L16.8 6H18a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8Z"/><circle cx="12" cy="13" r="3.2"/>',
  bus: '<rect x="4" y="5" width="16" height="11" rx="2"/><line x1="4" y1="11" x2="20" y2="11"/><circle cx="8" cy="18" r="1.6"/><circle cx="16" cy="18" r="1.6"/>',
};
function icon(name, size = 18) {
  return `<svg class="icon" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ICON_PATHS[name]}</svg>`;
}
// Icon inside a soft-tinted colored circle — used for stat-card labels so each
// metric reads as its own "badge" instead of a plain inline glyph.
function iconBadge(name, colorVar = '--accent', size = 34) {
  const iconSize = Math.round(size * 0.53);
  return `<span class="icon-badge" style="--badge-color:var(${colorVar});width:${size}px;height:${size}px;">${icon(name, iconSize)}</span>`;
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
  transitSubtype: null, // null | 'topup' | 'pass' | 'single' — only meaningful when category === 'transport'
  transitFrom: '',
  transitTo: '',
  transitMode: '',
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
  const titles = { overview: '主页', expenses: '记录', transit: '交通卡', split: '分账', settings: '设置' };
  if (view !== 'overview') byId('page-title').textContent = titles[view] || '';
  renderCurrentView();
}

function renderCurrentView() {
  if (State.activeView === 'overview') renderOverview();
  else if (State.activeView === 'expenses') renderExpensesList();
  else if (State.activeView === 'transit') renderTransit();
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
      <div class="bar-fill" style="width:${width}%;background:${over ? 'var(--bad)' : 'var(--bar-fill-color, var(--accent))'}"></div>
    </div>
    <div class="stat-pct ${over ? 'negative' : ''}">已用 ${pct}%</div>
  `;
}

function progressRingHtml(pct, size = 72, stroke = 8) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const clamped = Math.min(100, Math.max(0, pct));
  const offset = c * (1 - clamped / 100);
  const over = pct > 100;
  return `
    <div class="progress-ring" style="width:${size}px;height:${size}px;">
      <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
        <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="var(--gridline)" stroke-width="${stroke}"/>
        <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${over ? 'var(--bad)' : 'var(--accent)'}" stroke-width="${stroke}" stroke-linecap="round" stroke-dasharray="${c}" stroke-dashoffset="${offset}" transform="rotate(-90 ${size / 2} ${size / 2})"/>
      </svg>
      <div class="progress-ring-label ${over ? 'negative' : ''}">${pct}%</div>
    </div>
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
  // A transit-card top-up just moves money from cash/card into the card balance —
  // it isn't real consumption, so it must not also count as 交通 spend (that
  // would double-count once here and again when the loaded value is actually spent).
  if (e.transitSubtype === 'topup') return 0;
  // Same logic for a leg covered by an already-bought pass: the real cost was
  // already counted once when the pass itself was purchased.
  if (e.transitSubtype === 'single' && e.transitUsage === 'pass') return 0;
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
  // Further split by the *original* payment method of the underlying expense,
  // so "分账收回" can show separately whether the cash/card that moved was
  // tied to a cash-fronted or card-fronted expense.
  const cashByOrigin = { cash: 0, card: 0 };
  const cardByOrigin = { cash: 0, card: 0 };
  if (!selfId) return { cash, card, cashByOrigin, cardByOrigin };
  for (const exp of State.expenses) {
    if (!exp.isSplit || !Array.isArray(exp.participants)) continue;
    for (const p of exp.participants) {
      if (!p.settled || p.personId === exp.payerId) continue;
      const sign = exp.payerId === selfId ? 1 : p.personId === selfId ? -1 : 0;
      if (sign === 0) continue;
      const amt = sign * p.amount;
      const origin = exp.paymentMethod === 'card' ? 'card' : 'cash';
      if (p.settledMethod === 'card') { card += amt; cardByOrigin[origin] += amt; }
      else { cash += amt; cashByOrigin[origin] += amt; }
    }
  }
  return { cash, card, cashByOrigin, cardByOrigin };
}

function renderOverview() {
  const s = State.settings;
  byId('page-title').textContent = s.selfPersonId ? `Hello, ${personName(s.selfPersonId)}` : '主页';
  const flows = settlementFlows();
  const cashSpent = State.expenses.filter((e) => e.paymentMethod === 'cash' && isMyExpense(e)).reduce((a, e) => a + e.amount, 0);
  const cardSpent = State.expenses.filter((e) => e.paymentMethod === 'card' && isMyExpense(e)).reduce((a, e) => a + e.amount, 0);
  const cashLeft = s.initialCash - cashSpent + flows.cash;
  const myTotalSpend = State.expenses.reduce((a, e) => a + myShare(e), 0);
  const totalBudget = s.initialCash + ((s.cardEnabled && s.initialCard != null) ? s.initialCard : 0);
  const budgetPct = totalBudget > 0 ? Math.round(((cashSpent + cardSpent) / totalBudget) * 100) : 0;

  const flowLine = (flow, label) => flow !== 0
    ? `<div class="stat-sub flow-line ${flow > 0 ? 'positive' : 'negative'}">${label}${flow > 0 ? '收回' : '付出'} ${signedYen(flow)}</div>`
    : '';
  // Renders one sub-line per origin (cash-fronted / card-fronted expense) instead
  // of collapsing them into a single total, so it's clear which underlying
  // expense a given cash/card movement came from.
  const flowLinesByOrigin = (byOrigin) => {
    const parts = [];
    if (byOrigin.cash !== 0) parts.push(flowLine(byOrigin.cash, '现金垫付'));
    if (byOrigin.card !== 0) parts.push(flowLine(byOrigin.card, '卡垫付'));
    return parts.join('');
  };
  // Two-column version (label on top, amount below) used under 剩余现金 —
  // always shows both columns (¥0 if no flow) so the layout stays stable.
  const flowColumnsHtml = (byOrigin, labelCash, labelCard) => {
    const col = (flow, label) => {
      const cls = flow > 0 ? 'positive' : flow < 0 ? 'negative' : 'muted';
      return `
        <div class="flow-col">
          <div class="flow-col-label">${label}</div>
          <div class="flow-col-value ${cls}">${flow === 0 ? yen(0) : signedYen(flow)}</div>
        </div>`;
    };
    return `<div class="flow-columns">${col(byOrigin.cash, labelCash)}${col(byOrigin.card, labelCard)}</div>`;
  };

  let cardHtml;
  if (s.cardEnabled && s.initialCard != null) {
    const cardLeft = s.initialCard - cardSpent + flows.card;
    cardHtml = `<div class="stat-value ${cardLeft < 0 ? 'negative' : ''}">${yen(cardLeft)}</div>
      <div class="stat-sub">已花费 ${yen(cardSpent)} / 初始 ${yen(s.initialCard)}</div>
      ${budgetBarHtml(cardSpent, s.initialCard)}
      ${flowLinesByOrigin(flows.cardByOrigin)}`;
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
      <div class="stat-label">${iconBadge('users', '--series-5')} 分账未结</div>
      <div class="balance-list">${debtRows}</div>
    </div>` : '';

  byId('view-overview').innerHTML = `
    <div class="stat-card card-accent">
      <div class="stat-label stat-label-spread"><span>剩余现金</span>${iconBadge('wallet', undefined, 53)}</div>
      <div class="stat-value ${cashLeft < 0 ? 'negative' : ''}">${yen(cashLeft)}</div>
      <div class="stat-sub">已花费 ${yen(cashSpent)} / 初始 ${yen(s.initialCash)}</div>
      ${budgetBarHtml(cashSpent, s.initialCash)}
    </div>
    ${flowColumnsHtml(flows.cashByOrigin, '回收-现金', '回收-卡')}
    <div class="stat-card card-dark">
      <div class="stat-label stat-label-spread"><span>卡内余额</span>${iconBadge('card', undefined, 53)}</div>
      ${cardHtml}
    </div>
    <div class="stat-card total-card hero-card">
      <div class="hero-top">
        <div class="hero-top-text">
          <div class="stat-label">我的个人花费</div>
          <div class="stat-value">${yen(myTotalSpend)}</div>
          <div class="stat-sub">共 ${State.expenses.length} 笔记录${s.selfPersonId ? '（不含代垫他人的部分）' : ''}</div>
        </div>
        ${totalBudget > 0 ? progressRingHtml(budgetPct) : ''}
      </div>
      ${renderCategoryBreakdownHtml()}
    </div>
    ${debtCardHtml}
  `;
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
  const pmLabel = PAYMENT_METHOD_LABELS[e.paymentMethod] || e.paymentMethod;
  const mine = e.isSplit ? myShare(e) : null;
  return `
    <div class="expense-row" data-id="${e.id}">
      <div class="expense-cat-dot" style="background:var(${cat.var})"></div>
      <div class="expense-main">
        <div class="expense-top">
          <span class="expense-cat">${cat.label}</span>
          <span class="expense-amount">${yen(e.amount)}</span>
        </div>
        <div class="expense-sub">
          <span class="expense-sub-left">
            <span>${e.date}</span>
            <span>${pmLabel}</span>
            ${e.note ? `<span class="expense-note">${escapeHtml(e.note)}</span>` : ''}
            ${e.isSplit ? '<span class="split-badge">分账</span>' : ''}
            ${e.photo ? `<span class="expense-photo-badge">${icon('camera', 13)}</span>` : ''}
          </span>
          ${mine != null ? `<span class="expense-my-share">我的份 ${yen(mine)}</span>` : ''}
        </div>
      </div>
    </div>`;
}

// ---- Category breakdown (shown inline on Overview, under 我的个人花费) ----
function renderCategoryBreakdownHtml() {
  const totals = new Map();
  for (const e of State.expenses) {
    totals.set(e.category, (totals.get(e.category) || 0) + myShare(e));
  }
  const grandTotal = [...totals.values()].reduce((a, b) => a + b, 0);
  const rows = CATEGORIES
    .map((c) => ({ ...c, amount: totals.get(c.id) || 0 }))
    .sort((a, b) => b.amount - a.amount);

  return `
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
    </div>`;
}

// ---- Transit card (交通卡). 充值/购买套票 are real cash/card spending, entered
// through the normal "记一笔开销" flow and just listed here for reference. Each
// individual leg (from/to/mode) is logged directly on this tab instead — using
// an already-topped-up card or an already-bought pass isn't a new payment, so
// there's no cash/card method to pick, just which "pocket" it drew from. ----
function computeTransitBalances() {
  const total = State.expenses.filter((e) => e.transitSubtype === 'topup' && isMyExpense(e)).reduce((a, e) => a + e.amount, 0);
  const spent = State.expenses.filter((e) => e.transitSubtype === 'single' && e.transitUsage === 'card').reduce((a, e) => a + e.amount, 0);
  return { total, spent, left: total - spent };
}

const LegForm = { show: false, id: null, date: '', from: '', to: '', mode: '', amount: '', usage: 'card', paymentMethod: 'cash' };

function resetLegForm() {
  LegForm.show = false;
  LegForm.id = null;
  LegForm.date = todayStr();
  LegForm.from = '';
  LegForm.to = '';
  LegForm.mode = '';
  LegForm.amount = '';
  LegForm.usage = 'card';
  LegForm.paymentMethod = 'cash';
}

function openLegEditor(id) {
  const leg = State.expenses.find((e) => e.id === id);
  if (!leg) return;
  LegForm.id = leg.id;
  LegForm.date = leg.date;
  LegForm.from = leg.from || '';
  LegForm.to = leg.to || '';
  LegForm.mode = leg.transitMode || '';
  LegForm.amount = leg.amount ? String(leg.amount) : '';
  LegForm.usage = leg.transitUsage || 'single';
  LegForm.paymentMethod = leg.paymentMethod || 'cash';
  LegForm.show = true;
  renderTransit();
}

function renderTransit() {
  const view = byId('view-transit');
  const { total, spent, left } = computeTransitBalances();

  const topups = State.expenses.filter((e) => e.transitSubtype === 'topup').sort(sortByDateDesc);
  const passes = State.expenses.filter((e) => e.transitSubtype === 'pass').sort(sortByDateDesc);
  const legs = State.expenses.filter((e) => e.transitSubtype === 'single').sort(sortByDateDesc);

  const groups = [];
  const groupIndex = new Map();
  for (const leg of legs) {
    if (!groupIndex.has(leg.date)) {
      const g = { date: leg.date, legs: [] };
      groupIndex.set(leg.date, g);
      groups.push(g);
    }
    groupIndex.get(leg.date).legs.push(leg);
  }

  const listRow = (e, extra) => `
    <div class="balance-row record-row" data-id="${e.id}">
      <span><strong>${e.date}</strong>${extra ? ' · ' + escapeHtml(extra) : ''}</span>
      <span>${yen(e.amount)}</span>
    </div>`;
  const topupRows = topups.map((e) => listRow(e, PAYMENT_METHOD_LABELS[e.paymentMethod])).join('');
  const passRows = passes.map((e) => listRow(e, e.note)).join('');
  // Every leg falls into exactly one of three usage categories — color-coded
  // so the type is visible at a glance in the day-grouped list below.
  const legUsageInfo = (leg) => leg.transitUsage === 'card'
    ? { label: '交通卡扣款', cls: 'card' }
    : leg.transitUsage === 'pass'
      ? { label: '套票', cls: 'pass' }
      : { label: '单程票', cls: 'single' };

  const dayGroupsHtml = groups.length === 0
    ? '<p class="empty-hint">还没有交通记录</p>'
    : groups.map((g) => {
      const dayTotal = g.legs.reduce((a, leg) => a + leg.amount, 0);
      return `
        <div class="expense-debt-card">
          <div class="expense-debt-header"><div class="expense-debt-title">${g.date}</div></div>
          <div class="expense-debt-meta no-indent">当日交通花费 ${yen(dayTotal)}</div>
          <div class="debt-items">
            ${g.legs.map((leg) => {
              const usage = legUsageInfo(leg);
              return `
              <div class="debt-item leg-row" data-id="${leg.id}" data-dedicated="${leg.transitUsage ? '1' : '0'}">
                <div class="debt-item-row">
                  <span class="tx-text">${escapeHtml(leg.transitMode)}　${escapeHtml(leg.from || '')} → ${escapeHtml(leg.to || '')}</span>
                  <span class="tx-amount">${leg.amount > 0 ? yen(leg.amount) : '—'}</span>
                </div>
                <div class="leg-usage-label leg-usage-${usage.cls}">${usage.label}</div>
              </div>`;
            }).join('')}
          </div>
        </div>`;
    }).join('');

  view.innerHTML = `
    <div class="stat-card card-accent">
      <div class="stat-label stat-label-spread"><span>交通卡余额</span>${iconBadge('bus', undefined, 53)}</div>
      <div class="stat-value ${left < 0 ? 'negative' : ''}">${yen(left)}</div>
      <div class="stat-sub">已使用 ${yen(spent)} / 已加值 ${yen(total)}</div>
      ${total > 0 ? budgetBarHtml(spent, total) : ''}
    </div>

    ${topupRows ? `<h3 class="section-title">充值记录</h3><div class="balance-list">${topupRows}</div>` : ''}
    ${passRows ? `<h3 class="section-title">套票购买记录</h3><div class="balance-list">${passRows}</div>` : ''}

    <h3 class="section-title">交通记录</h3>
    <button type="button" class="primary-btn" id="show-leg-form-btn" style="margin-bottom:16px;">${LegForm.show ? '取消' : '＋ 记录一段交通'}</button>
    ${LegForm.show ? `
      <div class="stat-card" style="margin-top:12px;">
        <div class="form-group">
          <label>日期</label>
          <input type="date" id="leg-date" value="${LegForm.date}">
        </div>
        <div class="form-group">
          <label>出发地</label>
          <input type="text" id="leg-from" placeholder="例如「住宿」" value="${escapeHtml(LegForm.from)}">
        </div>
        <div class="form-group">
          <label>目的地</label>
          <input type="text" id="leg-to" placeholder="例如「熊本站」" value="${escapeHtml(LegForm.to)}">
        </div>
        <div class="form-group">
          <label>交通工具</label>
          <div class="pill-group" id="leg-mode-group">
            ${TRANSIT_MODES.map((m) => `<button type="button" class="pill ${LegForm.mode === m ? 'selected' : ''}" data-value="${m}">${m}</button>`).join('')}
          </div>
        </div>
        <div class="form-group">
          <label>使用方式</label>
          <div class="pill-group" id="leg-usage-group">
            <button type="button" class="pill ${LegForm.usage === 'card' ? 'selected' : ''}" data-value="card">交通卡扣款</button>
            <button type="button" class="pill ${LegForm.usage === 'single' ? 'selected' : ''}" data-value="single">单程票</button>
            <button type="button" class="pill ${LegForm.usage === 'pass' ? 'selected' : ''}" data-value="pass">套票</button>
          </div>
        </div>
        ${LegForm.usage === 'single' ? `
          <div class="form-group">
            <label>付款方式</label>
            <div class="pill-group" id="leg-payment-group">
              ${PAYMENT_METHODS.map((m) => `<button type="button" class="pill ${LegForm.paymentMethod === m.id ? 'selected' : ''}" data-value="${m.id}">${m.label}</button>`).join('')}
            </div>
          </div>
        ` : ''}
        <div class="form-group">
          <label>金额 (JPY)${LegForm.usage === 'pass' ? '（选填，套票不扣任何余额）' : ''}</label>
          <input type="number" id="leg-amount" min="0" step="1" placeholder="0" value="${LegForm.amount}">
        </div>
        <button type="button" class="primary-btn" id="save-leg-btn">${LegForm.id ? '保存修改' : '保存这一段'}</button>
        ${LegForm.id ? '<button type="button" class="danger-btn" id="delete-leg-btn">删除</button>' : ''}
      </div>
    ` : ''}

    <div class="debt-expense-list">${dayGroupsHtml}</div>
  `;

  wireTransitEvents();
}

function wireTransitEvents() {
  const view = byId('view-transit');

  view.querySelectorAll('.record-row').forEach((el) => {
    el.addEventListener('click', () => openExpenseModal(+el.dataset.id));
  });
  view.querySelectorAll('.leg-row').forEach((el) => {
    el.addEventListener('click', () => {
      if (el.dataset.dedicated === '1') openLegEditor(+el.dataset.id);
      else openExpenseModal(+el.dataset.id);
    });
  });

  const showBtn = byId('show-leg-form-btn');
  if (showBtn) {
    showBtn.addEventListener('click', () => {
      const wasShown = LegForm.show;
      resetLegForm();
      LegForm.show = !wasShown;
      renderTransit();
    });
  }

  const dateInput = byId('leg-date');
  if (dateInput) dateInput.addEventListener('change', (e) => { LegForm.date = e.target.value; });
  const fromInput = byId('leg-from');
  if (fromInput) fromInput.addEventListener('input', (e) => { LegForm.from = e.target.value; });
  const toInput = byId('leg-to');
  if (toInput) toInput.addEventListener('input', (e) => { LegForm.to = e.target.value; });
  const amountInput = byId('leg-amount');
  if (amountInput) amountInput.addEventListener('input', (e) => { LegForm.amount = e.target.value; });

  const modeGroup = byId('leg-mode-group');
  if (modeGroup) {
    modeGroup.querySelectorAll('.pill').forEach((btn) => {
      btn.addEventListener('click', () => {
        LegForm.mode = btn.dataset.value;
        modeGroup.querySelectorAll('.pill').forEach((b) => b.classList.toggle('selected', b === btn));
      });
    });
  }
  const usageGroup = byId('leg-usage-group');
  if (usageGroup) {
    usageGroup.querySelectorAll('.pill').forEach((btn) => {
      btn.addEventListener('click', () => {
        LegForm.usage = btn.dataset.value;
        renderTransit();
      });
    });
  }
  const paymentGroup = byId('leg-payment-group');
  if (paymentGroup) {
    paymentGroup.querySelectorAll('.pill').forEach((btn) => {
      btn.addEventListener('click', () => {
        LegForm.paymentMethod = btn.dataset.value;
        paymentGroup.querySelectorAll('.pill').forEach((b) => b.classList.toggle('selected', b === btn));
      });
    });
  }

  const saveBtn = byId('save-leg-btn');
  if (saveBtn) saveBtn.addEventListener('click', saveLeg);
  const deleteBtn = byId('delete-leg-btn');
  if (deleteBtn) deleteBtn.addEventListener('click', deleteLeg);
}

async function saveLeg() {
  if (!LegForm.date) { toast('请选择日期'); return; }
  if (!LegForm.mode) { toast('请选择交通工具'); return; }
  const amount = parseInt(LegForm.amount, 10) || 0;
  if ((LegForm.usage === 'card' || LegForm.usage === 'single') && amount <= 0) { toast('请输入金额'); return; }

  const expense = {
    date: LegForm.date,
    category: 'transport',
    amount,
    paymentMethod: LegForm.usage === 'single' ? LegForm.paymentMethod : null,
    note: '',
    isSplit: false,
    payerId: null,
    splitType: null,
    participants: [],
    photo: null,
    transitSubtype: 'single',
    from: LegForm.from.trim(),
    to: LegForm.to.trim(),
    transitMode: LegForm.mode,
    transitUsage: LegForm.usage === 'single' ? null : LegForm.usage,
  };

  if (LegForm.id != null) {
    expense.id = LegForm.id;
    await DB.updateExpense(expense);
  } else {
    await DB.addExpense(expense);
  }
  resetLegForm();
  await refreshData();
  toast('已保存');
}

async function deleteLeg() {
  if (!LegForm.id) return;
  if (!confirm('确定删除这段交通记录？')) return;
  await DB.deleteExpense(LegForm.id);
  resetLegForm();
  await refreshData();
  toast('已删除');
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
        <span class="settle-label">还款方式</span>
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
    FormState.transitSubtype = e.transitSubtype || null;
    FormState.transitFrom = e.from || '';
    FormState.transitTo = e.to || '';
    FormState.transitMode = e.transitMode || '';
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
    FormState.transitSubtype = null;
    FormState.transitFrom = '';
    FormState.transitTo = '';
    FormState.transitMode = '';
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
            ${CATEGORIES.map((c) => `<button type="button" class="pill ${FormState.category === c.id ? 'selected' : ''}" data-value="${c.id}" style="--pill-color:var(${c.var});--pill-ink:#fff">${c.label}</button>`).join('')}
          </div>
        </div>
        <div id="transport-extra"></div>
        <div class="form-group">
          <label>金额 (JPY)</label>
          <input type="number" id="f-amount" inputmode="numeric" min="0" step="1" placeholder="0" value="${FormState.amount}">
        </div>
        <div class="form-group">
          <label>付款方式</label>
          <div class="pill-group" id="f-payment-group"></div>
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
  renderTransportExtra();
  renderPaymentGroup();
  renderSplitDetail();
  wireExpenseModal();
}

function renderTransportExtra() {
  const el = byId('transport-extra');
  if (!el) return;
  if (FormState.category !== 'transport') { el.innerHTML = ''; return; }
  el.innerHTML = `
    <div class="form-group">
      <label>交通类型</label>
      <div class="pill-group" id="f-transit-subtype-group">
        <button type="button" class="pill ${FormState.transitSubtype === 'topup' ? 'selected' : ''}" data-value="topup">交通卡充值</button>
        <button type="button" class="pill ${FormState.transitSubtype === 'pass' ? 'selected' : ''}" data-value="pass">套票</button>
        <button type="button" class="pill ${FormState.transitSubtype === 'single' ? 'selected' : ''}" data-value="single">单程票</button>
      </div>
      ${FormState.transitSubtype === 'single'
        ? '<p class="hint-text">用交通卡余额或套票支付的行程，去导航栏「交通卡」记录</p>'
        : '<p class="hint-text">每一段具体交通（几点从哪到哪）在下面导航栏「交通卡」里记录</p>'}
    </div>
    ${FormState.transitSubtype === 'single' ? `
      <div class="form-group">
        <label>出发地（选填）</label>
        <input type="text" id="f-transit-from" placeholder="例如「住宿」" value="${escapeHtml(FormState.transitFrom)}">
      </div>
      <div class="form-group">
        <label>目的地（选填）</label>
        <input type="text" id="f-transit-to" placeholder="例如「熊本站」" value="${escapeHtml(FormState.transitTo)}">
      </div>
      <div class="form-group">
        <label>交通工具</label>
        <div class="pill-group" id="f-transit-mode-group">
          ${TRANSIT_MODES.map((m) => `<button type="button" class="pill ${FormState.transitMode === m ? 'selected' : ''}" data-value="${m}">${m}</button>`).join('')}
        </div>
      </div>
    ` : ''}
  `;
  const subtypeGroup = byId('f-transit-subtype-group');
  subtypeGroup.querySelectorAll('.pill').forEach((btn) => {
    btn.addEventListener('click', () => {
      FormState.transitSubtype = btn.dataset.value;
      renderTransportExtra();
    });
  });
  const fromInput = byId('f-transit-from');
  if (fromInput) fromInput.addEventListener('input', (e) => { FormState.transitFrom = e.target.value; });
  const toInput = byId('f-transit-to');
  if (toInput) toInput.addEventListener('input', (e) => { FormState.transitTo = e.target.value; });
  const modeGroup = byId('f-transit-mode-group');
  if (modeGroup) {
    modeGroup.querySelectorAll('.pill').forEach((btn) => {
      btn.addEventListener('click', () => {
        FormState.transitMode = btn.dataset.value;
        modeGroup.querySelectorAll('.pill').forEach((b) => b.classList.toggle('selected', b === btn));
      });
    });
  }
}

function renderPaymentGroup() {
  const el = byId('f-payment-group');
  if (!el) return;
  el.innerHTML = PAYMENT_METHODS.map((p) => `<button type="button" class="pill ${FormState.paymentMethod === p.id ? 'selected' : ''}" data-value="${p.id}">${p.label}</button>`).join('');
  el.querySelectorAll('.pill').forEach((btn) => {
    btn.addEventListener('click', () => {
      FormState.paymentMethod = btn.dataset.value;
      el.querySelectorAll('.pill').forEach((b) => b.classList.toggle('selected', b === btn));
    });
  });
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
      if (FormState.category !== 'transport') {
        FormState.transitSubtype = null;
      } else if (!FormState.transitSubtype) {
        FormState.transitSubtype = 'topup';
      }
      renderTransportExtra();
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
  if (!FormState.date) { toast('请选择日期'); return; }
  const amount = parseInt(FormState.amount, 10);
  if (!amount || amount <= 0) { toast('请输入有效金额'); return; }
  const isSingleTicket = FormState.category === 'transport' && FormState.transitSubtype === 'single';
  if (isSingleTicket && !FormState.transitMode) { toast('请选择交通工具'); return; }

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
    transitSubtype: FormState.category === 'transport' ? FormState.transitSubtype : null,
    from: isSingleTicket ? FormState.transitFrom.trim() : '',
    to: isSingleTicket ? FormState.transitTo.trim() : '',
    transitMode: isSingleTicket ? FormState.transitMode : '',
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
  const header = ['日期', '分类', '金额', '付款方式', '备注', '是否分账', '参与分账人员', '各自分摊金额', '各自还款状态', '垫付人', '是否有照片', '出发地', '目的地', '交通工具', '交通使用方式'];
  const rows = [header];
  const sorted = [...State.expenses].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.id - b.id));
  for (const e of sorted) {
    const cat = CATEGORY_MAP[e.category]?.label || e.category;
    const pm = PAYMENT_METHOD_LABELS[e.paymentMethod] || e.paymentMethod || '';
    const names = (e.participants || []).map((p) => personName(p.personId)).join('/');
    const amounts = (e.participants || []).map((p) => p.amount).join('/');
    const status = (e.participants || []).map((p) => {
      if (p.personId === e.payerId) return '本人垫付';
      return p.settled ? `已还(${p.settledMethod === 'card' ? '卡' : '现金'})` : '未还';
    }).join('/');
    const payer = e.payerId ? personName(e.payerId) : '';
    const usage = TRANSIT_USAGE_LABELS[e.transitUsage] || '';
    rows.push([e.date, cat, e.amount, pm, e.note || '', e.isSplit ? '是' : '否', names, amounts, status, payer, e.photo ? '是' : '否', e.from || '', e.to || '', e.transitMode || '', usage]);
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
