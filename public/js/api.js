// api.js — network + polling primitives.

// fetchJSON: aborts on timeout, normalizes failures into Error with .code.
export async function fetchJSON(url, { timeout = 12000, signal } = {}) {
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), timeout);
  const onAbort = () => ctrl.abort();
  if (signal) {
    if (signal.aborted) ctrl.abort();
    else signal.addEventListener('abort', onAbort);
  }
  try {
    const res = await fetch(url, { headers: { accept: 'application/json' }, signal: ctrl.signal });
    if (!res.ok) {
      const e = new Error('Server responded ' + res.status);
      e.code = 'http';
      e.status = res.status;
      throw e;
    }
    return await res.json();
  } catch (err) {
    if (err && err.name === 'AbortError') {
      const e = new Error('Request timed out');
      e.code = 'timeout';
      throw e;
    }
    if (err instanceof TypeError) {
      const e = new Error('Network unavailable');
      e.code = 'network';
      throw e;
    }
    throw err;
  } finally {
    clearTimeout(to);
    if (signal) signal.removeEventListener('abort', onAbort);
  }
}

// Poller: repeatedly runs an async fn. The first run fires immediately and
// unconditionally (so a tab opened in the background still loads). Periodic
// refreshes pause while the tab is hidden and resume on visibilitychange.
// Interval can be swapped live; an interval <= 0 pauses periodic runs.
export class Poller {
  constructor(fn, interval = 60000) {
    this.fn = fn;
    this.interval = interval;
    this.timer = null;
    this.running = false;
    this.busy = false;
    this._tick = this._tick.bind(this);
    this._onVisibility = this._onVisibility.bind(this);
  }

  start() {
    if (this.running) return;
    this.running = true;
    document.addEventListener('visibilitychange', this._onVisibility);
    this._run(); // immediate, regardless of visibility
  }

  stop() {
    this.running = false;
    clearTimeout(this.timer);
    this.timer = null;
    document.removeEventListener('visibilitychange', this._onVisibility);
  }

  setInterval(ms) {
    if (ms === this.interval) return;
    this.interval = ms;
    this._schedule();
  }

  // Run fn now (guarded against overlap), then schedule the next tick.
  async _run() {
    if (!this.running || this.busy) return;
    this.busy = true;
    try {
      await this.fn();
    } catch (_) {
      // fn owns its own error UI; swallow so scheduling continues
    } finally {
      this.busy = false;
      this._schedule();
    }
  }

  // Scheduled path: skip work while hidden (visibilitychange will resume).
  _tick() {
    if (!this.running) return;
    if (document.hidden) return;
    this._run();
  }

  _schedule() {
    clearTimeout(this.timer);
    if (!this.running || this.interval <= 0) return;
    this.timer = setTimeout(this._tick, this.interval);
  }

  _onVisibility() {
    if (!document.hidden && this.running) this._run();
  }
}

// resolveAthletes: batch-resolve athlete ids into a name map, chunked to
// <= 40 ids per /api/athletes call, memoized across the session.
const _athleteCache = new Map();

export async function resolveAthletes(ids) {
  const wanted = [];
  const seen = new Set();
  for (const raw of ids || []) {
    const id = String(raw == null ? '' : raw);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    if (!_athleteCache.has(id)) wanted.push(id);
  }

  for (let i = 0; i < wanted.length; i += 40) {
    const chunk = wanted.slice(i, i + 40);
    try {
      const data = await fetchJSON('/api/athletes?ids=' + encodeURIComponent(chunk.join(',')));
      const map = (data && data.athletes) || {};
      for (const id of chunk) _athleteCache.set(id, map[id] || null);
    } catch (_) {
      // leave unresolved ids uncached so a later call can retry
    }
  }

  const out = new Map();
  for (const id of seen) out.set(id, _athleteCache.get(id) || null);
  return out;
}

export function cachedAthlete(id) {
  return _athleteCache.get(String(id)) || null;
}

// getAliveMaps: resolve /api/alive into lookup maps keyed by id, abbr, and
// name. Memoized with a short TTL so each view refetch is cheap but stays
// current. On failure returns empty maps (nothing gets flagged dead).
let _aliveCache = null;
let _aliveAt = 0;

export async function getAliveMaps(maxAge = 60000) {
  const now = Date.now();
  if (_aliveCache && now - _aliveAt < maxAge) return _aliveCache;
  try {
    const d = await fetchJSON('/api/alive', { timeout: 8000 });
    const byId = new Map();
    const byAbbr = new Map();
    const byName = new Map();
    for (const t of (d && d.teams) || []) {
      if (t.id != null) byId.set(String(t.id), t);
      if (t.abbr) byAbbr.set(String(t.abbr).toUpperCase(), t);
      if (t.name) byName.set(String(t.name).toLowerCase(), t);
    }
    _aliveCache = { byId, byAbbr, byName };
    _aliveAt = now;
  } catch (_) {
    if (!_aliveCache) _aliveCache = { byId: new Map(), byAbbr: new Map(), byName: new Map() };
  }
  return _aliveCache;
}

// lookupTeam: find an alive-team record by id, abbr, or name (first hit wins).
export function lookupTeam(maps, { teamId, abbr, name } = {}) {
  if (!maps) return null;
  if (teamId != null && maps.byId.has(String(teamId))) return maps.byId.get(String(teamId));
  if (abbr && maps.byAbbr.has(String(abbr).toUpperCase())) return maps.byAbbr.get(String(abbr).toUpperCase());
  if (name && maps.byName.has(String(name).toLowerCase())) return maps.byName.get(String(name).toLowerCase());
  return null;
}

// isDead: true only when a matched team is explicitly eliminated. Unknown
// teams are treated as alive so nothing is dimmed on missing data.
export function isDead(maps, keys) {
  const t = lookupTeam(maps, keys);
  return !!t && t.alive === false;
}
