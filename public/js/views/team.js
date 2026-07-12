// views/team.js — national team profile and 2026 World Cup dashboard.
import { fetchJSON } from '../api.js';
import { esc, fmtDate, fmtTime, resultChip } from '../format.js';
import { errorState, meter, playerLink, safeUrl } from './_shared.js';

const SNAPSHOT = [
  ['played', 'Matches'], ['wins', 'Wins'], ['draws', 'Draws'], ['losses', 'Losses'],
  ['totalGoals', 'Goals'], ['goalsConceded', 'Against'], ['cleanSheet', 'Clean sheets'], ['passPct', 'Pass accuracy'],
];
const STAT_GROUPS = [
  ['Attacking', ['totalGoals', 'goalAssists', 'totalShots', 'shotsOnTarget', 'shotAssists', 'bigChanceCreated', 'bigChanceMissed', 'attemptsInBox']],
  ['Passing', ['totalPasses', 'accuratePasses', 'passPct', 'totalCrosses', 'accurateCrosses', 'totalThroughBalls', 'accurateThroughBalls']],
  ['Defending', ['totalTackles', 'effectiveTackles', 'interceptions', 'recoveries', 'blockedShots', 'totalClearance', 'duels', 'duelsWon']],
  ['Goalkeeping', ['saves', 'cleanSheet', 'goalsConceded', 'shotsFaced', 'penaltyKicksFaced', 'penaltyKicksSaved']],
  ['Discipline', ['foulsCommitted', 'foulsSuffered', 'yellowCards', 'redCards']],
];
const POSITION_ORDER = ['G', 'D', 'M', 'F'];
const POSITION_LABELS = { G: 'Goalkeepers', D: 'Defenders', M: 'Midfielders', F: 'Forwards' };

export function mount(root, params) {
  const id = params.id;
  root.innerHTML = `<div class="view view-team"><div class="wrap">
    <button type="button" class="back-link" id="team-back"><span aria-hidden="true">←</span> Back</button>
    <div id="team-body">${teamSkeleton()}</div>
  </div></div>`;
  const body = root.querySelector('#team-body');
  root.querySelector('#team-back').addEventListener('click', () => {
    if (window.history.length > 1) window.history.back();
    else window.location.hash = '#/groups';
  });
  let alive = true;

  async function load() {
    try {
      const data = await fetchJSON('/api/team?id=' + encodeURIComponent(id));
      if (alive) render(body, data);
    } catch (error) {
      if (alive) errorState(body, { title: 'Team unavailable', note: error.message, onRetry: load });
    }
  }

  load();
  return { destroy() { alive = false; } };
}

function render(root, data) {
  const team = data.team || {};
  if (team.name) document.title = 'WC26 · ' + team.name;
  const stats = data.stats || {};
  const record = data.record || {};
  const snapshot = SNAPSHOT.map(([key, label]) => [key, label, snapshotValue(key, record, stats)]);
  const statGroups = STAT_GROUPS.map(([title, keys]) => ({
    title,
    rows: keys.filter(key => stats[key] && Number(stats[key].value) !== 0).map(key => [key, stats[key]]),
  })).filter(group => group.rows.length);
  const matches = Array.isArray(data.matches) ? data.matches : [];
  const leaders = Array.isArray(data.leaders) ? data.leaders : [];
  const roster = Array.isArray(data.roster) ? data.roster : [];

  root.innerHTML = `<header class="team-hero">
    <div class="team-crest">${team.logo ? `<img src="${esc(safeUrl(team.logo))}" alt="${esc(team.name || 'Team')} crest" width="150" height="150">` : `<span class="team-crest-fallback mono">${esc(team.abbr || '?')}</span>`}</div>
    <div class="team-intro">
      <div class="micro muted">${esc(team.abbr || '')} · 2026 FIFA World Cup</div>
      <h2 class="team-page-name">${esc(team.name || 'Unknown team')}</h2>
      ${teamProgress(matches)}
    </div>
  </header>

  <section class="team-snapshot" aria-label="Tournament record">
    ${snapshot.map(([key, label, value]) => `<div class="team-snapshot-stat"><span class="team-snapshot-value mono">${esc(formatSnapshot(key, value))}</span><span class="micro muted">${esc(label)}</span></div>`).join('')}
  </section>

  <div class="team-layout">
    <main class="team-main">
      <section class="team-section">
        <div class="panel-head"><h3 class="panel-title">Team leaders</h3></div>
        ${leaders.length ? `<div class="team-leader-grid">${leaders.map(leaderCard).join('')}</div>` : '<div class="sub-inline muted">No team leaders posted yet.</div>'}
      </section>

      <section class="team-section">
        <div class="panel-head"><h3 class="panel-title">Tournament matches</h3><span class="micro muted">${esc(matches.length)} fixtures</span></div>
        ${matches.length ? `<div class="team-match-list">${matches.map(teamMatch).join('')}</div>` : '<div class="sub-inline muted">No tournament matches found.</div>'}
      </section>

      <section class="team-section">
        <div class="panel-head"><h3 class="panel-title">Team statistics</h3></div>
        ${statGroups.length ? `<div class="team-stat-groups">${statGroups.map(statGroup).join('')}</div>` : '<div class="sub-inline muted">No tournament statistics posted yet.</div>'}
      </section>
    </main>

    <aside class="team-side">
      ${standingPanel(data.standing)}
      <section class="team-side-section">
        <div class="panel-head"><h3 class="panel-title">Squad</h3><span class="micro muted">${esc(roster.length)}</span></div>
        ${rosterPanel(roster)}
      </section>
      ${team.espnUrl ? `<a class="profile-source micro" href="${esc(safeUrl(team.espnUrl))}" target="_blank" rel="noopener">ESPN team page ↗</a>` : ''}
    </aside>
  </div>`;
}

function snapshotValue(key, record, stats) {
  if (['played', 'wins', 'draws', 'losses'].includes(key)) return record[key] ?? 0;
  if (key === 'totalGoals') return stats[key]?.value ?? record.gf ?? 0;
  if (key === 'goalsConceded') return stats[key]?.value ?? record.ga ?? 0;
  return stats[key]?.value ?? 0;
}

function formatSnapshot(key, value) {
  const n = Number(value);
  if (/Pct$/i.test(key) && Number.isFinite(n)) return Math.round(n * 100) + '%';
  return Number.isFinite(n) ? String(n) : value;
}

function teamProgress(matches) {
  const live = matches.find(match => match.state === 'in');
  const next = matches.find(match => match.state === 'pre');
  const completed = matches.filter(match => match.state === 'post');
  const last = completed[completed.length - 1];
  if (live) return `<div class="team-progress"><span class="tag tag-live">Live · ${esc(live.stage || live.detail || '')}</span><span>${esc(live.opponent?.name || '')}</span></div>`;
  if (next) return `<div class="team-progress"><span class="tag">Next · ${esc(next.stage || 'Fixture')}</span><span>${esc(fmtDate(next.date))} · ${esc(fmtTime(next.date))} vs ${esc(next.opponent?.name || '')}</span></div>`;
  if (last?.result === 'L') return `<div class="team-progress"><span class="tag tag-final">Eliminated</span><span>${esc(last.stage || '')}</span></div>`;
  return last ? `<div class="team-progress"><span class="tag tag-final">${esc(last.stage || 'Complete')}</span><span>Last match ${esc(fmtDate(last.date))}</span></div>` : '';
}

function leaderCard(category) {
  const max = Math.max(...category.leaders.map(leader => Number(leader.value) || 0), 1);
  return `<section class="team-leader-card card">
    <div class="team-leader-head"><h4>${esc(category.label || category.key)}</h4><span class="micro muted">Top ${esc(category.leaders.length)}</span></div>
    <div>${category.leaders.map((leader, index) => `<div class="team-leader-row">
      <span class="mono muted">${index + 1}</span>
      <div class="team-leader-player"><div>${playerLink(leader.athleteId, leader.name)}</div>${meter((Number(leader.value) || 0) / max * 100, index === 0)}</div>
      <b class="mono">${esc(leader.displayValue ?? leader.value ?? '')}</b>
    </div>`).join('')}</div>
  </section>`;
}

function teamMatch(match) {
  const opponent = match.opponent || {};
  const isPlayed = match.state === 'post' || match.state === 'in';
  const chip = resultChip(match.result);
  const score = isPlayed
    ? `${esc(match.score ?? '')}<span>–</span>${esc(match.opponentScore ?? '')}${match.pens != null || match.opponentPens != null ? `<small class="mono"> pens ${esc(match.pens ?? '')}–${esc(match.opponentPens ?? '')}</small>` : ''}`
    : `<span class="team-match-time">${esc(fmtTime(match.date))}</span>`;
  return `<a class="team-match-row" href="#/match/${encodeURIComponent(match.id || '')}">
    <div class="team-match-meta"><span class="micro">${esc(match.stage || '')}</span><span class="muted">${esc(fmtDate(match.date))}</span></div>
    <div class="team-match-opponent">${opponent.logo ? `<img src="${esc(safeUrl(opponent.logo))}" alt="" width="28" height="28" loading="lazy">` : ''}<span><small class="muted">${esc(match.homeAway === 'home' ? 'vs' : 'at')}</small> ${esc(opponent.name || opponent.abbr || 'TBD')}</span></div>
    <div class="team-match-score">${match.result ? `<span class="form-chip form-${esc(chip.cls)}">${esc(chip.label)}</span>` : ''}<b class="mono">${score}</b></div>
  </a>`;
}

function statGroup(group) {
  return `<section class="team-stat-group">
    <h4 class="micro">${esc(group.title)}</h4>
    <div>${group.rows.map(([key, stat]) => `<div class="team-stat-row"><span>${esc(stat.label || key)}</span><b class="mono">${esc(statValue(stat, key))}</b></div>`).join('')}</div>
  </section>`;
}

function statValue(stat, key) {
  const value = Number(stat?.value);
  if (/Pct$/i.test(key) && Number.isFinite(value)) return Math.round(value * 100) + '%';
  return stat?.displayValue != null ? stat.displayValue : (Number.isFinite(value) ? String(value) : '');
}

function standingPanel(standing) {
  if (!standing) return '';
  const gd = Number(standing.gd);
  const gdText = Number.isFinite(gd) && gd > 0 ? '+' + gd : String(standing.gd ?? '');
  return `<section class="team-side-section team-standing">
    <div class="panel-head"><h3 class="panel-title">${esc(standing.group || 'Group standing')}</h3><span class="tag${standing.advanced ? ' tag-final' : ''}">${standing.advanced ? 'Advanced' : 'Group stage'}</span></div>
    <div class="team-standing-rank"><span class="mono">#${esc(standing.rank ?? '')}</span><small class="micro muted">Group finish</small></div>
    <div class="team-standing-grid">
      ${standingStat('Pts', standing.points)}${standingStat('W-D-L', `${standing.wins ?? 0}-${standing.draws ?? 0}-${standing.losses ?? 0}`)}
      ${standingStat('Goals', `${standing.gf ?? 0}:${standing.ga ?? 0}`)}${standingStat('GD', gdText)}
    </div>
  </section>`;
}

function standingStat(label, value) {
  return `<div><span class="mono">${esc(value)}</span><small class="micro muted">${esc(label)}</small></div>`;
}

function rosterPanel(roster) {
  if (!roster.length) return '<div class="sub-inline muted">Squad unavailable.</div>';
  const groups = new Map();
  for (const player of roster) {
    const key = POSITION_ORDER.includes(player.positionAbbr) ? player.positionAbbr : 'Other';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(player);
  }
  const order = [...POSITION_ORDER, 'Other'];
  return `<div class="team-roster">${order.filter(key => groups.has(key)).map(key => `<section>
    <h4 class="micro muted">${esc(POSITION_LABELS[key] || 'Squad')}</h4>
    ${groups.get(key).map(player => `<div class="team-roster-row"><span class="mono muted">${esc(player.jersey ?? '·')}</span>${playerLink(player.id, player.name || '', 'team-roster-name')}<span class="micro muted">${esc(player.positionAbbr || '')}</span></div>`).join('')}
  </section>`).join('')}</div>`;
}

function teamSkeleton() {
  return `<div class="team-hero" aria-hidden="true">
    <span class="sk team-crest"></span>
    <div class="sk-card"><span class="sk sk-line" style="width:34%"></span><span class="sk sk-line" style="width:62%;height:34px"></span><span class="sk sk-line" style="width:52%"></span></div>
  </div>`;
}
