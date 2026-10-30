(function () {
  const cacheLifetime = 120_000;
  const cache = new Map();
  let edgeFunctionUrl = "";
  let publishableKey = "";

  function configure(options) {
    edgeFunctionUrl = options.edgeFunctionUrl || "";
    publishableKey = options.publishableKey || "";
  }

  async function load(resource, { refresh = false } = {}) {
    const cached = cache.get(resource);
    if (!refresh && cached && cached.expiresAt > Date.now()) return cached.value;

    try {
      const url = edgeFunctionUrl
        ? `${edgeFunctionUrl.replace(/\/+$/, "")}/${resource}`
        : `/api/psx/${resource}`;
      const response = await fetch(url, {
        headers: edgeFunctionUrl ? { apikey: publishableKey } : {},
      });
      let result;
      try {
        result = await response.json();
      } catch {
        throw new Error("PSX data service returned an invalid response.");
      }
      if (!response.ok) throw new Error(result.error || `PSX data service returned HTTP ${response.status}.`);
      cache.set(resource, { value: result, expiresAt: Date.now() + cacheLifetime });
      return result;
    } catch (error) {
      console.error(`Unable to load PSX ${resource} data:`, error);
      throw new Error("Couldn't load live data — try refreshing.");
    }
  }

  async function loadMovers(category, { refresh = false } = {}) {
    const resource = `live-${category}`;
    const cached = cache.get(resource);
    if (!refresh && cached && cached.expiresAt > Date.now()) return cached.value;

    try {
      const response = await fetch(`/api/live/${encodeURIComponent(category)}`);
      let result;
      try {
        result = await response.json();
      } catch {
        throw new Error("Market quote service returned an invalid response.");
      }
      if (!response.ok || !result.ok) {
        throw new Error(result.error || `Market quote service returned HTTP ${response.status}.`);
      }
      cache.set(resource, { value: result, expiresAt: Date.now() + cacheLifetime });
      return result;
    } catch (error) {
      console.error(`Unable to load live ${category} data:`, error);
      throw new Error("Market quotes are temporarily unavailable. Retrying automatically.");
    }
  }

  window.PsxData = {
    configure,
    loadAnnouncements: (options) => load("announcements", options),
    loadMarket: (options) => load("market", options),
    loadMovers,
  };
})();
