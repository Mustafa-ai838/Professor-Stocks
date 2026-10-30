import {
  parseAnnouncements,
  parseIndices,
  parseIntraday,
  parseMarketWatch,
  psxUrl,
} from "../../../shared/psx-data.mjs";

const cacheLifetime = 120_000;
const cache = new Map<string, { value: unknown; expiresAt: number }>();
const inFlight = new Map<string, Promise<unknown>>();
const psxOrigin = "https://dps.psx.com.pk";
const corsHeaders = {
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Origin": "*",
};
let lastPsxRequest = 0;
let psxRequestQueue = Promise.resolve();

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    headers: {
      ...corsHeaders,
      "Cache-Control": "no-store",
      "Content-Type": "application/json; charset=utf-8",
    },
    status,
  });
}

async function requestPsx(path: string, method = "GET", body?: string) {
  const next = psxRequestQueue.then(async () => {
    const wait = Math.max(0, 1000 - (Date.now() - lastPsxRequest));
    if (wait) await new Promise((resolve) => setTimeout(resolve, wait));
    lastPsxRequest = Date.now();
    return fetch(psxUrl(path), {
      body,
      headers: {
        "Accept-Encoding": "gzip, deflate",
        "User-Agent": "ProfessorStocks/1.0 (PSX market dashboard)",
        "X-Requested-With": "XMLHttpRequest",
        ...(body ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
      },
      method,
      signal: AbortSignal.timeout(20_000),
    });
  });
  psxRequestQueue = next.then(() => {}, () => {});

  const response = await next;
  if (!response.ok) throw new Error(`PSX returned HTTP ${response.status} for ${path}.`);
  return response;
}

async function cached<T>(key: string, fetcher: () => Promise<T>): Promise<T> {
  const current = cache.get(key);
  if (current && current.expiresAt > Date.now()) return current.value as T;
  const pending = inFlight.get(key);
  if (pending) return pending as Promise<T>;

  const request = fetcher().then((value) => {
    cache.set(key, { value, expiresAt: Date.now() + cacheLifetime });
    return value;
  }).finally(() => inFlight.delete(key));
  inFlight.set(key, request);
  return request;
}

async function cachedResource<T>(key: string, fetcher: () => Promise<T>) {
  return cached(key, async () => {
    try {
      return { data: await fetcher(), ok: true };
    } catch (error) {
      console.error(`PSX data request failed (${key}):`, error);
      return { error: "Couldn't load live data — try refreshing.", ok: false };
    }
  });
}

async function loadMarket() {
  const marketWatch = cachedResource("market-watch", async () =>
    parseMarketWatch(await (await requestPsx("/market-watch")).text()));
  const indices = cachedResource("indices", async () =>
    parseIndices(await (await requestPsx("/indices")).text()));
  const chart = cachedResource("kse100-intraday", async () =>
    parseIntraday(await (await requestPsx("/timeseries/int/KSE100")).json()));
  const [market, index, sparkline] = await Promise.all([marketWatch, indices, chart]);

  return {
    market,
    index: index.ok
      ? { data: index.data.find((entry) => entry.code.toUpperCase() === "KSE100") || null, ok: true }
      : index,
    chart: sparkline,
    asOf: new Date().toISOString(),
  };
}

async function loadAnnouncements() {
  const body = new URLSearchParams({
    type: "C",
    count: "20",
    offset: "0",
    page: "annc",
  }).toString();
  return {
    announcements: await cachedResource("company-announcements", async () =>
      parseAnnouncements(await (await requestPsx("/announcements", "POST", body)).text())),
    asOf: new Date().toISOString(),
  };
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (request.method !== "GET") {
    return jsonResponse({ error: "Method not allowed." }, 405);
  }

  const resource = new URL(request.url).pathname.split("/").filter(Boolean).at(-1);
  try {
    if (resource === "market") return jsonResponse(await loadMarket());
    if (resource === "announcements") return jsonResponse(await loadAnnouncements());
    return jsonResponse({ error: "Unknown PSX data resource." }, 404);
  } catch (error) {
    console.error("PSX market data function failed:", error);
    return jsonResponse({ error: "Couldn't load live data — try refreshing." }, 502);
  }
});
