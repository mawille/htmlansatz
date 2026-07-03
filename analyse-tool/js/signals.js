/*
 * Signal-Engine: wertet die Indikatoren der letzten Kerze aus und
 * aggregiert sie zu einer Long/Short/Neutral-Einschätzung.
 *
 * WICHTIG: Das ist ein Analyse-Hilfsmittel, keine Anlageberatung.
 */

const Signals = (() => {

    /**
     * Bewertet den aktuellen Zustand.
     * @param {Array} candles Kerzen
     * @param {Object} ind vorberechnete Indikatoren
     *        { ema9, ema20, rsi, macd, bollinger, vwap, atr }
     * @returns {{ items: Array, score: number, verdict: string }}
     */
    function evaluate(candles, ind) {
        const i = candles.length - 1;
        const items = [];
        if (i < 30) return { items, score: 0, verdict: 'NEUTRAL' };

        const c = candles[i];
        const push = (name, dir, text) => items.push({ name, dir, text });

        // 1) Trend: EMA 9 vs. EMA 20 (inkl. frischem Kreuz)
        const e9 = ind.ema9[i], e20 = ind.ema20[i];
        const e9p = ind.ema9[i - 1], e20p = ind.ema20[i - 1];
        if (e9 !== null && e20 !== null) {
            const crossedUp = e9p !== null && e20p !== null && e9p <= e20p && e9 > e20;
            const crossedDown = e9p !== null && e20p !== null && e9p >= e20p && e9 < e20;
            if (crossedUp) push('EMA-Kreuz', 1, 'EMA 9 kreuzt EMA 20 nach oben (frisches Kaufsignal)');
            else if (crossedDown) push('EMA-Kreuz', -1, 'EMA 9 kreuzt EMA 20 nach unten (frisches Verkaufssignal)');
            else if (e9 > e20) push('Trend (EMA)', 1, 'EMA 9 über EMA 20 – kurzfristiger Aufwärtstrend');
            else push('Trend (EMA)', -1, 'EMA 9 unter EMA 20 – kurzfristiger Abwärtstrend');
        }

        // 2) VWAP: institutionelle Referenzlinie im Day-Trading
        const vw = ind.vwap[i];
        if (vw !== null) {
            const distPct = ((c.close - vw) / vw) * 100;
            if (c.close > vw) push('VWAP', 1, `Kurs ${distPct.toFixed(2)} % über VWAP – Käufer dominieren`);
            else push('VWAP', -1, `Kurs ${Math.abs(distPct).toFixed(2)} % unter VWAP – Verkäufer dominieren`);
        }

        // 3) RSI: Überkauft/Überverkauft
        const r = ind.rsi[i];
        if (r !== null) {
            if (r < 30) push('RSI', 1, `RSI ${r.toFixed(1)} – überverkauft, Rebound möglich`);
            else if (r > 70) push('RSI', -1, `RSI ${r.toFixed(1)} – überkauft, Rücksetzer möglich`);
            else if (r >= 50) push('RSI', 0.5, `RSI ${r.toFixed(1)} – bullischer Bereich`);
            else push('RSI', -0.5, `RSI ${r.toFixed(1)} – bärischer Bereich`);
        }

        // 4) MACD-Histogramm: Momentum und frische Kreuzungen
        const h = ind.macd.histogram[i], hp = ind.macd.histogram[i - 1];
        if (h !== null && hp !== null) {
            if (hp <= 0 && h > 0) push('MACD', 1, 'MACD kreuzt Signallinie nach oben – Momentum dreht bullisch');
            else if (hp >= 0 && h < 0) push('MACD', -1, 'MACD kreuzt Signallinie nach unten – Momentum dreht bärisch');
            else if (h > 0) push('MACD', 0.5, 'MACD-Histogramm positiv – bullisches Momentum');
            else push('MACD', -0.5, 'MACD-Histogramm negativ – bärisches Momentum');
        }

        // 5) Bollinger-Bänder: Extremzonen
        const bb = ind.bollinger;
        if (bb.upper[i] !== null) {
            if (c.close > bb.upper[i]) push('Bollinger', -1, 'Kurs über dem oberen Band – überdehnt, Mean-Reversion-Risiko');
            else if (c.close < bb.lower[i]) push('Bollinger', 1, 'Kurs unter dem unteren Band – überdehnt, Rebound möglich');
        }

        // 6) Volumen: bestätigt die letzte Bewegung?
        const volAvg = avgVolume(candles, i, 20);
        if (volAvg > 0 && c.volume > 1.5 * volAvg) {
            const dir = c.close >= c.open ? 1 : -1;
            push('Volumen', dir * 0.5,
                `Volumen ${(c.volume / volAvg).toFixed(1)}× über Schnitt – Bewegung wird bestätigt`);
        }

        const score = items.reduce((s, it) => s + it.dir, 0);
        let verdict = 'NEUTRAL';
        if (score >= 2.5) verdict = 'LONG';
        else if (score <= -2.5) verdict = 'SHORT';
        else if (score >= 1) verdict = 'LEICHT LONG';
        else if (score <= -1) verdict = 'LEICHT SHORT';

        return { items, score, verdict };
    }

    function avgVolume(candles, i, period) {
        let sum = 0, n = 0;
        for (let j = Math.max(0, i - period); j < i; j++) { sum += candles[j].volume; n++; }
        return n ? sum / n : 0;
    }

    /**
     * Positionsgrößen-Rechner mit ATR-basiertem Stop.
     * @returns {{ stop, target1, target2, riskPerShare, shares, positionValue }}
     */
    function positionPlan(direction, price, atrValue, capital, riskPct, atrMult = 1.5) {
        const riskAmount = capital * (riskPct / 100);
        const stopDist = atrValue * atrMult;
        const sign = direction === 'SHORT' ? -1 : 1;
        const stop = price - sign * stopDist;
        const target1 = price + sign * stopDist * 1.5; // 1,5 R
        const target2 = price + sign * stopDist * 3;   // 3 R
        let shares = stopDist > 0 ? Math.floor(riskAmount / stopDist) : 0;
        // Ohne Hebel kann die Position nicht größer als das Kapital sein
        const maxShares = price > 0 ? Math.floor(capital / price) : 0;
        const cappedByCapital = shares > maxShares;
        if (cappedByCapital) shares = maxShares;
        return {
            stop, target1, target2,
            riskPerShare: stopDist,
            shares,
            positionValue: shares * price,
            riskAmount,
            cappedByCapital,
        };
    }

    return { evaluate, positionPlan };
})();
