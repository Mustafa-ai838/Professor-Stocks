export function parseTradingViewMarket(payload) {
  if (!Array.isArray(payload?.data) || payload.data.length === 0) {
    throw new Error("TradingView did not return any Pakistan Stock Exchange quotes.");
  }

  const quotes = payload.data.flatMap((row) => {
    const [symbolValue, price, changePercent, change, volume] = row?.d || [];
    const symbol = String(symbolValue || "").trim();
    if (
      (row.s && !String(row.s).startsWith("PSX:"))
      || !/^([A-Z0-9][A-Z0-9.-]*)$/.test(symbol)
      || !Number.isFinite(price)
      || price <= 0
      || !Number.isFinite(changePercent)
      || !Number.isFinite(change)
      || !Number.isFinite(volume)
      || volume < 0
    ) return [];

    return [{ symbol, price, changePercent, change, volume }];
  });

  if (!quotes.length) {
    throw new Error("TradingView response did not contain valid Pakistan Stock Exchange quotes.");
  }
  return quotes;
}

export function selectMarketMovers(quotes, category, limit = 3) {
  let matches;
  if (category === "gainers") {
    matches = quotes.filter((quote) => quote.changePercent > 0)
      .sort((left, right) => right.changePercent - left.changePercent);
  } else if (category === "losers") {
    matches = quotes.filter((quote) => quote.changePercent < 0)
      .sort((left, right) => left.changePercent - right.changePercent);
  } else if (category === "active") {
    matches = quotes.filter((quote) => quote.volume > 0)
      .sort((left, right) => right.volume - left.volume);
  } else {
    throw new Error(`Unknown market mover category: ${category}`);
  }
  return matches.slice(0, limit);
}
