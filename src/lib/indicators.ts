/**
 * Technical indicators (no dependencies). SMA-seeded EMA and Wilder RSI,
 * matching TradingView / pandas-ta defaults.
 */

export function ema(values: number[], length: number): number[] {
  const out = new Array<number>(values.length).fill(NaN);
  if (values.length < length) return out;
  const k = 2 / (length + 1);
  let prev = values.slice(0, length).reduce((a, b) => a + b, 0) / length;
  out[length - 1] = prev;
  for (let i = length; i < values.length; i++) {
    prev = values[i] * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

export function rsi(values: number[], length = 14): number[] {
  const out = new Array<number>(values.length).fill(NaN);
  if (values.length <= length) return out;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= length; i++) {
    const d = values[i] - values[i - 1];
    if (d > 0) gain += d; else loss -= d;
  }
  let avgGain = gain / length;
  let avgLoss = loss / length;
  const calc = () => (avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss));
  out[length] = calc();
  for (let i = length + 1; i < values.length; i++) {
    const d = values[i] - values[i - 1];
    avgGain = (avgGain * (length - 1) + Math.max(d, 0)) / length;
    avgLoss = (avgLoss * (length - 1) + Math.max(-d, 0)) / length;
    out[i] = calc();
  }
  return out;
}

/**
 * Average absolute close-to-close move over the last `length` bars.
 * Stand-in for ATR because the PSX EOD feed has no daily high/low.
 */
export function closeAtr(values: number[], length = 14): number {
  if (values.length <= length) return NaN;
  let sum = 0;
  for (let i = values.length - length; i < values.length; i++) sum += Math.abs(values[i] - values[i - 1]);
  return sum / length;
}

export const last =(arr: number[]) => arr[arr.length - 1];

/**
 * Average true range (simple mean of the last `length` true ranges).
 * Returns NaN unless every bar in the window has high and low.
 */
export function trueAtr(bars: { high?: number; low?: number; close: number }[], length = 14): number {
  if (bars.length <= length) return NaN;
  let sum = 0;
  for (let i = bars.length - length; i < bars.length; i++) {
    const { high, low } = bars[i];
    if (high === undefined || low === undefined) return NaN;
    const pc = bars[i - 1].close;
    sum += Math.max(high - low, Math.abs(high - pc), Math.abs(low - pc));
  }
  return sum / length;
}
