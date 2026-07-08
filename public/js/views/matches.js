// views/matches.js — default view. Live match board.
import { fetchJSON, Poller } from '../api.js';
import { esc, fmtDate, fmtTime, fmtDateTime, americanOdds } from '../format.js';
import { skeletonCards, errorState, emptyState, liveDot, oddsCell, sep } from './_shared.js';

export function mount(root) {
  root.innerHTML = `<div class="view view-matches"><div class="wrap">
    <div id="m-stage" class="stage-line micro muted"></div>
    <div id="m-body">${skeletonCards(6)}</div>
  </div></div>`;

  const stage = root.querySelector('#m-stage');
  const body = root.querySelector('#m-body');
  let poller;

  async function load() {
    let data;
    try {
      data = await fetchJSON('/api/live');
    } catch (e) {
      if (!body.querySelector('.match-card')) {
        errorState(body, { title: 'Live feed unavailable', note: e.message, onRetry: load });
      }
      return;
    }
    render(data);
    if (poller) poller.setInterval(data.anyLive ? 15000 : 300000);
  }

  function render(data) {
    const matches = Array.isArray(data.matches) ? data.matches : [];
    const bits = [];
    if (data.stage) bits.push(esc(data.stage));
    if (data.updatedAt) bits.push('updated ' + esc(fmtTime(data.updatedAt)));
    stage.innerHTML = bits.join(' <span class="dot-sep">·</span> ');

    if (!matches.length) {
      emptyState(body, { title: 'No fixtures in window', note: 'Check back closer to kickoff.' });
      return;
    }

    const live = matches.filter((m) => m.state === 'in');
    const pre = matches.filter((m) => m.state === 'pre');
    const post = matches.filter((m) => m.state === 'post');

    let html = '';
    if (live.length) html += section('Live now', live);
    if (pre.length) html += section('Today & upcoming', pre);
    if (post.length) html += section('Recent results', post);
    body.innerHTML = html;
  }

  poller = new Poller(load, 300000);
  poller.start();
  return { destroy() { poller.stop(); } };
}

function section(title, list) {
  return `<section class="m-sec">
    <div class="sec-head row-head">
      <h2 class="sec-title small">${esc(title)}</h2>
      <span class="sec-count mono">${list.length}</span>
    </div>
    <div class="grid grid-cards">${list.map(matchCard).join('')}</div>
  </section>`;
}

function matchCard(m) {
  const isLive = m.state === 'in';
  const isPost = m.state === 'post';
  const isPre = m.state === 'pre';
  const showScore = isLive || isPost;

  let badge;
  if (isLive) badge = `<span class="tag tag-live">${liveDot()}${esc(m.detail || m.clock || 'Live')}</span>`;
  else if (isPost) badge = `<span class="tag tag-final">${esc(m.detail || 'FT')}</span>`;
  else badge = `<span class="tag">${esc(fmtTime(m.date))}</span>`;

  const home = m.home || {};
  const away = m.away || {};
  const teamRow = (t) => {
    const won = isPost && t.winner;
    const score = showScore
      ? `<span class="mono score${won ? ' is-won' : ''}">${esc(t.score ?? '')}${t.pens != null ? `<span class="pens">(${esc(t.pens)})</span>` : ''}</span>`
      : '';
    return `<div class="team-row${won ? ' won' : ''}">
      <span class="team-name">${esc(t.team || 'TBD')}${t.abbr ? `<span class="team-abbr mono">${esc(t.abbr)}</span>` : ''}</span>
      ${score}
    </div>`;
  };

  const topLeft = isPre ? esc(fmtDate(m.date)) : esc(m.venue || '');
  const foot = [];
  if (isPre && m.venue) foot.push(`<span class="micro muted">${esc(m.venue)}</span>`);
  const odds = oddsSummary(m);
  if (odds) foot.push(odds);

  const id = encodeURIComponent(m.id == null ? '' : m.id);
  return `<a class="card match-card${isLive ? ' is-live' : ''}" href="#/match/${id}">
    <div class="card-top"><span class="micro">${topLeft}</span>${badge}</div>
    <div class="teams">${teamRow(home)}${teamRow(away)}</div>
    ${foot.length ? `<div class="card-foot">${foot.join('')}</div>` : ''}
  </a>`;
}

function oddsSummary(m) {
  const o = m.odds;
  if (!o) return '';
  const parts = [];
  if (o.details) parts.push(esc(o.details));
  if (o.home != null || o.away != null || o.draw != null) {
    const h = m.home && m.home.abbr ? m.home.abbr : 'H';
    const a = m.away && m.away.abbr ? m.away.abbr : 'A';
    parts.push(`${esc(h)} ${americanOdds(o.home)}${sep()}Draw ${americanOdds(o.draw)}${sep()}${esc(a)} ${americanOdds(o.away)}`);
  }
  if (o.overUnder != null) parts.push('O/U ' + esc(o.overUnder));
  if (!parts.length) return '';
  const prov = o.provider ? ` <span class="muted">${esc(o.provider)}</span>` : '';
  return `<div class="odds-line mono">${parts.join(sep())}${prov}</div>`;
}
