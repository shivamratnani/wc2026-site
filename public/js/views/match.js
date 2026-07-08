// views/match.js — single match detail. Sections fail independently.
import { fetchJSON, Poller } from '../api.js';
import { esc, fmtDateTime, minuteBadge, resultChip } from '../format.js';
import { panelHead, oddsCell, twoSidedBar, inlineNote, liveDot } from './_shared.js';

const PLAYER_COLS = [
  { k: 'goals', l: 'G' },
  { k: 'assists', l: 'A' },
  { k: 'shots', l: 'S' },
  { k: 'sot', l: 'SOT' },
  { k: 'fouls', l: 'FC' },
  { k: 'yc', l: 'YC' },
  { k: 'rc', l: 'RC' },
  { k: 'saves', l: 'SV' },
];

export function mount(root, params) {
  const id = params.id;
  root.innerHTML = `<div class="view view-match"><div class="wrap">
    <a class="back-link" href="#/"><span aria-hidden="true">←</span> All matches</a>
    <header id="sec-header" class="match-header">${headerSkeleton()}</header>
    <div class="match-grid">
      <div class="match-main">
        <section id="sec-timeline" class="panel"></section>
        <section id="sec-teamstats" class="panel"></section>
        <section id="sec-lineups" class="panel"></section>
        <section id="sec-playerstats" class="panel"></section>
      </div>
      <aside class="match-side">
        <section id="sec-betting" class="panel"></section>
      </aside>
    </div>
  </div></div>`;

  let poller;
  let live = false;
  let firstLoad = true;
  let propsMounted = false;

  async function load() {
    const [mRes, oRes, pRes] = await Promise.allSettled([
      fetchJSON('/api/match?id=' + encodeURIComponent(id)),
      fetchJSON('/api/odds?id=' + encodeURIComponent(id)),
      fetchJSON('/api/props?id=' + encodeURIComponent(id)),
    ]);

    if (mRes.status === 'fulfilled' && mRes.value) {
      const d = mRes.value;
      live = d.state === 'in';
      renderHeader(d);
      renderTimeline(d);
      renderTeamStats(d);
      renderLineups(d);
      renderPlayerStats(d);
    } else if (firstLoad) {
      renderHeaderError(mRes.reason);
    }

    renderBetting(oRes, pRes);
    firstLoad = false;
    if (poller) poller.setInterval(live ? 15000 : 0);
  }

  function renderBetting(oRes, pRes) {
    const sec = document.getElementById('sec-betting');
    if (!sec) return;
    if (!sec.dataset.init) {
      sec.innerHTML = panelHead('Betting') + `<div id="odds-root"></div><div id="props-root"></div>`;
      sec.dataset.init = '1';
    }
    const oddsRoot = document.getElementById('odds-root');
    const propsRoot = document.getElementById('props-root');

    if (oRes.status === 'fulfilled' && oRes.value) oddsRoot.innerHTML = oddsCard(oRes.value);
    else if (!oddsRoot.innerHTML) oddsRoot.innerHTML = inlineNote('Odds unavailable.');

    if (!propsMounted) {
      if (pRes.status === 'fulfilled' && pRes.value && (pRes.value.types || []).length) {
        mountProps(propsRoot, pRes.value);
        propsMounted = true;
      } else if (!propsRoot.innerHTML) {
        propsRoot.innerHTML = inlineNote('No player props posted.');
      }
    }
  }

  poller = new Poller(load, 15000);
  poller.start();
  return { destroy() { poller.stop(); } };
}

// ---- header -------------------------------------------------------

function headerSkeleton() {
  return `<div class="mh-status"><span class="sk sk-line" style="width:120px"></span></div>
    <div class="mh-score">
      <div class="mh-team"><span class="sk sk-line" style="width:110px"></span></div>
      <div class="mh-mid"><span class="sk sk-line" style="width:70px;height:34px"></span></div>
      <div class="mh-team"><span class="sk sk-line" style="width:110px"></span></div>
    </div>`;
}

function renderHeader(d) {
  const el = document.getElementById('sec-header');
  if (!el) return;
  const h = d.header || {};
  const home = h.home || {};
  const away = h.away || {};
  const isLive = d.state === 'in';
  const isPost = d.state === 'post';
  const showScore = isLive || isPost;

  let badge;
  if (isLive) badge = `<span class="tag tag-live">${liveDot()}${esc(h.detail || 'Live')}</span>`;
  else if (isPost) badge = `<span class="tag tag-final">${esc(h.detail || 'FT')}</span>`;
  else badge = `<span class="tag">${esc(fmtDateTime(h.date))}</span>`;

  const mid = showScore
    ? `<div class="mh-sc mono">${esc(home.score ?? '')}<span class="dash">–</span>${esc(away.score ?? '')}</div>`
    : `<div class="mh-vs">vs</div>`;
  const pens = (home.pens != null || away.pens != null)
    ? `<div class="pens-line mono">pens ${esc(home.pens ?? '')}–${esc(away.pens ?? '')}</div>`
    : '';

  const venueBits = [h.venue, h.date ? fmtDateTime(h.date) : ''].filter(Boolean).map(esc);

  el.innerHTML = `
    <div class="mh-status micro">${esc(h.status || '')} ${badge}</div>
    <div class="mh-score">
      <div class="mh-team">
        <div class="mh-name">${esc(home.team || 'TBD')}</div>
        <div class="mh-form">${formStrip((d.form || {}).home)}</div>
      </div>
      <div class="mh-mid">${mid}${pens}</div>
      <div class="mh-team">
        <div class="mh-name">${esc(away.team || 'TBD')}</div>
        <div class="mh-form">${formStrip((d.form || {}).away)}</div>
      </div>
    </div>
    ${venueBits.length ? `<div class="mh-venue micro muted">${venueBits.join(' · ')}</div>` : ''}`;
}

function renderHeaderError(err) {
  const el = document.getElementById('sec-header');
  if (!el) return;
  el.innerHTML = `<div class="state state-error inline">
    <div class="state-title">Match unavailable</div>
    <div class="state-note">${esc((err && err.message) || 'Could not load this match.')}</div>
  </div>`;
}

function formStrip(arr) {
  if (!Array.isArray(arr) || !arr.length) return '';
  return arr.slice(-5).map((f) => {
    const c = resultChip(f.result);
    const title = [f.opp, f.score].filter(Boolean).join(' ');
    return `<span class="form-chip form-${c.cls}"${title ? ` title="${esc(title)}"` : ''}>${esc(c.label)}</span>`;
  }).join('');
}

// ---- timeline -----------------------------------------------------

function parseMinute(min) {
  const s = String(min == null ? '' : min);
  const base = parseInt(s, 10);
  const extra = s.split('+')[1];
  return (Number.isFinite(base) ? base : 0) + (extra ? (parseInt(extra, 10) || 0) * 0.01 : 0);
}

function eventIcon(type) {
  const t = String(type || '').toLowerCase();
  if (t.includes('own')) return { glyph: '⚽︎', cls: 'ic-owngoal' };
  if (t.includes('goal') || (t.includes('penalty') && !t.includes('miss'))) return { glyph: '⚽︎', cls: 'ic-goal' };
  if (t.includes('yellow')) return { glyph: '', cls: 'ic-yc' };
  if (t.includes('red')) return { glyph: '', cls: 'ic-rc' };
  if (t.includes('sub')) return { glyph: '⇄', cls: 'ic-sub' };
  if (t.includes('var')) return { glyph: '▢', cls: 'ic-var' };
  return { glyph: '•', cls: 'ic-dot' };
}

function renderTimeline(d) {
  const sec = document.getElementById('sec-timeline');
  if (!sec) return;
  const tl = Array.isArray(d.timeline) ? d.timeline.slice() : [];
  if (!tl.length) {
    sec.innerHTML = d.state === 'pre' ? '' : panelHead('Timeline') + inlineNote('No events yet.');
    return;
  }
  tl.sort((a, b) => parseMinute(a.minute) - parseMinute(b.minute));
  const homeId = d.header && d.header.home ? d.header.home.id : undefined;

  const rows = tl.map((ev) => {
    const side = ev.teamId != null ? (String(ev.teamId) === String(homeId) ? 'home' : 'away') : '';
    const ic = eventIcon(ev.type);
    const lead = ev.player ? `<b>${esc(ev.player)}</b>${ev.text ? ' — ' : ''}` : '';
    return `<li class="tl-row tl-${side}">
      <span class="tl-min mono">${esc(minuteBadge(ev.minute))}</span>
      <span class="tl-ic ${ic.cls}" aria-hidden="true">${ic.glyph}</span>
      <span class="tl-txt">${lead}${esc(ev.text || '')}</span>
    </li>`;
  }).join('');
  sec.innerHTML = panelHead('Timeline') + `<ol class="timeline">${rows}</ol>`;
}

// ---- team stats ---------------------------------------------------

function numish(v) {
  const n = Number(String(v == null ? '' : v).replace(/[^0-9.\-]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

function renderTeamStats(d) {
  const sec = document.getElementById('sec-teamstats');
  if (!sec) return;
  const stats = Array.isArray(d.teamStats) ? d.teamStats.slice() : [];
  if (!stats.length) { sec.innerHTML = ''; return; }

  // possession first
  const pi = stats.findIndex((s) => /poss/i.test(s.key || '') || /poss/i.test(s.label || ''));
  if (pi > 0) stats.unshift(stats.splice(pi, 1)[0]);

  const rows = stats.map((s) => `<div class="tstat">
    <span class="tstat-h mono">${esc(s.home ?? '')}</span>
    <div class="tstat-mid">
      <span class="tstat-label micro">${esc(s.label || s.key || '')}</span>
      ${twoSidedBar(numish(s.home), numish(s.away))}
    </div>
    <span class="tstat-a mono">${esc(s.away ?? '')}</span>
  </div>`).join('');
  sec.innerHTML = panelHead('Team stats') + `<div class="tstats">${rows}</div>`;
}

// ---- lineups ------------------------------------------------------

function playerLine(p, isSub) {
  let badge = '';
  if (p.subbedInMinute != null) badge = `<span class="lu-min mono in">${esc(minuteBadge(p.subbedInMinute))}<span aria-hidden="true">↑</span></span>`;
  else if (p.subbedOutMinute != null) badge = `<span class="lu-min mono out">${esc(minuteBadge(p.subbedOutMinute))}<span aria-hidden="true">↓</span></span>`;
  return `<li class="lu-p${isSub ? ' is-sub' : ''}">
    <span class="lu-num mono">${esc(p.jersey ?? '')}</span>
    <span class="lu-name">${esc(p.name || '')}</span>
    ${p.pos ? `<span class="lu-pos micro muted">${esc(p.pos)}</span>` : ''}
    ${badge}
  </li>`;
}

function renderLineups(d) {
  const sec = document.getElementById('sec-lineups');
  if (!sec) return;
  const lineups = Array.isArray(d.lineups) ? d.lineups : [];
  if (!lineups.length) { sec.innerHTML = ''; return; }

  const col = (lu) => {
    const starters = (lu.starters || []).map((p) => playerLine(p, false)).join('');
    const subs = (lu.subs || []).map((p) => playerLine(p, true)).join('');
    return `<div class="lu-col">
      <div class="lu-head">
        <span class="lu-team">${esc(lu.team || '')}</span>
        ${lu.formation ? `<span class="lu-form mono">${esc(lu.formation)}</span>` : ''}
      </div>
      ${starters ? `<ul class="lu-list">${starters}</ul>` : ''}
      ${subs ? `<div class="lu-subhead micro muted">Substitutes</div><ul class="lu-list lu-subs">${subs}</ul>` : ''}
    </div>`;
  };
  sec.innerHTML = panelHead('Lineups') + `<div class="lineups">${lineups.map(col).join('')}</div>`;
}

// ---- player stats -------------------------------------------------

function teamNameFor(d, teamId) {
  const h = (d && d.header) || {};
  if (h.home && String(h.home.id) === String(teamId)) return h.home.team || h.home.abbr || 'Home';
  if (h.away && String(h.away.id) === String(teamId)) return h.away.team || h.away.abbr || 'Away';
  return '';
}

function fmtStat(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return v == null ? '' : esc(v);
  return n === 0 ? '<span class="zero">·</span>' : String(n);
}

function renderPlayerStats(d) {
  const sec = document.getElementById('sec-playerstats');
  if (!sec) return;
  const teams = Array.isArray(d.playerStats) ? d.playerStats : [];
  if (!teams.length) { sec.innerHTML = ''; return; }

  const tables = teams.map((team) => {
    const players = team.players || [];
    if (!players.length) return '';
    const active = PLAYER_COLS.filter((c) => players.some((p) => Number(p[c.k]) > 0));
    const name = teamNameFor(d, team.teamId);
    const head = `<tr><th class="l">${esc(name)}</th>${active.map((c) => `<th class="r">${c.l}</th>`).join('')}</tr>`;
    const rows = players.map((p) => `<tr>
      <td class="l"><span class="ps-name">${esc(p.name || '')}</span>${p.pos ? ` <span class="micro muted">${esc(p.pos)}</span>` : ''}</td>
      ${active.map((c) => `<td class="r mono">${fmtStat(p[c.k])}</td>`).join('')}
    </tr>`).join('');
    return `<div class="ps-table tbl-scroll"><table class="tbl compact"><thead>${head}</thead><tbody>${rows}</tbody></table></div>`;
  }).join('');

  sec.innerHTML = tables.trim()
    ? panelHead('Player stats') + `<div class="pstats">${tables}</div>`
    : '';
}

// ---- betting: odds card -------------------------------------------

function oddsCard(o) {
  const ml = o.moneyline || {};
  const sp = o.spread || {};
  const tot = o.total || {};

  const row = (label, leaf, lineVal) => `<div class="oc-row">
    <span class="oc-label micro">${esc(label)}</span>
    <span class="oc-line mono">${lineVal != null ? esc(lineVal) : ''}</span>
    ${oddsCell(leaf && leaf.open, leaf && leaf.current)}
  </div>`;

  const groups = [];
  if (ml.home || ml.draw || ml.away) {
    groups.push(`<div class="oc-group">
      <div class="oc-gtitle micro muted">Moneyline</div>
      ${row('Home', ml.home)}
      ${ml.draw ? row('Draw', ml.draw) : ''}
      ${row('Away', ml.away)}
    </div>`);
  }
  if (sp.home || sp.away) {
    groups.push(`<div class="oc-group">
      <div class="oc-gtitle micro muted">Spread</div>
      ${row('Home', sp.home, sp.line)}
      ${row('Away', sp.away, sp.line != null ? negate(sp.line) : null)}
    </div>`);
  }
  if (tot.over || tot.under) {
    groups.push(`<div class="oc-group">
      <div class="oc-gtitle micro muted">Total</div>
      ${row('Over', tot.over, tot.line)}
      ${row('Under', tot.under, tot.line)}
    </div>`);
  }

  const meta = [o.provider, o.details].filter(Boolean).map(esc).join(' · ');
  return `<div class="odds-card">
    ${meta ? `<div class="oc-meta micro muted">${meta}</div>` : ''}
    ${groups.join('') || inlineNote('No lines posted.')}
  </div>`;
}

function negate(line) {
  const n = Number(line);
  if (!Number.isFinite(n)) return line;
  return n > 0 ? '-' + n : '+' + Math.abs(n);
}

// ---- betting: props browser (interactive) -------------------------

function prettyType(t) {
  return String(t || '')
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}

function isGoalType(t) {
  return /goal|scorer|anytime/i.test(String(t || ''));
}

function propRow(e) {
  const over = e.over || {};
  const under = e.under || {};
  return `<div class="prop-row">
    <span class="prop-name">${esc(e.name || '')}${e.teamAbbr ? ` <span class="micro muted mono">${esc(e.teamAbbr)}</span>` : ''}</span>
    <span class="prop-line mono">${e.line != null ? esc(e.line) : ''}</span>
    <span class="prop-ou"><span class="prop-ou-k micro">O</span>${oddsCell(over.open, over.current)}</span>
    <span class="prop-ou"><span class="prop-ou-k micro">U</span>${oddsCell(under.open, under.current)}</span>
  </div>`;
}

function mountProps(root, data) {
  const types = (data.types || []).slice();
  types.sort((a, b) => (isGoalType(b.type) ? 1 : 0) - (isGoalType(a.type) ? 1 : 0));

  const total = data.count != null ? data.count : types.reduce((s, t) => s + (t.entries || []).length, 0);
  let activeType = 'all';
  let query = '';
  const expanded = new Set();

  root.innerHTML = `<div class="props">
    <div class="props-head">
      <span class="props-title micro muted">Player props · ${esc(total)}</span>
      <input type="search" class="props-search" placeholder="Search player…" aria-label="Search props by player name">
    </div>
    <div class="chips" id="props-chips"></div>
    <div class="props-body" id="props-body"></div>
  </div>`;

  const chipsEl = root.querySelector('#props-chips');
  const bodyEl = root.querySelector('#props-body');
  const searchEl = root.querySelector('.props-search');

  function renderChips() {
    let html = `<button type="button" class="chip${activeType === 'all' ? ' is-active' : ''}" data-type="all">All</button>`;
    html += types.map((t) => `<button type="button" class="chip${activeType === t.type ? ' is-active' : ''}" data-type="${esc(t.type)}">${esc(prettyType(t.type))} <span class="chip-n mono">${(t.entries || []).length}</span></button>`).join('');
    chipsEl.innerHTML = html;
  }

  function renderBody() {
    const q = query.trim().toLowerCase();
    const shown = types.filter((t) => activeType === 'all' || t.type === activeType);
    let html = '';
    for (const t of shown) {
      let entries = t.entries || [];
      if (q) entries = entries.filter((e) => String(e.name || '').toLowerCase().includes(q));
      if (!entries.length) continue;
      const isExp = expanded.has(t.type) || !!q;
      const top = isExp ? entries : entries.slice(0, 6);
      const more = !q && entries.length > 6
        ? `<button type="button" class="link-btn" data-expand="${esc(t.type)}">${isExp ? 'Show less' : 'Show all ' + entries.length}</button>`
        : '';
      html += `<div class="prop-group">
        <div class="prop-gtitle"><span class="micro">${esc(prettyType(t.type))}</span><span class="micro muted mono">${entries.length}</span></div>
        <div class="prop-rows">${top.map(propRow).join('')}</div>
        ${more}
      </div>`;
    }
    bodyEl.innerHTML = html || inlineNote('No props match that search.');
  }

  chipsEl.addEventListener('click', (e) => {
    const b = e.target.closest('[data-type]');
    if (!b) return;
    activeType = b.dataset.type;
    renderChips();
    renderBody();
  });
  bodyEl.addEventListener('click', (e) => {
    const b = e.target.closest('[data-expand]');
    if (!b) return;
    const ty = b.dataset.expand;
    if (expanded.has(ty)) expanded.delete(ty);
    else expanded.add(ty);
    renderBody();
  });
  searchEl.addEventListener('input', () => {
    query = searchEl.value;
    renderBody();
  });

  renderChips();
  renderBody();
}
