// Kosha live backend — serves cached NSE bhavcopy-shaped data to the frontend.
// Runs under cPanel's Node.js Selector (Passenger). Do not call app.listen with a
// hardcoded port in that environment — Passenger injects PORT via env.

const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// ---- In-memory cache ----
let cache = { data: [], fetchedAt: 0 };
const CACHE_TTL_MS = 60 * 1000; // 60s during market hours

// NSE requires session cookies + realistic headers or it blocks the request.
// This handshake must run on the server, never in the browser.
async function fetchNseIndexQuotes() {
  const base = 'https://www.nseindia.com';
  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
    'Accept': 'application/json',
    'Accept-Language': 'en-US,en;q=0.9',
    'Referer': base + '/',
  };

  // Step 1: hit the homepage to collect cookies NSE requires on API calls.
  const homeRes = await fetch(base, { headers });
  const setCookie = homeRes.headers.get('set-cookie') || '';
  const cookieHeader = setCookie.split(',').map(c => c.split(';')[0]).join('; ');

  // Step 2: call the real quote endpoint with those cookies.
  const apiRes = await fetch(base + '/api/equity-stockIndices?index=NIFTY%20500', {
    headers: { ...headers, Cookie: cookieHeader },
  });
  if (!apiRes.ok) throw new Error('NSE API returned ' + apiRes.status);
  const json = await apiRes.json();

  // Step 3: normalize to the shape the frontend's BHAV array expects:
  // { s: symbol, e: series, c: close, p: pctChange, d: deliveryPct, t: tradedValueLakh, r: rangePos, n: numTrades }
  return (json.data || []).map(row => {
    const high = Number(row.dayHigh) || 0;
    const low = Number(row.dayLow) || 0;
    const close = Number(row.lastPrice) || 0;
    const rangePos = high > low ? (close - low) / (high - low) : 0.5;
    return {
      s: row.symbol,
      e: 'EQ',
      c: close,
      p: Number(row.pChange) || 0,
      d: Number(row.deliveryToTradedQuantity) || 0,
      t: Number(row.totalTradedValue) ? Number(row.totalTradedValue) / 100000 : 0, // to lakh
      r: Math.max(0, Math.min(1, rangePos)),
      n: Number(row.totalTradedVolume) || 0,
    };
  });
}

async function getBhavcopy() {
  const age = Date.now() - cache.fetchedAt;
  if (cache.data.length && age < CACHE_TTL_MS) return cache.data;
  try {
    const fresh = await fetchNseIndexQuotes();
    if (fresh.length) {
      cache = { data: fresh, fetchedAt: Date.now() };
    }
  } catch (err) {
    console.error('[bhavcopy] live fetch failed:', err.message);
    // Fall through — serve whatever is cached, even if stale, rather than erroring.
  }
  return cache.data;
}

app.get('/api/bhavcopy', async (req, res) => {
  const data = await getBhavcopy();
  res.set('Cache-Control', 'no-store');
  res.json(data);
});

app.get('/api/health', (req, res) => {
  res.json({ ok: true, cachedRows: cache.data.length, cacheAgeMs: Date.now() - cache.fetchedAt });
});

// Serve the static frontend (index.html + any assets) from ./public
app.use(express.static(path.join(__dirname, 'public')));

app.listen(PORT, () => {
  console.log('Kosha backend listening on port ' + PORT);
});
