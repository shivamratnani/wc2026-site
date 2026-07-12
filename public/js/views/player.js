// views/player.js — athlete profile and 2026 World Cup tournament stats.
import { fetchJSON } from '../api.js';
import { esc, fmtDate } from '../format.js';
import { errorState, safeUrl } from './_shared.js';

const FIELD_SNAPSHOT = [
  ['appearances', 'Apps'], ['starts', 'Starts'], ['minutes', 'Minutes'],
  ['totalGoals', 'Goals'], ['goalAssists', 'Assists'], ['totalShots', 'Shots'],
  ['shotsOnTarget', 'On target'], ['bigChanceCreated', 'Chances created'],
];
const KEEPER_SNAPSHOT = [
  ['appearances', 'Apps'], ['starts', 'Starts'], ['minutes', 'Minutes'],
  ['saves', 'Saves'], ['cleanSheet', 'Clean sheets'], ['goalsConceded', 'Goals against'],
  ['shotsFaced', 'Shots faced'], ['penaltyKicksSaved', 'Penalties saved'],
];
const STAT_GROUPS = [
  ['Attacking', ['totalGoals', 'goalAssists', 'totalShots', 'shotsOnTarget', 'shotAssists', 'bigChanceCreated', 'bigChanceMissed', 'attemptsInBox', 'attemptsOutBox', 'offsides']],
  ['Passing', ['totalPasses', 'accuratePasses', 'passPct', 'totalCrosses', 'accurateCrosses', 'totalThroughBalls', 'accurateThroughBalls']],
  ['Defending', ['totalTackles', 'effectiveTackles', 'interceptions', 'recoveries', 'blockedShots', 'totalClearance', 'duels', 'duelsWon', 'foulsCommitted']],
  ['Goalkeeping', ['saves', 'cleanSheet', 'goalsConceded', 'shotsFaced', 'penaltyKicksFaced', 'penaltyKicksSaved', 'shootOutKicksFaced', 'shootOutKicksSaved']],
  ['Discipline', ['yellowCards', 'redCards', 'foulsCommitted', 'foulsSuffered']],
];

export function mount(root, params) {
  const id = params.id;
  root.innerHTML = `<div class="view view-player"><div class="wrap">
    <button type="button" class="back-link" id="player-back"><span aria-hidden="true">←</span> Back</button>
    <div id="player-body">${profileSkeleton()}</div>
  </div></div>`;
  const body = root.querySelector('#player-body');
  root.querySelector('#player-back').addEventListener('click', () => {
    if (window.history.length > 1) window.history.back();
    else window.location.hash = '#/leaders';
  });
  let alive = true;

  async function load() {
    try {
      const data = await fetchJSON('/api/player?id=' + encodeURIComponent(id));
      if (alive) render(body, data);
    } catch (error) {
      if (alive) errorState(body, { title: 'Player unavailable', note: error.message, onRetry: load });
    }
  }

  load();
  return { destroy() { alive = false; } };
}

function render(root, data) {
  const player = data.player || {};
  if (player.name) document.title = 'WC26 · ' + player.name;
  const stats = data.stats || {};
  const keeper = /goalkeeper|keeper|^gk$/i.test(player.position || player.positionAbbr || '');
  const snapshot = (keeper ? KEEPER_SNAPSHOT : FIELD_SNAPSHOT)
    .filter(([key]) => stats[key]);
  const detailGroups = STAT_GROUPS.map(([title, keys]) => ({
    title,
    rows: keys.filter(key => stats[key] && Number(stats[key].value) !== 0).map(key => [key, stats[key]]),
  })).filter(group => group.rows.length);

  root.innerHTML = `<header class="player-hero">
    <div class="player-photo-wrap">${playerImage(player)}</div>
    <div class="player-intro">
      <div class="micro muted">${esc([data.team?.abbr, player.position].filter(Boolean).join(' · '))}</div>
      <h2 class="player-name">${esc(player.name || 'Unknown player')}</h2>
      <div class="player-affiliations">
        ${teamLine(data.team, 'World Cup team')}
        ${teamLine(data.club, 'Club')}
      </div>
    </div>
  </header>

  ${snapshot.length ? `<section class="player-snapshot" aria-label="Tournament snapshot">
    ${snapshot.map(([key, label]) => statTile(label, stats[key], key)).join('')}
  </section>` : ''}

  <div class="player-layout">
    <main class="player-main">
      <div class="panel-head"><h3 class="panel-title">2026 World Cup stats</h3></div>
      ${detailGroups.length ? `<div class="player-stat-groups">${detailGroups.map(statGroup).join('')}</div>` : '<div class="sub-inline muted">No tournament statistics posted yet.</div>'}
    </main>
    <aside class="player-bio">
      <div class="panel-head"><h3 class="panel-title">Player info</h3></div>
      <dl class="bio-list">
        ${bioRow('Full name', player.fullName)}
        ${bioRow('Number', player.jersey != null ? '#' + player.jersey : '')}
        ${bioRow('Position', player.position)}
        ${bioRow('Age', player.age)}
        ${bioRow('Born', player.dateOfBirth ? fmtDate(player.dateOfBirth, { month: 'long', day: 'numeric', year: 'numeric' }) : '')}
        ${bioRow('Birthplace', player.birthPlace)}
        ${bioRow('Citizenship', player.citizenship)}
        ${bioRow('Height', player.height)}
        ${bioRow('Weight', player.weight)}
      </dl>
      ${player.espnUrl ? `<a class="profile-source micro" href="${esc(safeUrl(player.espnUrl))}" target="_blank" rel="noopener">ESPN profile ↗</a>` : ''}
    </aside>
  </div>`;
}

function playerImage(player) {
  if (player.headshot) {
    return `<img class="player-photo" src="${esc(safeUrl(player.headshot))}" alt="${esc(player.name || 'Player')}" width="180" height="180">`;
  }
  const initials = String(player.name || '?').split(/\s+/).slice(0, 2).map(part => part.charAt(0)).join('');
  return `<div class="player-photo player-initials" aria-hidden="true">${esc(initials)}</div>`;
}

function teamLine(team, label) {
  if (!team) return '';
  const logo = team.logo ? `<img src="${esc(safeUrl(team.logo))}" alt="" width="22" height="22">` : '';
  return `<div class="player-team"><span>${logo}<b>${esc(team.name || team.abbr || '')}</b></span><small class="micro muted">${esc(label)}</small></div>`;
}

function statTile(label, stat, key) {
  return `<div class="player-stat"><span class="player-stat-value mono">${esc(statValue(stat, key))}</span><span class="micro muted">${esc(label)}</span></div>`;
}

function statGroup(group) {
  return `<section class="player-stat-group">
    <h4 class="micro">${esc(group.title)}</h4>
    <div>${group.rows.map(([key, stat]) => `<div class="player-stat-row"><span>${esc(stat.label || key)}</span><b class="mono">${esc(statValue(stat, key))}</b></div>`).join('')}</div>
  </section>`;
}

function statValue(stat, key) {
  const value = Number(stat && stat.value);
  if (/Pct$/i.test(key) && Number.isFinite(value)) return Math.round(value * 100) + '%';
  return stat && stat.displayValue != null ? stat.displayValue : (Number.isFinite(value) ? String(value) : '');
}

function bioRow(label, value) {
  if (value == null || value === '') return '';
  return `<div><dt class="micro muted">${esc(label)}</dt><dd>${esc(value)}</dd></div>`;
}

function profileSkeleton() {
  return `<div class="player-hero" aria-hidden="true">
    <span class="sk player-photo"></span>
    <div class="sk-card"><span class="sk sk-line" style="width:34%"></span><span class="sk sk-line" style="width:68%;height:34px"></span><span class="sk sk-line" style="width:48%"></span></div>
  </div>`;
}
