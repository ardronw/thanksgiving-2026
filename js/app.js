// Thanksgiving 2026 page: renders the confirmed menu, the suggestions people
// vote on, and the grocery list. All vote reads and writes go through store.js.

import { config } from './config.js?v=76179d85b2';
import { openVoteStore, getVoterId } from './store.js?v=76179d85b2';
import { CATEGORIES, PLANNED, POTENTIAL, CATALOG, LEFT_OFF, THRESHOLD_DEFAULT, CONSIDERATIONS, CONSIDERATION_GROUPS } from './data.js?v=76179d85b2';
import { buildGroceryList, countItems, formatLine, groceryText } from './grocery.js?v=76179d85b2';

const THRESHOLD = config.threshold || THRESHOLD_DEFAULT;
const CAT = Object.fromEntries(CATEGORIES.map((c) => [c.id, c]));
const BY_ID = Object.fromEntries([...PLANNED, ...POTENTIAL].map((d) => [d.id, d]));

// ---------- tiny helpers ----------

const $ = (sel, el = document) => el.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const safeUrl = (u) => (/^https:\/\//.test(u || '') ? u : '#');
const link = (url, text) => `<a href="${esc(safeUrl(url))}" target="_blank" rel="noopener">${text}</a>`;

const ICON = {
  up: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"/></svg>',
  down: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 15v4a3 3 0 0 0 3 3l4-9V2H5.72a2 2 0 0 0-2 1.7l-1.38 9a2 2 0 0 0 2 2.3zm7-13h2.67A2.31 2.31 0 0 1 22 4v7a2.31 2.31 0 0 1-2.33 2H17"/></svg>',
  ext: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><path d="M15 3h6v6"/><path d="M10 14 21 3"/></svg>',
  badge: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 1.5 14.6 4l3.6-.4.6 3.6 3.2 1.8-1.5 3.3 1.5 3.3-3.2 1.8-.6 3.6-3.6-.4L12 22.5 9.4 20l-3.6.4-.6-3.6L2 15l1.5-3.3L2 8.4l3.2-1.8.6-3.6 3.6.4z"/><path d="m8.5 12 2.4 2.4 4.6-4.8" fill="none" stroke="var(--paper)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  check: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>',
  copy: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>',
  share: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><path d="m16 6-4-4-4 4"/><path d="M12 2v13"/></svg>',
  download: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/><path d="M12 15V3"/></svg>',
  leaf: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2c5 3 7 8 5.5 13-.9 3-3 5-5.5 7-2.5-2-4.6-4-5.5-7C5 10 7 5 12 2z"/></svg>',
};

function readJSON(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
}
function writeJSON(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* private mode: fine */ }
}

// ---------- state ----------

const state = {
  store: null,
  me: getVoterId(config),
  server: [], // votes as last seen from the store
  pending: new Map(), // dishId -> value, my votes not yet confirmed by the store
  open: new Set(), // dishes whose details are expanded
  groceryMode: readJSON('tg26.groceryMode', 'aisle'),
  onlyVotes: readJSON('tg26.onlyVotes', false),
  checked: readJSON('tg26.checked', {}), // item key -> total at the time it was ticked
  lastAdded: null,
};

function votesFor(dishId) {
  const map = new Map();
  for (const v of state.server) if (v.dish === dishId && v.value) map.set(v.voter, v.value);
  if (state.pending.has(dishId)) {
    const p = state.pending.get(dishId);
    if (p) map.set(state.me, p); else map.delete(state.me);
  }
  let up = 0, down = 0;
  for (const value of map.values()) { if (value > 0) up++; else if (value < 0) down++; }
  return { up, down, mine: map.get(state.me) || 0 };
}

const isVotedIn = (d) => votesFor(d.id).up >= THRESHOLD;
const votedIn = () => POTENTIAL.filter(isVotedIn);
const suggestions = () => POTENTIAL.filter((d) => !isVotedIn(d));
const confirmedCount = () => PLANNED.length + votedIn().length;
const groceryDishes = () => [...PLANNED.filter((d) => d.groceries), ...votedIn()];

// ---------- recipe panel (shared by both columns) ----------
// The in-app recipe: ingredients already scaled for 6 (pies as written),
// timing, make-ahead and tips, plus a link to the original page for the
// steps. The grocery list is built from these same ingredient lines.

function scaleNote(d) {
  const m = /Scaled ([\d.]+)×/.exec(d.serves || '');
  if (m) return `Already scaled ${m[1]}× for 6. The original page shows its own smaller amounts, so cook with these.`;
  if (/as written/i.test(d.serves || '')) return 'Same amounts as the original recipe.';
  return '';
}

function details(d) {
  const parts = [];
  if (d.ingredients?.length) {
    const heading = d.category ? 'Ingredients for 6' : d.group === 'drinks' ? 'For 12 cocktails' : d.group === 'dessert' && d.url ? 'Ingredients for one 9-inch pie' : 'Ingredients';
    const rows = d.ingredients.map(([key, qty, note]) => {
      const item = CATALOG[key];
      return `<li><span>${esc(item.name)}${note ? ` <small>· ${esc(note)}</small>` : ''}</span><span>${esc(formatLine(item, qty))}</span></li>`;
    }).join('');
    const extra = [scaleNote(d), d.url && d.group !== 'drinks' ? 'Plus salt, pepper and water as the recipe directs.' : ''].filter(Boolean).join(' ');
    parts.push(`<h5>${heading}</h5><ul class="ing">${rows}</ul>${extra ? `<p class="ing-note">${esc(extra)}</p>` : ''}`);
    if (d.category && !isVotedIn(d)) parts.push('<p class="ing-note">If this gets 3 thumbs-up, these go straight onto the grocery list.</p>');
  }
  const timing = [d.time, d.heat].filter(Boolean).map(esc).join(' · ');
  if (timing) parts.push(`<h5>Time &amp; oven</h5><p>${timing}</p>`);
  if (d.ahead) parts.push(`<h5>Make ahead</h5><p>${esc(d.ahead)}</p>`);
  if (d.heads?.length) parts.push(`<h5>Good to know</h5><ul>${d.heads.map((h) => `<li>${esc(h)}</li>`).join('')}</ul>`);
  if (d.proof && !d.category) parts.push(`<h5>Track record</h5><p>${esc(d.proof)}</p>`);
  if (d.url) {
    const more = (d.links || []).map((l) => link(l.url, `${esc(l.label)} ↗`)).join('');
    parts.push(`<p class="steps-link">${link(d.url, `Full steps on ${esc(d.source)} ↗`)}${more}</p>`);
  }
  const summary = d.category ? 'Recipe for 6' : d.url ? 'Recipe' : 'What to buy';
  return `<details class="more" data-dish="${esc(d.id)}"${state.open.has(d.id) ? ' open' : ''}><summary>${summary}</summary><div class="more-body">${parts.join('')}</div></details>`;
}

// ---------- Confirmed column (no voting here) ----------

function renderConfirmed() {
  const classics = PLANNED.filter((d) => d.group === 'classics');
  const desserts = PLANNED.filter((d) => d.group === 'dessert');
  const drinks = PLANNED.filter((d) => d.group === 'drinks');
  const voted = votedIn();

  const votedHtml = voted.map((d) => `
    <li class="mc-item voted${state.lastAdded === d.id ? ' just-added' : ''}" data-cat="${esc(d.category)}" id="confirmed-${esc(d.id)}">
      <span class="t">${link(d.url, esc(d.title))}</span>
      <span class="s"><span class="voted-pill">${ICON.check}Voted in</span> ${esc(CAT[d.category].name)} · ${link(d.url, `${esc(d.source)} ↗`)}</span>
      ${details(d)}
    </li>`).join('');

  const plannedItem = (d) => `
    <li class="mc-item">
      <span class="t">${d.url ? link(d.url, esc(d.title)) : esc(d.title)}</span>
      ${d.by ? `<span class="s">${esc(d.by)} · ${link(d.url, `${esc(d.source)} ↗`)}</span>` : ''}
      ${details(d)}
    </li>`;
  const dessertHtml = desserts.map((d) => `
    <li class="mc-item">
      <span class="t">${d.url ? link(d.url, esc(d.title)) : esc(d.title)}</span>
      ${d.by ? `<span class="s">${esc(d.by)} · ${link(d.url, `${esc(d.source)} ↗`)}</span>` : ''}
      ${details(d)}
    </li>`).join('');

  $('#confirmed').innerHTML = `
    <header class="col-head">
      <h2 class="col-title" id="confirmed-h">Confirmed</h2>
      <p class="col-sub">${confirmedCount()} dishes on the menu</p>
    </header>
    <div class="menu-card">
      <p class="mc-kicker">Thursday, November 26</p>
      <div class="mc-rule" aria-hidden="true">${ICON.leaf}</div>
      <section class="mc-sec" aria-labelledby="mains-h">
        <h3 id="mains-h">Mains &amp; sides</h3>
        <ul class="mc-list mc-classics">${classics.map((d) => `<li class="mc-item"><span class="t">${esc(d.title)}</span></li>`).join('')}</ul>
        ${voted.length ? `<ul class="mc-list mc-voted">${votedHtml}</ul>` : ''}
        <p class="mc-note">${voted.length ? '' : 'Suggestions that reach 3 thumbs-up are added here. '}Family recipes aren’t on the grocery list.</p>
      </section>
      <section class="mc-sec" aria-labelledby="desserts-h">
        <h3 id="desserts-h">Desserts</h3>
        <ul class="mc-list mc-desserts">${dessertHtml}</ul>
      </section>
      <section class="mc-sec" aria-labelledby="drinks-h">
        <h3 id="drinks-h">Drinks</h3>
        <ul class="mc-list">${drinks.map(plannedItem).join('')}</ul>
      </section>
    </div>`;
}

// ---------- Suggestions column (the only place to vote) ----------

function card(d) {
  const t = votesFor(d.id);
  const need = Math.max(0, THRESHOLD - t.up);
  const dots = Array.from({ length: THRESHOLD }, (_, i) => `<i${i < t.up ? ' class="on"' : ''}></i>`).join('');
  const hot = /^oven/i.test(d.heat) ? ' hot' : '';
  return `
  <article class="card" data-cat="${esc(d.category)}" id="card-${esc(d.id)}">
    <h4>${link(d.url, esc(d.title))}</h4>
    <p class="byline"><b>${esc(d.source)}</b> · ${esc(d.by)}</p>
    <p class="pitch">${esc(d.pitch)}</p>
    <p class="proof">${ICON.badge}<span>${esc(d.proof)}</span></p>
    <p class="facts"><span>${esc(d.serves)}</span><span>${esc(d.time)}</span><span class="heat${hot}">${esc(d.heat)}</span></p>
    <div class="vote-row">
      <button class="thumb up" data-vote="1" data-dish="${esc(d.id)}" aria-pressed="${t.mine > 0}" aria-label="Thumbs up for ${esc(d.title)}, ${t.up} so far">${ICON.up}<span>${t.up}</span></button>
      <button class="thumb down" data-vote="-1" data-dish="${esc(d.id)}" aria-pressed="${t.mine < 0}" aria-label="Thumbs down for ${esc(d.title)}, ${t.down} so far">${ICON.down}<span>${t.down}</span></button>
      <div class="progress" aria-label="${t.up} of ${THRESHOLD} thumbs-up">${dots}<span>${need === 1 ? '1 more to confirm' : `${need} more to confirm`}</span></div>
    </div>
    <div class="card-foot">
      ${details(d)}
      <a class="recipe-link" href="${esc(safeUrl(d.url))}" target="_blank" rel="noopener">Full steps ${ICON.ext}</a>
    </div>
  </article>`;
}

function renderSuggestions() {
  const open = suggestions();
  const mineCount = open.filter((d) => votesFor(d.id).mine !== 0).length;
  const sections = CATEGORIES.map((c) => {
    const dishes = open.filter((d) => d.category === c.id);
    const total = POTENTIAL.filter((d) => d.category === c.id).length;
    const moved = total - dishes.length;
    const body = dishes.length
      ? `<div class="cards">${dishes.map(card).join('')}</div>`
      : `<p class="cat-done">All ${total} moved to Confirmed.</p>`;
    return `<section class="cat" data-cat="${c.id}" aria-labelledby="cat-${c.id}">
      <div class="cat-head">
        <h3 id="cat-${c.id}">${esc(c.name)}</h3>
        <p>${esc(c.blurb)}${moved && dishes.length ? ` <span class="cat-moved">${moved} moved to Confirmed</span>` : ''}</p>
      </div>
      ${body}
    </section>`;
  }).join('');

  $('#suggestions').innerHTML = `
    <header class="col-head">
      <h2 class="col-title" id="suggestions-h">Suggestions</h2>
      <p class="col-sub">${open.length} to vote on · 3 thumbs-up in total moves one to Confirmed</p>
      <p class="you-voted">You’ve voted on <b>${mineCount}</b> of ${open.length}. <a href="#more-ideas">More ideas below ↓</a></p>
    </header>
    ${sections}
    ${renderConsiderations()}`;
}

// ---------- Additional recipe considerations (no voting, no groceries) ----------

const CHECKED = {
  page: 'Checked on the recipe page',
  search: 'From search results only',
};

function consCard(c) {
  return `<article class="cons">
    <h5>${link(c.url, esc(c.title))}</h5>
    <p class="byline"><b>${esc(c.source)}</b> · ${esc(c.by)}</p>
    <p class="cons-why">${esc(c.why)}</p>
    <p class="cons-proof"><span class="chk ${esc(c.checked)}">${CHECKED[c.checked]}</span> ${esc(c.proof)}</p>
    ${c.facts?.length ? `<p class="facts">${c.facts.map((f) => `<span>${esc(f)}</span>`).join('')}</p>` : ''}
    ${c.note ? `<p class="cons-note">${esc(c.note)}</p>` : ''}
    <a class="cons-link" href="${esc(safeUrl(c.url))}" target="_blank" rel="noopener">Recipe ${ICON.ext}</a>
  </article>`;
}

function renderConsiderations() {
  const groups = CONSIDERATION_GROUPS.map((g) => {
    const items = CONSIDERATIONS.filter((c) => c.group === g.id);
    if (!items.length) return '';
    return `<div class="cons-group"><h3 class="cons-h">${esc(g.name)}</h3><div class="cons-list">${items.map(consCard).join('')}</div></div>`;
  }).join('');
  return `<section class="considerations" id="more-ideas" aria-labelledby="cons-title">
    <header class="col-head">
      <h2 class="col-title" id="cons-title">Additional recipe considerations</h2>
      <p class="col-sub">${CONSIDERATIONS.length} more vetted ideas. They’re not up for a vote and not on the grocery list; any of them can be added to the suggestions.</p>
    </header>
    ${groups}
  </section>`;
}

// ---------- Groceries ----------

// Which items came from dishes the family voted in: 'new' (only voted-in
// dishes need it) or 'more' (already on the list, and a voted-in dish needs more).
function voteTag(i) {
  const fromVote = i.lines.filter((l) => l.dish.category).length;
  if (!fromVote) return null;
  return fromVote === i.lines.length ? 'new' : 'more';
}

function renderGroceries() {
  const dishes = groceryDishes();
  const planned = dishes.filter((d) => !d.category);
  const voted = dishes.filter((d) => d.category);
  const aisles = buildGroceryList(dishes);
  const all = aisles.flatMap((a) => a.items);
  const newCount = all.filter((i) => voteTag(i) === 'new').length;
  const moreCount = all.filter((i) => voteTag(i) === 'more').length;
  const onlyVotes = state.onlyVotes && voted.length > 0;
  const shown = onlyVotes
    ? aisles.map((a) => ({ ...a, items: a.items.filter(voteTag) })).filter((a) => a.items.length)
    : aisles;
  const shownItems = shown.flatMap((a) => a.items);
  const isDone = (i) => state.checked[i.key] != null && state.checked[i.key] >= i.total - 1e-9;
  const done = shownItems.filter(isDone).length;
  const canShare = typeof navigator.share === 'function';

  const pill = (tag) => (tag === 'new' ? '<span class="pill new">New</span>' : tag === 'more' ? '<span class="pill more">More</span>' : '');

  const itemHtml = (i) => {
    const wasChecked = state.checked[i.key] != null && !isDone(i);
    const uses = i.lines.map((l) => `<span${l.dish.category ? ' class="u-vote"' : ''}>${esc(l.dish.short || l.dish.title)} ${esc(formatLine(i.item, l.qty))}</span>`).join(' · ');
    return `<li class="g-item${isDone(i) ? ' done' : ''}">
      <label>
        <input type="checkbox" data-check="${esc(i.key)}" data-total="${i.total}"${isDone(i) ? ' checked' : ''}>
        <span class="g-check" aria-hidden="true">${ICON.check}</span>
        <span><span class="g-name">${esc(i.item.name)} ${pill(voteTag(i))}</span>${i.hint ? `<span class="g-hint">${esc(i.hint)}</span>` : ''}<span class="g-uses">${uses}</span>${wasChecked ? '<span class="g-more">More needed since you ticked it</span>' : ''}</span>
        <span class="g-amt">${esc(i.amount)}</span>
      </label>
    </li>`;
  };

  const byAisle = `<div class="aisles">${shown.map((a) => `
    <section class="aisle${a.id === 'pantry' ? ' pantry' : ''}">
      <h3>${esc(a.name)} <span>${a.items.length}</span></h3>
      ${a.note ? `<p class="aisle-note">${esc(a.note)}</p>` : ''}
      <ul class="g-list">${a.items.map(itemHtml).join('')}</ul>
    </section>`).join('')}</div>`;

  const dishList = onlyVotes ? voted : [...voted, ...planned];
  const byDish = `<div class="aisles">${dishList.map((d) => `
    <section class="aisle${d.category ? ' voted' : ''}">
      <h3>${esc(d.short || d.title)} ${d.url ? link(d.url, 'Full steps ↗') : ''}</h3>
      <p class="aisle-note">${d.category ? '<span class="pill new">Voted in</span> ' : ''}${esc(d.serves || '')}</p>
      <ul class="ing">${d.ingredients.map(([key, qty, note]) => `<li><span>${esc(CATALOG[key].name)}${note ? ` <small>· ${esc(note)}</small>` : ''}</span><span>${esc(formatLine(CATALOG[key], qty))}</span></li>`).join('')}</ul>
    </section>`).join('')}</div>`;

  const summary = voted.length
    ? `<div class="g-summary has-votes">
        <p><b>Added by votes:</b> ${voted.map((d) => esc(d.short || d.title)).join(', ')}. That’s <b>${newCount}</b> new ${newCount === 1 ? 'item' : 'items'} and <b>${moreCount}</b> ${moreCount === 1 ? 'item' : 'items'} you need more of, marked ${pill('new')} and ${pill('more')} below.</p>
        <label class="switch"><input type="checkbox" data-only-votes${onlyVotes ? ' checked' : ''}><span class="track" aria-hidden="true"></span>Show only what votes added</label>
      </div>`
    : `<div class="g-summary"><p>Right now this is the shopping for the pies and whipped cream. When a suggestion gets 3 thumbs-up, its ingredients are added here automatically, marked ${pill('new')}.</p></div>`;

  $('#groceries').innerHTML = `
    <div class="g-head">
      <div>
        <h2 class="col-title" id="g-h">Grocery list</h2>
        <p class="col-sub">For confirmed dishes only · scaled for 6 adults, pies as written</p>
      </div>
      <div class="g-actions">
        <div class="seg-ctl" role="group" aria-label="Arrange by">
          <button data-mode="aisle" aria-pressed="${state.groceryMode === 'aisle'}">By aisle</button>
          <button data-mode="dish" aria-pressed="${state.groceryMode === 'dish'}">By dish</button>
        </div>
        <button class="btn primary" data-action="export">${ICON.download}Export spreadsheet</button>
        <button class="btn" data-action="copy">${ICON.copy}Copy list</button>
        ${canShare ? `<button class="btn" data-action="share">${ICON.share}Share</button>` : ''}
      </div>
    </div>
    ${summary}
    <div class="g-for">
      <span class="g-for-label">Planned</span>${planned.map((d) => `<span class="chip">${esc(d.short || d.title)}</span>`).join('')}
      ${voted.length ? `<span class="g-for-label">Voted in</span>${voted.map((d) => `<span class="chip new">${esc(d.short || d.title)}</span>`).join('')}` : ''}
    </div>
    ${state.groceryMode === 'aisle' ? `
      <div class="g-progress"><span>${done} of ${shownItems.length} in the basket</span><span class="g-bar"><i style="width:${shownItems.length ? Math.round((done / shownItems.length) * 100) : 0}%"></i></span>${Object.keys(state.checked).length ? '<button class="btn" data-action="clear">Clear ticks</button>' : ''}</div>
      ${byAisle}` : byDish}
    <p class="g-left"><b>Not on this list:</b> ${esc(LEFT_OFF)} Ticks are saved on this device only.</p>`;
}

// ---------- header, nav counts ----------

function renderChrome() {
  const groceries = countItems(buildGroceryList(groceryDishes()));
  const counts = { confirmed: confirmedCount(), suggestions: suggestions().length, groceries };
  for (const [k, v] of Object.entries(counts)) $(`[data-count="${k}"]`).textContent = v;

  const target = new Date(2026, 10, 26);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const days = Math.round((target - today) / 86400000);
  $('#countdown').textContent = days > 1 ? `${days} days to go` : days === 1 ? 'Tomorrow!' : days === 0 ? 'Today!' : 'Hope it was delicious';
}

function render() {
  const focus = document.activeElement;
  const focusKey = focus?.dataset?.dish && focus.dataset.vote ? `[data-dish="${focus.dataset.dish}"][data-vote="${focus.dataset.vote}"]` : null;
  renderConfirmed();
  renderSuggestions();
  renderGroceries();
  renderChrome();
  if (focusKey) $(focusKey)?.focus({ preventScroll: true });
  spy();
}

// ---------- changes, toasts ----------

function toast(message, { tone = '', action, onAction, ms = 5000 } = {}) {
  const el = document.createElement('div');
  el.className = `toast ${tone}`;
  el.innerHTML = `<p></p>${action ? `<button type="button">${esc(action)}</button>` : ''}`;
  el.querySelector('p').textContent = message;
  if (action) el.querySelector('button').addEventListener('click', () => { onAction?.(); dismiss(); });
  $('#toasts').append(el);
  const toasts = $('#toasts').children;
  while (toasts.length > 2) toasts[0].remove();
  let gone = false;
  function dismiss() {
    if (gone) return; gone = true;
    el.classList.add('out');
    setTimeout(() => el.remove(), 220);
  }
  setTimeout(dismiss, ms);
}

const scrollToId = (id) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });

function snapshot() {
  return { voted: new Set(votedIn().map((d) => d.id)), groceries: countItems(buildGroceryList(groceryDishes())) };
}

function announce(before) {
  const now = new Set(votedIn().map((d) => d.id));
  const added = [...now].filter((id) => !before.voted.has(id));
  const removed = [...before.voted].filter((id) => !now.has(id));
  const delta = countItems(buildGroceryList(groceryDishes())) - before.groceries;
  for (const id of added) {
    state.lastAdded = id;
    clearTimeout(announce.timer);
    announce.timer = setTimeout(() => { state.lastAdded = null; }, 2500);
    const more = delta > 0 ? ` ${delta} new ${delta === 1 ? 'item' : 'items'} on the grocery list.` : ' The grocery list is updated.';
    toast(`${BY_ID[id].title} moved to Confirmed!${more}`, { tone: 'good', action: 'See list', onAction: () => scrollToId('groceries'), ms: 7000 });
  }
  for (const id of removed) toast(`${BY_ID[id].title} went back to Suggestions.`);
}

async function castVote(dishId, dir) {
  const current = votesFor(dishId).mine;
  const next = current === dir ? 0 : dir;
  const before = snapshot();
  state.pending.set(dishId, next);
  render();
  announce(before);
  $(`[data-dish="${dishId}"][data-vote="${dir}"]`)?.classList.add('pop');
  try {
    await state.store.setVote(dishId, state.me, next);
    // Keep the pending value until the write lands, so a poll that raced the
    // write can't flicker the old vote back onto the screen.
    state.server = state.server.filter((v) => !(v.dish === dishId && v.voter === state.me));
    if (next) state.server.push({ dish: dishId, voter: state.me, value: next });
    state.pending.delete(dishId);
  } catch (err) {
    console.error(err);
    const undo = snapshot();
    state.pending.delete(dishId);
    render();
    announce(undo);
    toast('That vote didn’t save. Check your connection and try again.');
  }
}

function onServerVotes(votes) {
  const before = snapshot();
  state.server = votes;
  render();
  announce(before);
}

// ---------- nav highlight ----------

function spy() {
  const navBottom = $('.jumpnav').getBoundingClientRect().bottom;
  const band = navBottom + window.innerHeight * 0.25;
  for (const id of ['confirmed', 'suggestions', 'groceries']) {
    const r = document.getElementById(id).getBoundingClientRect();
    const current = r.top <= band && r.bottom > navBottom + 8;
    const a = $(`[data-section="${id}"]`);
    if (current) a.setAttribute('aria-current', 'true'); else a.removeAttribute('aria-current');
  }
}
let spyQueued = false;
window.addEventListener('scroll', () => {
  if (spyQueued) return;
  spyQueued = true;
  requestAnimationFrame(() => { spyQueued = false; spy(); });
}, { passive: true });
window.addEventListener('resize', spy);

// ---------- events ----------

document.addEventListener('click', (e) => {
  const voteBtn = e.target.closest('[data-vote]');
  if (voteBtn) {
    castVote(voteBtn.dataset.dish, Number(voteBtn.dataset.vote));
    return;
  }
  const mode = e.target.closest('[data-mode]');
  if (mode) {
    state.groceryMode = mode.dataset.mode;
    writeJSON('tg26.groceryMode', state.groceryMode);
    renderGroceries();
    return;
  }
  const action = e.target.closest('[data-action]')?.dataset.action;
  if (action === 'export') exportSpreadsheet();
  if (action === 'copy') copyList();
  if (action === 'share') shareList();
  if (action === 'clear') { state.checked = {}; writeJSON('tg26.checked', {}); renderGroceries(); }
});

document.addEventListener('change', (e) => {
  if (e.target.matches('[data-only-votes]')) {
    state.onlyVotes = e.target.checked;
    writeJSON('tg26.onlyVotes', state.onlyVotes);
    renderGroceries();
    $('[data-only-votes]')?.focus({ preventScroll: true });
    return;
  }
  const box = e.target.closest('[data-check]');
  if (!box) return;
  if (box.checked) state.checked[box.dataset.check] = Number(box.dataset.total);
  else delete state.checked[box.dataset.check];
  writeJSON('tg26.checked', state.checked);
  renderGroceries();
  renderChrome();
  $(`[data-check="${box.dataset.check}"]`)?.focus({ preventScroll: true });
});

document.addEventListener('toggle', (e) => {
  const d = e.target;
  if (!(d instanceof HTMLDetailsElement) || !d.dataset.dish) return;
  if (d.open) state.open.add(d.dataset.dish); else state.open.delete(d.dataset.dish);
}, true);

function listText() {
  const dishes = groceryDishes();
  return groceryText(buildGroceryList(dishes), dishes, LEFT_OFF);
}

// Spreadsheet export: one row per item, in store-aisle order, as a CSV that
// Excel, Numbers and Google Sheets open directly.
function exportSpreadsheet() {
  const dishes = groceryDishes();
  const aisles = buildGroceryList(dishes);
  const rows = [['Aisle', 'Item', 'Amount to buy', 'Buying note', 'Used for', 'Added by vote', 'Got it']];
  for (const a of aisles) {
    for (const i of a.items) {
      const tag = voteTag(i);
      const done = state.checked[i.key] != null && state.checked[i.key] >= i.total - 1e-9;
      rows.push([
        a.name,
        i.item.name,
        i.amount,
        i.hint || '',
        i.lines.map((l) => `${l.dish.short || l.dish.title} (${formatLine(i.item, l.qty)})`).join('; '),
        tag === 'new' ? 'New' : tag === 'more' ? 'More' : '',
        done ? 'Yes' : '',
      ]);
    }
  }
  const cell = (v) => {
    const text = String(v);
    const safe = /^[=+\-@]/.test(text) ? `'${text}` : text;
    return `"${safe.replace(/"/g, '""')}"`;
  };
  const csv = rows.map((r) => r.map(cell).join(',')).join('\r\n');
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'thanksgiving-grocery-list.csv';
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  toast('Saved thanksgiving-grocery-list.csv. It opens in Excel, Numbers or Google Sheets.');
}

async function copyList() {
  const text = listText();
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.append(ta); ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    if (!ok) { toast('Couldn’t copy on this device. Try Share instead.'); return; }
  }
  toast('Copied. Paste it into Notes or a text.');
}

async function shareList() {
  try {
    await navigator.share({ title: 'Thanksgiving groceries', text: listText() });
  } catch (err) {
    if (err?.name !== 'AbortError') toast('Sharing didn’t work here. Try Copy list.');
  }
}

// ---------- start ----------

async function start() {
  render();
  try {
    state.store = await openVoteStore(config);
    state.server = await state.store.load();
    render();
    state.store.subscribe(onServerVotes);
    if (!state.store.shared) {
      const n = $('#notice');
      n.textContent = 'Preview mode: votes are saved in this browser only, so they don’t add up across people yet.';
      n.hidden = false;
    }
  } catch (err) {
    console.error(err);
    state.store = { setVote: async () => { throw new Error('offline'); } };
    const n = $('#notice');
    n.textContent = 'Couldn’t load the votes right now. The menu and grocery list still work; try again in a minute.';
    n.classList.add('error');
    n.hidden = false;
  }
}

start();
