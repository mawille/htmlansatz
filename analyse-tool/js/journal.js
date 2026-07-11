/*
 * Trading-Tagebuch: eigene Trades erfassen, lokal im Browser speichern
 * (localStorage) und auswerten. Das Tagebuch ist das wichtigste
 * Lernwerkzeug: Es zeigt schwarz auf weiß, was funktioniert und was nicht.
 */

const Journal = (() => {

    const KEY = 'trading_journal_v1';

    /* ---------- Speicherung ---------- */

    function load() {
        try {
            const data = JSON.parse(localStorage.getItem(KEY));
            return Array.isArray(data) ? data : [];
        } catch { return []; }
    }

    function save(trades) {
        localStorage.setItem(KEY, JSON.stringify(trades));
    }

    function add(trade) {
        const trades = load();
        trade.id = Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
        trades.push(trade);
        trades.sort((a, b) => new Date(a.time) - new Date(b.time));
        save(trades);
        return trades;
    }

    function remove(id) {
        const trades = load().filter(t => t.id !== id);
        save(trades);
        return trades;
    }

    function clear() {
        localStorage.removeItem(KEY);
    }

    /* ---------- Auswertung ---------- */

    function pnl(t) {
        return (t.exit - t.entry) * t.dir * t.shares - (t.fees || 0);
    }

    // Tagesphase eines Trades (deutsche Zeit) – für die Frage:
    // "Zu welcher Uhrzeit trade ich am besten?"
    function phaseOf(time) {
        const d = new Date(time);
        const m = d.getHours() * 60 + d.getMinutes();
        if (m < 690) return 'Vormittag (bis 11:30)';
        if (m < 930) return 'Mittag (11:30–15:30)';
        if (m < 1050) return 'Nachmittag (15:30–17:30)';
        return 'Abend (ab 17:30)';
    }

    function stats(trades) {
        const results = trades.map(t => ({ ...t, pnl: pnl(t) }));
        const wins = results.filter(t => t.pnl > 0);
        const losses = results.filter(t => t.pnl <= 0);
        const grossWin = wins.reduce((s, t) => s + t.pnl, 0);
        const grossLoss = Math.abs(losses.reduce((s, t) => s + t.pnl, 0));

        // Nach Symbol und Tagesphase gruppieren
        const bySymbol = {}, byPhase = {};
        for (const t of results) {
            bySymbol[t.symbol] = (bySymbol[t.symbol] || 0) + t.pnl;
            const ph = phaseOf(t.time);
            if (!byPhase[ph]) byPhase[ph] = { pnl: 0, count: 0 };
            byPhase[ph].pnl += t.pnl;
            byPhase[ph].count++;
        }

        return {
            count: results.length,
            wins: wins.length,
            losses: losses.length,
            winRate: results.length ? (wins.length / results.length) * 100 : 0,
            total: grossWin - grossLoss,
            avgWin: wins.length ? grossWin / wins.length : 0,
            avgLoss: losses.length ? grossLoss / losses.length : 0,
            profitFactor: grossLoss > 0 ? grossWin / grossLoss : (grossWin > 0 ? Infinity : 0),
            bySymbol, byPhase,
            equity: results.reduce((acc, t) => { acc.push(acc[acc.length - 1] + t.pnl); return acc; }, [0]),
        };
    }

    /**
     * Coaching-Hinweise aus den eigenen Zahlen ableiten.
     * @returns {Array<string>}
     */
    function insights(trades) {
        const s = stats(trades);
        const out = [];
        if (s.count < 5) {
            out.push('Erfasse mindestens 5 Trades, dann werden hier Muster sichtbar.');
            return out;
        }
        if (s.avgLoss > s.avgWin * 1.5 && s.losses > 2) {
            out.push('⚠️ Deine Verluste sind im Schnitt deutlich größer als deine Gewinne – ' +
                'klassisches Zeichen, dass Stops zu spät gezogen werden. Notbremse konsequent setzen!');
        }
        if (s.winRate < 40 && s.count >= 10) {
            out.push('⚠️ Trefferquote unter 40 % – prüfe im Tagebuch, welche Einstiegsgründe ' +
                'am häufigsten schiefgehen, und lasse diese Trades weg.');
        }
        const phases = Object.entries(s.byPhase).filter(([, v]) => v.count >= 3);
        if (phases.length >= 2) {
            phases.sort((a, b) => b[1].pnl - a[1].pnl);
            const best = phases[0], worst = phases[phases.length - 1];
            if (best[1].pnl > 0) out.push(`✅ Am besten läuft es bei dir am ${best[0]} (${best[1].count} Trades).`);
            if (worst[1].pnl < 0) out.push(`⚠️ Am ${worst[0]} verlierst du unterm Strich – diese Zeit vielleicht meiden.`);
        }
        const symbols = Object.entries(s.bySymbol);
        if (symbols.length >= 2) {
            symbols.sort((a, b) => b[1] - a[1]);
            const best = symbols[0], worst = symbols[symbols.length - 1];
            if (best[1] > 0) out.push(`✅ Dein stärkster Wert: ${best[0]}.`);
            if (worst[1] < 0) out.push(`⚠️ Dein schwächster Wert: ${worst[0]} – liegt er dir wirklich?`);
        }
        if (out.length === 0) out.push('Solide Bilanz – weiter diszipliniert dokumentieren!');
        return out;
    }

    /* ---------- CSV-Export (deutsches Excel-Format) ---------- */

    function toCsv(trades) {
        const num = v => String(v).replace('.', ',');
        const esc = v => '"' + String(v || '').replace(/"/g, '""') + '"';
        const lines = ['Datum;Symbol;Richtung;Stückzahl;Einstieg;Ausstieg;Gebühren;Ergebnis;Notiz'];
        for (const t of trades) {
            const d = new Date(t.time);
            lines.push([
                d.toLocaleDateString('de-DE') + ' ' + d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }),
                t.symbol,
                t.dir === 1 ? 'Long' : 'Short',
                t.shares,
                num(t.entry), num(t.exit), num(t.fees || 0),
                num(pnl(t).toFixed(2)),
                esc(t.note),
            ].join(';'));
        }
        return lines.join('\r\n');
    }

    return { load, add, remove, clear, pnl, stats, insights, toCsv, phaseOf };
})();
