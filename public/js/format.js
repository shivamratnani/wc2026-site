// format.js — pure formatting + escaping helpers. No DOM, no imports.
// Every dynamic string that reaches the DOM must pass through esc().

const ESC_MAP = { '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' };

export const esc = (s) =>
  String(s == null ? '' : s).replace(/[<>&"']/g, (c) => ESC_MAP[c]);

// ---- Dates / times (viewer's local timezone) ----------------------

function toDate(iso) {
  if (iso == null || iso === '') return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function fmtDate(iso, opts) {
  const d = toDate(iso);
  if (!d) return '';
  return d.toLocaleDateString([], opts || { weekday: 'short', month: 'short', day: 'numeric' });
}

export function fmtTime(iso) {
  const d = toDate(iso);
  if (!d) return '';
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

export function fmtDateTime(iso) {
  const d = toDate(iso);
  if (!d) return '';
  return d.toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

// ---- Odds ---------------------------------------------------------
// Leaves arrive as { american, decimal } | null, but plain numbers
// (e.g. from /api/live) are accepted too.

function leafAmerican(v) {
  if (v == null) return null;
  if (typeof v === 'object') v = v.american;
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : null;
}

function leafDecimal(v) {
  if (v == null) return null;
  if (typeof v === 'object' && v.decimal != null) {
    const d = Number(v.decimal);
    if (Number.isFinite(d)) return d;
  }
  const a = leafAmerican(v);
  if (a == null) return null;
  return a > 0 ? 1 + a / 100 : 1 + 100 / Math.abs(a);
}

// American odds display, e.g. 150 -> "+150", -110 -> "-110".
export function americanOdds(v) {
  const n = leafAmerican(v);
  if (n == null) return '—';
  return (n > 0 ? '+' : '') + n;
}

// Implied probability as a 0..100 number (or null).
export function impliedPct(v) {
  const n = leafAmerican(v);
  if (n == null) return null;
  const p = n > 0 ? 100 / (n + 100) : Math.abs(n) / (Math.abs(n) + 100);
  return p * 100;
}

// Probability given as 0..1 -> "63%".
export function pct01(p, digits = 0) {
  const n = Number(p);
  if (!Number.isFinite(n)) return '';
  return (n * 100).toFixed(digits) + '%';
}

// Minute badge: 45 -> "45'", passthrough for "45+2" / "90+3".
export function minuteBadge(min) {
  if (min == null || min === '') return '';
  const s = String(min).trim();
  return /['+]$/.test(s) ? s : s + "'";
}

// W / D / L chip descriptor: { cls, label }.
export function resultChip(result) {
  const r = String(result || '').toUpperCase().charAt(0);
  if (r === 'W') return { cls: 'win', label: 'W' };
  if (r === 'L') return { cls: 'loss', label: 'L' };
  if (r === 'D' || r === 'T') return { cls: 'draw', label: 'D' };
  return { cls: 'none', label: '·' };
}

// Movement between an opening and current odds leaf.
// Returns { arrow, dir } with dir in 'up' | 'down' | ''.
// 'up' = price shortened (firmed in); 'down' = drifted out.
export function movementArrow(open, current) {
  const a = leafDecimal(open);
  const b = leafDecimal(current);
  if (a == null || b == null) return { arrow: '', dir: '' };
  const eps = 1e-6;
  if (b < a - eps) return { arrow: '▲', dir: 'up' };
  if (b > a + eps) return { arrow: '▼', dir: 'down' };
  return { arrow: '', dir: '' };
}
