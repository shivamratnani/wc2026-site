// app.js — hash router + persistent nav live-status chip.
import * as matches from './views/matches.js';
import * as matchView from './views/match.js';
import * as playerView from './views/player.js';
import * as teamView from './views/team.js';
import * as clubView from './views/club.js';
import * as bracket from './views/bracket.js';
import * as groups from './views/groups.js';
import * as leaders from './views/leaders.js';
import * as markets from './views/markets.js';
import { fetchJSON, Poller } from './api.js';
import { esc, fmtTime } from './format.js';

const ROUTES = [
  { test: (h) => h === '#/player' || /^#\/player\//.test(h), view: playerView, nav: null, title: 'Player', params: (h) => ({ id: decodeURIComponent(h.replace(/^#\/player\/?/, '')) }) },
  { test: (h) => h === '#/team' || /^#\/team\//.test(h), view: teamView, nav: null, title: 'Team', params: (h) => ({ id: decodeURIComponent(h.replace(/^#\/team\/?/, '')) }) },
  { test: (h) => h === '#/club' || /^#\/club\//.test(h), view: clubView, nav: null, title: 'Club', params: (h) => ({ id: decodeURIComponent(h.replace(/^#\/club\/?/, '')) }) },
  { test: (h) => h === '#/match' || /^#\/match\//.test(h), view: matchView, nav: null, title: 'Match', params: (h) => ({ id: decodeURIComponent(h.replace(/^#\/match\/?/, '')) }) },
  { test: (h) => h === '#/bracket', view: bracket, nav: 'bracket', title: 'Bracket' },
  { test: (h) => h === '#/groups', view: groups, nav: 'groups', title: 'Groups' },
  { test: (h) => h === '#/leaders', view: leaders, nav: 'leaders', title: 'Leaders' },
  { test: (h) => h === '#/markets', view: markets, nav: 'markets', title: 'Markets' },
  { test: () => true, view: matches, nav: 'matches', title: 'Matches' },
];

const viewEl = document.getElementById('view');
let current = null;

function setNav(key) {
  document.querySelectorAll('[data-nav]').forEach((a) => {
    if (key && a.dataset.nav === key) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
}

function route() {
  const hash = location.hash || '#/';
  const r = ROUTES.find((x) => x.test(hash)) || ROUTES[ROUTES.length - 1];

  if (current && typeof current.destroy === 'function') {
    try { current.destroy(); } catch (_) { /* ignore teardown errors */ }
  }
  current = null;
  viewEl.replaceChildren();
  window.scrollTo(0, 0);
  setNav(r.nav);
  document.title = 'WC26 · ' + r.title;

  const params = r.params ? r.params(hash) : {};
  try {
    current = r.view.mount(viewEl, params);
  } catch (e) {
    viewEl.innerHTML = `<div class="wrap"><div class="state state-error"><div class="state-title">This view failed to load</div><div class="state-note">${esc((e && e.message) || '')}</div></div></div>`;
  }
}

window.addEventListener('hashchange', route);
route();

// ---- persistent nav live-status chip ------------------------------

const chip = document.getElementById('status-chip');

async function updateChip() {
  if (!chip) return;
  try {
    const d = await fetchJSON('/api/live', { timeout: 8000 });
    const nLive = (d.matches || []).filter((m) => m.state === 'in').length;
    chip.title = 'Updated ' + fmtTime(new Date().toISOString());
    if (d.anyLive || nLive) {
      chip.className = 'status-chip is-live';
      chip.innerHTML = `<span class="live-dot" aria-hidden="true"></span><span class="sc-txt mono">${nLive} live</span>`;
      chipPoller.setInterval(30000);
    } else {
      chip.className = 'status-chip';
      chip.innerHTML = `<span class="idle-dot" aria-hidden="true"></span><span class="sc-txt mono">${esc(d.stage || 'idle')}</span>`;
      chipPoller.setInterval(120000);
    }
  } catch (_) {
    chip.className = 'status-chip is-err';
    chip.innerHTML = `<span class="idle-dot" aria-hidden="true"></span><span class="sc-txt mono">offline</span>`;
    chipPoller.setInterval(60000);
  }
}

const chipPoller = new Poller(updateChip, 60000);
chipPoller.start();

// ---- theme toggle (dark is default; persists in localStorage) -----

(function initTheme() {
  const toggle = document.getElementById('theme-toggle');
  if (!toggle) return;

  const current = () => (document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark');
  const label = () => {
    toggle.setAttribute('aria-label', current() === 'light' ? 'Switch to dark theme' : 'Switch to light theme');
  };

  toggle.addEventListener('click', () => {
    const next = current() === 'light' ? 'dark' : 'light';
    if (next === 'light') document.documentElement.setAttribute('data-theme', 'light');
    else document.documentElement.removeAttribute('data-theme');
    try { localStorage.setItem('wc26-theme', next); } catch (_) { /* private mode */ }
    label();
  });

  label();
})();
