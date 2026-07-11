/*
 * Backtest-Engine: simuliert die Marker-Strategie (EMA-9/20-Kreuz mit
 * VWAP-Bestätigung) über die geladene Kurshistorie und misst, was sie
 * gebracht hätte.
 *
 * Regeln (bewusst einfach und ohne Blick in die Zukunft):
 *  - Einstieg zum ERÖFFNUNGSKURS der Kerze NACH dem Signal
 *  - Stop-Loss bei 1,5 × ATR, Gewinnziel bei 1,5 R (wie der Rechner)
 *  - Ausstieg bei Stop, Ziel, Gegensignal oder spätestens zum Tagesschluss
 *    (Day-Trading: keine Position über Nacht)
 *  - Positionsgröße aus Kapital und Risiko pro Trade, gedeckelt durch
 *    das Kapital (kein Hebel), plus Ordergebühr je Kauf/Verkauf
 *
 * WICHTIG: Vergangenheit ist keine Garantie für die Zukunft – und mit
 * Demo-Daten ist das Ergebnis nur eine Spielerei zum Ausprobieren.
 */

const Backtest = (() => {

    const ATR_MULT = 1.5; // Stop-Abstand, identisch zum Positionsrechner
    const RR = 1.5;       // Chance-Risiko-Verhältnis fürs Gewinnziel

    /**
     * @param {Array} candles Kerzen
     * @param {Object} ind vorberechnete Indikatoren (ema9, ema20, vwap, atr)
     * @param {Object} opts { capital, riskPct, fee, allowShort }
     * @returns {{ trades, stats, equity }}
     */
    function run(candles, ind, opts) {
        const signals = new Map();
        for (const m of Recommendation.markers(candles, ind)) signals.set(m.index, m.type);

        const trades = [];
        let pos = null;

        for (let i = 1; i < candles.length; i++) {
            const c = candles[i];
            const day = new Date(c.time).toDateString();
            const nextDay = i + 1 < candles.length ? new Date(candles[i + 1].time).toDateString() : null;
            const lastOfDay = nextDay !== day;

            // Offene Position: Ausstiegsbedingungen prüfen
            if (pos) {
                let exit = null, reason = null;
                if (pos.dir === 1) {
                    // Konservativ: Stop vor Ziel prüfen, falls beide in einer Kerze liegen
                    if (c.low <= pos.stop) { exit = pos.stop; reason = 'Stop-Loss'; }
                    else if (c.high >= pos.target) { exit = pos.target; reason = 'Gewinnziel'; }
                } else {
                    if (c.high >= pos.stop) { exit = pos.stop; reason = 'Stop-Loss'; }
                    else if (c.low <= pos.target) { exit = pos.target; reason = 'Gewinnziel'; }
                }
                const sig = signals.get(i);
                if (!exit && sig && ((pos.dir === 1 && sig === 'sell') || (pos.dir === -1 && sig === 'buy'))) {
                    exit = c.close; reason = 'Gegensignal';
                }
                if (!exit && lastOfDay) { exit = c.close; reason = 'Tagesschluss'; }

                if (exit !== null) {
                    const pnl = (exit - pos.entry) * pos.dir * pos.shares - 2 * opts.fee;
                    trades.push({
                        dir: pos.dir, entryTime: pos.entryTime, exitTime: c.time,
                        entry: pos.entry, exit, shares: pos.shares, reason, pnl,
                        r: ((exit - pos.entry) * pos.dir) / pos.stopDist,
                    });
                    pos = null;
                }
            }

            // Kein Einstieg mehr in der letzten Kerze des Tages
            if (!pos && !lastOfDay && signals.has(i)) {
                const type = signals.get(i);
                if (type === 'sell' && !opts.allowShort) continue;
                const atrV = ind.atr[i];
                if (atrV === null) continue;
                const entryIdx = i + 1;
                // Einstieg nur, wenn die nächste Kerze am selben Tag liegt
                if (new Date(candles[entryIdx].time).toDateString() !== day) continue;

                const entry = candles[entryIdx].open;
                const dir = type === 'buy' ? 1 : -1;
                const stopDist = atrV * ATR_MULT;
                const riskAmount = opts.capital * (opts.riskPct / 100);
                let shares = stopDist > 0 ? Math.floor(riskAmount / stopDist) : 0;
                shares = Math.min(shares, Math.floor(opts.capital / entry));
                if (shares < 1) continue;

                pos = {
                    dir, entry, entryTime: candles[entryIdx].time,
                    stop: entry - dir * stopDist,
                    target: entry + dir * stopDist * RR,
                    stopDist, shares,
                };
            }
        }

        return { trades, stats: computeStats(trades, opts), equity: equityCurve(trades) };
    }

    function computeStats(trades, opts) {
        const wins = trades.filter(t => t.pnl > 0);
        const losses = trades.filter(t => t.pnl <= 0);
        const grossWin = wins.reduce((s, t) => s + t.pnl, 0);
        const grossLoss = Math.abs(losses.reduce((s, t) => s + t.pnl, 0));
        const total = grossWin - grossLoss;

        // Maximaler Drawdown auf der Kapitalkurve
        let peak = 0, equity = 0, maxDD = 0;
        for (const t of trades) {
            equity += t.pnl;
            peak = Math.max(peak, equity);
            maxDD = Math.max(maxDD, peak - equity);
        }

        return {
            count: trades.length,
            wins: wins.length,
            losses: losses.length,
            winRate: trades.length ? (wins.length / trades.length) * 100 : 0,
            total,
            totalPct: opts.capital > 0 ? (total / opts.capital) * 100 : 0,
            avgWin: wins.length ? grossWin / wins.length : 0,
            avgLoss: losses.length ? grossLoss / losses.length : 0,
            profitFactor: grossLoss > 0 ? grossWin / grossLoss : (grossWin > 0 ? Infinity : 0),
            maxDrawdown: maxDD,
            best: trades.length ? Math.max(...trades.map(t => t.pnl)) : 0,
            worst: trades.length ? Math.min(...trades.map(t => t.pnl)) : 0,
            fees: trades.length * 2 * opts.fee,
        };
    }

    function equityCurve(trades) {
        const curve = [0];
        let sum = 0;
        for (const t of trades) { sum += t.pnl; curve.push(sum); }
        return curve;
    }

    /** Kleine Kapitalkurve auf einen Canvas zeichnen */
    function drawEquity(canvas, equity) {
        const ctx = canvas.getContext('2d');
        const dpr = window.devicePixelRatio || 1;
        const rect = canvas.getBoundingClientRect();
        if (rect.width === 0) return;
        canvas.width = Math.round(rect.width * dpr);
        canvas.height = Math.round(rect.height * dpr);
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        const w = rect.width, h = rect.height, pad = 4;

        ctx.fillStyle = '#11151c';
        ctx.fillRect(0, 0, w, h);
        if (equity.length < 2) return;

        const min = Math.min(0, ...equity);
        const max = Math.max(0, ...equity);
        const span = (max - min) || 1;
        const xOf = i => pad + (i / (equity.length - 1)) * (w - 2 * pad);
        const yOf = v => pad + (1 - (v - min) / span) * (h - 2 * pad);

        // Nulllinie
        ctx.strokeStyle = '#232a36';
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(pad, yOf(0));
        ctx.lineTo(w - pad, yOf(0));
        ctx.stroke();
        ctx.setLineDash([]);

        const final = equity[equity.length - 1];
        ctx.strokeStyle = final >= 0 ? '#26a69a' : '#ef5350';
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.moveTo(xOf(0), yOf(equity[0]));
        for (let i = 1; i < equity.length; i++) ctx.lineTo(xOf(i), yOf(equity[i]));
        ctx.stroke();
        ctx.lineWidth = 1;
    }

    return { run, drawEquity };
})();
