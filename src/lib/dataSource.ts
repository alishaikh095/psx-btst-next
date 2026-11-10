/** Picks the market-data source. The token is read from the environment only. */
import "server-only";
import { CONFIG } from "./config";

export type Source = "capitalstake" | "scstrade" | "psx";

export const csToken = () => process.env.CAPITALSTAKE_TOKEN?.trim() || "";
export const csBaseUrl = () => (process.env.CAPITALSTAKE_BASE_URL?.trim() || CONFIG.capitalStake.baseUrl).replace(/\/+$/, "");

export function activeSource(): Source {
  if (CONFIG.dataSource === "auto") return csToken() ? "capitalstake" : "scstrade";
  return CONFIG.dataSource;
}

/** A setup problem that makes every request fail, or null. */
export function sourceProblem(): string | null {
  if (activeSource() === "capitalstake" && !csToken()) {
    return "dataSource is \"capitalstake\" but CAPITALSTAKE_TOKEN is not set. Add it to .env.local and restart.";
  }
  return null;
}

export function sourceLabel(): string {
  const src = activeSource();
  if (src === "capitalstake") return `Capital Stake (${csBaseUrl().replace(/^https?:\/\//, "")})`;
  return src === "scstrade" ? "SCSTrade charts" : "PSX website";
}
