/**
 * Capital Stake market-data API (authorized PSX vendor) - server-side only.
 * Docs: https://www.capitalstake.com/docs/rest/intro
 *   GET /3.0/market/eod?symbol=&date_from=&date_to=   -> time, open, high, low, close, volume
 *   GET /3.0/market/intraday/{1m|5m|15m}?symbol=       -> time, open, high, low, close, volume
 *   GET /3.0/market/index/constituents?code=           -> symbol, ...
 * Responses: {"status":"ok","message":"","data":[...]}. Auth: Bearer token.
 */
import "server-only";
import { CONFIG } from "./config";
import { csBaseUrl, csToken } from "./dataSource";
import { pkt, pktDateOf } from "./marketHours";
import type { Bar, DailyBar } from "./types";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const num = (v: unknown) => (v === null || v === undefined || v === "" ? NaN : Number(v));
const toSec = (ts: number) => (ts > 1e12 ? Math.floor(ts / 1000) : ts);
type Row = Record<string, unknown>;

/** Thrown for problems retrying won't fix (bad token, bad request). */
export class CsError extends Error {}

async function get(path: string, params: Record<string, string>, retries = 3): Promise<Row[]> {
  const url = `${csBaseUrl()}${path}?${new URLSearchParams(params)}`;
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${csToken()}`, Accept: "application/json" },
        cache: "no-store",
        signal: AbortSignal.timeout(CONFIG.requestTimeoutMs),
      });
      const js = await res.json().catch(() => null);
      if (res.status === 401 || res.status === 403) throw new CsError(`Capital Stake rejected the token (HTTP ${res.status})`);
      if (res.status === 404) return [];  // unknown symbol / no data
      if (res.status === 400) throw new CsError(`Capital Stake bad request: ${js?.message ?? path}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      if (js?.status && js.status !== "ok") throw new Error(js.message || js.status);
      const data = js?.data;
      return Array.isArray(data) ? data : data && typeof data === "object" ? [data] : [];
    } catch (e) {
      if (e instanceof CsError || attempt >= retries) throw e;
      await sleep(800 * attempt);
    }
  }
}

const isoDaysAgo = (date: string, days: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) - days * 86_400_000).toISOString().slice(0, 10);

export async function csDaily(symbol: string): Promise<DailyBar[]> {
  const today = pkt().date;
  // ~1.6 calendar days per trading day covers weekends and holidays
  const rows = await get("/3.0/market/eod", {
    symbol, date_from: isoDaysAgo(today, Math.ceil(CONFIG.dailyLookbackDays * 1.6)), date_to: today,
  });
  const byDate = new Map<string, DailyBar>();
  for (const r of rows) {
    const ts = toSec(num(r.time));
    const close = num(r.close);
    if (!Number.isFinite(ts) || !Number.isFinite(close)) continue;
    const bar: DailyBar = { date: pktDateOf(ts), close, volume: num(r.volume) || 0 };
    const [o, h, l] = [num(r.open), num(r.high), num(r.low)];
    if (Number.isFinite(o)) bar.open = o;
    if (Number.isFinite(h) && Number.isFinite(l)) { bar.high = h; bar.low = l; }
    byDate.set(bar.date, bar);
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date)).slice(-CONFIG.dailyLookbackDays);
}

export async function csIntraday(symbol: string): Promise<Bar[]> {
  const interval = CONFIG.intradayIntervalMin === 15 ? "15m" : CONFIG.intradayIntervalMin === 1 ? "1m" : "5m";
  const rows = await get(`/3.0/market/intraday/${interval}`, { symbol });
  const today = pkt().date;
  return rows
    .map((r) => ({
      t: toSec(num(r.time)), open: num(r.open), high: num(r.high), low: num(r.low),
      close: num(r.close), volume: num(r.volume) || 0,
    }))
    .filter((b) => Number.isFinite(b.t) && Number.isFinite(b.close) && pktDateOf(b.t) === today)
    .map((b) => ({
      ...b,
      open: Number.isFinite(b.open) ? b.open : b.close,
      high: Number.isFinite(b.high) ? b.high : b.close,
      low: Number.isFinite(b.low) ? b.low : b.close,
    }))
    .sort((a, b) => a.t - b.t);
}

export async function csConstituents(code: string): Promise<string[]> {
  const rows = await get("/3.0/market/index/constituents", { code });
  const syms = rows.map((r) => String(r.symbol ?? "").trim().toUpperCase()).filter((s) => /^[A-Z0-9]{1,12}$/.test(s));
  if (syms.length < 10) throw new Error(`only ${syms.length} constituents for ${code}`);
  return [...new Set(syms)].sort();
}
