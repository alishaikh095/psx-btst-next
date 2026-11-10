/**
 * PSX Data Portal (dps.psx.com.pk) client - server-side only.
 *   /timeseries/eod/<SYM> -> [[unix_ts, close, volume, (open)], ...]
 *   /timeseries/int/<SYM> -> [[unix_ts, price, volume], ...]   (today's trades)
 * Parsing is defensive because these endpoints are undocumented.
 */
import "server-only";
import { CONFIG } from "./config";
import { pkt, pktDateOf } from "./marketHours";
import type { Bar, DailyBar } from "./types";
import { CsError, csDaily, csIntraday } from "./capitalstake";
import { activeSource } from "./dataSource";
import { scsDaily, scsIntraday } from "./scstrade";

const BASE = "https://dps.psx.com.pk";
const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
  Accept: "application/json, text/plain, */*",
  Referer: `${BASE}/`,
  "X-Requested-With": "XMLHttpRequest",
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const num = (v: unknown) => (v === null || v === undefined || v === "" ? NaN : Number(v));
const toSec = (ts: number) => (ts > 1e12 ? Math.floor(ts / 1000) : ts);

async function getRows(path: string, retries = 3): Promise<unknown[][]> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch(BASE + path, {
        headers: HEADERS,
        cache: "no-store",
        signal: AbortSignal.timeout(CONFIG.requestTimeoutMs),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const js = await res.json();
      const data = Array.isArray(js) ? js : js?.data;
      return Array.isArray(data) ? data : [];
    } catch (e) {
      if (attempt === retries) {
        console.warn(`PSX fetch failed ${path}: ${(e as Error).message}`);
        return [];
      }
      await sleep(800 * attempt);
    }
  }
  return [];
}

// Daily bars don't change during the day -> cache per ticker per PKT date
const dailyCache = new Map<string, { date: string; bars: DailyBar[] }>();

/** Capital Stake errors: a bad token is fatal (rethrown); anything else counts as "no data". */
async function viaCs<T>(what: string, fn: () => Promise<T[]>): Promise<T[]> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof CsError) throw e;
    console.warn(`Capital Stake ${what} failed: ${(e as Error).message}`);
    return [];
  }
}

export async function fetchDaily(symbol: string): Promise<DailyBar[]> {
  const today = pkt().date;
  const src = activeSource();
  const key = `${src}:${symbol}`;
  const hit = dailyCache.get(key);
  if (hit && hit.date === today) return hit.bars;

  const bars = src === "capitalstake" ? await viaCs(`eod ${symbol}`, () => csDaily(symbol))
    : src === "scstrade" ? await scsDaily(symbol)
    : await portalDaily(symbol);
  if (bars.length) dailyCache.set(key, { date: today, bars });
  return bars;
}

async function portalDaily(symbol: string): Promise<DailyBar[]> {
  const rows = await getRows(`/timeseries/eod/${encodeURIComponent(symbol)}`);
  const byDate = new Map<string, DailyBar & { ts: number }>();
  for (const r of rows) {
    const ts = toSec(num(r[0]));
    const close = num(r[1]);
    if (!Number.isFinite(ts) || !Number.isFinite(close)) continue;
    const date = pktDateOf(ts);
    const prev = byDate.get(date);
    if (!prev || ts >= prev.ts) byDate.set(date, { date, close, volume: num(r[2]) || 0, ts });
  }
  const bars = [...byDate.values()]
    .sort((a, b) => a.ts - b.ts)
    .slice(-CONFIG.dailyLookbackDays)
    .map(({ date, close, volume }) => ({ date, close, volume }));
  return bars;
}

export async function fetchIntraday(symbol: string): Promise<Bar[]> {
  const src = activeSource();
  if (src === "capitalstake") return viaCs(`intraday ${symbol}`, () => csIntraday(symbol));
  if (src === "scstrade") return scsIntraday(symbol);
  return portalIntraday(symbol);
}

async function portalIntraday(symbol: string): Promise<Bar[]> {
  const rows = await getRows(`/timeseries/int/${encodeURIComponent(symbol)}`);
  const today = pkt().date;
  const ticks = rows
    .map((r) => ({ ts: toSec(num(r[0])), price: num(r[1]), volume: num(r[2]) || 0 }))
    .filter((t) => Number.isFinite(t.ts) && Number.isFinite(t.price) && pktDateOf(t.ts) === today)
    .sort((a, b) => a.ts - b.ts);
  if (!ticks.length) return [];

  // Defensive: convert cumulative volume to per-trade volume if it looks cumulative
  const vols = ticks.map((t) => t.volume);
  const monotonic = vols.every((v, i) => i === 0 || v >= vols[i - 1]);
  const median = [...vols].sort((a, b) => a - b)[Math.floor(vols.length / 2)] || 1;
  if (ticks.length > 20 && monotonic && vols[vols.length - 1] > 10 * median) {
    for (let i = ticks.length - 1; i > 0; i--) ticks[i].volume = Math.max(0, vols[i] - vols[i - 1]);
  }

  // Resample ticks into N-minute OHLCV bars
  const step = CONFIG.intradayIntervalMin * 60;
  const bars = new Map<number, Bar>();
  for (const { ts, price, volume } of ticks) {
    const t = Math.floor(ts / step) * step;
    const b = bars.get(t);
    if (!b) bars.set(t, { t, open: price, high: price, low: price, close: price, volume });
    else {
      b.high = Math.max(b.high, price);
      b.low = Math.min(b.low, price);
      b.close = price;
      b.volume += volume;
    }
  }
  return [...bars.values()].sort((a, b) => a.t - b.t);
}

/** Run async tasks with a concurrency limit, preserving order. */
export async function mapPool<T, R>(items: T[], limit: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return out;
}
