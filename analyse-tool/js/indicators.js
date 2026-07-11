/*
 * Technische Indikatoren für das Day-Trading-Analysetool.
 * Alle Funktionen arbeiten auf Arrays von Kerzen:
 *   { time, open, high, low, close, volume }
 * und geben Arrays gleicher Länge zurück (fehlende Werte = null).
 */

const Indicators = (() => {

    /** Einfacher gleitender Durchschnitt (Simple Moving Average) */
    function sma(values, period) {
        const out = new Array(values.length).fill(null);
        let sum = 0;
        for (let i = 0; i < values.length; i++) {
            sum += values[i];
            if (i >= period) sum -= values[i - period];
            if (i >= period - 1) out[i] = sum / period;
        }
        return out;
    }

    /** Exponentieller gleitender Durchschnitt (Exponential Moving Average) */
    function ema(values, period) {
        const out = new Array(values.length).fill(null);
        const k = 2 / (period + 1);
        let prev = null;
        for (let i = 0; i < values.length; i++) {
            if (prev === null) {
                // Start mit SMA über die ersten `period` Werte
                if (i === period - 1) {
                    let sum = 0;
                    for (let j = 0; j < period; j++) sum += values[j];
                    prev = sum / period;
                    out[i] = prev;
                }
            } else {
                prev = values[i] * k + prev * (1 - k);
                out[i] = prev;
            }
        }
        return out;
    }

    /** Relative-Stärke-Index nach Wilder */
    function rsi(candles, period = 14) {
        const out = new Array(candles.length).fill(null);
        let avgGain = 0, avgLoss = 0;
        for (let i = 1; i < candles.length; i++) {
            const change = candles[i].close - candles[i - 1].close;
            const gain = Math.max(change, 0);
            const loss = Math.max(-change, 0);
            if (i <= period) {
                avgGain += gain / period;
                avgLoss += loss / period;
                if (i === period) {
                    out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
                }
            } else {
                avgGain = (avgGain * (period - 1) + gain) / period;
                avgLoss = (avgLoss * (period - 1) + loss) / period;
                out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
            }
        }
        return out;
    }

    /** MACD (12/26/9) – liefert { macd, signal, histogram } */
    function macd(candles, fast = 12, slow = 26, signalPeriod = 9) {
        const closes = candles.map(c => c.close);
        const emaFast = ema(closes, fast);
        const emaSlow = ema(closes, slow);
        const macdLine = closes.map((_, i) =>
            emaFast[i] !== null && emaSlow[i] !== null ? emaFast[i] - emaSlow[i] : null);

        // Signallinie: EMA über die MACD-Linie (nur dort, wo sie existiert)
        const signal = new Array(closes.length).fill(null);
        const k = 2 / (signalPeriod + 1);
        let prev = null, seen = 0;
        for (let i = 0; i < macdLine.length; i++) {
            if (macdLine[i] === null) continue;
            seen++;
            if (prev === null) {
                if (seen === signalPeriod) {
                    let sum = 0, count = 0;
                    for (let j = i; j >= 0 && count < signalPeriod; j--) {
                        if (macdLine[j] !== null) { sum += macdLine[j]; count++; }
                    }
                    prev = sum / signalPeriod;
                    signal[i] = prev;
                }
            } else {
                prev = macdLine[i] * k + prev * (1 - k);
                signal[i] = prev;
            }
        }
        const histogram = macdLine.map((v, i) =>
            v !== null && signal[i] !== null ? v - signal[i] : null);
        return { macd: macdLine, signal, histogram };
    }

    /** Bollinger-Bänder – liefert { middle, upper, lower } */
    function bollinger(candles, period = 20, mult = 2) {
        const closes = candles.map(c => c.close);
        const middle = sma(closes, period);
        const upper = new Array(closes.length).fill(null);
        const lower = new Array(closes.length).fill(null);
        for (let i = period - 1; i < closes.length; i++) {
            let variance = 0;
            for (let j = i - period + 1; j <= i; j++) {
                variance += (closes[j] - middle[i]) ** 2;
            }
            const std = Math.sqrt(variance / period);
            upper[i] = middle[i] + mult * std;
            lower[i] = middle[i] - mult * std;
        }
        return { middle, upper, lower };
    }

    /** VWAP – volumengewichteter Durchschnittspreis, Reset pro Handelstag */
    function vwap(candles) {
        const out = new Array(candles.length).fill(null);
        let cumPV = 0, cumVol = 0, currentDay = null;
        for (let i = 0; i < candles.length; i++) {
            const day = new Date(candles[i].time).toDateString();
            if (day !== currentDay) {
                currentDay = day;
                cumPV = 0;
                cumVol = 0;
            }
            const typical = (candles[i].high + candles[i].low + candles[i].close) / 3;
            cumPV += typical * candles[i].volume;
            cumVol += candles[i].volume;
            out[i] = cumVol > 0 ? cumPV / cumVol : typical;
        }
        return out;
    }

    /** Average True Range nach Wilder */
    function atr(candles, period = 14) {
        const out = new Array(candles.length).fill(null);
        let prev = null;
        for (let i = 1; i < candles.length; i++) {
            const tr = Math.max(
                candles[i].high - candles[i].low,
                Math.abs(candles[i].high - candles[i - 1].close),
                Math.abs(candles[i].low - candles[i - 1].close)
            );
            if (i <= period) {
                prev = prev === null ? tr : prev + tr;
                if (i === period) {
                    prev = prev / period;
                    out[i] = prev;
                }
            } else {
                prev = (prev * (period - 1) + tr) / period;
                out[i] = prev;
            }
        }
        return out;
    }

    return { sma, ema, rsi, macd, bollinger, vwap, atr };
})();
