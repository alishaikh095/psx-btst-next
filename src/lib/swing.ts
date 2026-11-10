/**
 * Swing strategy on the daily chart.
 *   Breakout: close above the highest close of the last N days, on heavy volume, above EMA50.
 *   Pullback: uptrend (EMA20 > EMA50, EMA50 rising), price back near EMA20 and bouncing.
 */
import { CONFIG } from "./config";
import { closeAtr, ema, last, rsi, trueAtr } from "./indicators";
import type { PktParts } from "./marketHours";
import type { Bar, DailyBar, SwingSignal } from "./types";

const W = CONFIG.swing;
const r2 = (n: number) => Math.round(n * 100) / 100;
const inRange = (v: number, [lo, hi]: [number, number]) => v >= lo && v <= hi;

export interface SwingEval {
  ticker: string;
  hasData: boolean;
  signal: SwingSignal | null;
  reason: string;
}

export function evaluateSwing(ticker: string, daily: DailyBar[], intraday: Bar[], now: PktParts): SwingEval {
  const ev: SwingEval = { ticker, hasData: false, signal: null, reason: "" };
  const hist = daily.filter((d) => d.date !== now.date);
  const todayBar = daily.find((d) => d.date === now.date);

  // Price/volume for "today": live intraday, else today's EOD bar, else last completed bar
  let price: number, todayVol: number, asOf: string;
  let todayHigh: number | undefined, todayLow: number | undefined;
  if (intraday.length) {
    price = intraday[intraday.length - 1].close;
    todayVol = intraday.reduce((a, b) => a + b.volume, 0);
    todayHigh = Math.max(...intraday.map((b) => b.high));
    todayLow = Math.min(...intraday.map((b) => b.low));
    asOf = now.date;
  } else if (todayBar) {
    price = todayBar.close; todayVol = todayBar.volume; asOf = todayBar.date;
    todayHigh = todayBar.high; todayLow = todayBar.low;
  } else {
    const lb = hist.pop();
    if (!lb) { ev.reason = "no data"; return ev; }
    price = lb.close; todayVol = lb.volume; asOf = lb.date;
    todayHigh = lb.high; todayLow = lb.low;
  }

  if (hist.length < 60) { ev.reason = `insufficient history (${hist.length} bars)`; return ev; }
  ev.hasData = true;

  const closes = [...hist.map((d) => d.close), price];
  const e20s = ema(closes, 20);
  const e50s = ema(closes, 50);
  const e20 = last(e20s), e50 = last(e50s);
  const e50prev = e50s[e50s.length - 1 - W.emaSlopeLookback];
  const rsiV = last(rsi(closes, 14));
  // Real ATR when the source has daily high/low (Capital Stake); close-to-close otherwise
  const ohlc = [...hist, { close: price, high: todayHigh, low: todayLow }];
  const realAtr = trueAtr(ohlc, W.atrPeriod);
  const atr = Number.isFinite(realAtr) ? realAtr : closeAtr(closes, W.atrPeriod);

  const recentVol = hist.slice(-W.volumeLookbackDays);
  const avgVol = recentVol.reduce((a, d) => a + d.volume, 0) / (recentVol.length || 1);
  const volRatio = avgVol > 0 ? todayVol / avgVol : 0;
  const priorHigh = Math.max(...hist.slice(-W.breakoutLookbackDays).map((d) => d.close));
  const prevClose = hist[hist.length - 1].close;
  const distE20Pct = (Math.abs(price - e20) / e20) * 100;

  if (price < W.minPrice) { ev.reason = "price too low"; return ev; }
  if (avgVol < W.minAvgDailyVolume) { ev.reason = "illiquid"; return ev; }

  const breakout = price > priorHigh && volRatio >= W.breakoutMinVolRatio && price > e50 && inRange(rsiV, W.breakoutRsi);
  const pullback = e20 > e50 && e50 > e50prev && price > e50 && distE20Pct <= W.pullbackMaxDistPct
    && price > prevClose && inRange(rsiV, W.pullbackRsi);
  if (!breakout && !pullback) { ev.reason = "no setup"; return ev; }

  const setup = breakout ? "Breakout" : "Pullback";
  const stopDist = Math.min(Math.max(W.stopAtrMult * atr, (W.minStopPct / 100) * price), (W.maxStopPct / 100) * price);
  const stopLoss = price - stopDist;
  const target = price + W.rewardRisk * stopDist;

  // Breakouts: stronger volume and margin over the old high. Pullbacks: trend strength, tight to EMA20.
  const score = breakout
    ? Math.min(volRatio, 5) * 15 + ((price - priorHigh) / priorHigh) * 1000
    : ((e20 - e50) / e50) * 1000 + (W.pullbackMaxDistPct - distE20Pct) * 15;

  ev.signal = {
    ticker, setup, asOf,
    price: r2(price),
    rsi: Math.round(rsiV * 10) / 10,
    ema20: r2(e20),
    ema50: r2(e50),
    volRatio: r2(volRatio),
    avgMovePct: r2((atr / price) * 100),
    stopLoss: r2(stopLoss),
    target: r2(target),
    stopPct: r2((stopDist / price) * 100),
    targetPct: r2(((target - price) / price) * 100),
    maxHoldDays: W.maxHoldDays,
    score: Math.round(score * 10) / 10,
  };
  return ev;
}
