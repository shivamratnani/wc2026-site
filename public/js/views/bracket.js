// views/bracket.js — live knockout bracket from the round of 32 onward.
import { fetchJSON, Poller } from '../api.js';
import { esc, fmtDate, fmtTime } from '../format.js';
import { emptyState, errorState, safeUrl } from './_shared.js';

const BOARD_HEIGHT = 1504;
const CARD_HEIGHT = 82;
const ROUND_SIZES = {
  'round-of-32': 16,
  'round-of-16': 8,
  quarterfinals: 4,
  semifinals: 2,
  final: 1,
};

export function mount(root) {
  root.innerHTML = `<div class="view view-bracket"><div class="wrap">
    <div class="sec-head">
      <h2 class="sec-title">World Cup bracket</h2>
      <p class="sec-sub">The complete knockout path from the round of 32 to the final.</p>
    </div>
    <div id="b-stage" class="stage-line micro muted">Knockout stage</div>
    <div id="b-body">${skeletonBracket()}</div>
  </div></div>`;

  const stage = root.querySelector('#b-stage');
  const body = root.querySelector('#b-body');
  let poller;

  async function load() {
    let data;
    try {
      data = await fetchJSON('/api/bracket');
    } catch (e) {
      if (!body.querySelector('.bracket-board')) {
        errorState(body, { title: 'Bracket unavailable', note: e.message, onRetry: load });
      }
      return;
    }

    render(data);
    if (poller) poller.setInterval(data.anyLive ? 15000 : 300000);
  }

  function render(data) {
    const rounds = alignRounds(Array.isArray(data.rounds) ? data.rounds : []);
    const hasMatches = rounds.some(round => Array.isArray(round.matches) && round.matches.length);
    stage.textContent = data.updatedAt ? `Knockout stage · updated ${fmtTime(data.updatedAt)}` : 'Knockout stage';

    if (!hasMatches) {
      emptyState(body, { title: 'Bracket not set', note: 'Knockout fixtures will appear when the field is confirmed.' });
      return;
    }

    body.innerHTML = `<div class="bracket-shell">
      <div class="bracket-scroll" tabindex="0" aria-label="World Cup knockout bracket">
        <div class="bracket-board" style="--bracket-height:${BOARD_HEIGHT}px">
          ${rounds.map((round, index) => roundColumn(round, index < rounds.length - 1)).join('')}
        </div>
      </div>
      ${data.thirdPlace ? thirdPlace(data.thirdPlace) : ''}
    </div>`;
  }

  poller = new Poller(load, 300000);
  poller.start();
  return { destroy() { poller.stop(); } };
}

// ESPN returns fixtures chronologically, which is not always bracket order.
// Once a later round is set, use its participants to place each feeder tie.
function alignRounds(input) {
  const rounds = input.map(round => ({
    ...round,
    matches: Array.isArray(round.matches) ? [...round.matches] : [],
  }));

  for (let index = rounds.length - 2; index >= 0; index--) {
    const current = rounds[index].matches;
    const next = rounds[index + 1].matches;
    const unused = new Set(current.map((_, matchIndex) => matchIndex));
    const ordered = [];

    for (const match of next) {
      for (const team of [match.home, match.away]) {
        const teamId = team && team.teamId != null ? String(team.teamId) : '';
        if (!teamId) continue;
        const feederIndex = current.findIndex((candidate, candidateIndex) => {
          if (!unused.has(candidateIndex)) return false;
          const winner = [candidate.home, candidate.away].find(side => side && side.winner);
          return winner && winner.teamId != null && String(winner.teamId) === teamId;
        });
        if (feederIndex >= 0) {
          ordered.push(current[feederIndex]);
          unused.delete(feederIndex);
        }
      }
    }

    if (ordered.length === current.length) rounds[index].matches = ordered;
  }
  return rounds;
}

function roundColumn(round, hasNext) {
  const matches = Array.isArray(round.matches) ? round.matches : [];
  const expected = ROUND_SIZES[round.key] || Math.max(matches.length, 1);
  const cards = matches.map((match, index) => {
    const center = ((index + 0.5) * BOARD_HEIGHT) / expected;
    const top = Math.round(center - CARD_HEIGHT / 2);
    return bracketMatch(match, `style="top:${top}px"`, hasNext);
  }).join('');

  let connectors = '';
  if (hasNext) {
    for (let index = 0; index + 1 < matches.length; index += 2) {
      const first = ((index + 0.5) * BOARD_HEIGHT) / expected;
      const second = ((index + 1.5) * BOARD_HEIGHT) / expected;
      connectors += `<span class="bracket-connector" style="top:${Math.round(first)}px;height:${Math.round(second - first)}px" aria-hidden="true"></span>`;
    }
  }

  return `<section class="bracket-round" aria-labelledby="round-${esc(round.key)}">
    <div class="bracket-round-head">
      <h3 id="round-${esc(round.key)}">${esc(round.label || round.key)}</h3>
      <span class="mono">${matches.length}</span>
    </div>
    <div class="bracket-track">${cards}${connectors}</div>
  </section>`;
}

function bracketMatch(match, position = '', hasNext = false) {
  const home = match.home || {};
  const away = match.away || {};
  const showScore = match.state === 'in' || match.state === 'post';
  const live = match.state === 'in';
  const final = match.stage === 'final';
  const status = matchStatus(match);
  const id = encodeURIComponent(match.id == null ? '' : match.id);
  const label = `${home.team || 'TBD'} vs ${away.team || 'TBD'}${status ? `, ${status}` : ''}`;

  return `<a class="bracket-match${live ? ' is-live' : ''}${final ? ' is-final' : ''}${hasNext ? ' has-next' : ''}" href="#/match/${id}" ${position} aria-label="${esc(label)}">
    <div class="bracket-teams">
      ${teamRow(home, showScore)}
      ${teamRow(away, showScore)}
    </div>
    <div class="bracket-match-foot${live ? ' is-live' : ''}">${esc(status)}</div>
  </a>`;
}

function teamRow(team, showScore) {
  const logo = team.logo
    ? `<img src="${esc(safeUrl(team.logo))}" alt="" width="18" height="18" loading="lazy">`
    : '<span class="bracket-logo-ph" aria-hidden="true"></span>';
  const score = showScore
    ? `<span class="bracket-score mono">${esc(team.score ?? '')}${team.pens != null ? `<small>(${esc(team.pens)})</small>` : ''}</span>`
    : '';

  return `<div class="bracket-team${team.winner ? ' is-winner' : ''}">
    <span class="bracket-team-name">${logo}<span>${esc(team.team || 'TBD')}</span></span>
    ${score}
  </div>`;
}

function matchStatus(match) {
  if (match.state === 'in') return match.detail || match.clock || 'Live';
  if (match.state === 'post') return match.note || match.detail || match.status || 'Final';
  const date = fmtDate(match.date, { month: 'short', day: 'numeric' });
  const time = fmtTime(match.date);
  return [date, time].filter(Boolean).join(' · ') || match.status || 'Scheduled';
}

function thirdPlace(match) {
  return `<section class="third-place" aria-labelledby="third-place-title">
    <div class="panel-head">
      <h3 class="panel-title" id="third-place-title">Third-place match</h3>
    </div>
    <div class="third-place-card">${bracketMatch(match)}</div>
  </section>`;
}

function skeletonBracket() {
  const rounds = ['Round of 32', 'Round of 16', 'Quarterfinals', 'Semifinals', 'Final'];
  return `<div class="bracket-skeleton" aria-hidden="true">${rounds.map(label => `<div>
    <span class="micro muted">${label}</span>
    <span class="sk sk-line"></span>
    <span class="sk sk-line"></span>
    <span class="sk sk-line"></span>
  </div>`).join('')}</div>`;
}
