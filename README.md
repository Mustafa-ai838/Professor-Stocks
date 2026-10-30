# Professor Stock Analysis

A responsive PSX market dashboard and Supabase Auth login page. Live market data comes from the unofficial, undocumented DPS routes used by the PSX portal; the dashboard labels disclosures as official company announcements rather than editorial news.

## Run locally

1. Use Node.js 22.13 or newer.
2. Copy `.env.example` to `.env` and set `SUPABASE_URL` plus `SUPABASE_PUBLISHABLE_KEY` (or `SUPABASE_ANON_KEY` for a legacy public anon key).
3. Run `npm install`, then `npm start`.
4. Open `http://localhost:3001`. The homepage is `/`; sign in at `/login`.
5. Run `npm test` for the offline DPS response-parser tests.

The public Supabase key is sent to the browser. Never put a `service_role` or secret key in this app. `.env` and the local `data/` directory are ignored by Git.

## PSX data routes

The browser cannot call the DPS portal directly: its data routes do not provide CORS headers. Locally, `public/psx-data.js` calls the same-origin Node backend, and `server.js` fetches/normalizes DPS data server-side. The backend probes PSX data nodes, uses TLS with the official `dps.psx.com.pk` hostname, spaces requests by at least one second, and caches each successful route for 120 seconds.

The `/api/live/gainers`, `/api/live/losers`, and `/api/live/active` routes try the official PSX market-watch feed first. If that feed is unavailable, the server fetches a Pakistan-market quote snapshot from TradingView's scanner and derives the same lists. Responses identify their source and update time; TradingView quotes may be delayed and should be checked against PSX before trading. If both sources fail, the API reports an error instead of inventing prices. Failed data responses are retried after 15 seconds.

The optional deployable Supabase Edge Function is in `supabase/functions/psx-market-data/index.ts`. To use it instead of the local Node proxy:

1. Install/use the Supabase CLI and authenticate with `npx supabase login`.
2. Link this workspace to your Supabase project: `npx supabase link --project-ref YOUR_PROJECT_REF`.
3. Deploy the function: `npx supabase functions deploy psx-market-data`.
4. Add `PSX_DATA_FUNCTION_URL=https://YOUR_PROJECT_REF.supabase.co/functions/v1/psx-market-data` to `.env`, then restart the Node app.

The function is configured as a public, read-only data endpoint (`verify_jwt = false`); it uses no privileged Supabase key and only fetches the fixed DPS routes. The local backend remains the development fallback. Deploying a function requires Supabase CLI authentication for the project owner; the publishable key alone cannot deploy it.

### DPS endpoints used

- `GET https://dps.psx.com.pk/market-watch` — trading symbol table, sorted into top gainers, losers and volume leaders.
- `GET https://dps.psx.com.pk/indices` — current KSE-100 level and daily change.
- `GET https://dps.psx.com.pk/timeseries/int/KSE100` — intraday chart points.
- `POST https://dps.psx.com.pk/announcements` — official company disclosures (`type=C`, `page=annc`); PDF links point back to DPS.

### Public quote fallback

- `POST https://scanner.tradingview.com/pakistan/scan` — Pakistan market quotes used only when PSX market-watch fails; one response supplies symbols, price, daily change, and volume for all three mover lists.
- `https://www.investing.com/equities/pakistan` and `https://hamariweb.com/finance/stock_exchange.aspx` were checked but were not usable as feeds during verification (HTTP 403 and HTTP 404, respectively).

PSX does not publish a documented public API. Routes and table markup can change without notice. Some DPS nodes return 403/404 for data routes even when the main portal works; the local backend probes the documented data route and tries known DPS nodes before reporting an error. Market-open status is estimated from regular PSX weekday trading hours and does not account for public holidays. Data may be delayed or incomplete; it is not investment advice.

## Main files

- `public/index.html`, `public/home.css`, `public/home.js` — responsive homepage and auth-aware header.
- `public/psx-data.js` — reusable client-side data loader and short in-memory cache.
- `shared/psx-data.mjs` — DPS HTML/JSON response parsers shared by Node and the Edge Function.
- `server.js` — local web server and rate-paced, cached DPS proxy.
- `supabase/functions/psx-market-data/index.ts` — deployable Edge Function.
- `public/login.html`, `public/app.js` — existing Supabase Auth screen.
