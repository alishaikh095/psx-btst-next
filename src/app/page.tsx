"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { BtstScanResult, PositionView, SwingScanResult } from "@/lib/types";

interface Status {
  state: string;
  label: string;
  nowPkt: string;
  btstIntervalMin: number;
  monitorIntervalMin: number;
  strategy: { targetPct: number; stopLossPct: number };
  dataSource: string;
  dataProblem: string | null;
  clockOffsetMin?: number;
}

type Tab = "btst" | "swing" | "positions";
interface NewPos { ticker: string; kind: "BTST" | "SWING"; setup?: string; price: number; target: number; stopLoss: number; maxHoldDays?: number }

const POSITIONS_INTERVAL_MIN = 5;
const fmt = (n: number, d = 2) => n.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
const pct = (n: number | null) => (n === null ? "—" : `${n > 0 ? "+" : ""}${n.toFixed(2)}%`);

function beep() {
  try {
    const ctx = new AudioContext();
    [0, 0.25].forEach((delay) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.value = 880;
      g.gain.value = 0.15;
      o.connect(g).connect(ctx.destination);
      o.start(ctx.currentTime + delay);
      o.stop(ctx.currentTime + delay + 0.15);
    });
  } catch { /* audio blocked until user interacts with the page */ }
}

function notify(title: string, body: string) {
  beep();
  if ("Notification" in window && Notification.permission === "granted") new Notification(title, { body });
}

async function getJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { cache: "no-store", ...init });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
  return data;
}

export default function Dashboard() {
  const [tab, setTab] = useState<Tab>("btst");
  const [status, setStatus] = useState<Status | null>(null);
  const [scan, setScan] = useState<BtstScanResult | null>(null);
  const [swing, setSwing] = useState<SwingScanResult | null>(null);
  const [positions, setPositions] = useState<PositionView[] | null>(null);
  const [scanning, setScanning] = useState(false);
  const [swingScanning, setSwingScanning] = useState(false);
  const [error, setError] = useState("");
  const [universe, setUniverse] = useState("KMI30");
  const [autoMode, setAutoMode] = useState(true);
  const [canNotify, setCanNotify] = useState(true);
  const [diagTicker, setDiagTicker] = useState("");
  const [diag, setDiag] = useState("");
  const lastScanAt = useRef(0);
  const lastPosAt = useRef(0);
  const alerted = useRef(new Set<string>());

  useEffect(() => {
    setCanNotify(!("Notification" in window) || Notification.permission === "granted");
  }, []);

  const runScan = useCallback(async () => {
    setScanning(true);
    setError("");
    try {
      const data = await getJson<BtstScanResult>(`/api/scan?universe=${universe}`);
      setScan(data);
      lastScanAt.current = Date.now();
      const fresh = data.signals.filter((s) => s.isNew);
      if (fresh.length) {
        notify(`BTST signal: ${fresh.map((s) => s.ticker).join(", ")}`,
          fresh.map((s) => `${s.ticker} @ ${fmt(s.price)} → T ${fmt(s.target)} / SL ${fmt(s.stopLoss)}`).join("\n"));
      }
    } catch (e) {
      setError(`BTST scan failed: ${(e as Error).message}`);
    } finally {
      setScanning(false);
    }
  }, [universe]);

  const runSwing = useCallback(async () => {
    setSwingScanning(true);
    setError("");
    try {
      setSwing(await getJson<SwingScanResult>(`/api/scan?mode=swing&universe=${universe}`));
    } catch (e) {
      setError(`Swing scan failed: ${(e as Error).message}`);
    } finally {
      setSwingScanning(false);
    }
  }, [universe]);

  const loadPositions = useCallback(async () => {
    try {
      const list = await getJson<PositionView[]>("/api/positions");
      setPositions(list);
      lastPosAt.current = Date.now();
      // Alert once per position per status
      const hits = list.filter((p) => p.level === "action" && !alerted.current.has(`${p.id}:${p.status}`));
      hits.forEach((p) => alerted.current.add(`${p.id}:${p.status}`));
      if (hits.length) notify(`Exit alert: ${hits.map((p) => p.ticker).join(", ")}`, hits.map((p) => `${p.ticker}: ${p.status}`).join("\n"));
    } catch (e) {
      setError(`Positions failed: ${(e as Error).message}`);
    }
  }, []);

  useEffect(() => { loadPositions(); }, [loadPositions]);

  // Every 30s: refresh market status; auto-scan BTST and refresh positions on schedule
  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const st: Status = await getJson("/api/status");
        if (cancelled) return;
        setStatus(st);
        const live = st.state === "open" || st.state === "btst";
        if (live && Date.now() - lastPosAt.current >= POSITIONS_INTERVAL_MIN * 60_000 - 5000) loadPositions();
        if (!autoMode || scanning) return;
        const since = Date.now() - lastScanAt.current;
        if (st.state === "btst" && since >= st.btstIntervalMin * 60_000 - 5000) runScan();
        else if (st.state === "open" && since >= st.monitorIntervalMin * 60_000 - 5000) runScan();
      } catch { /* dev server restarting */ }
    };
    tick();
    const id = setInterval(tick, 30_000);
    return () => { cancelled = true; clearInterval(id); };
  }, [autoMode, scanning, runScan, loadPositions]);

  const track = async (p: NewPos) => {
    const input = window.prompt(`Your buy price for ${p.ticker} (${p.kind}):`, String(p.price));
    if (input === null) return;
    const entry = Number(input);
    if (!Number.isFinite(entry) || entry <= 0) return alert("Invalid price");
    // Keep the same % target/stop if the fill price differs from the signal price
    const k = entry / p.price;
    try {
      await getJson("/api/positions", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "add", ticker: p.ticker, kind: p.kind, setup: p.setup, entryPrice: entry,
          target: p.target * k, stopLoss: p.stopLoss * k, maxHoldDays: p.maxHoldDays }),
      });
      await loadPositions();
      setTab("positions");
    } catch (e) { setError(`Could not add position: ${(e as Error).message}`); }
  };

  const closePos = async (p: PositionView) => {
    const input = window.prompt(`Your sell price for ${p.ticker}:`, p.price === null ? "" : String(p.price));
    if (input === null) return;
    const price = Number(input);
    if (!Number.isFinite(price) || price <= 0) return alert("Invalid price");
    await getJson("/api/positions", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "close", id: p.id, price }) }).catch((e) => setError((e as Error).message));
    loadPositions();
  };

  const deletePos = async (p: PositionView) => {
    if (!window.confirm(`Remove ${p.ticker} from the list? This cannot be undone.`)) return;
    await getJson("/api/positions", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "delete", id: p.id }) }).catch((e) => setError((e as Error).message));
    loadPositions();
  };

  const diagnose = async () => {
    if (!diagTicker.trim()) return;
    setDiag("Loading…");
    const res = await fetch(`/api/diagnose/${diagTicker.trim().toUpperCase()}`, { cache: "no-store" });
    setDiag(JSON.stringify(await res.json(), null, 2));
  };

  const t = status?.strategy.targetPct ?? 2.5;
  const sl = status?.strategy.stopLossPct ?? 2;
  const openPos = positions?.filter((p) => !p.closed) ?? [];
  const closedPos = positions?.filter((p) => p.closed) ?? [];
  const actionCount = openPos.filter((p) => p.level === "action").length;

  return (
    <main>
      <header>
        <div>
          <h1>PSX <span>Trading</span> Advisor</h1>
          <div className="sub">Shariah-compliant (KMI) · BTST (buy today, sell tomorrow) · Swing (days to 2 weeks)</div>
        </div>
        <div className="controls">
          <select value={universe} onChange={(e) => setUniverse(e.target.value)}>
            <option value="KMI30">KMI-30</option>
            <option value="KMIALLSHR">KMI All Share</option>
            <option value="BOTH">Both</option>
          </select>
          <button onClick={() => setAutoMode((a) => !a)}>Auto-scan: {autoMode ? "ON" : "OFF"}</button>
          {!canNotify && (
            <button onClick={() => Notification.requestPermission().then((p) => setCanNotify(p === "granted"))}>Enable alerts</button>
          )}
        </div>
      </header>

      <section className="panel status">
        <span className={`pill ${status?.state ?? ""}`}>{status?.label ?? "Connecting…"}</span>
        <div className="stat"><div className="k">PKT</div><div className="v">{status?.nowPkt.slice(11) ?? "—"}</div></div>
        <div className="stat"><div className="k">Last BTST scan</div><div className="v">{scan?.scannedAt.slice(11) ?? "—"}</div></div>
        <div className="stat"><div className="k">Universe</div><div className="v">{scan ? `${scan.total} stocks` : swing ? `${swing.total} stocks` : "—"}</div></div>
        <div className="stat"><div className="k">Prices from</div><div className="v">{status?.dataSource ?? "—"}</div></div>
        <div className="stat"><div className="k">Stock list</div><div className="v">{(scan ?? swing)?.universeSource ?? "—"}</div></div>
        <div className="stat"><div className="k">Open positions</div><div className="v">{openPos.length}{actionCount > 0 && <span className="r"> · {actionCount} to act</span>}</div></div>
      </section>

      <nav className="tabs">
        <button className={tab === "btst" ? "on" : ""} onClick={() => setTab("btst")}>BTST {scan && `(${scan.signals.length})`}</button>
        <button className={tab === "swing" ? "on" : ""} onClick={() => setTab("swing")}>Swing {swing && `(${swing.signals.length})`}</button>
        <button className={tab === "positions" ? "on" : ""} onClick={() => setTab("positions")}>
          Positions ({openPos.length}){actionCount > 0 && <span className="new">{actionCount}</span>}
        </button>
      </nav>

      {status?.dataProblem && <p className="err">Data setup: {status.dataProblem}</p>}
      {!!status?.clockOffsetMin && (
        <p className="warn">
          This computer&apos;s clock is off by about {Math.abs(status.clockOffsetMin)} minutes, so the app is using internet time instead.
          Turn on &ldquo;Set time and date automatically&rdquo; in System Settings → General → Date &amp; Time.
        </p>
      )}
      {status?.dataSource === "PSX website" && (
        <p className="warn">Using the PSX website, which blocks the app (HTTP 403). Set <code>dataSource</code> to
          &quot;scstrade&quot; or &quot;auto&quot; in config.ts.</p>
      )}
      {status?.dataSource === "SCSTrade charts" && (
        <p className="m" style={{ fontSize: 12 }}>Prices come from SCSTrade’s free chart feed (unofficial — it can change
          without notice). For a licensed feed, add a Capital Stake token to <code>.env.local</code>.</p>
      )}
      {error && <p className="err">{error}</p>}

      {tab === "btst" && (
        <>
          {scan && scan.noData === scan.total && (
            <p className="err">No data returned for any ticker. Check your connection, or diagnose one ticker below.</p>
          )}
          <section className="panel">
            <h2>
              BTST signals {scan && <span className="m">({scan.signals.length})</span>}
              <span style={{ flex: 1 }} />
              <button className="primary" onClick={runScan} disabled={scanning}>{scanning ? "Scanning…" : "Scan now"}</button>
            </h2>
            {scan && !scan.confirmed && scan.signals.length > 0 && (
              <p className="warn">Preview only — these become real signals only if they still pass in the BTST window
                (last ~15 min before close). Not alerted or logged yet.</p>
            )}
            {scan && scan.overnightDays > 1 && (
              <p className="warn">Next session is {scan.nextSession} — a BTST buy today is held {scan.overnightDays} days
                over the weekend/holiday, so gap risk is higher.</p>
            )}
            {!scan ? (
              <p className="empty">No scan yet. Auto-scan runs during market hours, or press “Scan now”.</p>
            ) : scan.signals.length === 0 ? (
              <p className="empty">No stock meets all 7 conditions right now.</p>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Ticker</th><th>Price</th><th>Vol surge</th><th>RSI</th><th>Off HOD</th>
                      <th>Target (+{t}%)</th><th>Stop loss (−{sl}%)</th><th>Score</th><th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {scan.signals.map((s) => (
                      <tr key={s.ticker}>
                        <td><span className="tk">{s.ticker}</span>{s.isNew && <span className="new">NEW</span>}
                          {!scan.confirmed && <span className="tag">preview</span>}</td>
                        <td>{fmt(s.price)}</td>
                        <td>+{fmt(s.volumeSurgePct, 0)}%</td>
                        <td>{s.rsi.toFixed(1)}</td>
                        <td>{s.distFromHighPct.toFixed(2)}%</td>
                        <td className="g">{fmt(s.target)}</td>
                        <td className="r">{fmt(s.stopLoss)}</td>
                        <td>{s.score.toFixed(0)}</td>
                        <td><button className="sm" onClick={() => track({ ticker: s.ticker, kind: "BTST", price: s.price, target: s.target, stopLoss: s.stopLoss })}>I bought</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {scan && scan.watchlist.length > 0 && (
            <section className="panel">
              <h2>Watchlist <span className="m">closest to triggering</span></h2>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr><th>Ticker</th><th>Price</th><th>Surge</th><th>RSI</th><th>Off HOD</th><th>Checks</th><th>Missing</th></tr>
                  </thead>
                  <tbody>
                    {scan.watchlist.map((e) => (
                      <tr key={e.ticker}>
                        <td className="tk">{e.ticker}</td>
                        <td>{fmt(e.metrics!.price)}</td>
                        <td>{e.metrics!.surgeRatio.toFixed(2)}x</td>
                        <td>{e.metrics!.rsi.toFixed(1)}</td>
                        <td>{e.metrics!.distFromHighPct.toFixed(2)}%</td>
                        <td>{e.checksPassed}/{e.totalChecks}</td>
                        <td className="reasons">{e.reasons.join(" · ")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </>
      )}

      {tab === "swing" && (
        <section className="panel">
          <h2>
            Swing setups {swing && <span className="m">({swing.signals.length})</span>}
            <span style={{ flex: 1 }} />
            <button className="primary" onClick={runSwing} disabled={swingScanning}>{swingScanning ? "Scanning…" : "Scan swing"}</button>
          </h2>
          <p className="m">
            Daily-chart setups held from a few days up to 2 weeks. <b>Breakout</b>: closes above its 20-day high on
            heavy volume. <b>Pullback</b>: in an uptrend, dips back to the 20-day average and bounces. Best run after
            the 3:30 PM close, when today’s candle and volume are complete.
          </p>
          {swing?.intradayPartial && (
            <p className="warn">Market is still open — today’s volume is incomplete, so breakouts may be missed and setups can change by the close.</p>
          )}
          {swing && swing.noData === swing.total && <p className="err">No data returned for any ticker.</p>}
          {!swing ? (
            <p className="empty">No swing scan yet. Press “Scan swing”.</p>
          ) : swing.signals.length === 0 ? (
            <p className="empty">No breakout or pullback setups today.</p>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr><th>Ticker</th><th>Setup</th><th>Price</th><th>RSI</th><th>Vol ×avg</th><th>Avg move</th>
                    <th>Stop loss</th><th>Target</th><th>Hold max</th><th>Score</th><th></th></tr>
                </thead>
                <tbody>
                  {swing.signals.map((s) => (
                    <tr key={s.ticker}>
                      <td className="tk">{s.ticker}</td>
                      <td><span className={`tag ${s.setup === "Breakout" ? "bo" : "pb"}`}>{s.setup}</span></td>
                      <td>{fmt(s.price)}</td>
                      <td>{s.rsi.toFixed(1)}</td>
                      <td>{s.volRatio.toFixed(2)}x</td>
                      <td>{s.avgMovePct.toFixed(1)}%</td>
                      <td className="r">{fmt(s.stopLoss)} <span className="m">−{s.stopPct.toFixed(1)}%</span></td>
                      <td className="g">{fmt(s.target)} <span className="m">+{s.targetPct.toFixed(1)}%</span></td>
                      <td>{s.maxHoldDays}d</td>
                      <td>{s.score.toFixed(0)}</td>
                      <td><button className="sm" onClick={() => track({ ticker: s.ticker, kind: "SWING", setup: s.setup, price: s.price, target: s.target, stopLoss: s.stopLoss, maxHoldDays: s.maxHoldDays })}>I bought</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {tab === "positions" && (
        <section className="panel">
          <h2>
            Open positions <span className="m">({openPos.length}) · refreshes every {POSITIONS_INTERVAL_MIN} min in market hours</span>
            <span style={{ flex: 1 }} />
            <button onClick={loadPositions}>Refresh</button>
          </h2>
          {openPos.length === 0 ? (
            <p className="empty">No open positions. Press “I bought” on a BTST or swing signal to track it here.</p>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr><th>Ticker</th><th>Type</th><th>Bought</th><th>Entry</th><th>Now</th><th>P/L</th>
                    <th>Stop</th><th>Target</th><th>Exit by</th><th>Status</th><th></th></tr>
                </thead>
                <tbody>
                  {openPos.map((p) => (
                    <tr key={p.id} className={`lvl-${p.level}`}>
                      <td className="tk">{p.ticker}</td>
                      <td>{p.kind}{p.setup ? ` · ${p.setup}` : ""}</td>
                      <td>{p.entryDate}</td>
                      <td>{fmt(p.entryPrice)}</td>
                      <td>{p.price === null ? "—" : fmt(p.price)}</td>
                      <td className={p.pnlPct !== null && p.pnlPct >= 0 ? "g" : "r"}>{pct(p.pnlPct)}</td>
                      <td className="r">{fmt(p.stopLoss)}</td>
                      <td className="g">{fmt(p.target)}</td>
                      <td>{p.exitBy}</td>
                      <td className="reasons status-cell">{p.status}</td>
                      <td>
                        <button className="sm" onClick={() => closePos(p)}>Sold</button>{" "}
                        <button className="sm" onClick={() => deletePos(p)} title="Remove">✕</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {closedPos.length > 0 && (
            <>
              <h2 style={{ marginTop: 20 }}>Closed trades <span className="m">
                ({closedPos.length} · win rate {Math.round((closedPos.filter((p) => (p.pnlPct ?? 0) > 0).length / closedPos.length) * 100)}%
                · avg {pct(closedPos.reduce((a, p) => a + (p.pnlPct ?? 0), 0) / closedPos.length)})</span></h2>
              <div className="table-wrap">
                <table>
                  <thead><tr><th>Ticker</th><th>Type</th><th>Bought</th><th>Sold</th><th>Entry</th><th>Exit</th><th>Days</th><th>P/L</th><th></th></tr></thead>
                  <tbody>
                    {closedPos.map((p) => (
                      <tr key={p.id}>
                        <td className="tk">{p.ticker}</td>
                        <td>{p.kind}{p.setup ? ` · ${p.setup}` : ""}</td>
                        <td>{p.entryDate}</td>
                        <td>{p.closed!.date}</td>
                        <td>{fmt(p.entryPrice)}</td>
                        <td>{fmt(p.closed!.price)}</td>
                        <td>{p.daysHeld}</td>
                        <td className={(p.pnlPct ?? 0) >= 0 ? "g" : "r"}>{pct(p.pnlPct)}</td>
                        <td><button className="sm" onClick={() => deletePos(p)} title="Remove">✕</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </section>
      )}

      <section className="panel">
        <h2>Diagnose a ticker</h2>
        <div className="controls">
          <input placeholder="e.g. LUCK" value={diagTicker}
            onChange={(e) => setDiagTicker(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && diagnose()} />
          <button onClick={diagnose}>Diagnose</button>
        </div>
        {diag && <pre>{diag}</pre>}
      </section>

      <footer>
        Signals are generated from technical rules and are not financial advice. Keep this tab open during
        market hours for alerts. BTST signals are logged to <code>signals/YYYY-MM-DD.csv</code>, swing setups to{" "}
        <code>signals/swing-YYYY-MM-DD.csv</code>, positions to <code>positions.json</code>.
      </footer>
    </main>
  );
}
