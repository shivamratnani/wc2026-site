// wc2026.ratnani.org — World Cup 2026 live backend (v2)
//
// Cloudflare Worker "wc2026" serving wc2026.ratnani.org.
//   /api/*          -> handled here (JSON, CORS *, edge-cached upstream)
//   everything else -> env.ASSETS.fetch(request) (static assets binding)
//
// Endpoints:
//   GET /api/live               compact match list (scores, live status, odds)
//   GET /api/stats              golden boot + assists leaders (from statistics)
//   GET /api/standings          group tables
//   GET /api/match?id=EVENTID   full match detail (lineups, timeline, stats, form, h2h)
//   GET /api/odds?id=EVENTID    DraftKings moneyline / spread / total (open + current)
//   GET /api/props?id=EVENTID   DraftKings player prop bets, grouped by type
//   GET /api/leaders            tournament stat leaders (goals, assists, saves, ...)
//   GET /api/athletes?ids=1,2   batch athlete resolver (name/jersey/pos/team)
//   GET /api/alive              team life status (advanced from group, not yet knocked out)
//   GET /api/predictions        prediction markets (Kalshi, Polymarket fallback)
//   GET /api/markets            Anthropic web-search futures/boot odds
//
// One file by deployment constraint. Workers runtime provides fetch/caches/Response.

// ============================================================================
// Upstream bases (all keyless)
// ============================================================================

const SITE = 'https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world';
const SITE2 = 'https://site.api.espn.com/apis/v2/sports/soccer/fifa.world'; // standings lives here
const CORE = 'https://sports.core.api.espn.com/v2/sports/soccer/leagues/fifa.world';
const ESPN = SITE; // alias kept so the v1 handlers below stay byte-identical

// ============================================================================
// Shared helpers
// ============================================================================

// Edge-cache an upstream GET for `ttl` seconds.
const cachedFetch = (url, ttl, headers) =>
  fetch(url, { headers, cf: { cacheTtl: ttl, cacheEverything: true } });

// JSON response with CORS + client cache-control mirroring the endpoint TTL.
const json = (obj, ttl = 30, status = 200) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': `public, max-age=${ttl}`,
      'access-control-allow-origin': '*',
    },
  });

// Edge-cached GET that parses JSON and throws (carrying the upstream status) on !ok.
async function fetchJSON(url, ttl, headers) {
  const r = await cachedFetch(url, ttl, headers);
  if (!r.ok) {
    const e = new Error('upstream ' + r.status);
    e.upstreamStatus = r.status;
    throw e;
  }
  return r.json();
}

// Run a handler, mapping upstream failures -> 502 and anything else -> 500.
async function handle(fn) {
  try {
    return await fn();
  } catch (e) {
    if (e && e.upstreamStatus) return json({ error: 'upstream ' + e.upstreamStatus }, 10, 502);
    return json({ error: String((e && e.message) || e) }, 10, 500);
  }
}

// Last numeric path segment of an ESPN $ref URL: ".../athletes/176203?lang=en" -> "176203".
const idFromRef = (ref) => {
  const m = String(ref || '').match(/\/(\d+)(?=\?|$)/);
  return m ? m[1] : null;
};

// Normalize an ESPN odds price node -> { american, decimal } (or null).
const priceOf = (node) =>
  node
    ? {
        american: node.american ?? node.alternateDisplayValue ?? null,
        decimal: node.decimal ?? node.value ?? null,
      }
    : null;

// Normalize an athlete object (CORE resolver or SITE roster) to a common shape.
// teamId comes from a CORE $ref; teamAbbr is supplied by roster context.
const normAthlete = (a, teamAbbr = null) => {
  a = a || {};
  return {
    name: a.displayName || null,
    short: a.shortName || null,
    jersey: a.jersey ?? null,
    pos: a.position?.abbreviation ?? null,
    teamId: idFromRef(a.team?.$ref),
    teamAbbr,
  };
};

// ============================================================================
// v1 endpoints — preserved exactly (contract frozen)
// ============================================================================

function fmtDates(daysAhead = 14) {
  const d = new Date();
  const s = x => x.toISOString().slice(0, 10).replace(/-/g, '');
  const end = new Date(d.getTime() + daysAhead * 864e5);
  const start = new Date(d.getTime() - 1 * 864e5); // include yesterday's finals
  return `${s(start)}-${s(end)}`;
}

async function apiLive() {
  const r = await cachedFetch(`${ESPN}/scoreboard?dates=${fmtDates()}`, 30);
  if (!r.ok) return json({ error: 'upstream ' + r.status }, 10, 502);
  const d = await r.json();
  const matches = (d.events || []).map(e => {
    const c = (e.competitions || [])[0] || {};
    const side = ha => {
      const t = (c.competitors || []).find(x => x.homeAway === ha) || {};
      return {
        team: t.team?.displayName || '',
        abbr: t.team?.abbreviation || '',
        score: t.score ?? null,
        winner: t.winner ?? null,
        pens: t.shootoutScore ?? null,
      };
    };
    const odds = (c.odds || []).filter(Boolean).map(o => ({
      details: o.details || null,
      overUnder: o.overUnder ?? null,
      provider: o.provider?.name || null,
      home: o.homeTeamOdds?.moneyLine ?? null,
      away: o.awayTeamOdds?.moneyLine ?? null,
      draw: o.drawOdds?.moneyLine ?? null,
    }))[0] || null;
    return {
      id: e.id,
      date: e.date,
      name: e.name,
      short: e.shortName,
      stage: e.season?.slug || '',
      state: e.status?.type?.state || '',          // pre | in | post
      status: e.status?.type?.description || '',
      detail: e.status?.type?.detail || '',
      clock: e.status?.displayClock || '',
      home: side('home'),
      away: side('away'),
      odds,
      venue: c.venue?.fullName || '',
    };
  });
  const anyLive = matches.some(m => m.state === 'in');
  return json(
    { updatedAt: new Date().toISOString(), anyLive, stage: d.leagues?.[0]?.season?.type?.name || '', matches },
    anyLive ? 15 : 60
  );
}

async function apiStats() {
  const r = await cachedFetch(`${ESPN}/statistics`, 300);
  if (!r.ok) return json({ error: 'upstream ' + r.status }, 30, 502);
  const d = await r.json();
  const out = { updatedAt: new Date().toISOString(), goals: [], assists: [] };
  const walk = o => {
    if (o && typeof o === 'object') {
      if (o.displayName && Array.isArray(o.leaders)) {
        const bucket =
          o.displayName === 'Goals' ? out.goals :
          o.displayName === 'Assists' ? out.assists : null;
        if (bucket && bucket.length === 0) {
          for (const l of o.leaders.slice(0, 25)) {
            const m = /Goals:\s*(\d+)|Assists:\s*(\d+)/.exec(l.displayValue || '');
            const matches2 = /Matches:\s*(\d+)/.exec(l.displayValue || '');
            bucket.push({
              name: l.athlete?.displayName || '',
              team: l.team?.abbreviation || l.athlete?.teamShortName || '',
              val: l.value ?? (m ? parseInt(m[1] || m[2], 10) : null),
              matches: matches2 ? parseInt(matches2[1], 10) : null,
            });
          }
        }
      }
      for (const v of Object.values(o)) walk(v);
    } else if (Array.isArray(o)) o.forEach(walk);
  };
  walk(d);
  return json(out, 300);
}

async function apiMarkets(env, ctx) {
  if (!env.ANTHROPIC_API_KEY)
    return json({ configured: false, note: 'Set ANTHROPIC_API_KEY secret to enable live betting-market pulls.' }, 3600);

  // 15-min edge cache keyed on a synthetic URL
  const cacheKey = new Request('https://cache.internal/api/markets-v1');
  const cache = caches.default;
  const hit = await cache.match(cacheKey);
  if (hit) return hit;

  const body = {
    model: 'claude-sonnet-4-6',
    max_tokens: 1000,
    messages: [{
      role: 'user',
      content: 'World Cup 2026 current betting odds: outright winner futures and Golden Boot odds, plus Messi scorer props for his next game. Do ONE web search, then immediately output ONLY minified JSON (no prose): {"winnerOdds":[{"t":"Team","o":"+000"}],"bootOdds":[{"t":"Player - N goals","o":"+000"}],"messiNote":"1 sentence"} Max 6 rows per list. Start with { end with }.',
    }],
    tools: [{ type: 'web_search_20250305', name: 'web_search' }],
  };
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
  });
  if (!r.ok) return json({ configured: true, error: 'anthropic ' + r.status }, 60, 502);
  const data = await r.json();
  const text = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n');
  let payload;
  try {
    const s = text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1);
    payload = JSON.parse(s);
  } catch (e) {
    return json({ configured: true, error: 'parse failed', raw: text.slice(0, 200) }, 60, 502);
  }
  const res = json({ configured: true, updatedAt: new Date().toISOString(), ...payload }, 900);
  ctx.waitUntil(cache.put(cacheKey, res.clone()));
  return res;
}

// ============================================================================
// GET /api/standings — group tables (SITE2/standings)
// ============================================================================

async function apiStandings() {
  const d = await fetchJSON(`${SITE2}/standings`, 300);
  const groups = (d.children || []).map(ch => {
    const entries = (ch.standings?.entries || []).map(e => {
      const t = e.team || {};
      const sm = {};
      for (const s of e.stats || []) sm[s.name] = s; // stat lookup by name (no repeated find())
      const val = name => sm[name]?.value ?? null;
      return {
        teamId: t.id ?? null,
        team: t.displayName ?? null,
        abbr: t.abbreviation ?? null,
        logo: t.logos?.[0]?.href ?? null,
        played: val('gamesPlayed'),
        wins: val('wins'),
        draws: val('ties'),
        losses: val('losses'),
        gf: val('pointsFor'),
        ga: val('pointsAgainst'),
        gd: val('pointDifferential'),
        points: val('points'),
        rank: val('rank'),
        // 'advanced' is a numeric stat (1/0); key the boolean off value — displayValue '0' is truthy.
        advanced: !!Number(sm.advanced?.value),
      };
    });
    entries.sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99)); // feed order is not table order
    return { name: ch.name ?? null, entries };
  });
  return json({ updatedAt: new Date().toISOString(), groups }, 300);
}

// ============================================================================
// GET /api/match?id=EVENTID — full match detail (SITE/summary)
// Extract only the fields we need: the raw summary can carry control chars in
// commentary, so we never re-serialize the whole payload.
// ============================================================================

const PLAYER_STAT_MAP = {
  totalGoals: 'goals',
  goalAssists: 'assists',
  totalShots: 'shots',
  shotsOnTarget: 'sot',
  foulsCommitted: 'fouls',
  yellowCards: 'yc',
  redCards: 'rc',
  saves: 'saves',
};

// position abbreviation for a roster item (item first, then embedded athlete).
const rosterPos = it => it.position?.abbreviation ?? it.athlete?.position?.abbreviation ?? null;
// substitution minute if the field is an object; boolean flags carry no minute.
const subMinute = v => (v && typeof v === 'object' ? (v.clock?.displayValue ?? v.displayValue ?? null) : null);

async function apiMatch(id) {
  if (!id) return json({ error: 'missing id' }, 10, 400);
  const d = await fetchJSON(`${SITE}/summary?event=${id}`, 15);

  const comp = d.header?.competitions?.[0] || {};
  const comps = comp.competitors || [];
  const homeC = comps.find(c => c.homeAway === 'home') || {};
  const awayC = comps.find(c => c.homeAway === 'away') || {};
  const homeId = homeC.team?.id ?? null;
  const awayId = awayC.team?.id ?? null;
  const state = comp.status?.type?.state ?? null;

  const mkSide = c => ({
    id: c.team?.id ?? null,
    team: c.team?.displayName ?? null,
    abbr: c.team?.abbreviation ?? null,
    logo: c.team?.logos?.[0]?.href ?? c.team?.logo ?? null,
    score: c.score ?? null,
    pens: c.shootoutScore ?? null,
  });

  const header = {
    date: comp.date ?? null,
    venue: d.gameInfo?.venue?.fullName ?? null,
    status: comp.status?.type?.description ?? null,
    detail: comp.status?.type?.detail ?? null,
    home: mkSide(homeC),
    away: mkSide(awayC),
  };

  // Lineups: starters vs subs per roster.
  const lineups = (d.rosters || []).map(r => {
    const items = r.roster || [];
    return {
      teamId: r.team?.id ?? null,
      team: r.team?.displayName ?? null,
      formation: r.formation ?? null,
      starters: items.filter(it => it.starter).map(it => ({
        id: it.athlete?.id ?? null,
        name: it.athlete?.displayName ?? null,
        jersey: it.jersey ?? null,
        pos: rosterPos(it),
        subbedOutMinute: subMinute(it.subbedOut),
      })),
      subs: items.filter(it => !it.starter).map(it => ({
        id: it.athlete?.id ?? null,
        name: it.athlete?.displayName ?? null,
        jersey: it.jersey ?? null,
        pos: rosterPos(it),
        subbedInMinute: subMinute(it.subbedIn),
      })),
    };
  });

  // Timeline: key events.
  const timeline = (d.keyEvents || [])
    .map(k => ({
      minute: k.clock?.displayValue ?? null,
      type: k.type?.text ?? null,
      text: k.text ?? null,
      teamId: k.team?.id ?? null,
      player: (k.participants || k.athletesInvolved)?.[0]?.displayName ?? null,
    }))
    .filter(ev => ev.text); // some keyEvents carry no description — noise as rows

  // Team stats: pair home/away boxscore statistics by name.
  const bteams = d.boxscore?.teams || [];
  const bHome = bteams.find(t => t.team?.id === homeId) || bteams[0] || {};
  const bAway = bteams.find(t => t.team?.id === awayId) || bteams[1] || {};
  const awayStatByName = {};
  for (const s of bAway.statistics || []) awayStatByName[s.name] = s;
  const teamStats = (bHome.statistics || []).map(s => ({
    key: s.name,
    label: s.label ?? s.displayName ?? s.name,
    home: s.displayValue ?? null,
    away: awayStatByName[s.name]?.displayValue ?? null,
  }));

  // Player stats: keep starters and anyone with a nonzero counting stat.
  const playerStats = (d.rosters || []).map(r => {
    const players = [];
    for (const it of r.roster || []) {
      const sm = {};
      for (const s of it.stats || []) sm[s.name] = s.value;
      const rec = {
        id: it.athlete?.id ?? null,
        name: it.athlete?.displayName ?? null,
        pos: rosterPos(it),
        minutes: sm.minutes ?? sm.appearances ?? null,
      };
      for (const [src, dst] of Object.entries(PLAYER_STAT_MAP)) rec[dst] = sm[src] ?? 0;
      const hasStat = rec.goals || rec.assists || rec.shots || rec.sot || rec.fouls || rec.yc || rec.rc || rec.saves;
      if (it.starter || hasStat) players.push(rec);
    }
    return { teamId: r.team?.id ?? null, players };
  });

  // Recent form per side.
  const lastFive = d.lastFiveGames || [];
  const formFor = teamId => {
    const g = lastFive.find(x => x.team?.id === teamId) || {};
    return (g.events || []).map(e => ({
      result: e.gameResult ?? null,
      score: e.score ?? null,
      opp: e.opponent?.abbreviation ?? null,
    }));
  };
  const form = { home: formFor(homeId), away: formFor(awayId) };

  // Head-to-head history.
  const h2hSrc = (d.headToHeadGames || [])[0] || {};
  const h2hTeam = h2hSrc.team || {};
  const h2h = (h2hSrc.events || []).map(e => ({
    date: e.gameDate ?? null,
    home: (e.homeTeamId === h2hTeam.id ? h2hTeam.abbreviation : e.opponent?.abbreviation) ?? null,
    away: (e.awayTeamId === h2hTeam.id ? h2hTeam.abbreviation : e.opponent?.abbreviation) ?? null,
    score: e.score ?? null,
  }));

  return json(
    { updatedAt: new Date().toISOString(), id, state, header, lineups, timeline, teamStats, playerStats, form, h2h },
    state === 'in' ? 15 : 300
  );
}

// ============================================================================
// GET /api/odds?id=EVENTID — DraftKings moneyline / spread / total (CORE)
// ============================================================================

async function apiOdds(id) {
  if (!id) return json({ error: 'missing id' }, 10, 400);
  const d = await fetchJSON(`${CORE}/events/${id}/competitions/${id}/odds`, 30);
  const it = (d.items || [])[0] || {}; // items[0] = DraftKings
  const hto = it.homeTeamOdds || {};
  const ato = it.awayTeamOdds || {};
  const dro = it.drawOdds || {};

  // Moneylines are nested price objects on home/away but a flat american
  // number on drawOdds ({moneyLine: 285}) — normalize both shapes.
  const flatMl = n =>
    typeof n === 'number'
      ? { american: (n > 0 ? '+' : '') + n, decimal: +(n > 0 ? 1 + n / 100 : 1 + 100 / Math.abs(n)).toFixed(2) }
      : null;
  const mlPrice = n => (n && typeof n === 'object' ? priceOf(n) : flatMl(n));
  const ml = o => ({
    open: mlPrice(o.open?.moneyLine),
    current: mlPrice(o.current?.moneyLine) ?? flatMl(o.moneyLine),
  });
  const moneyline = { home: ml(hto), draw: ml(dro), away: ml(ato) };
  const spread = {
    line: hto.current?.pointSpread?.american ?? hto.current?.pointSpread?.alternateDisplayValue ?? null,
    home: { open: priceOf(hto.open?.spread), current: priceOf(hto.current?.spread) },
    away: { open: priceOf(ato.open?.spread), current: priceOf(ato.current?.spread) },
  };
  const total = {
    line: it.overUnder ?? null,
    over: { open: priceOf(it.open?.over), current: priceOf(it.current?.over) },
    under: { open: priceOf(it.open?.under), current: priceOf(it.current?.under) },
  };

  return json(
    {
      updatedAt: new Date().toISOString(),
      provider: 'DraftKings',
      details: it.details ?? null,
      overUnder: it.overUnder ?? null,
      lastUpdated: it.lastUpdated ?? null,
      moneyline,
      spread,
      total,
    },
    30
  );
}

// ============================================================================
// GET /api/props?id=EVENTID — DraftKings player prop bets (CORE), grouped by type
// Athlete names resolved via team rosters (4 subrequests total).
// ============================================================================

// Goalscorer prop types come first, in this order; everything else is alphabetical.
const PROP_TYPE_ORDER = [
  'Anytime Goalscorer',
  'First Goalscorer',
  'Last Goalscorer',
  'To Score 2+ Goals',
  'To Score in Both Halves',
];

async function apiProps(id) {
  if (!id) return json({ error: 'missing id' }, 10, 400);

  const [propsD, sumD] = await Promise.all([
    fetchJSON(`${CORE}/events/${id}/competitions/${id}/odds/100/propBets?limit=1000`, 60),
    fetchJSON(`${SITE}/summary?event=${id}`, 300),
  ]);

  // Two team ids from the summary header, then a roster each -> id -> athlete info.
  const teamIds = (sumD.header?.competitions?.[0]?.competitors || [])
    .map(c => c.team?.id)
    .filter(Boolean);
  const rosters = await Promise.all(
    teamIds.map(tid => fetchJSON(`${SITE}/teams/${tid}/roster`, 86400).catch(() => null))
  );
  const byId = {};
  for (const r of rosters) {
    if (!r) continue;
    const teamAbbr = r.team?.abbreviation ?? null;
    for (const a of r.athletes || []) {
      const n = normAthlete(a, teamAbbr);
      byId[a.id] = { name: n.name, jersey: n.jersey, pos: n.pos, teamAbbr: n.teamAbbr };
    }
  }

  // Group entries by prop type.
  const items = propsD.items || [];
  const groups = new Map();
  for (const it of items) {
    const typeName = it.type?.name || 'Other';
    const aid = idFromRef(it.athlete?.$ref);
    const info = byId[aid] || {};
    const entry = {
      athleteId: aid,
      name: info.name || ('Unknown #' + aid),
      jersey: info.jersey ?? null,
      pos: info.pos ?? null,
      teamAbbr: info.teamAbbr ?? null,
      line: it.current?.total?.value ?? null,
      over: { open: priceOf(it.open?.over), current: priceOf(it.current?.over) },
      under: { open: priceOf(it.open?.under), current: priceOf(it.current?.under) },
    };
    if (!groups.has(typeName)) groups.set(typeName, []);
    groups.get(typeName).push(entry);
  }

  // Sort entries within a type by current over decimal ascending (favorites first).
  for (const arr of groups.values())
    arr.sort((a, b) => (a.over.current?.decimal ?? Infinity) - (b.over.current?.decimal ?? Infinity));

  // Order type groups: goalscorer types first (defined order), then alphabetical.
  const rank = name => {
    const i = PROP_TYPE_ORDER.indexOf(name);
    return i === -1 ? [1, name] : [0, i];
  };
  const types = [...groups.entries()]
    .sort((a, b) => {
      const [ga, va] = rank(a[0]);
      const [gb, vb] = rank(b[0]);
      if (ga !== gb) return ga - gb;
      if (ga === 0) return va - vb; // both goalscorer types -> defined order
      return String(va).localeCompare(String(vb)); // both other -> alphabetical
    })
    .map(([type, entries]) => ({ type, entries }));

  return json({ updatedAt: new Date().toISOString(), count: items.length, types }, 60);
}

// ============================================================================
// GET /api/leaders — tournament stat leaders (CORE)
// ============================================================================

async function apiLeaders() {
  const d = await fetchJSON(`${CORE}/seasons/2026/types/1/leaders?limit=10`, 600);
  const skip = new Set(['goalsLeaders', 'assistsLeaders']); // duplicates of goals/assists
  const categories = (d.categories || [])
    .filter(c => !skip.has(c.name))
    .map(c => ({
      key: c.name,
      label: c.displayName ?? c.name,
      leaders: (c.leaders || []).map(l => ({
        athleteId: idFromRef(l.athlete?.$ref),
        teamId: idFromRef(l.team?.$ref),
        value: l.value ?? null,
        displayValue: l.displayValue ?? null,
      })),
    }));
  return json({ updatedAt: new Date().toISOString(), categories }, 600);
}

// ============================================================================
// GET /api/athletes?ids=1,2,3 — batch athlete resolver (CORE), max 40
// ============================================================================

async function apiAthletes(idsParam) {
  if (!idsParam) return json({ error: 'missing ids' }, 10, 400);
  const ids = idsParam.split(',').map(s => s.trim()).filter(Boolean);
  if (ids.length === 0) return json({ error: 'missing ids' }, 10, 400);
  if (ids.length > 40) return json({ error: 'too many ids (max 40)' }, 10, 400);

  const one = async id => {
    try {
      const a = await fetchJSON(`${CORE}/seasons/2026/athletes/${id}`, 604800);
      const n = normAthlete(a);
      return [id, { name: n.name, short: n.short, jersey: n.jersey, pos: n.pos, teamId: n.teamId }];
    } catch {
      return [id, null]; // individual failure never fails the batch
    }
  };
  const entries = await Promise.all(ids.map(one));
  return json({ updatedAt: new Date().toISOString(), athletes: Object.fromEntries(entries) }, 86400);
}

// ============================================================================
// GET /api/alive — tournament life status per team
// Dead = failed to advance from the group, or lost a completed knockout tie.
// ============================================================================

async function apiAlive() {
  const [standings, knockouts] = await Promise.all([
    fetchJSON(`${SITE2}/standings`, 300),
    fetchJSON(`${SITE}/scoreboard?dates=20260625-20260731`, 300), // full knockout window
  ]);

  const teams = new Map();
  for (const ch of standings.children || []) {
    for (const e of ch.standings?.entries || []) {
      const t = e.team || {};
      if (!t.id) continue;
      const advanced = !!Number((e.stats || []).find(s => s.name === 'advanced')?.value);
      teams.set(t.id, { id: t.id, abbr: t.abbreviation ?? null, name: t.displayName ?? null, alive: advanced });
    }
  }
  for (const ev of knockouts.events || []) {
    if (ev.status?.type?.state !== 'post') continue;
    // The date window can catch late group-stage matchdays — a group loss is not elimination.
    if (String(ev.season?.slug || '').includes('group')) continue;
    for (const c of (ev.competitions?.[0] || {}).competitors || []) {
      const rec = c.team?.id && teams.get(c.team.id);
      if (rec && c.winner === false) rec.alive = false;
    }
  }
  return json({ updatedAt: new Date().toISOString(), teams: [...teams.values()] }, 300);
}

// ============================================================================
// GET /api/predictions — Kalshi prediction markets (keyless public reads)
// Winner futures, per-match regulation-time moneylines, R16 advancement.
// ============================================================================

const KALSHI = 'https://api.elections.kalshi.com/trade-api/v2';
const KALSHI_SERIES = ['KXMENWORLDCUP', 'KXWCGAME', 'KXWCADVANCE'];
const POLYMARKET = 'https://gamma-api.polymarket.com';
const POLYMARKET_SLUGS = [
  'world-cup-winner',
  'world-cup-nation-to-reach-semifinals',
  'which-continent-will-win-the-world-cup',
];
// Prediction-market hosts reject UA-less requests (Workers fetch sends no default UA).
const PM_HEADERS = { accept: 'application/json', 'user-agent': 'wc2026-board/1.0 (+https://wc2026.ratnani.org)' };

// One Kalshi series -> contract markets. Uses the *_dollars fields (0..1
// floats) — the legacy integer fields (last_price, yes_bid, ...) are null.
// status=open on the event keeps only live markets; eliminated teams inside
// an open event surface as finalized markets, hence the per-market filter.
async function kalshiSeries(seriesTicker) {
  const d = await fetchJSON(
    `${KALSHI}/events?series_ticker=${seriesTicker}&with_nested_markets=true&status=open`,
    60,
    PM_HEADERS
  );
  return (d.events || [])
    .map(ev => {
      const outcomes = (ev.markets || [])
        .filter(m => m.status === 'active')
        .map(m => {
          const bid = Number(m.yes_bid_dollars) || 0;
          const ask = Number(m.yes_ask_dollars) || 0;
          const last = m.last_price_dollars != null ? Number(m.last_price_dollars) : null;
          const prob = last ?? (bid && ask ? (bid + ask) / 2 : bid || ask);
          return { name: String(m.yes_sub_title || m.title || '').replace(/^Reg Time: /, ''), prob };
        })
        .filter(o => o.prob > 0)
        .sort((a, b) => b.prob - a.prob);
      return {
        question: ev.title,
        outcomes,
        volume: Math.round((ev.markets || []).reduce((s, m) => s + (Number(m.volume_fp) || 0), 0)),
        url: `https://kalshi.com/markets/${(ev.series_ticker || seriesTicker).toLowerCase()}`,
      };
    })
    .filter(m => m.outcomes.length);
}

// One Polymarket Gamma slug -> contract markets. outcomePrices is a
// stringified JSON array; closed (eliminated) markets stay in the event.
async function polymarketSlug(slug) {
  const evs = await fetchJSON(`${POLYMARKET}/events?slug=${slug}`, 60, PM_HEADERS);
  return (evs || [])
    .map(ev => {
      const outcomes = (ev.markets || [])
        .filter(m => m.closed === false)
        .map(m => {
          let prob = 0;
          try { prob = Number(JSON.parse(m.outcomePrices || '[]')[0]) || 0; } catch { /* keep 0 */ }
          return { name: m.groupItemTitle || m.question || '', prob };
        })
        .filter(o => o.prob > 0)
        .sort((a, b) => b.prob - a.prob);
      return {
        question: ev.title,
        outcomes,
        volume: Math.round(Number(ev.volume) || 0),
        url: `https://polymarket.com/event/${ev.slug || slug}`,
      };
    })
    .filter(m => m.outcomes.length);
}

// Kalshi is richer (winner + per-match + advancement) but rate-limits shared
// Worker egress IPs (intermittent 429s / empty results), so both providers are
// fetched in parallel and merged: Kalshi markets win, Polymarket fills gaps —
// its winner event is dropped only when Kalshi's own came through.
async function fetchPredictions() {
  const collect = async (keys, fn) => {
    const settled = await Promise.allSettled(keys.map(fn));
    return {
      markets: settled.flatMap(s => (s.status === 'fulfilled' ? s.value : [])),
      errors: settled
        .map((s, i) => (s.status === 'rejected' ? `${keys[i]}: ${s.reason?.message || s.reason}` : null))
        .filter(Boolean),
    };
  };
  const [kalshi, poly] = await Promise.all([
    collect(KALSHI_SERIES, kalshiSeries),
    collect(POLYMARKET_SLUGS, polymarketSlug),
  ]);
  const isWinner = m => /world cup winner/i.test(m.question);
  const polyKept = poly.markets.filter(m => !(isWinner(m) && kalshi.markets.some(isWinner)));
  const markets = [...kalshi.markets, ...polyKept].sort((a, b) => (isWinner(a) ? 0 : 1) - (isWinner(b) ? 0 : 1));
  const source =
    [kalshi.markets.length && 'kalshi', polyKept.length && 'polymarket'].filter(Boolean).join(' + ') || null;
  const errors = [...kalshi.errors, ...poly.errors];
  return { source, markets, errors: errors.length ? errors : undefined };
}

async function apiPredictions(debug) {
  if (debug) {
    // Ops probe (?debug=1): raw status + first bytes of each provider, no transform.
    // Kept because Kalshi's Worker-egress behavior is erratic (429s, geo-empties).
    const probe = async url => {
      try {
        const r = await fetch(url, { headers: PM_HEADERS });
        return { status: r.status, body: (await r.text()).slice(0, 300) };
      } catch (e) {
        return { error: String(e).slice(0, 200) };
      }
    };
    const [k, pm] = await Promise.all([
      probe(`${KALSHI}/events?series_ticker=KXMENWORLDCUP&with_nested_markets=true&status=open`),
      probe(`${POLYMARKET}/events?slug=world-cup-winner`),
    ]);
    return json({ kalshi: k, polymarket: pm }, 5);
  }
  const p = await fetchPredictions();
  return json({ updatedAt: new Date().toISOString(), source: p.source, markets: p.markets, errors: p.errors }, 60);
}

// ============================================================================
// Router
// ============================================================================

const routes = {
  '/api/live': () => apiLive(),
  '/api/stats': () => apiStats(),
  '/api/standings': () => apiStandings(),
  '/api/match': p => apiMatch(p.get('id')),
  '/api/odds': p => apiOdds(p.get('id')),
  '/api/props': p => apiProps(p.get('id')),
  '/api/leaders': () => apiLeaders(),
  '/api/athletes': p => apiAthletes(p.get('ids')),
  '/api/alive': () => apiAlive(),
  '/api/predictions': p => apiPredictions(p.get('debug')),
  '/api/markets': (p, env, ctx) => apiMarkets(env, ctx),
};

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const { pathname } = url;
    try {
      const route = routes[pathname];
      if (route) return await handle(() => route(url.searchParams, env, ctx));
      if (pathname.startsWith('/api/')) return json({ error: 'not found' }, 60, 404);
      return env.ASSETS.fetch(request);
    } catch (e) {
      return json({ error: String((e && e.message) || e) }, 10, 500);
    }
  },
};
