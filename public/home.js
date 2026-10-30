const authActions = document.querySelector("#auth-actions");
const userMenu = document.querySelector("#user-menu");
const logoutButton = document.querySelector("#logout-button");
const marketStatus = document.querySelector("#market-status");
const indexValue = document.querySelector("#index-value");
const indexChange = document.querySelector("#index-change");
const indexChart = document.querySelector("#index-chart");
const indexChartLine = document.querySelector("#index-chart-line");
const snapshotError = document.querySelector("#snapshot-error");
const chartError = document.querySelector("#chart-error");
const refreshButton = document.querySelector("#refresh-button");
const mobileMenuButton = document.querySelector("#mobile-menu-button");
const mainNav = document.querySelector(".main-nav");

document.querySelector("#year").textContent = new Date().getFullYear();

function formatNumber(value, digits = 2) {
  return new Intl.NumberFormat("en-PK", {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  }).format(value);
}

function formatVolume(value) {
  return new Intl.NumberFormat("en-PK", {
    maximumFractionDigits: 0,
    notation: "compact",
  }).format(value);
}

function signedNumber(value, digits = 2) {
  return `${value > 0 ? "+" : value < 0 ? "−" : ""}${formatNumber(Math.abs(value), digits)}`;
}

function showResourceError(container, message = "PSX live data is temporarily unavailable. Retrying automatically.") {
  container.replaceChildren();
  const error = document.createElement("p");
  error.className = "data-error";
  error.textContent = message;
  container.append(error);
}

function setMarketStatus(status) {
  const open = status?.open ?? false;
  marketStatus.className = `market-status ${open ? "is-open" : "is-closed"}`;
  marketStatus.title = "Based on PSX's usual Pakistan Standard Time trading hours; public holidays may differ.";
  marketStatus.innerHTML = `<span class="status-dot"></span>${open ? "Market Open" : "Market Closed"}`;
}

function renderIndex(index, result) {
  if (!result?.ok || !index) {
    indexValue.textContent = "--";
    indexChange.className = "index-change is-muted";
    indexChange.textContent = "Index data unavailable";
    snapshotError.hidden = false;
    return;
  }

  indexValue.textContent = formatNumber(index.current);
  const direction = index.change > 0 ? "↑" : index.change < 0 ? "↓" : "•";
  indexChange.className = `index-change ${index.change > 0 ? "is-gain" : index.change < 0 ? "is-loss" : "is-muted"}`;
  indexChange.textContent = `${direction} ${signedNumber(index.change)} (${signedNumber(index.changePercent)}%) today`;
  snapshotError.hidden = true;
}

function renderChart(result, index) {
  if (!result?.ok || !Array.isArray(result.data) || result.data.length < 2) {
    indexChart.hidden = true;
    chartError.hidden = false;
    chartError.textContent = "PSX live data is temporarily unavailable. Retrying automatically.";
    return;
  }

  const values = result.data.map((point) => point.value).filter(Number.isFinite);
  const low = Math.min(...values);
  const high = Math.max(...values);
  const range = high - low || 1;
  const points = values.map((value, position) => {
    const x = 2 + (position / (values.length - 1)) * 176;
    const y = 62 - ((value - low) / range) * 52;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  indexChartLine.setAttribute("points", points.join(" "));
  indexChart.classList.toggle("is-loss", index?.change < 0);
  indexChart.setAttribute(
    "aria-label",
    `KSE-100 intraday movement from ${formatNumber(values[0])} to ${formatNumber(values.at(-1))}`,
  );
  indexChart.hidden = false;
  chartError.hidden = true;
}

function renderLeaderList(container, result, mode) {
  if (!result?.ok || !Array.isArray(result.data)) {
    showResourceError(container);
    return;
  }
  const { data } = result;
  if (!data.length) {
    container.innerHTML = '<p class="empty-message">No matching stocks are reported right now.</p>';
    return;
  }

  const fragment = document.createDocumentFragment();
  for (const item of data) {
    const row = document.createElement("div");
    row.className = "leader-row";
    const name = document.createElement("span");
    name.className = "leader-symbol";
    name.textContent = item.symbol;
    if (item.name) {
      const company = document.createElement("span");
      company.className = "leader-company";
      company.textContent = item.name;
      name.append(company);
    }

    const quote = document.createElement("span");
    quote.className = "leader-quote";
    const price = document.createElement("span");
    price.className = "leader-price";
    price.textContent = `Rs ${formatNumber(item.price)}`;
    const change = document.createElement("span");
    const changeClass = item.changePercent > 0 ? "is-gain" : item.changePercent < 0 ? "is-loss" : "is-neutral";
    change.className = `leader-metric ${changeClass}`;
    const changeText = `${signedNumber(item.changePercent)}%`;
    change.textContent = mode === "volume"
      ? `${formatVolume(item.volume)} vol · ${changeText}`
      : changeText;
    quote.append(price, change);
    row.append(name, quote);
    fragment.append(row);
  }

  const attribution = document.createElement("p");
  attribution.className = "quote-source";
  const updated = new Intl.DateTimeFormat("en-PK", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "Asia/Karachi",
  }).format(new Date(result.asOf));
  attribution.textContent = `Source: ${result.source} · Fetched ${updated} PKT`;
  fragment.append(attribution);
  container.replaceChildren(fragment);
}

function parseDisclosureDate(item) {
  const date = String(item.date || "").trim();
  const time = String(item.time || "00:00").trim();
  let timestamp = Date.parse(`${date} ${time} GMT+0500`);

  if (!Number.isFinite(timestamp)) {
    const isoDate = date.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    const alternate = date.match(/^(\d{1,2})[-/ ]([A-Za-z]{3}|\d{1,2})[-/ ](\d{4})$/);
    if (isoDate) {
      timestamp = Date.parse(`${isoDate[1]}-${isoDate[2].padStart(2, "0")}-${isoDate[3].padStart(2, "0")}T${time}+05:00`);
    } else if (alternate) {
      const month = /^\d+$/.test(alternate[2])
        ? Number(alternate[2]) - 1
        : new Date(`${alternate[2]} 1, 2000`).getMonth();
      timestamp = Date.UTC(Number(alternate[3]), month, Number(alternate[1]), 0, 0) - 5 * 60 * 60 * 1000;
    }
  }

  return Number.isFinite(timestamp) ? timestamp : null;
}

function relativeTime(timestamp, fallback) {
  if (timestamp === null) return fallback || "Date unavailable";
  const hours = Math.max(0, Math.floor((Date.now() - timestamp) / 3_600_000));
  if (hours < 1) return "Less than an hour ago";
  if (hours < 24) return `${hours} ${hours === 1 ? "hour" : "hours"} ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} ${days === 1 ? "day" : "days"} ago`;
  return new Intl.DateTimeFormat("en-PK", { dateStyle: "medium", timeZone: "Asia/Karachi" })
    .format(new Date(timestamp));
}

function renderAnnouncements(resource) {
  const grid = document.querySelector("#news-grid");
  if (!resource?.ok || !Array.isArray(resource.data)) {
    showResourceError(grid);
    return;
  }
  if (!resource.data.length) {
    grid.innerHTML = '<p class="empty-message">No recent company disclosures are available.</p>';
    return;
  }

  const fragment = document.createDocumentFragment();
  for (const item of resource.data.slice(0, 3)) {
    const card = document.createElement("article");
    card.className = "news-card";
    const category = document.createElement("p");
    category.className = "news-category";
    category.textContent = item.symbol ? `Company disclosure · ${item.symbol}` : "PSX company disclosure";
    const headline = item.link ? document.createElement("a") : document.createElement("p");
    headline.className = "news-title";
    headline.textContent = item.title;
    if (item.link) {
      headline.href = item.link;
      headline.target = "_blank";
      headline.rel = "noopener noreferrer";
    }
    const meta = document.createElement("p");
    meta.className = "news-meta";
    meta.textContent = `${item.company || "Pakistan Stock Exchange"} · ${relativeTime(parseDisclosureDate(item), item.date)}`;
    card.append(category, headline, meta);
    fragment.append(card);
  }
  grid.replaceChildren(fragment);
}

function renderMarketResponse(result) {
  renderIndex(result?.index?.data, result?.index);
  renderChart(result?.chart, result?.index?.data);
  setMarketStatus(result?.marketStatus || getMarketStatus());
}

function renderMoversResponse(results) {
  renderLeaderList(document.querySelector("#top-gainers"), results.gainers, "gainers");
  renderLeaderList(document.querySelector("#top-losers"), results.losers, "losers");
  renderLeaderList(document.querySelector("#most-active"), results.active, "volume");
}

function getMarketStatus() {
  const pkt = new Date(Date.now() + 5 * 60 * 60 * 1000);
  const weekday = pkt.getUTCDay();
  const minutes = pkt.getUTCHours() * 60 + pkt.getUTCMinutes();
  const open = (weekday >= 1 && weekday <= 4 && minutes >= 9 * 60 && minutes <= 15 * 60 + 45)
    || (weekday === 5 && (
      (minutes >= 9 * 60 && minutes <= 12 * 60 + 15)
      || (minutes >= 14 * 60 + 15 && minutes <= 16 * 60 + 45)
    ));
  return { open };
}

function setAuthUser(user) {
  authActions.hidden = Boolean(user);
  userMenu.hidden = !user;
  document.querySelector("#user-email").textContent = user?.email || "";
}

async function loadDashboard({ refresh = false } = {}) {
  const [market, announcements, gainers, losers, active] = await Promise.allSettled([
    window.PsxData.loadMarket({ refresh }),
    window.PsxData.loadAnnouncements({ refresh }),
    window.PsxData.loadMovers("gainers", { refresh }),
    window.PsxData.loadMovers("losers", { refresh }),
    window.PsxData.loadMovers("active", { refresh }),
  ]);
  if (market.status === "fulfilled") {
    renderMarketResponse(market.value);
  } else {
    console.error("Unable to load PSX market data:", market.reason);
    const failure = { ok: false };
    renderMarketResponse({ index: failure, chart: failure });
  }
  renderMoversResponse({
    gainers: gainers.status === "fulfilled" ? gainers.value : null,
    losers: losers.status === "fulfilled" ? losers.value : null,
    active: active.status === "fulfilled" ? active.value : null,
  });
  if (announcements.status === "fulfilled") {
    renderAnnouncements(announcements.value.announcements);
  } else {
    console.error("Unable to load PSX company announcements:", announcements.reason);
    showResourceError(document.querySelector("#news-grid"));
  }
}

async function initializeAuthAndData() {
  const configResponse = await fetch("/api/config");
  if (!configResponse.ok) throw new Error(`App configuration request failed (${configResponse.status}).`);
  const config = await configResponse.json();
  window.PsxData.configure({
    edgeFunctionUrl: config.psxDataFunctionUrl,
    publishableKey: config.publishableKey,
  });
  loadDashboard();

  if (!config.configured || !window.supabase?.createClient) return;
  const client = window.supabase.createClient(config.supabaseUrl, config.publishableKey);
  try {
    const { data, error } = await client.auth.getSession();
    if (error) throw error;
    setAuthUser(data.session?.user || null);
  } catch (error) {
    console.error("Unable to restore the Supabase session:", error);
    setAuthUser(null);
  }
  client.auth.onAuthStateChange((_event, session) => setAuthUser(session?.user || null));

  logoutButton.addEventListener("click", async () => {
    logoutButton.disabled = true;
    const { error: logoutError } = await client.auth.signOut();
    logoutButton.disabled = false;
    if (logoutError) console.error("Supabase sign out failed:", logoutError.message);
  });
}

refreshButton.addEventListener("click", async () => {
  refreshButton.disabled = true;
  try {
    await loadDashboard({ refresh: true });
  } finally {
    refreshButton.disabled = false;
  }
});

mobileMenuButton.addEventListener("click", () => {
  const expanded = mobileMenuButton.getAttribute("aria-expanded") === "true";
  mobileMenuButton.setAttribute("aria-expanded", String(!expanded));
  mainNav.classList.toggle("is-open", !expanded);
});

initializeAuthAndData().catch((error) => {
  console.error("Unable to initialize dashboard:", error);
  showResourceError(document.querySelector("#top-gainers"));
  showResourceError(document.querySelector("#top-losers"));
  showResourceError(document.querySelector("#most-active"));
  showResourceError(document.querySelector("#news-grid"));
  renderIndex(null, null);
  renderChart(null, null);
  setMarketStatus(getMarketStatus());
});

window.setInterval(() => loadDashboard({ refresh: true }), 130_000);
