const { createServer } = require("node:http");
const { resolve4 } = require("node:dns").promises;
const https = require("node:https");
const { readFile } = require("node:fs");
const { existsSync } = require("node:fs");
const { extname, join, resolve, sep } = require("node:path");

const marketMovers = import("./shared/market-movers.mjs");
const port = Number(process.env.PORT || 3001);
const publicDirectory = resolve(__dirname, "public");
const supabaseBundlePath = resolve(
  __dirname,
  "node_modules",
  "@supabase",
  "supabase-js",
  "dist",
  "umd",
  "supabase.js",
);
const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
};
const psxCache = new Map();
const psxInFlight = new Map();
const psxAgents = new Map();
const psxSeedNodes = ["52.128.23.16", "52.128.23.6"];
const psxHost = "dps.psx.com.pk";
const psxData = import("./shared/psx-data.mjs");
let selectedPsxNode;
let selectingPsxNode;
let upstreamQueue = Promise.resolve();
let lastUpstreamRequest = 0;
const cacheLifetime = 120_000;

function requestPsx(node, pathname, method = "GET", body = "") {
  let agent;
  if (node) agent = psxAgents.get(node);
  if (node && !agent) {
    agent = new https.Agent({
      keepAlive: true,
      lookup(hostname, options, callback) {
        if (options?.all) callback(null, [{ address: node, family: 4 }]);
        else callback(null, node, 4);
      },
    });
    psxAgents.set(node, agent);
  }

  const payload = Buffer.from(body);
  return new Promise((resolveResponse, rejectResponse) => {
    const request = https.request({
      agent,
      headers: {
        "Accept-Encoding": "gzip, deflate",
        "Host": psxHost,
        "User-Agent": "ProfessorStocks/1.0 (PSX market dashboard)",
        "X-Requested-With": "XMLHttpRequest",
        ...(method === "POST" ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
        ...(method === "POST" ? { "Content-Length": payload.length } : {}),
      },
      hostname: psxHost,
      method,
      path: pathname,
      port: 443,
      servername: psxHost,
      timeout: 20_000,
    }, (response) => {
      const chunks = [];
      let size = 0;
      response.on("data", (chunk) => {
        size += chunk.length;
        if (size > 2_000_000) {
          request.destroy(new Error("PSX response exceeded the size limit."));
          return;
        }
        chunks.push(chunk);
      });
      response.on("end", () => {
        const content = Buffer.concat(chunks);
        const encoding = response.headers["content-encoding"];
        const decompress = encoding === "gzip"
          ? require("node:zlib").gunzipSync
          : encoding === "deflate"
            ? require("node:zlib").inflateSync
            : null;
        try {
          resolveResponse({
            body: (decompress ? decompress(content) : content).toString("utf8"),
            status: response.statusCode || 0,
          });
        } catch (error) {
          rejectResponse(error);
        }
      });
      response.on("error", rejectResponse);
    });
    request.on("timeout", () => request.destroy(new Error("PSX request timed out.")));
    request.on("error", rejectResponse);
    if (method === "POST") request.write(payload);
    request.end();
  });
}

function requestTradingViewMarket() {
  const payload = JSON.stringify({
    filter: [{ left: "volume", operation: "greater", right: 0 }],
    options: { lang: "en" },
    symbols: { query: { types: [] }, tickers: [] },
    columns: ["name", "close", "change", "change_abs", "volume"],
    sort: { sortBy: "volume", sortOrder: "desc" },
    range: [0, 1000],
  });

  return new Promise((resolveResponse, rejectResponse) => {
    const request = https.request({
      hostname: "scanner.tradingview.com",
      method: "POST",
      path: "/pakistan/scan",
      port: 443,
      servername: "scanner.tradingview.com",
      timeout: 15_000,
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(payload),
        "Origin": "https://www.tradingview.com",
        "Referer": "https://www.tradingview.com/",
        "User-Agent": "Mozilla/5.0 (compatible; ProfessorStocks/1.0)",
      },
    }, (response) => {
      const chunks = [];
      let size = 0;
      response.on("data", (chunk) => {
        size += chunk.length;
        if (size > 2_000_000) {
          request.destroy(new Error("TradingView response exceeded the size limit."));
          return;
        }
        chunks.push(chunk);
      });
      response.on("end", () => {
        const body = Buffer.concat(chunks).toString("utf8");
        if (response.statusCode < 200 || response.statusCode >= 300) {
          rejectResponse(new Error(`TradingView returned HTTP ${response.statusCode}.`));
          return;
        }
        try {
          resolveResponse(JSON.parse(body));
        } catch {
          rejectResponse(new Error("TradingView returned invalid JSON."));
        }
      });
      response.on("error", rejectResponse);
    });
    request.on("timeout", () => request.destroy(new Error("TradingView request timed out.")));
    request.on("error", rejectResponse);
    request.end(payload);
  });
}

function upstreamRequest(node, pathname, method, body) {
  const next = upstreamQueue.then(async () => {
    const wait = Math.max(0, 1000 - (Date.now() - lastUpstreamRequest));
    if (wait) await new Promise((resolveWait) => setTimeout(resolveWait, wait));
    lastUpstreamRequest = Date.now();
    return requestPsx(node, pathname, method, body);
  });
  upstreamQueue = next.catch(() => {});
  return next;
}

async function getPsxCandidates() {
  let addresses = [];
  try {
    addresses = await resolve4(psxHost);
  } catch (error) {
    console.warn("Could not resolve current PSX data nodes:", error.message);
  }
  return [...new Set([...addresses, ...psxSeedNodes])];
}

async function findHealthyPsxNode(excluded = new Set()) {
  if (selectedPsxNode && !excluded.has(selectedPsxNode)) return selectedPsxNode;
  if (!selectingPsxNode) {
    selectingPsxNode = (async () => {
      for (const candidate of await getPsxCandidates()) {
        if (excluded.has(candidate)) continue;
        try {
          const probe = await upstreamRequest(candidate, "/data/symbol-position", "GET", "");
          if (probe.status === 200) {
            JSON.parse(probe.body);
            selectedPsxNode = candidate;
            return candidate;
          }
          console.warn(`PSX data node ${candidate} did not pass its data-route probe (HTTP ${probe.status}).`);
        } catch (error) {
          console.warn(`PSX data node ${candidate} probe failed:`, error.message);
        }
      }
      throw new Error("PSX data portal is unavailable from the available data nodes.");
    })().finally(() => {
      selectingPsxNode = undefined;
    });
  }
  return selectingPsxNode;
}

async function fetchPsx(pathname, { method = "GET", body = "" } = {}) {
  let node;
  try {
    node = await findHealthyPsxNode();
  } catch (error) {
    if (pathname !== "/indices") throw error;
    const response = await upstreamRequest(undefined, pathname, method, body);
    if (response.status < 200 || response.status >= 300) {
      throw new Error(`PSX returned HTTP ${response.status} for ${pathname}.`);
    }
    return response.body;
  }
  let response = await upstreamRequest(node, pathname, method, body);
  if (response.status === 403 || response.status === 404) {
    selectedPsxNode = undefined;
    const alternate = await findHealthyPsxNode(new Set([node]));
    response = await upstreamRequest(alternate, pathname, method, body);
  }
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`PSX returned HTTP ${response.status} for ${pathname}.`);
  }
  return response.body;
}

function cachePsx(key, fetcher) {
  const cached = psxCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return Promise.resolve(cached.value);
  const pending = psxInFlight.get(key);
  if (pending) return pending;

  const request = fetcher().then((value) => {
    const lifetime = value?.ok === false ? 15_000 : cacheLifetime;
    psxCache.set(key, { value, expiresAt: Date.now() + lifetime });
    return value;
  }).finally(() => psxInFlight.delete(key));
  psxInFlight.set(key, request);
  return request;
}

async function cachedResource(key, fetcher) {
  return cachePsx(key, async () => {
    try {
      return { data: await fetcher(), ok: true, asOf: new Date().toISOString() };
    } catch (error) {
      console.error(`PSX data request failed (${key}):`, error);
      return {
        error: "Couldn't load live data — try refreshing.",
        ok: false,
        asOf: new Date().toISOString(),
      };
    }
  });
}

async function getMarketResponse() {
  const psx = await psxData;
  const marketWatch = cachedResource("market-watch", async () =>
    psx.parseMarketWatch(await fetchPsx("/market-watch")));
  const indices = cachedResource("indices", async () =>
    psx.parseIndices(await fetchPsx("/indices")));
  const intraday = cachedResource("kse100-intraday", async () =>
    psx.parseIntraday(JSON.parse(await fetchPsx("/timeseries/int/KSE100"))));
  const [market, index, chart] = await Promise.all([marketWatch, indices, intraday]);
  return {
    market,
    index: index.ok
      ? { data: index.data.find((entry) => entry.code.toUpperCase() === "KSE100") || null, ok: true }
      : index,
    chart,
    asOf: new Date().toISOString(),
    marketStatus: getMarketStatus(),
  };
}

async function getMoversResponse(category) {
  const [psx, movers] = await Promise.all([psxData, marketMovers]);
  const official = await cachedResource("market-watch", async () =>
    psx.parseMarketWatch(await fetchPsx("/market-watch")));
  if (official.ok) {
    return {
      ok: true,
      data: movers.selectMarketMovers(official.data, category),
      source: "PSX DPS",
      asOf: official.asOf,
    };
  }

  const fallback = await cachedResource("tradingview-market", async () =>
    movers.parseTradingViewMarket(await requestTradingViewMarket()));
  if (!fallback.ok) {
    return {
      ok: false,
      error: "Official PSX and TradingView quotes are temporarily unavailable.",
      source: null,
      asOf: new Date().toISOString(),
    };
  }
  return {
    ok: true,
    data: movers.selectMarketMovers(fallback.data, category),
    source: "TradingView",
    asOf: fallback.asOf,
  };
}

function getMarketStatus() {
  const now = new Date(Date.now() + 5 * 60 * 60 * 1000);
  const weekday = now.getUTCDay();
  const minutes = now.getUTCHours() * 60 + now.getUTCMinutes();
  const isWeekday = weekday >= 1 && weekday <= 5;
  const weekdayOpen = weekday >= 1 && weekday <= 4 && minutes >= 9 * 60 && minutes <= 15 * 60 + 45;
  const fridayOpen = weekday === 5 && (
    (minutes >= 9 * 60 && minutes <= 12 * 60 + 15)
    || (minutes >= 14 * 60 + 15 && minutes <= 16 * 60 + 45)
  );
  return {
    label: weekdayOpen || fridayOpen ? "Market Open" : "Market Closed",
    open: Boolean(isWeekday && (weekdayOpen || fridayOpen)),
  };
}

async function getAnnouncementsResponse() {
  const psx = await psxData;
  const body = new URLSearchParams({
    type: "C",
    count: "20",
    offset: "0",
    page: "annc",
  }).toString();
  const announcements = await cachedResource("company-announcements", async () =>
    psx.parseAnnouncements(await fetchPsx("/announcements", { method: "POST", body })));
  return { announcements, asOf: new Date().toISOString() };
}

function getSupabaseConfig() {
  const projectUrl = process.env.SUPABASE_URL || "";
  const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY || "";
  if (!projectUrl || !publishableKey) return null;

  try {
    const url = new URL(projectUrl);
    if (
      url.protocol !== "https:"
      || url.username
      || url.password
      || url.pathname !== "/"
      || url.search
      || url.hash
    ) return null;
    return { projectUrl: url.origin, publishableKey };
  } catch {
    return null;
  }
}

function sendJson(response, status, value) {
  response.writeHead(status, {
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
  });
  response.end(JSON.stringify(value));
}

function serveFile(request, response, filePath) {
  readFile(filePath, (error, content) => {
    if (error) {
      if (error.code === "ENOENT") {
        response.writeHead(404);
        return response.end("Not found.");
      }
      console.error("Unable to read requested asset:", error);
      response.writeHead(500);
      return response.end("Unable to load this page.");
    }

    response.writeHead(200, {
      "Cache-Control": /\.(?:html|css|js)$/i.test(filePath)
        ? "no-cache"
        : "public, max-age=3600",
      "Content-Length": content.length,
      "Content-Type": contentTypes[extname(filePath)] || "application/octet-stream",
    });
    response.end(request.method === "HEAD" ? undefined : content);
  });
}

const server = createServer((request, response) => {
  const config = getSupabaseConfig();
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("X-Frame-Options", "DENY");
  response.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  response.setHeader(
    "Content-Security-Policy",
    `default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' data:; connect-src 'self'${config ? ` ${config.projectUrl} wss://${new URL(config.projectUrl).host}` : ""}; form-action 'self'; frame-ancestors 'none'; base-uri 'self'`,
  );

  let pathname;
  try {
    pathname = new URL(request.url, "http://localhost").pathname;
  } catch {
    response.writeHead(400);
    return response.end("Bad request.");
  }

  if (request.method !== "GET" && request.method !== "HEAD") {
    response.writeHead(405, { Allow: "GET, HEAD" });
    return response.end("Method not allowed.");
  }

  if (pathname === "/api/config") {
    return sendJson(response, 200, config
      ? {
        configured: true,
        supabaseUrl: config.projectUrl,
        publishableKey: config.publishableKey,
        psxDataFunctionUrl: process.env.PSX_DATA_FUNCTION_URL || "",
      }
      : { configured: false });
  }

  if (request.method === "GET" && pathname === "/api/psx/market") {
    return getMarketResponse().then((data) => sendJson(response, 200, data)).catch((error) => {
      console.error("Unable to load PSX market data:", error);
      return sendJson(response, 502, { error: "Couldn't load live data — try refreshing." });
    });
  }

  if (request.method === "GET" && pathname === "/api/psx/announcements") {
    return getAnnouncementsResponse().then((data) => sendJson(response, 200, data)).catch((error) => {
      console.error("Unable to load PSX announcements:", error);
      return sendJson(response, 502, { error: "Couldn't load live data — try refreshing." });
    });
  }

  const liveMover = pathname.match(/^\/api\/live\/(gainers|losers|active)$/);
  if (request.method === "GET" && liveMover) {
    const category = liveMover[1];
    return getMoversResponse(category).then((data) =>
      sendJson(response, data.ok ? 200 : 502, data)).catch((error) => {
      console.error(`Unable to load ${category} market quotes:`, error);
      return sendJson(response, 502, {
        ok: false,
        error: "Market quotes are temporarily unavailable. Please try again.",
        source: null,
      });
    });
  }

  if (pathname === "/vendor/supabase.js") {
    if (!existsSync(supabaseBundlePath)) {
      console.error("Supabase SDK bundle is missing. Run npm install.");
      return sendJson(response, 503, { error: "Supabase SDK is not installed. Run npm install." });
    }
    return serveFile(request, response, supabaseBundlePath);
  }

  let decodedPath;
  try {
    decodedPath = decodeURIComponent(pathname);
  } catch {
    response.writeHead(400);
    return response.end("Bad request.");
  }
  const relativePath = decodedPath === "/" ? "index.html" : decodedPath.slice(1);
  const pagePath = relativePath === "login" || relativePath === "login/"
    ? "login.html"
    : relativePath === "dashboard.html"
      ? "index.html"
      : relativePath;
  const filePath = resolve(publicDirectory, pagePath);
  if (!filePath.startsWith(`${publicDirectory}${sep}`)) {
    response.writeHead(404);
    return response.end("Not found.");
  }
  serveFile(request, response, filePath);
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Professor Stocks is running at http://localhost:${port}`);
  if (getSupabaseConfig()) {
    console.log("Supabase configuration found.");
  } else {
    console.log("Supabase is not configured. Add SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY to .env.");
  }
});

function shutDown() {
  server.close(() => process.exit(0));
}
process.on("SIGINT", shutDown);
process.on("SIGTERM", shutDown);
