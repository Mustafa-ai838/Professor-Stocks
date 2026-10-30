import test from "node:test";
import assert from "node:assert/strict";
import {
  parseAnnouncements,
  parseIndices,
  parseIntraday,
  parseMarketWatch,
} from "../shared/psx-data.mjs";
import {
  parseTradingViewMarket,
  selectMarketMovers,
} from "../shared/market-movers.mjs";

test("parses real TradingView PSX scanner rows into normalized quotes", () => {
  const quotes = parseTradingViewMarket({
    totalCount: 2,
    data: [
      { s: "PSX:AAA", d: ["AAA", 12.5, 10, 1.25, 1250] },
      { s: "PSX:BBB", d: ["BBB", 7.5, -5, -0.4, 2500] },
    ],
  });

  assert.deepEqual(quotes, [
    { symbol: "AAA", price: 12.5, changePercent: 10, change: 1.25, volume: 1250 },
    { symbol: "BBB", price: 7.5, changePercent: -5, change: -0.4, volume: 2500 },
  ]);
});

test("selects sorted gainers, losers and active PSX quotes", () => {
  const quotes = [
    { symbol: "AAA", changePercent: 2, volume: 10 },
    { symbol: "BBB", changePercent: -5, volume: 30 },
    { symbol: "CCC", changePercent: 9, volume: 20 },
    { symbol: "DDD", changePercent: -1, volume: 40 },
  ];

  assert.deepEqual(selectMarketMovers(quotes, "gainers").map((quote) => quote.symbol), ["CCC", "AAA"]);
  assert.deepEqual(selectMarketMovers(quotes, "losers").map((quote) => quote.symbol), ["BBB", "DDD"]);
  assert.deepEqual(selectMarketMovers(quotes, "active").map((quote) => quote.symbol), ["DDD", "BBB", "CCC"]);
  assert.throws(() => selectMarketMovers(quotes, "unknown"), /Unknown market mover category/);
});

test("rejects empty or malformed TradingView quote payloads", () => {
  assert.throws(() => parseTradingViewMarket({ totalCount: 0, data: [] }), /did not return any/);
  assert.throws(() => parseTradingViewMarket({
    data: [{ s: "OTHER:AAA", d: ["AAA", 1, 1, 1, 1] }],
  }), /did not contain valid/);
});

test("parses PSX market-watch rows and raw numeric order values", () => {
  const html = `
    <table>
      <thead><tr>
        <th data-name="symbol">Symbol</th>
        <th data-name="name">Name</th>
        <th data-name="close">Close</th>
        <th data-name="change">Change</th>
        <th data-name="percentChange">% Change</th>
        <th data-name="volume">Volume</th>
      </tr></thead>
      <tbody>
        <tr><td>AAA</td><td>Alpha</td><td data-order="12.5">12.50</td>
          <td data-order="1.25">▲ 1.25</td><td data-order="10">▲ 10.00%</td>
          <td data-order="1250">1,250</td></tr>
      </tbody>
    </table>`;

  assert.deepEqual(parseMarketWatch(html), [{
    symbol: "AAA",
    name: "Alpha",
    price: 12.5,
    change: 1.25,
    changePercent: 10,
    volume: 1250,
  }]);
});

test("parses KSE-100 index values from the PSX indices table", () => {
  const html = `
    <table><thead><tr>
      <th>Index</th><th>High</th><th>Low</th><th>Current</th><th>Change</th><th>% Change</th>
    </tr></thead><tbody><tr>
      <td>KSE100</td><td data-order="167338.72">167,338.72</td>
      <td data-order="166750.43">166,750.43</td><td data-order="167128.21">167,128.21</td>
      <td data-order="-65.22">▼ 65.22</td><td data-order="-0.04">-0.04%</td>
    </tr></tbody></table>`;

  assert.deepEqual(parseIndices(html), [{
    code: "KSE100",
    current: 167128.21,
    change: -65.22,
    changePercent: -0.04,
    high: 167338.72,
    low: 166750.43,
  }]);
});

test("parses intraday ticks in oldest-to-newest order", () => {
  assert.deepEqual(parseIntraday({
    status: 1,
    data: [[2, 102, 20], [1, 100, 10]],
  }), [
    { timestamp: 1, value: 100 },
    { timestamp: 2, value: 102 },
  ]);
});

test("parses company disclosure titles and official PDF links", () => {
  const html = `
    <table><thead><tr>
      <th>DATE</th><th>TIME</th><th>SYMBOL</th><th>NAME</th><th>TITLE</th><th>DOCUMENT</th>
    </tr></thead><tbody><tr>
      <td>30-Oct-2026</td><td>12:00</td><td>AAA</td><td>Alpha &amp; Sons</td>
      <td>Board meeting notice</td><td><a href="/download/document/42.pdf">PDF</a></td>
    </tr></tbody></table>`;

  assert.deepEqual(parseAnnouncements(html), [{
    date: "30-Oct-2026",
    time: "12:00",
    symbol: "AAA",
    company: "Alpha & Sons",
    title: "Board meeting notice",
    link: "https://dps.psx.com.pk/download/document/42.pdf",
  }]);
});

test("rejects unexpected PSX response shapes instead of returning empty data", () => {
  assert.throws(() => parseMarketWatch("<html>Unavailable</html>"), /expected symbol table/);
  assert.throws(() => parseIntraday({ status: 0, message: "Unavailable", data: [] }), /Unavailable/);
});
