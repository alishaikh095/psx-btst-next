/** Runs BTST and swing scans over the Shariah universe and logs signals to CSV. */
import "server-only";
import { promises as fs } from "fs";
import path from "path";
import { CONFIG, type Universe } from "./config";
import { getUniverse } from "./kmi";
import { calendarDaysBetween, marketState, nextTradingDate, pkt } from "./marketHours";
import { fetchDaily, fetchIntraday, mapPool } from "./psx";
import { evaluate } from "./strategy";
import { evaluateSwing } from "./swing";
import type { BtstScanResult, Signal, SwingScanResult } from "./types";

const signalDir = () => path.join(process.cwd(), "signals");
const btstFile = (date: string) => path.join(signalDir(), `${date}.csv`);

// Tickers already alerted today. Rebuilt from today's CSV after a server
// restart so the same signal is not alerted or logged twice.
let seen: { date: string; tickers: Set<string> } | null = null;

async function seenToday(date: string): Promise<Set<string>> {
  if (seen?.date === date) return seen.tickers;
  const tickers = new Set<string>();
  try {
    const lines = (await fs.readFile(btstFile(date), "utf8")).trim().split("\n").slice(1);
    for (const l of lines) { const t = l.split(",")[1]; if (t) tickers.add(t); }
  } catch { /* no file yet */ }
  seen = { date, tickers };
  return tickers;
}

async function logBtst(signals: Signal[], date: string, time: string) {
  if (!signals.length) return;
  await fs.mkdir(signalDir(), { recursive: true });
  const file = btstFile(date);
  const cols = ["ticker", "price", "dayHigh", "distFromHighPct", "volumeSurgePct", "rsi",
    "ema20", "ema50", "target", "stopLoss", "score"] as const;
  let exists = true;
  try { await fs.access(file); } catch { exists = false; }
  const lines = signals.map((s) => [time, ...cols.map((c) => s[c])].join(","));
  await fs.appendFile(file, (exists ? "" : `time,${cols.join(",")}\n`) + lines.join("\n") + "\n");
}

async function loadAll(universe: Universe) {
  const { tickers, source } = await getUniverse(universe);
  const data = await mapPool(tickers, CONFIG.maxConcurrency, async (t) => {
    const [daily, intra] = await Promise.all([fetchDaily(t), fetchIntraday(t)]);
    return { t, daily, intra };
  });
  return { tickers, source, data };
}

export async function runScan(universe: Universe): Promise<BtstScanResult> {
  const started = Date.now();
  const now = pkt();
  const ms = marketState(now);
  const { tickers, source, data } = await loadAll(universe);
  const evals = data.map(({ t, daily, intra }) => evaluate(t, daily, intra, now));

  // Only signals inside the BTST window are real (they use near-closing prices and
  // last-hour volume). Earlier ones are previews: shown, but not alerted or logged.
  const confirmed = ms.state === "btst";
  const already = await seenToday(now.date);
  const signals = evals
    .filter((e) => e.passed && e.signal)
    .map((e) => ({ ...e.signal!, isNew: confirmed && !already.has(e.ticker) }))
    .sort((a, b) => b.score - a.score);

  if (confirmed) {
    const fresh = signals.filter((s) => s.isNew);
    fresh.forEach((s) => already.add(s.ticker));
    await logBtst(fresh, now.date, now.time).catch((e) => console.warn("CSV log failed:", e));
  }

  const watchlist = evals
    .filter((e) => e.metrics && !e.passed)
    .sort((a, b) => b.checksPassed - a.checksPassed || a.metrics!.distFromHighPct - b.metrics!.distFromHighPct)
    .slice(0, CONFIG.watchlistSize);

  const nextSession = nextTradingDate(now.date);
  return {
    scannedAt: `${now.date} ${now.time}`,
    marketState: ms.state,
    marketLabel: ms.label,
    universe,
    universeSource: source,
    total: tickers.length,
    noData: evals.filter((e) => !e.metrics).length,
    signals,
    watchlist,
    durationMs: Date.now() - started,
    confirmed,
    nextSession,
    overnightDays: calendarDaysBetween(now.date, nextSession),
  };
}

export async function runSwingScan(universe: Universe): Promise<SwingScanResult> {
  const started = Date.now();
  const now = pkt();
  const ms = marketState(now);
  const { tickers, source, data } = await loadAll(universe);
  const evals = data.map(({ t, daily, intra }) => evaluateSwing(t, daily, intra, now));
  const signals = evals.filter((e) => e.signal).map((e) => e.signal!)
    .sort((a, b) => a.setup.localeCompare(b.setup) || b.score - a.score);

  // One file per day, rewritten each scan with the current list
  if (signals.length) {
    const cols = ["ticker", "setup", "asOf", "price", "stopLoss", "target", "stopPct", "targetPct",
      "rsi", "ema20", "ema50", "volRatio", "avgMovePct", "score"] as const;
    const csv = [cols.join(","), ...signals.map((s) => cols.map((c) => s[c]).join(","))].join("\n") + "\n";
    await fs.mkdir(signalDir(), { recursive: true })
      .then(() => fs.writeFile(path.join(signalDir(), `swing-${now.date}.csv`), csv))
      .catch((e) => console.warn("Swing CSV log failed:", e));
  }

  return {
    scannedAt: `${now.date} ${now.time}`,
    marketState: ms.state,
    marketLabel: ms.label,
    universe,
    universeSource: source,
    total: tickers.length,
    noData: evals.filter((e) => !e.hasData).length,
    intradayPartial: ms.state === "open" || ms.state === "btst" || ms.state === "break",
    signals,
    durationMs: Date.now() - started,
  };
}
