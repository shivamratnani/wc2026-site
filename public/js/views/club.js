// views/club.js — club-level view of its players' 2026 World Cup output.
import { fetchJSON } from '../api.js';
import { esc } from '../format.js';
import { errorState, meter, safeUrl } from './_shared.js';

const LEAGUE_NAMES = {
  'eng.1': 'Premier League', 'esp.1': 'LaLiga', 'ger.1': 'Bundesliga',
  'ita.1': 'Serie A', 'fra.1': 'Ligue 1', 'usa.1': 'MLS',
};
const SNAPSHOT = [
  ['players', 'WC players'], ['countries', 'Countries'], ['appearances', 'Apps'], ['starts', 'Starts'],
  ['minutes', 'Minutes'], ['totalGoals', 'Goals'], ['goalAssists', 'Assists'], ['saves', 'Saves'],
];
const LEADER_CATEGORIES = [
  ['totalGoals', 'Goals'], ['goalAssists', 'Assists'], ['minutes', 'Minutes'],
  ['shotsOnTarget', 'Shots on target'], ['bigChanceCreated', 'Chances created'],
  ['effectiveTackles', 'Tackles won'], ['accuratePasses', 'Accurate passes'], ['saves', 'Saves'],
];

export function mount(root, params) {
  const id = params.id;
  root.innerHTML = `<div class="view view-club"><div class="wrap">
    <button type="button" class="back-link" id="club-back"><span aria-hidden="true">←</span> Back</button>
    <div id="club-body">${clubSkeleton()}</div>
  </div></div>`;
  const body = root.querySelector('#club-body');
  root.querySelector('#club-back').addEventListener('click', () => {
    if (window.history.length > 1) window.history.back();
    else window.location.hash = '#/leaders';
  });
  let alive = true;

  async function load() {
    try {
      const data = await fetchJSON('/api/club?id=' + encodeURIComponent(id));
      if (alive) render(body, data);
    } catch (error) {
      if (alive) errorState(body, { title: 'Club unavailable', note: error.message, onRetry: load });
    }
  }

  load();
  return { destroy() { alive = false; } };
}

function render(root, data) {
  const club = data.club || {};
  const totals = data.totals || {};
  const players = Array.isArray(data.players) ? data.players : [];
  if (club.name) document.title = 'WC26 · ' + club.name;
  const leaderCards = LEADER_CATEGORIES.map(([key, label]) => leaderCard(key, label, players)).filter(Boolean);
  const countries = countryGroups(players);
  const positions = positionGroups(players);
  const league = LEAGUE_NAMES[club.league] || club.league || 'Club';

  root.innerHTML = `<header class="club-hero">
    <div class="club-crest">${club.logo ? `<img src="${esc(safeUrl(club.logo))}" alt="${esc(club.name || 'Club')} crest" width="150" height="150">` : `<span class="club-crest-fallback mono">${esc(club.abbr || '?')}</span>`}</div>
    <div class="club-intro">
      <div class="micro muted">${esc(club.abbr || '')} · ${esc(league)}</div>
      <h2 class="club-page-name">${esc(club.name || 'Unknown club')}</h2>
      <div class="club-summary">World Cup output from <b>${esc(totals.players || 0)}</b> players across <b>${esc(totals.countries || 0)}</b> national teams.</div>
    </div>
  </header>

  <section class="club-snapshot" aria-label="Club World Cup totals">
    ${SNAPSHOT.map(([key, label]) => `<div class="club-snapshot-stat"><span class="club-snapshot-value mono">${esc(totals[key] ?? 0)}</span><span class="micro muted">${esc(label)}</span></div>`).join('')}
  </section>

  ${players.length ? `<div class="club-layout">
    <main class="club-main">
      <section class="club-section">
        <div class="panel-head"><h3 class="panel-title">Top performers</h3><span class="micro muted">2026 World Cup</span></div>
        <div class="club-leader-grid">${leaderCards.join('')}</div>
      </section>

      <section class="club-section">
        <div class="panel-head"><h3 class="panel-title">World Cup contingent</h3><span class="micro muted">${esc(players.length)} players</span></div>
        ${playerTable(players)}
      </section>
    </main>

    <aside class="club-side">
      <section class="club-side-section">
        <div class="panel-head"><h3 class="panel-title">Countries represented</h3><span class="micro muted">${esc(countries.length)}</span></div>
        <div class="club-country-list">${countries.map(countryRow).join('')}</div>
      </section>
      <section class="club-side-section">
        <div class="panel-head"><h3 class="panel-title">Squad mix</h3></div>
        <div class="club-position-list">${positions.map(positionRow).join('')}</div>
      </section>
      ${club.espnUrl ? `<a class="profile-source micro" href="${esc(safeUrl(club.espnUrl))}" target="_blank" rel="noopener">ESPN club page ↗</a>` : ''}
    </aside>
  </div>` : `<div class="state state-empty"><span class="state-mark" aria-hidden="true">—</span><div class="state-title">No World Cup players</div><div class="state-note">No current club player has recorded a 2026 tournament appearance.</div></div>`}`;
}

function value(player, key) {
  return Number(player.stats?.[key]?.value) || 0;
}

function shownValue(player, key) {
  const stat = player.stats?.[key];
  return stat?.displayValue ?? String(value(player, key));
}

function leaderCard(key, label, players) {
  const ranked = players.filter(player => value(player, key) > 0)
    .sort((a, b) => value(b, key) - value(a, key) || String(a.name).localeCompare(String(b.name)))
    .slice(0, 5);
  if (!ranked.length) return '';
  const max = value(ranked[0], key) || 1;
  return `<section class="club-leader-card card">
    <div class="club-leader-head"><h4>${esc(label)}</h4><span class="micro muted">Top ${esc(ranked.length)}</span></div>
    <div>${ranked.map((player, index) => clubLeaderRow(player, index, key, max)).join('')}</div>
  </section>`;
}

function clubLeaderRow(player, index, key, max) {
  const content = `<span class="mono muted">${index + 1}</span>
    <div class="club-leader-player"><span class="club-leader-name">${esc(player.name || 'Unknown player')}</span>${meter(value(player, key) / max * 100, index === 0)}</div>
    <b class="mono">${esc(shownValue(player, key))}</b>`;
  return player.id != null
    ? `<a class="club-leader-row" href="#/player/${encodeURIComponent(player.id)}">${content}</a>`
    : `<div class="club-leader-row">${content}</div>`;
}

function playerTable(players) {
  const head = `<div class="club-player-head micro muted"><span>Player</span><span>Nation</span><span>Pos</span><span>Apps</span><span>Min</span><span>G</span><span>A</span></div>`;
  const rows = players.map(player => {
    const content = `<span class="club-player-name">${esc(player.name || 'Unknown player')}</span>
      <span class="club-player-country">${player.countryFlag ? `<img src="${esc(safeUrl(player.countryFlag))}" alt="" width="20" height="14" loading="lazy">` : ''}${esc(player.country || '—')}</span>
      <span class="mono muted">${esc(player.positionAbbr || '—')}</span>
      <span class="mono">${esc(shownValue(player, 'appearances'))}</span>
      <span class="mono">${esc(shownValue(player, 'minutes'))}</span>
      <span class="mono">${esc(shownValue(player, 'totalGoals'))}</span>
      <span class="mono">${esc(shownValue(player, 'goalAssists'))}</span>`;
    return player.id != null
      ? `<a class="club-player-row" href="#/player/${encodeURIComponent(player.id)}">${content}</a>`
      : `<div class="club-player-row">${content}</div>`;
  }).join('');
  return `<div class="club-player-scroll" tabindex="0" aria-label="Club players at the World Cup"><div class="club-player-table">${head}${rows}</div></div>`;
}

function countryGroups(players) {
  const groups = new Map();
  for (const player of players) {
    const key = player.country || 'Unknown';
    if (!groups.has(key)) groups.set(key, { name: key, flag: player.countryFlag, players: 0, goals: 0, assists: 0 });
    const group = groups.get(key);
    group.players += 1;
    group.goals += value(player, 'totalGoals');
    group.assists += value(player, 'goalAssists');
  }
  return [...groups.values()].sort((a, b) => b.players - a.players || b.goals - a.goals || a.name.localeCompare(b.name));
}

function countryRow(country) {
  const playerLabel = country.players === 1 ? 'player' : 'players';
  return `<div class="club-country-row">
    <span>${country.flag ? `<img src="${esc(safeUrl(country.flag))}" alt="" width="22" height="15" loading="lazy">` : ''}<b>${esc(country.name)}</b></span>
    <span class="mono">${esc(country.players)}<small class="muted"> ${playerLabel}</small></span>
    <small class="muted">${esc(country.goals)} G · ${esc(country.assists)} A</small>
  </div>`;
}

function positionGroups(players) {
  const labels = { G: 'Goalkeepers', D: 'Defenders', M: 'Midfielders', F: 'Forwards' };
  const order = ['G', 'D', 'M', 'F'];
  return order.map(key => ({ key, label: labels[key], count: players.filter(player => player.positionAbbr === key).length })).filter(item => item.count);
}

function positionRow(position) {
  return `<div><span>${esc(position.label)}</span><b class="mono">${esc(position.count)}</b></div>`;
}

function clubSkeleton() {
  return `<div class="club-hero" aria-hidden="true">
    <span class="sk club-crest"></span>
    <div class="sk-card"><span class="sk sk-line" style="width:34%"></span><span class="sk sk-line" style="width:62%;height:34px"></span><span class="sk sk-line" style="width:52%"></span></div>
  </div>`;
}
