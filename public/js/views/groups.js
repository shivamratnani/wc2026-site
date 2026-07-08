// views/groups.js — group-stage standings.
import { fetchJSON, Poller } from '../api.js';
import { esc } from '../format.js';
import { errorState, emptyState } from './_shared.js';

export function mount(root) {
  root.innerHTML = `<div class="view view-groups"><div class="wrap">
    <div class="sec-head">
      <h2 class="sec-title">Group stage</h2>
      <p class="sec-sub">Standings across all twelve groups. Top two plus the eight best third-placed sides advance to the round of 32.</p>
    </div>
    <div id="g-body">${skeletonGroups()}</div>
  </div></div>`;

  const body = root.querySelector('#g-body');
  let poller;

  async function load() {
    let data;
    try {
      data = await fetchJSON('/api/standings');
    } catch (e) {
      if (!body.querySelector('.group-card')) {
        errorState(body, { title: 'Standings unavailable', note: e.message, onRetry: load });
      }
      return;
    }
    const groups = Array.isArray(data.groups) ? data.groups : [];
    if (!groups.length) {
      emptyState(body, { title: 'No standings yet', note: 'Tables populate once group play begins.' });
      return;
    }
    body.innerHTML = `<div class="grid grid-groups">${groups.map(groupCard).join('')}</div>`;
  }

  poller = new Poller(load, 300000);
  poller.start();
  return { destroy() { poller.stop(); } };
}

function skeletonGroups() {
  let cards = '';
  for (let i = 0; i < 6; i++) {
    let rows = '';
    for (let r = 0; r < 4; r++) rows += `<div class="sk-listrow"><span class="sk sk-line" style="width:60%"></span><span class="sk sk-num"></span></div>`;
    cards += `<div class="card sk-card" aria-hidden="true"><div class="sk sk-line" style="width:40%"></div>${rows}</div>`;
  }
  return `<div class="grid grid-groups">${cards}</div>`;
}

function num(v) {
  return v == null || v === '' ? '<span class="zero">·</span>' : esc(v);
}

function fmtGD(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return num(v);
  return n > 0 ? '+' + n : String(n);
}

function groupCard(g) {
  const name = /group/i.test(g.name || '') ? g.name : 'Group ' + (g.name || '');
  const rows = (g.entries || []).map((e, i) => `<tr class="${e.advanced ? 'is-adv' : ''}">
    <td class="r mono rank">${esc(e.rank ?? i + 1)}</td>
    <td class="l team"><span class="team-cell">${e.logo ? `<img class="logo" src="${esc(e.logo)}" alt="" loading="lazy" width="18" height="18">` : '<span class="logo logo-ph" aria-hidden="true"></span>'}<span class="tname">${esc(e.team || e.abbr || '')}</span></span></td>
    <td class="r mono">${num(e.played)}</td>
    <td class="r mono">${num(e.wins)}</td>
    <td class="r mono">${num(e.draws)}</td>
    <td class="r mono">${num(e.losses)}</td>
    <td class="r mono">${num(e.gf)}</td>
    <td class="r mono">${num(e.ga)}</td>
    <td class="r mono gd">${fmtGD(e.gd)}</td>
    <td class="r mono pts">${num(e.points)}</td>
  </tr>`).join('');

  return `<div class="group-card card">
    <div class="group-title"><span class="gt-name">${esc(name)}</span></div>
    <div class="tbl-scroll"><table class="tbl standings"><thead><tr>
      <th class="r">#</th><th class="l">Team</th>
      <th class="r">P</th><th class="r">W</th><th class="r">D</th><th class="r">L</th>
      <th class="r">GF</th><th class="r">GA</th><th class="r">GD</th><th class="r">Pts</th>
    </tr></thead><tbody>${rows}</tbody></table></div>
  </div>`;
}
