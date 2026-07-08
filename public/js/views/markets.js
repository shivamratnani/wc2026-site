// views/markets.js — three panels: live match lines, prediction markets,
// tournament futures (live or a static July-7 snapshot fallback).
import { fetchJSON, Poller } from '../api.js';
import { esc, fmtDateTime, impliedPct, pct01 } from '../format.js';
import { skeletonRows, errorState, emptyState, oddsCell, liveDot, meter, safeUrl, sep, inlineNote } from './_shared.js';

// Snapshot carried over from v1 — shown when /api/markets is unconfigured.
const FALLBACK_MARKETS = {
  winnerOdds: [
    { t: 'France', o: '+175' }, { t: 'Spain', o: '+400' }, { t: 'Argentina', o: '+450' },
    { t: 'England', o: '+500' }, { t: 'Belgium', o: '+1400' }, { t: 'Norway', o: '+1800' },
    { t: 'Morocco', o: '+2500' },
  ],
  bootOdds: [
    { t: 'Kylian Mbappé — 7 goals', o: '+100' }, { t: 'Lionel Messi — 8 goals', o: '+165' },
    { t: 'Erling Haaland — 7 goals', o: '+700' }, { t: 'Harry Kane — 6 goals', o: '+1000' },
    { t: 'Ousmane Dembélé — 4', o: '+5500' }, { t: 'Mikel Oyarzabal — 4', o: '+5500' },
  ],
  messiNote: "leads the Boot on goals but prices second (+165 vs Mbappé +100) — books weight France's softer half, Mbappé's assists tiebreaker, and his shot at an unprecedented second Boot. Anytime-scorer pricing for Argentina's quarterfinal expected in the −110/+120 band.",
};

export function mount(root) {
  root.innerHTML = `<div class="view view-markets"><div class="wrap">
    <div class="sec-head">
      <h2 class="sec-title">Markets</h2>
      <p class="sec-sub">Live match lines, prediction markets, and tournament futures. Prices are indicative, not betting advice.</p>
    </div>
    <section class="panel">
      <div class="panel-head"><h3 class="panel-title">Match lines</h3></div>
      <div id="mk-lines">${skeletonRows(5)}</div>
    </section>
    <section class="panel">
      <div class="panel-head"><h3 class="panel-title">Prediction markets</h3></div>
      <div id="mk-pred">${skeletonRows(3)}</div>
    </section>
    <section class="panel">
      <div class="panel-head"><h3 class="panel-title">Futures</h3><span id="mk-fut-label" class="micro muted"></span></div>
      <div id="mk-fut">${skeletonRows(6)}</div>
    </section>
  </div></div>`;

  const linesEl = root.querySelector('#mk-lines');
  const predEl = root.querySelector('#mk-pred');
  const futEl = root.querySelector('#mk-fut');
  const futLabel = root.querySelector('#mk-fut-label');
  let poller;

  async function loadLines() {
    let live;
    try {
      live = await fetchJSON('/api/live');
    } catch (e) {
      if (!linesEl.querySelector('table')) errorState(linesEl, { title: 'Lines unavailable', note: e.message, onRetry: loadLines });
      return;
    }
    const fixtures = (live.matches || [])
      .filter((m) => m.state === 'in' || m.state === 'pre')
      .sort((a, b) => new Date(a.date) - new Date(b.date))
      .slice(0, 6);
    if (!fixtures.length) {
      emptyState(linesEl, { title: 'No live or upcoming fixtures' });
      return;
    }
    const odds = await Promise.all(fixtures.map((f) =>
      fetchJSON('/api/odds?id=' + encodeURIComponent(f.id)).catch(() => null)));
    renderLines(fixtures, odds);
  }

  function renderLines(fixtures, odds) {
    const rows = fixtures.map((f, i) => {
      const o = odds[i] || {};
      const ml = o.moneyline || {};
      const sp = o.spread || {};
      const tot = o.total || {};
      const id = encodeURIComponent(f.id == null ? '' : f.id);
      return `<tr class="${f.state === 'in' ? 'is-live' : ''}">
        <td class="l"><a class="mk-fix" href="#/match/${id}">${esc(f.short || f.name || '')}</a>${f.state === 'in' ? ` <span class="tag tag-live">${liveDot()}Live</span>` : ''}</td>
        <td class="l micro mono nowrap">${esc(fmtDateTime(f.date))}</td>
        <td class="r">${oddsCell(ml.home && ml.home.open, ml.home && ml.home.current)}</td>
        <td class="r">${oddsCell(ml.draw && ml.draw.open, ml.draw && ml.draw.current)}</td>
        <td class="r">${oddsCell(ml.away && ml.away.open, ml.away && ml.away.current)}</td>
        <td class="r">${sp.line != null ? `<span class="mono spread-line">${esc(sp.line)}</span> ` : ''}${oddsCell(sp.home && sp.home.open, sp.home && sp.home.current)}</td>
        <td class="r mono">${tot.line != null ? 'O/U ' + esc(tot.line) : '—'}</td>
      </tr>`;
    }).join('');
    linesEl.innerHTML = `<div class="tbl-scroll"><table class="tbl lines"><thead><tr>
      <th class="l">Fixture</th><th class="l">Kickoff</th>
      <th class="r">Home</th><th class="r">Draw</th><th class="r">Away</th>
      <th class="r">Spread</th><th class="r">Total</th>
    </tr></thead><tbody>${rows}</tbody></table></div>`;
  }

  async function loadPredictions() {
    let data;
    try {
      data = await fetchJSON('/api/predictions');
    } catch (_) {
      if (!predEl.querySelector('.pred-card')) predEl.innerHTML = inlineNote('Prediction markets connecting soon.');
      return;
    }
    const markets = (data && data.markets) || [];
    if (!markets.length || !data.source) {
      predEl.innerHTML = inlineNote('Prediction markets connecting soon.');
      return;
    }
    const src = `<div class="pred-src micro muted">${esc(sourceLabel(data.source))}</div>`;
    predEl.innerHTML = src + `<div class="grid grid-pred">${markets.map(predCard).join('')}</div>`;
  }

  async function loadFutures() {
    let m = null;
    try {
      const r = await fetchJSON('/api/markets');
      if (r && r.configured && (r.winnerOdds || r.bootOdds)) m = r;
    } catch (_) { /* fall back to snapshot */ }
    if (m) renderFutures(m, false);
    else renderFutures(FALLBACK_MARKETS, true);
  }

  function renderFutures(m, isSnapshot) {
    futLabel.textContent = isSnapshot
      ? 'Snapshot · Jul 7'
      : (m.updatedAt ? 'Live · ' + fmtDateTime(m.updatedAt) : 'Live');
    const winner = oddsTable('To win the World Cup', 'Team', m.winnerOdds || []);
    const boot = oddsTable('Golden Boot', 'Player', m.bootOdds || []);
    const note = m.messiNote
      ? `<div class="mk-note"><span class="mk-note-k micro">Messi watch</span> ${esc(m.messiNote)}</div>`
      : '';
    futEl.innerHTML = `<div class="grid grid-2">${winner}${boot}</div>${note}`;
  }

  async function loadAll() {
    await Promise.allSettled([loadLines(), loadPredictions()]);
  }

  loadFutures();
  poller = new Poller(loadAll, 60000);
  poller.start();
  return { destroy() { poller.stop(); } };
}

function predCard(m) {
  const outs = (m.outcomes || []).slice(0, 6);
  const rows = outs.map((o) => `<div class="pred-row">
    <div class="pr-top"><span class="pr-name">${esc(o.name || '')}</span><span class="pr-pct mono">${pct01(o.prob, 0)}</span></div>
    ${meter((Math.max(0, Math.min(1, Number(o.prob) || 0))) * 100)}
  </div>`).join('');
  const foot = [
    m.volume != null ? `Vol ${esc(fmtVolume(m.volume))}` : '',
    m.url ? `<a class="src-link" href="${esc(safeUrl(m.url))}" target="_blank" rel="noopener">source ↗</a>` : '',
  ].filter(Boolean).join(sep());
  return `<div class="pred-card card">
    <div class="pred-q">${esc(m.question || '')}</div>
    <div class="pred-rows">${rows}</div>
    ${foot ? `<div class="pred-foot micro muted">${foot}</div>` : ''}
  </div>`;
}

function oddsTable(title, col, list) {
  const rows = list.map((r) => {
    const p = impliedPct(r.o);
    return `<tr>
      <td class="l">${esc(r.t)}</td>
      <td class="r mono">${esc(r.o)}</td>
      <td class="r mono implied">${p != null ? p.toFixed(1) + '%' : ''}</td>
    </tr>`;
  }).join('');
  return `<div class="fut-table">
    <div class="ft-title micro">${esc(title)}</div>
    <table class="tbl"><thead><tr>
      <th class="l">${esc(col)}</th><th class="r">Price</th><th class="r">Implied</th>
    </tr></thead><tbody>${rows}</tbody></table>
  </div>`;
}

function fmtVolume(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return String(v == null ? '' : v);
  if (n >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'K';
  return String(n);
}

// "kalshi" -> "Data via Kalshi", "polymarket" -> "Data via Polymarket".
function sourceLabel(src) {
  const s = String(src || '').trim();
  if (!s) return '';
  return 'Data via ' + s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}
