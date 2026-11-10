/** Shariah universe: live KMI constituents from PSX, with config fallback. */
import "server-only";
import { promises as fs } from "fs";
import path from "path";
import * as cheerio from "cheerio";
import { CONFIG, type Universe } from "./config";
import { pkt } from "./marketHours";
import { csConstituents } from "./capitalstake";
import { activeSource } from "./dataSource";

/**
 * PSX index pages append corporate-action markers to symbols while they apply:
 * XD (ex-dividend), XB (ex-bonus), XR (ex-rights), XA (ex-all), e.g. "MEBLXD".
 * Price feeds use the plain symbol ("MEBL").
 */
export const cleanSymbol = (s: string) => s.toUpperCase().replace(/^(.{2,}?)(XD|XB|XR|XA)$/, "$1");

type Cache = Record<string, { date: string; tickers: string[] }>;
const cachePath = () => path.join(process.cwd(), "kmi_cache.json");

async function readCache(): Promise<Cache> {
  try {
    return JSON.parse(await fs.readFile(cachePath(), "utf8"));
  } catch {
    return {};
  }
}

async function fetchIndex(code: string): Promise<string[]> {
  const res = await fetch(`https://dps.psx.com.pk/indices/${code}`, {
    headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/124.0" },
    cache: "no-store",
    signal: AbortSignal.timeout(CONFIG.requestTimeoutMs),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const $ = cheerio.load(await res.text());

  for (const table of $("table").toArray()) {
    const headers = $(table).find("thead th, tr:first-child th")
      .toArray().map((th) => $(th).text().trim().toUpperCase());
    const col = headers.findIndex((h) => h === "SYMBOL" || h === "SCRIP");
    if (col < 0) continue;
    const syms = $(table).find("tbody tr").toArray()
      .map((tr) => $(tr).find("td").eq(col).text().trim().split(/\s+/)[0]?.toUpperCase() ?? "")
      .filter((s) => /^[A-Z0-9]{1,12}$/.test(s));
    if (syms.length >= 10) return [...new Set(syms)].sort();
  }
  throw new Error(`No constituents table found for ${code}`);
}

async function getIndex(code: "KMI30" | "KMIALLSHR"): Promise<{ tickers: string[]; source: string }> {
  const today = pkt().date;
  const cache = await readCache();
  const entry = cache[code];

  if (CONFIG.autoFetchKmi) {
    if (entry?.date === today) return { tickers: entry.tickers, source: "PSX (cached today)" };
    const sources: [string, () => Promise<string[]>][] = [];
    if (activeSource() === "capitalstake") {
      sources.push(["Capital Stake", () => csConstituents(CONFIG.capitalStake.indexCodes[code])]);
    }
    sources.push(["PSX", () => fetchIndex(code)]);
    for (const [name, load] of sources) {
      try {
        const tickers = await load();
        cache[code] = { date: today, tickers };
        await fs.writeFile(cachePath(), JSON.stringify(cache, null, 2));
        return { tickers, source: `${name} (live)` };
      } catch (e) {
        console.warn(`${name} constituents for ${code} failed:`, (e as Error).message);
      }
    }
    if (entry) return { tickers: entry.tickers, source: `cached ${entry.date}` };
  }
  const tickers = code === "KMI30"
    ? [...CONFIG.kmi30Tickers]
    : [...new Set([...CONFIG.kmi30Tickers, ...CONFIG.kmiAllShareExtra])].sort();
  return { tickers, source: "config.ts" };
}

export async function getUniverse(universe: Universe): Promise<{ tickers: string[]; source: string }> {
  let result: { tickers: string[]; source: string };
  if (universe === "BOTH") {
    const [a, b] = await Promise.all([getIndex("KMI30"), getIndex("KMIALLSHR")]);
    result = { tickers: [...new Set([...a.tickers, ...b.tickers])].sort(), source: `${a.source} + ${b.source}` };
  } else {
    result = await getIndex(universe);
  }
  const excl = new Set(CONFIG.excludeTickers.map((t) => t.toUpperCase()));
  const tickers = [...new Set(result.tickers.map(cleanSymbol))].filter((t) => !excl.has(t)).sort();
  return { ...result, tickers };
}
