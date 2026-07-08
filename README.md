# wc2026.ratnani.org — World Cup 2026 live board

A single-page live board for World Cup 2026: real-time scores, tournament stats,
standings, DraftKings odds and player props, and prediction-market lines. Data
comes from ESPN's public JSON feeds (no API key), proxied and cached at the edge.

## Architecture

Everything runs in one Cloudflare Worker (`src/worker.js`) that serves static
assets from `public/` and exposes a small JSON API. ESPN's public feeds are
fetched server-side and cached at the edge, so the browser never talks to ESPN
directly and repeat reads are essentially free. There is no build step.

- `src/worker.js` — edge API:
  - `GET /api/live`    scores + status + DraftKings odds; 15s cache when a match is live, 60s idle
  - `GET /api/stats`   goals/assists leaders; 5 min cache
  - `GET /api/markets` optional futures/props via Anthropic web search; 15 min cache
- `public/` — static frontend; polls `/api/live` during matches, backs off when idle,
  pauses when the tab is hidden and refetches on focus.

## Local development

```bash
npx wrangler dev
```

Serves the Worker and static assets locally with hot reload — no global install needed.

## Deploy

Deploys run automatically: every push to `main` triggers the GitHub Actions
workflow in `.github/workflows/deploy.yml`, which runs `wrangler deploy`.

To deploy manually:

```bash
npx wrangler deploy
```

`wrangler.toml` pins the account and routes the custom domain
`wc2026.ratnani.org` (requires the `ratnani.org` zone on the same Cloudflare
account; the custom domain and DNS record are created on first deploy).

## Configuration

### Required — GitHub repo secret

CI needs a Cloudflare API token to deploy. Add it as a repository secret named
`CLOUDFLARE_API_TOKEN`:

1. Cloudflare dashboard → **My Profile → API Tokens → Create Token**.
2. Use the **Edit Cloudflare Workers** template, scoped to this account.
3. In GitHub: **Settings → Secrets and variables → Actions → New repository secret**,
   name it `CLOUDFLARE_API_TOKEN`, paste the value.

The account ID is already in `wrangler.toml`, so the workflow needs no other inputs.

### Optional — Worker secret for live markets

`/api/markets` uses an Anthropic API key for futures/props. Set it as a Worker secret:

```bash
npx wrangler secret put ANTHROPIC_API_KEY
```

Without it, `/api/markets` returns `configured:false` and the frontend falls back
to an embedded futures snapshot.

## Ops notes

- ESPN feeds are unofficial-but-stable public endpoints; the Worker degrades
  gracefully (short-cached passthrough) if they change.
- The stats feed can trail the live scoreboard by a short window after goals.
- Zero cost at this traffic level (Workers free tier: 100k req/day; edge cache
  absorbs most reads).
