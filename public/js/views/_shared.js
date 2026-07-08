// views/_shared.js — DOM builders + shared UI fragments.
// String builders assume the caller has esc()'d every dynamic value.
import { esc, americanOdds, movementArrow } from '../format.js';

// ---- tiny DOM helpers ---------------------------------------------

export function frag(html) {
  const t = document.createElement('template');
  t.innerHTML = html;
  return t.content;
}

export function node(html) {
  return frag(html).firstElementChild;
}

// ---- skeleton loaders ---------------------------------------------

export function skeletonCards(n = 6) {
  let cards = '';
  for (let i = 0; i < n; i++) {
    cards += `<div class="card sk-card" aria-hidden="true">
      <div class="sk sk-line" style="width:38%"></div>
      <div class="sk-row"><span class="sk sk-line" style="width:52%"></span><span class="sk sk-pill"></span></div>
      <div class="sk-row"><span class="sk sk-line" style="width:44%"></span><span class="sk sk-pill"></span></div>
      <div class="sk sk-line" style="width:66%"></div>
    </div>`;
  }
  return `<div class="grid grid-cards">${cards}</div>`;
}

export function skeletonRows(n = 6) {
  let rows = '';
  for (let i = 0; i < n; i++) {
    rows += `<div class="sk-listrow" aria-hidden="true"><span class="sk sk-line" style="width:${30 + (i * 11) % 46}%"></span><span class="sk sk-num"></span></div>`;
  }
  return `<div class="sk-list">${rows}</div>`;
}

// ---- empty / error states -----------------------------------------

export function emptyState(root, { title = 'Nothing here yet', note = '' } = {}) {
  root.replaceChildren(node(
    `<div class="state state-empty">
      <span class="state-mark" aria-hidden="true">—</span>
      <div class="state-title">${esc(title)}</div>
      ${note ? `<div class="state-note">${esc(note)}</div>` : ''}
    </div>`
  ));
}

export function errorState(root, { title = 'Could not load', note = '', onRetry } = {}) {
  const el = node(
    `<div class="state state-error">
      <span class="state-mark" aria-hidden="true">!</span>
      <div class="state-title">${esc(title)}</div>
      ${note ? `<div class="state-note">${esc(note)}</div>` : ''}
      <button type="button" class="btn btn-retry">Retry</button>
    </div>`
  );
  const btn = el.querySelector('.btn-retry');
  if (onRetry) btn.addEventListener('click', onRetry);
  else btn.remove();
  root.replaceChildren(el);
}

export function inlineNote(msg) {
  return `<div class="sub-inline muted">${esc(msg)}</div>`;
}

// ---- shared fragments ---------------------------------------------

export function liveDot() {
  return `<span class="live-dot" aria-hidden="true"></span>`;
}

export function tag(label, kind = '') {
  return `<span class="tag${kind ? ' tag-' + kind : ''}">${esc(label)}</span>`;
}

export function sectionHead(title, sub) {
  return `<div class="sec-head">
    <h2 class="sec-title">${esc(title)}</h2>
    ${sub ? `<p class="sec-sub">${esc(sub)}</p>` : ''}
  </div>`;
}

export function panelHead(title, extra) {
  return `<div class="panel-head"><h3 class="panel-title">${esc(title)}</h3>${extra || ''}</div>`;
}

// odds cell: current american price in mono + open->current movement arrow.
export function oddsCell(open, current) {
  const val = americanOdds(current);
  const m = movementArrow(open, current);
  const arrow = m.arrow ? `<span class="mv mv-${m.dir}" aria-hidden="true">${m.arrow}</span>` : '';
  const empty = val === '—' ? ' is-empty' : '';
  return `<span class="odds${empty}"><span class="mono odds-val">${esc(val)}</span>${arrow}</span>`;
}

// two-sided proportional bar (home vs away share).
export function twoSidedBar(home, away) {
  const h = Number(home) || 0;
  const a = Number(away) || 0;
  const total = h + a;
  const hp = total > 0 ? (h / total) * 100 : 50;
  return `<span class="dbar" aria-hidden="true"><span class="dbar-h" style="width:${hp.toFixed(1)}%"></span><span class="dbar-a" style="width:${(100 - hp).toFixed(1)}%"></span></span>`;
}

// single meter filled to pct (0..100); emphasis switches to rose-deep fill.
export function meter(pct, emphasis = false) {
  const p = Math.max(0, Math.min(100, Number(pct) || 0));
  return `<span class="meter${emphasis ? ' meter-em' : ''}" aria-hidden="true"><span class="meter-fill" style="width:${p.toFixed(1)}%"></span></span>`;
}

export function sep() {
  return `<span class="dot-sep" aria-hidden="true">·</span>`;
}

// Guard hrefs from javascript:/data: URLs before they reach the DOM.
export function safeUrl(url) {
  const u = String(url || '');
  return /^https?:\/\//i.test(u) ? u : '#';
}
