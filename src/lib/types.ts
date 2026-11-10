export interface DailyBar {
  date: string; // YYYY-MM-DD (PKT)
  close: number;
  volume: number;
  // Present when the data source provides them (Capital Stake does, PSX website does not)
  open?: number;
  high?: number;
  low?: number;
}

export interface Bar {
  t: number; // bar start, unix seconds
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface Metrics {
  price: number;
  dayHigh: number;
  distFromHighPct: number;
  rsi: number;
  ema20: number;
  ema50: number;
  surgeRatio: number;
  avgDailyVolume: number;
  lastHourVolume: number;
}

export interface Signal {
  ticker: string;
  price: number;
  dayHigh: number;
  distFromHighPct: number;
  volumeSurgeRatio: number;
  volumeSurgePct: number;
  rsi: number;
  ema20: number;
  ema50: number;
  target: number;
  stopLoss: number;
  score: number;
  isNew?: boolean;
}

export interface Evaluation {
  ticker: string;
  passed: boolean;
  checksPassed: number;
  totalChecks: number;
  reasons: string[];
  metrics: Metrics | null;
  signal: Signal | null;
}

export interface ScanResult {
  scannedAt: string;
  marketState: string;
  marketLabel: string;
  universe: string;
  universeSource: string;
  total: number;
  noData: number;
  signals: Signal[];
  watchlist: Evaluation[];
  durationMs: number;
}

// ---------------- BTST scan extras ----------------
export interface BtstScanResult extends ScanResult {
  /** true only inside the BTST window; earlier signals are previews */
  confirmed: boolean;
  nextSession: string;     // next trading date (the "sell" day)
  overnightDays: number;   // calendar days until nextSession (>1 = weekend/holiday hold)
}

// ---------------- Swing ----------------
export type SwingSetup = "Breakout" | "Pullback";

export interface SwingSignal {
  ticker: string;
  setup: SwingSetup;
  asOf: string;          // date of the price used
  price: number;
  rsi: number;
  ema20: number;
  ema50: number;
  volRatio: number;      // today's volume vs N-day average
  avgMovePct: number;    // average daily move, % of price
  stopLoss: number;
  target: number;
  stopPct: number;
  targetPct: number;
  maxHoldDays: number;
  score: number;
}

export interface SwingScanResult {
  scannedAt: string;
  marketState: string;
  marketLabel: string;
  universe: string;
  universeSource: string;
  total: number;
  noData: number;
  intradayPartial: boolean; // scanned while market open: today's volume is incomplete
  signals: SwingSignal[];
  durationMs: number;
}

// ---------------- Positions ----------------
export type PositionKind = "BTST" | "SWING";

export interface Position {
  id: string;
  ticker: string;
  kind: PositionKind;
  setup?: string;
  entryDate: string;
  entryPrice: number;
  target: number;
  stopLoss: number;
  exitBy: string;        // last trading date to hold
  closed?: { date: string; price: number };
}

export type PositionLevel = "action" | "warn" | "ok" | "closed";

export interface PositionView extends Position {
  price: number | null;
  pnlPct: number | null;
  status: string;
  level: PositionLevel;
  daysHeld: number;
}
