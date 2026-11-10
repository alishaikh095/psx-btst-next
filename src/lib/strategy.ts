/** BTST strategy: volume surge + close near HOD + above EMA20/50 + RSI 55-75. */
import { CONFIG } from "./config";
import { ema, last, rsi } from "./indicators";
import { sessionHours, type PktParts } from "./marketHours";
import type { Bar, DailyBar, Evaluation } from "./types";

const S = CONFIG.strategy;
const r2 = (n: number) => Math.round(n * 100) / 100;

export function evaluate(ticker: string, daily: DailyBar[], intraday: Bar[], now: PktParts): Evaluation {
  const ev: Evaluation = {
    ticker, passed: false, checksPassed: 0, totalChecks: 7, reasons: [], metrics: null, signal: null,
  };

  if (!intraday.length) {
    ev.reasons.push("no intraday data");
    return ev;
  }
  if (daily.length < S.emaSlow + 5) {
    ev.reasons.push(`insufficient daily history (${daily.length} bars)`);
    return ev;
  }

  const price = intraday[intraday.length - 1].close;
  const dayHigh = Math.max(...intraday.map((b) => b.high));

  // History excluding today, plus today's live price as a provisional bar
  const hist = daily.filter((d) => d.date !== now.date);
  const closes = [...hist.map((d) => d.close), price];

  const ema20 = last(ema(closes, S.emaFast));
  const ema50 = last(ema(closes, S.emaSlow));
  const rsiV = last(rsi(closes, S.rsiPeriod));

  const recent = hist.slice(-S.volumeLookbackDays);
  const avgDailyVolume = recent.reduce((a, d) => a + d.volume, 0) / (recent.length || 1);
  const hours = sessionHours(now.weekday) || 6;
  const avgHourly = avgDailyVolume / hours;

  const lastT = intraday[intraday.length - 1].t;
  const windowStart = lastT - S.lastHourMinutes * 60;
  const lastHourVolume = intraday.filter((b) => b.t > windowStart).reduce((a, b) => a + b.volume, 0);
  const surgeRatio = avgHourly > 0 ? lastHourVolume / avgHourly : 0;
  const distFromHighPct = dayHigh > 0 ? ((dayHigh - price) / dayHigh) * 100 : 100;

  ev.metrics = { price, dayHigh, distFromHighPct, rsi: rsiV, ema20, ema50, surgeRatio, avgDailyVolume, lastHourVolume };

  const checks: [boolean, string][] = [
    [price >= S.minPrice, `price ${price.toFixed(2)} < ${S.minPrice}`],
    [avgDailyVolume >= S.minAvgDailyVolume, `illiquid (avg vol ${Math.round(avgDailyVolume).toLocaleString()})`],
    [surgeRatio >= S.minVolumeSurgeRatio, `volume surge ${surgeRatio.toFixed(2)}x < ${S.minVolumeSurgeRatio}x`],
    [distFromHighPct <= S.maxDistFromHighPct, `${distFromHighPct.toFixed(2)}% below HOD`],
    [price > ema20, `below EMA${S.emaFast} (${ema20.toFixed(2)})`],
    [price > ema50, `below EMA${S.emaSlow} (${ema50.toFixed(2)})`],
    [rsiV >= S.rsiMin && rsiV <= S.rsiMax, `RSI ${rsiV.toFixed(1)} outside ${S.rsiMin}-${S.rsiMax}`],
  ];
  ev.checksPassed = checks.filter(([ok]) => ok).length;
  ev.reasons = checks.filter(([ok]) => !ok).map(([, msg]) => msg);
  if (ev.reasons.length) return ev;

  // Score: stronger surge, closer to HOD, RSI nearer the middle of the band
  const rsiMid = (S.rsiMin + S.rsiMax) / 2;
  const score = Math.min(surgeRatio, 5) * 20 + (S.maxDistFromHighPct - distFromHighPct) * 10 - Math.abs(rsiV - rsiMid);

  ev.passed = true;
  ev.signal = {
    ticker,
    price: r2(price),
    dayHigh: r2(dayHigh),
    distFromHighPct: r2(distFromHighPct),
    volumeSurgeRatio: r2(surgeRatio),
    volumeSurgePct: Math.round((surgeRatio - 1) * 1000) / 10,
    rsi: Math.round(rsiV * 10) / 10,
    ema20: r2(ema20),
    ema50: r2(ema50),
    target: r2(price * (1 + S.targetPct / 100)),
    stopLoss: r2(price * (1 - S.stopLossPct / 100)),
    score: Math.round(score * 10) / 10,
  };
  return ev;
}
