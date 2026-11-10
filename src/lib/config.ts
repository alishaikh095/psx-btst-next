/**
 * PSX BTST Advisor - configuration.
 * Edit this file to update the Shariah universe, thresholds, timings and holidays.
 */

export type Universe = "KMI30" | "KMIALLSHR" | "BOTH";
type HM = [number, number]; // [hour, minute] in PKT

export const CONFIG = {
  // ------------------------------------------------------------------
  // 1. SHARIAH UNIVERSE (KMI)
  // ------------------------------------------------------------------
  // The app first downloads live constituents from dps.psx.com.pk/indices/<CODE>
  // (cached once per day in kmi_cache.json). If that fails it falls back to the
  // lists below. These lists are a STARTER set, not the authoritative current
  // composition - keep them in sync with official PSX/KMI recompositions.
  autoFetchKmi: true,
  kmiCacheFile: "kmi_cache.json",
  defaultUniverse: "KMI30" as Universe,

  kmi30Tickers: [
    "LUCK", "MEBL", "OGDC", "PPL", "MARI", "HUBC", "ENGROH", "EFERT",
    "SYS", "PSO", "POL", "MLCF", "DGKC", "FCCL", "ATRL", "SNGP",
    "SEARL", "CHCC", "KOHC", "PIOC", "ILP", "INIL", "NML", "GAL",
    "TGL", "PAEL", "AIRLINK", "TRG", "CNERGY", "FFC",
  ],
  kmiAllShareExtra: [
    "PRL", "NRL", "OCTOPUS", "HCAR", "MTL", "AGP", "CEPB", "LOTCHEM",
    "FATIMA", "GHGL", "AVN", "FFL", "WTL", "PTC", "BOP",
  ],
  excludeTickers: [] as string[],

  // ------------------------------------------------------------------
  // 2. MARKET HOURS (PKT). Index: Mon=0 ... Fri=4
  // ------------------------------------------------------------------
  sessions: {
    0: [[[9, 32], [15, 30]]],
    1: [[[9, 32], [15, 30]]],
    2: [[[9, 32], [15, 30]]],
    3: [[[9, 32], [15, 30]]],
    4: [[[9, 17], [12, 0]], [[14, 32], [16, 30]]],
  } as Record<number, [HM, HM][]>,

  btstWindows: {
    0: [[15, 15], [15, 25]],
    1: [[15, 15], [15, 25]],
    2: [[15, 15], [15, 25]],
    3: [[15, 15], [15, 25]],
    4: [[16, 15], [16, 25]],
  } as Record<number, [HM, HM]>,

  // PSX holidays as "YYYY-MM-DD". IMPORTANT: add these from the official PSX
  // holiday calendar. Exit dates for BTST/swing positions skip these days.
  holidays: [] as string[],

  monitorIntervalMin: 15, // normal trading hours (watchlist)
  btstIntervalMin: 2,     // inside the BTST window (signals)

  // ------------------------------------------------------------------
  // 3. DATA
  // ------------------------------------------------------------------
  // "auto"         - Capital Stake if CAPITALSTAKE_TOKEN is set, else SCSTrade
  // "capitalstake" - licensed API (needs CAPITALSTAKE_TOKEN in .env.local)
  // "scstrade"     - free chart feed behind scstrade.com's realtime charts (unofficial)
  // "psx"          - dps.psx.com.pk website feeds (blocks automated requests: HTTP 403)
  dataSource: "auto" as "auto" | "capitalstake" | "scstrade" | "psx",
  capitalStake: {
    // Production: https://csapis.com   Test (UAT): https://uat.csapis.com
    // Override with CAPITALSTAKE_BASE_URL in .env.local
    baseUrl: "https://csapis.com",
    // Index codes on Capital Stake. KMI All Share is not documented there; if this
    // code fails the app falls back to the PSX index page / config lists.
    indexCodes: { KMI30: "KMI30", KMIALLSHR: "KMIALLSHR" },
  },
  intradayIntervalMin: 5,  // 5 or 15
  dailyLookbackDays: 150,  // 50-EMA needs well over 50 bars
  maxConcurrency: 4,       // parallel requests to the data source (be polite)
  requestTimeoutMs: 15000,

  // ------------------------------------------------------------------
  // 4. STRATEGY
  // ------------------------------------------------------------------
  strategy: {
    emaFast: 20,
    emaSlow: 50,
    rsiPeriod: 14,
    rsiMin: 55,
    rsiMax: 75,
    maxDistFromHighPct: 2.0,
    // Last-hour volume vs AVERAGE HOURLY volume over N days
    // (N-day avg daily volume / session hours). 1.5 = 50% above normal pace.
    volumeLookbackDays: 10,
    minVolumeSurgeRatio: 1.5,
    lastHourMinutes: 60,
    minAvgDailyVolume: 100_000,
    minPrice: 5,
    targetPct: 2.5,
    stopLossPct: 2.0,
  },

  // BTST exit: sell on the next trading day; flag "exit now" this many
  // minutes before that day's close if neither target nor stop was hit.
  btstExitMinutesBeforeClose: 30,

  // ------------------------------------------------------------------
  // 5. SWING STRATEGY (daily chart, hold days to ~2 weeks)
  // ------------------------------------------------------------------
  // Two setups:
  //   Breakout - close above the highest close of the last N days on heavy volume
  //   Pullback - uptrend (EMA20 > EMA50, EMA50 rising), price dips back to EMA20 and bounces
  // Stop = 2x average daily move (from closes; PSX EOD feed has no high/low),
  // clamped between minStopPct and maxStopPct. Target = stop distance x rewardRisk.
  swing: {
    minPrice: 5,
    minAvgDailyVolume: 100_000,
    volumeLookbackDays: 20,
    breakoutLookbackDays: 20,
    breakoutMinVolRatio: 1.5,
    breakoutRsi: [50, 72] as [number, number],
    pullbackMaxDistPct: 2.0,   // max distance of price from EMA20
    pullbackRsi: [40, 58] as [number, number],
    emaSlopeLookback: 10,      // EMA50 must be higher than N days ago
    atrPeriod: 14,
    stopAtrMult: 2,
    minStopPct: 3,
    maxStopPct: 8,
    rewardRisk: 2,
    maxHoldDays: 10,           // time stop, in trading days
  },

  // ------------------------------------------------------------------
  // 6. OUTPUT
  // ------------------------------------------------------------------
  signalLogDir: "signals", // CSV log, one file per day
  watchlistSize: 10,
};
