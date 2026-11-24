// Grocery list maths: add up ingredient lines from the confirmed dishes and
// format the totals in units people shop in. Pure functions, no DOM.

import { AISLES, CATALOG } from './data.js?v=76179d85b2';

const FRACTIONS = [
  [0, ''], [1 / 8, '⅛'], [1 / 4, '¼'], [1 / 3, '⅓'], [3 / 8, '⅜'], [1 / 2, '½'],
  [5 / 8, '⅝'], [2 / 3, '⅔'], [3 / 4, '¾'], [7 / 8, '⅞'], [1, ''],
];

// 1.375 -> "1⅜", 0.05 -> "⅛" (never rounds a real amount down to zero)
export function frac(x) {
  let whole = Math.floor(x + 1e-9);
  const rem = x - whole;
  let best = FRACTIONS[0];
  for (const f of FRACTIONS) if (Math.abs(rem - f[0]) < Math.abs(rem - best[0])) best = f;
  if (best[0] === 1) { whole += 1; best = FRACTIONS[0]; }
  if (whole === 0 && best[0] === 0) return x > 0 ? '⅛' : '0';
  return (whole ? String(whole) : '') + best[1];
}

// Same, but never rounds down (beyond a hair), for amounts to buy.
export function fracUp(x) {
  const whole = Math.floor(x + 1e-9);
  const rem = x - whole;
  for (const [f] of FRACTIONS) {
    if (f >= rem - 0.02) return frac(whole + f);
  }
  return String(whole + 1);
}

const plural = (q, one, many) => (q > 1 + 1e-9 ? many : one);
let F = frac; // swapped to fracUp while formatting totals
const cups = (q) => `${F(q)} ${plural(q, 'cup', 'cups')}`;

function tbspText(q) {
  if (q >= 4 - 1e-9) return cups(q / 16);
  if (q < 1 - 1e-9) return `${F(q * 3)} tsp`;
  return `${F(q)} Tbsp`;
}

function tspText(q) {
  if (q >= 6 - 1e-9) return tbspText(q / 3);
  return `${F(q)} tsp`;
}

// Total for the shopping list: rounds countable things up to whole items.
// Returns { amount, hint } where hint is an optional buying note.
export function formatTotal(item, q, toTaste) {
  if (q === 0 && toTaste) return { amount: 'to taste', hint: null };
  F = fracUp;
  try {
    return totalText(item, q, toTaste);
  } finally {
    F = frac;
  }
}

function totalText(item, q, toTaste) {
  const extra = item.hint ? item.hint(q) : null;
  let out;
  switch (item.unit) {
    case 'count': {
      const n = Math.ceil(q - 1e-9);
      const exact = Math.abs(n - q) > 1e-6 ? `recipes use ${F(q)}` : null;
      out = { amount: `${n} ${plural(n, item.one, item.many)}`, hint: exact };
      break;
    }
    case 'clove': {
      const n = Math.ceil(q - 1e-9);
      out = { amount: `${n} ${plural(n, 'clove', 'cloves')}`, hint: n > 10 ? `${Math.ceil(n / 10)} heads` : '1 head' };
      break;
    }
    case 'butter': {
      const lbs = Math.ceil(q / 32 - 1e-9);
      out = { amount: `${F(q / 8)} ${plural(q / 8, 'stick', 'sticks')}`, hint: `${F(q)} Tbsp · buy ${lbs} lb (${lbs * 4} sticks)` };
      break;
    }
    case 'cream': {
      out = { amount: cups(q / 16), hint: q / 16 > 2 + 1e-9 ? 'a pint is 2 cups, so get a quart' : null };
      break;
    }
    case 'flour': {
      const lb = (q * 4.25) / 16;
      out = { amount: cups(q), hint: `about ${F(lb)} lb, plus extra for rolling out` };
      break;
    }
    case 'herb': {
      const bunches = Math.max(1, Math.ceil(q / 16 - 1e-9));
      out = { amount: `${bunches} ${plural(bunches, 'bunch', 'bunches')}`, hint: `about ${tbspText(q)} chopped` };
      break;
    }
    case 'sprig':
      out = { amount: '1 small pack', hint: `${tspText(q)} chopped` };
      break;
    case 'lb': out = { amount: `${F(q)} lb`, hint: null }; break;
    case 'oz': out = { amount: q >= 16 ? `${F(q / 16)} lb` : `${F(q)} oz`, hint: null }; break;
    case 'g': out = { amount: `${Math.round(q)} g`, hint: null }; break;
    case 'floz': out = { amount: `${F(q)} fl oz`, hint: null }; break;
    case 'cup': out = { amount: cups(q), hint: null }; break;
    case 'tbsp': out = { amount: tbspText(q), hint: null }; break;
    case 'tsp': out = { amount: tspText(q), hint: null }; break;
    default: throw new Error(`Unknown unit ${item.unit}`);
  }
  if (toTaste) out.amount += ', plus more to taste';
  const hint = [out.hint, extra].filter(Boolean).join(' · ') || null;
  return { amount: out.amount, hint };
}

// One recipe line, as it reads in a dish breakdown: no rounding up.
export function formatLine(item, q) {
  if (q == null) return 'to taste';
  switch (item.unit) {
    case 'count': return `${frac(q)} ${plural(q, item.one, item.many)}`;
    case 'clove': return `${frac(q)} ${plural(q, 'clove', 'cloves')}`;
    case 'butter': return q >= 8 ? `${frac(q / 8)} ${plural(q / 8, 'stick', 'sticks')}` : `${frac(q)} Tbsp`;
    case 'cream': return tbspText(q);
    case 'flour': return cups(q);
    case 'herb': return `${tbspText(q)} chopped`;
    case 'sprig': return `${tspText(q)} chopped`;
    default: return formatTotal(item, q, false).amount;
  }
}

// dishes: the confirmed dishes that carry groceries.
// Returns aisles in store order, each with summed items.
export function buildGroceryList(dishes) {
  const byKey = new Map();
  for (const dish of dishes) {
    for (const [key, qty, note] of dish.ingredients || []) {
      const item = CATALOG[key];
      if (!item) throw new Error(`Unknown ingredient "${key}" in ${dish.id}`);
      let entry = byKey.get(key);
      if (!entry) {
        entry = { key, item, total: 0, toTaste: false, lines: [] };
        byKey.set(key, entry);
      }
      if (qty == null) entry.toTaste = true;
      else entry.total += qty;
      const same = entry.lines.find((l) => l.dish === dish);
      if (same) {
        same.qty = qty == null ? same.qty : (same.qty ?? 0) + qty;
        if (note) same.note = same.note ? `${same.note}; ${note}` : note;
      } else {
        entry.lines.push({ dish, qty, note: note || null });
      }
    }
  }
  const aisles = AISLES.map((a) => ({ ...a, items: [] }));
  const index = Object.fromEntries(aisles.map((a) => [a.id, a]));
  for (const entry of byKey.values()) {
    const { amount, hint } = formatTotal(entry.item, entry.total, entry.toTaste);
    index[entry.item.aisle].items.push({ ...entry, amount, hint });
  }
  for (const a of aisles) a.items.sort((x, y) => x.item.name.localeCompare(y.item.name));
  return aisles.filter((a) => a.items.length);
}

export function countItems(aisles) {
  return aisles.reduce((n, a) => n + a.items.length, 0);
}

// Plain text for pasting into Notes, Reminders or a group text.
export function groceryText(aisles, dishes, leftOff) {
  const lines = ['Thanksgiving groceries · Thu Nov 26 · for 6', ''];
  const voted = dishes.filter((d) => d.category);
  lines.push(`For: ${dishes.filter((d) => !d.category).map((d) => d.short || d.title).join(', ')}`);
  if (voted.length) lines.push(`Voted in: ${voted.map((d) => d.short || d.title).join(', ')}`);
  lines.push('');
  for (const a of aisles) {
    lines.push(a.name.toUpperCase());
    for (const i of a.items) {
      const fromVote = i.lines.filter((l) => l.dish.category).length;
      const tag = !fromVote ? '' : fromVote === i.lines.length ? ' (new)' : ' (more, for a voted-in dish)';
      lines.push(`- ${i.item.name}: ${i.amount}${tag}`);
    }
    lines.push('');
  }
  lines.push(`Not listed: ${leftOff}`);
  return lines.join('\n');
}
