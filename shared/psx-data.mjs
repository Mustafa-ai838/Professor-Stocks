const PSX_ORIGIN = "https://dps.psx.com.pk";

function decodeHtml(value) {
  const named = {
    amp: "&",
    apos: "'",
    gt: ">",
    lt: "<",
    nbsp: " ",
    quot: '"',
  };
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&([a-z]+);/gi, (entity, name) => named[name.toLowerCase()] ?? entity);
}

function stripTags(value) {
  return decodeHtml(value.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
}

function attribute(attributes, name) {
  const match = attributes.match(new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i"));
  return match ? decodeHtml(match[1] ?? match[2] ?? match[3] ?? "") : "";
}

function parseTable(tableHtml) {
  const rows = [...tableHtml.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map((match) => match[1]);
  const headers = [];
  let headerRowIndex = -1;

  for (let index = 0; index < rows.length; index += 1) {
    const cells = [...rows[index].matchAll(/<(th|td)\b([^>]*)>([\s\S]*?)<\/\1>/gi)];
    if (cells.some((cell) => cell[1].toLowerCase() === "th")) {
      headers.push(...cells.map((cell) => attribute(cell[2], "data-name") || stripTags(cell[3])));
      headerRowIndex = index;
      break;
    }
  }

  return rows.slice(headerRowIndex + 1).flatMap((rowHtml) => {
    const cells = [...rowHtml.matchAll(/<(th|td)\b([^>]*)>([\s\S]*?)<\/\1>/gi)];
    if (!cells.length || cells.some((cell) => cell[1].toLowerCase() === "th")) return [];
    const record = {};
    for (let index = 0; index < cells.length; index += 1) {
      const [, , attributes, content] = cells[index];
      const name = attribute(attributes, "data-name") || headers[index] || `col${index}`;
      const order = attribute(attributes, "data-order");
      record[name] = name.toLowerCase() === "date" || name.toLowerCase() === "time"
        ? stripTags(content) || order
        : order || stripTags(content);
    }
    const links = [...rowHtml.matchAll(/<a\b([^>]*)>/gi)]
      .map((match) => attribute(match[1], "href"))
      .filter(Boolean);
    record.link = links.find((href) => href.includes("/download/")) || "";
    return [record];
  });
}

function findTable(html, predicate) {
  const tables = html.match(/<table\b[\s\S]*?<\/table>/gi) || [];
  return tables.find(predicate);
}

function numberValue(value) {
  const number = Number(String(value ?? "").replace(/,/g, "").replace(/%/g, "").replace(/[▲▼↑↓]/g, "").trim());
  return Number.isFinite(number) ? number : null;
}

function normalizeHeader(value) {
  return value.toLowerCase().replace(/%/g, "percent").replace(/[^a-z]/g, "");
}

function findValue(record, ...names) {
  const normalized = new Map(Object.entries(record).map(([key, value]) => [normalizeHeader(key), value]));
  for (const name of names) {
    const value = normalized.get(normalizeHeader(name));
    if (value !== undefined) return value;
  }
  return "";
}

export function parseMarketWatch(html) {
  const table = findTable(html, (candidate) => /data-name\s*=\s*["']symbol["']/i.test(candidate));
  if (!table) throw new Error("PSX market-watch response did not contain the expected symbol table.");
  const records = parseTable(table).map((record) => ({
    symbol: String(findValue(record, "symbol")).trim(),
    name: String(findValue(record, "name", "company")).trim(),
    price: numberValue(findValue(record, "close", "current", "price")),
    change: numberValue(findValue(record, "change")),
    changePercent: numberValue(findValue(record, "percentChange", "changePercent", "% Change")),
    volume: numberValue(findValue(record, "volume")),
  })).filter((record) => record.symbol && record.price !== null);
  if (!records.length) throw new Error("PSX market-watch response did not contain any valid quotes.");
  return records;
}

export function parseIndices(html) {
  const table = findTable(html, (candidate) => {
    const header = candidate.match(/<th\b([^>]*)>([\s\S]*?)<\/th>/i);
    return header && (attribute(header[1], "data-name") || stripTags(header[2])).toLowerCase() === "index";
  });
  if (!table) throw new Error("PSX indices response did not contain the expected index table.");
  const indices = parseTable(table).map((record) => ({
    code: String(findValue(record, "index")).trim(),
    current: numberValue(findValue(record, "current")),
    change: numberValue(findValue(record, "change")),
    changePercent: numberValue(findValue(record, "% Change", "percentChange")),
    high: numberValue(findValue(record, "high")),
    low: numberValue(findValue(record, "low")),
  })).filter((index) => index.code && index.current !== null);
  if (!indices.length) throw new Error("PSX indices response did not contain valid index values.");
  return indices;
}

export function parseIntraday(payload) {
  if (payload?.status !== 1 || !Array.isArray(payload.data)) {
    throw new Error(payload?.message || "PSX intraday response did not contain chart data.");
  }
  return payload.data.flatMap((row) => {
    if (!Array.isArray(row) || row.length < 2) return [];
    const timestamp = numberValue(row[0]);
    const value = numberValue(row[1]);
    return timestamp !== null && value !== null ? [{ timestamp, value }] : [];
  }).reverse();
}

export function parseAnnouncements(html) {
  const table = findTable(html, (candidate) => /<th[^>]*>\s*TITLE\s*<\/th>/i.test(candidate));
  if (!table) throw new Error("PSX announcements response did not contain the expected disclosure table.");
  return parseTable(table).map((record) => ({
    date: String(findValue(record, "date")).trim(),
    time: String(findValue(record, "time")).trim(),
    symbol: String(findValue(record, "symbol")).trim(),
    company: String(findValue(record, "name")).trim(),
    title: String(findValue(record, "title")).trim(),
    link: String(findValue(record, "link")).trim(),
  })).filter((record) => record.title).slice(0, 3).map((record) => ({
    ...record,
    link: record.link ? new URL(record.link, PSX_ORIGIN).href : "",
  }));
}

export function psxUrl(path) {
  return new URL(path, PSX_ORIGIN);
}
