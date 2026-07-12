// views/leaders.js — tournament leaders. Goals/assists render immediately
// from /api/stats; other categories resolve athlete names via /api/athletes.
import { fetchJSON, resolveAthletes, getAliveMaps, isDead, lookupTeam } from '../api.js';
import { esc } from '../format.js';
import { errorState, emptyState, meter, playerLink } from './_shared.js';

export function mount(root) {
  root.innerHTML = `<div class="view view-leaders"><div class="wrap">
    <div class="sec-head">
      <h2 class="sec-title">Tournament leaders</h2>
      <p class="sec-sub">Straight from the official stats feed, which can trail in-play matches by a short window.</p>
    </div>
    <div class="hero-boards" id="l-hero">${heroSkeleton()}</div>
    <div class="sec-head sub-head"><h3 class="sec-title small">By category</h3></div>
    <div id="l-cats">${catsSkeleton()}</div>
  </div></div>`;

  const hero = root.querySelector('#l-hero');
  const cats = root.querySelector('#l-cats');
  let alive = true;

  async function loadStats() {
    try {
      const [s, aliveMaps] = await Promise.all([fetchJSON('/api/stats'), getAliveMaps()]);
      if (!alive) return;
      hero.innerHTML = board('Golden Boot', s.goals, 'goals', aliveMaps) + board('Assists', s.assists, 'assists', aliveMaps);
    } catch (e) {
      if (alive) errorState(hero, {
        title: 'Leaders unavailable', note: e.message,
        onRetry: () => { hero.innerHTML = heroSkeleton(); loadStats(); },
      });
    }
  }

  async function loadCats() {
    let data;
    let aliveMaps;
    try {
      [data, aliveMaps] = await Promise.all([fetchJSON('/api/leaders'), getAliveMaps()]);
    } catch (e) {
      if (alive) errorState(cats, {
        title: 'Category leaders unavailable', note: e.message,
        onRetry: () => { cats.innerHTML = catsSkeleton(); loadCats(); },
      });
      return;
    }
    const categories = Array.isArray(data.categories) ? data.categories : [];
    if (!categories.length) {
      emptyState(cats, { title: 'No category leaders yet' });
      return;
    }
    const ids = [];
    for (const c of categories) for (const l of (c.leaders || [])) if (l.athleteId != null) ids.push(l.athleteId);
    let names = new Map();
    try { names = await resolveAthletes(ids); } catch (_) { /* fall back to ids */ }
    if (!alive) return;
    cats.innerHTML = `<div class="grid grid-cats">${categories.map((c) => catCard(c, names, aliveMaps)).join('')}</div>`;
  }

  loadStats();
  loadCats();
  return { destroy() { alive = false; } };
}

function heroSkeleton() {
  const b = () => {
    let rows = '';
    for (let i = 0; i < 6; i++) rows += `<div class="sk-listrow"><span class="sk sk-line" style="width:${40 + i * 6}%"></span><span class="sk sk-num"></span></div>`;
    return `<div class="card sk-card" aria-hidden="true"><div class="sk sk-line" style="width:45%"></div>${rows}</div>`;
  };
  return b() + b();
}

function catsSkeleton() {
  let cards = '';
  for (let i = 0; i < 8; i++) {
    let rows = '';
    for (let r = 0; r < 4; r++) rows += `<div class="sk-listrow"><span class="sk sk-line" style="width:65%"></span><span class="sk sk-num"></span></div>`;
    cards += `<div class="card sk-card" aria-hidden="true"><div class="sk sk-line" style="width:55%"></div>${rows}</div>`;
  }
  return `<div class="grid grid-cats">${cards}</div>`;
}

function board(title, list, unit, alive) {
  const items = (list || []).filter((x) => x && x.val != null);
  if (!items.length) {
    return `<div class="board card"><div class="board-title">${esc(title)}</div><div class="sub-inline muted">No data yet.</div></div>`;
  }
  const max = Math.max(...items.map((x) => Number(x.val) || 0)) || 1;
  const rows = items.slice(0, 12).map((x, i) => {
    const dead = isDead(alive, { abbr: x.team, name: x.team });
    const m = x.matches != null ? ` · ${esc(x.matches)} ${Number(x.matches) === 1 ? 'match' : 'matches'}` : '';
    const out = dead ? ' · <span class="out-mark">out</span>' : '';
    return `<div class="board-row${dead ? ' row-out' : ''}">
      <span class="br-rank mono">${i + 1}</span>
      <div class="br-main">
        <div class="br-top">${playerLink(x.athleteId, x.name || '', 'br-name')}<span class="br-val mono">${esc(x.val)}</span></div>
        <div class="br-meta micro muted">${esc(x.team || '')}${m}${out}</div>
        ${meter((Number(x.val) || 0) / max * 100, i === 0)}
      </div>
    </div>`;
  }).join('');
  return `<div class="board card">
    <div class="board-title">${esc(title)}<span class="board-unit micro muted">${esc(unit || '')}</span></div>
    <div class="board-rows">${rows}</div>
  </div>`;
}

function catCard(c, names, alive) {
  const leaders = (c.leaders || []).slice(0, 8);
  const rows = leaders.map((l, i) => {
    const a = names.get(String(l.athleteId));
    const nm = (a && a.name) || (l.athleteId != null ? '#' + l.athleteId : '—');
    const val = l.displayValue != null ? l.displayValue : (l.value != null ? l.value : '');
    const tid = l.teamId != null ? l.teamId : (a && a.teamId);
    const dead = isDead(alive, { teamId: tid });
    let out = '';
    if (dead) {
      const team = lookupTeam(alive, { teamId: tid });
      const abbr = team && team.abbr ? `<span class="cr-abbr micro muted">${esc(team.abbr)}</span>` : '';
      out = `${abbr}<span class="out-mark">out</span>`;
    }
    return `<div class="cat-row${dead ? ' row-out' : ''}">
      <span class="cr-rank mono">${i + 1}</span>
      <span class="cr-name">${playerLink(l.athleteId, nm, 'cr-player')}${out}</span>
      <span class="cr-val mono">${esc(val)}</span>
    </div>`;
  }).join('');
  return `<div class="cat-card card">
    <div class="cat-title micro">${esc(c.label || c.key || '')}</div>
    <div class="cat-rows">${rows}</div>
  </div>`;
}
