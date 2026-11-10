/**
 * SCSTrade (Standard Capital Securities) chart data - server-side only.
 * This is the data feed behind https://www.scstrade.com/TechnicalAnalysis/TA_RealTimeCharting.aspx
 * (TradingView "UDF" format). It is public and needs no key, but it is not an
 * official API: keep request rates modest, and it may change without notice.
 *   GET https://chart.scstrade.com/history?symbol=LUCK&resolution=1D|5|15|1&from=<unix>&to=<unix>
 *   -> {"s":"ok","t":[...],"o":[...],"h":[...],"l":[...],"c":[...],"v":[...]}  or {"s":"no_data"}
 */
import "server-only";
import { CONFIG } from "./config";
import { nowMs, pkt, pktDateOf } from "./marketHours";
import type { Bar, DailyBar } from "./types";

const BASE = "https://chart.scstrade.com";
// Honest client name - no browser impersonation
const HEADERS = { "User-Agent": "psx-trading-advisor/1.0 (personal use)", Accept: "application/json" };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Udf { s: string; t?: number[]; o?: number[]; h?: number[]; l?: number[]; c?: number[]; v?: number[]; errmsg?: string }

async function history(symbol: string, resolution: string, from: number, to: number, retries = 3): Promise<Udf> {
  const url = `${BASE}/history?${new URLSearchParams({ symbol, resolution, from: String(from), to: String(to) })}`;
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url, { headers: HEADERS, cache: "no-store", signal: AbortSignal.timeout(CONFIG.requestTimeoutMs) });
      if (res.status === 429) throw new Error("rate limited (HTTP 429)");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const js = (await res.json()) as Udf;
      if (js.s === "error") throw new Error(js.errmsg || "error");
      return js;
    } catch (e) {
      if (attempt >= retries) {
        console.warn(`SCSTrade ${symbol} ${resolution} failed: ${(e as Error).message}`);
        return { s: "error" };
      }
      await sleep(1000 * attempt);
    }
  }
}

function toRows(u: Udf) {
  if (u.s !== "ok" || !u.t || !u.c) return [];
  return u.t.map((t, i) => ({
    t, open: u.o?.[i] ?? u.c![i], high: u.h?.[i] ?? u.c![i], low: u.l?.[i] ?? u.c![i],
    close: u.c![i], volume: u.v?.[i] ?? 0,
  })).filter((r) => Number.isFinite(r.t) && Number.isFinite(r.close));
}

export async function scsDaily(symbol: string): Promise<DailyBar[]> {
  const now = Math.floor(nowMs() / 1000);
  // ~1.6 calendar days per trading day covers weekends and holidays
  const from = now - Math.ceil(CONFIG.dailyLookbackDays * 1.6) * 86_400;
  const byDate = new Map<string, DailyBar>();
  for (const r of toRows(await history(symbol, "1D", from, now))) {
    byDate.set(pktDateOf(r.t), { date: pktDateOf(r.t), open: r.open, high: r.high, low: r.low, close: r.close, volume: r.volume });
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date)).slice(-CONFIG.dailyLookbackDays);
}

export async function scsIntraday(symbol: string): Promise<Bar[]> {
  const today = pkt().date;
  const now = Math.floor(nowMs() / 1000);
  const startOfDayPkt = Date.parse(`${today}T00:00:00Z`) / 1000 - 5 * 3600;
  const res = [1, 5, 15].includes(CONFIG.intradayIntervalMin) ? String(CONFIG.intradayIntervalMin) : "5";
  return toRows(await history(symbol, res, startOfDayPkt, now))
    .filter((r) => pktDateOf(r.t) === today)
    .map(({ t, open, high, low, close, volume }) => ({ t, open, high, low, close, volume }))
    .sort((a, b) => a.t - b.t);
}
