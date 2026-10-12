// Kosha live backend — serves end-of-day NSE bhavcopy data to the frontend.
// Uses NSE's publicly downloadable daily CSV archive (sec_bhavdata_full), not the
// nseindia.com website API — that API blocks scripted/datacenter traffic with 403s,
// but the static archive files on archives.nseindia.com are meant for exactly this.
//
// The file for a given trading day is published after market close (~6:30pm IST).
// This fetches the most recent available day's file and caches it until the next
// one is published, re-checking once an hour.

const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const RECHECK_MS = 60 * 60 * 1000; // re-check for a newer file once an hour

let cache = { data: [], fetchedAt: 0, tradingDate: null };

function fmtDDMMYYYY(d) {
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  return dd + mm + yyyy;
}

function bhavcopyUrl(d) {
  return `https://archives.nseindia.com/products/content/sec_bhavdata_full_${fmtDDMMYYYY(d)}.csv`;
}

// Parses NSE's sec_bhavdata_full CSV into the shape the frontend's BHAV array expects:
// { s: symbol, e: series, c: close, p: pctChange, d: deliveryPct, t: tradedValueLakh, r: rangePos, n: numTrades }
function parseSecBhavdata(csvText) {
  const lines = csvText.split('\n').filter(l => l.trim());
  if (!lines.length) return [];
  const headers = lines[0].split(',').map(h => h.trim());
  const idx = name => headers.indexOf(name);

  const iSymbol = idx('SYMBOL'), iSeries = idx('SERIES'), iPrevClose = idx('PREV_CLOSE'),
    iHigh = idx('HIGH_PRICE'), iLow = idx('LOW_PRICE'), iClose = idx('CLOSE_PRICE'),
    iTurnover = idx('TURNOVER_LACS'), iTrades = idx('NO_OF_TRADES'), iDelivPer = idx('DELIV_PER');

  const out = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = lines[i].split(',').map(c => c.trim());
    if (cells.length < headers.length) continue;

    const close = Number(cells[iClose]) || 0;
    const prevClose = Number(cells[iPrevClose]) || 0;
    const high = Number(cells[iHigh]) || 0;
    const low = Number(cells[iLow]) || 0;
    const rangePos = high > low ? (close - low) / (high - low) : 0.5;
    const delivPerRaw = cells[iDelivPer];
    const delivPer = delivPerRaw === '-' ? 0 : Number(delivPerRaw) || 0;

    out.push({
      s: cells[iSymbol],
      e: cells[iSeries],
      c: close,
      p: prevClose ? ((close - prevClose) / prevClose) * 100 : 0,
      d: delivPer,
      t: Number(cells[iTurnover]) || 0,
      r: Math.max(0, Math.min(1, rangePos)),
      n: Number(cells[iTrades]) || 0,
    });
  }
  return out;
}

async function fetchBhavcopyForDate(d) {
  const url = bhavcopyUrl(d);
  const res = await fetch(url, { headers: { 'User-Agent': UA, 'Accept': 'text/csv,*/*' } });
  if (!res.ok) throw new Error('status ' + res.status + ' for ' + url);
  const text = await res.text();
  const rows = parseSecBhavdata(text);
  if (!rows.length) throw new Error('empty/unparsable file for ' + url);
  return rows;
}

// Walks backward from today looking for the most recent published trading day's file.
// NSE doesn't publish on weekends/holidays, so this tries up to 10 days back.
async function fetchLatestBhavcopy() {
  const today = new Date();
  for (let back = 0; back <= 10; back++) {
    const d = new Date(today);
    d.setDate(d.getDate() - back);
    try {
      const rows = await fetchBhavcopyForDate(d);
      return { rows, tradingDate: fmtDDMMYYYY(d) };
    } catch (err) {
      console.warn('[bhavcopy] no file for ' + fmtDDMMYYYY(d) + ': ' + err.message);
    }
  }
  throw new Error('no bhavcopy file found in the last 10 days');
}

async function getBhavcopy() {
  const age = Date.now() - cache.fetchedAt;
  if (cache.data.length && age < RECHECK_MS) return cache;
  try {
    const { rows, tradingDate } = await fetchLatestBhavcopy();
    cache = { data: rows, fetchedAt: Date.now(), tradingDate };
  } catch (err) {
    console.error('[bhavcopy] fetch failed:', err.message);
    // Fall through — serve whatever is cached, even if stale, rather than erroring.
  }
  return cache;
}

app.get('/api/bhavcopy', async (req, res) => {
  const { data } = await getBhavcopy();
  res.set('Cache-Control', 'no-store');
  res.json(data);
});

app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    cachedRows: cache.data.length,
    tradingDate: cache.tradingDate,
    cacheAgeMs: Date.now() - cache.fetchedAt,
  });
});

// Serve the static frontend (index.html + any assets) from ./public
app.use(express.static(path.join(__dirname, 'public')));

// Warm the cache on boot so the first visitor doesn't wait on the NSE fetch.
getBhavcopy();

app.listen(PORT, () => {
  console.log('Kosha backend listening on port ' + PORT);
});
