/*
 * Einstellbare Indikator-Parameter, lokal gespeichert (localStorage).
 * Alle Module (Chart, Signale, Empfehlung, Rechner, Backtest) rechnen
 * mit denselben Werten – Änderungen wirken sofort überall.
 */

const Settings = (() => {

    const KEY = 'indicator_settings_v1';

    const DEFAULTS = {
        emaFast: 9,     // schneller EMA
        emaSlow: 20,    // langsamer EMA
        rsiPeriod: 14,  // RSI-Periode
        rsiLow: 30,     // RSI überverkauft
        rsiHigh: 70,    // RSI überkauft
        bbPeriod: 20,   // Bollinger-Periode
        bbMult: 2,      // Bollinger-Standardabweichungen
        atrPeriod: 14,  // ATR-Periode
        atrMult: 1.5,   // Stop-Abstand in ATR
        rr: 1.5,        // Gewinnziel als R-Vielfaches
    };

    // Gültige Bereiche, damit keine unsinnigen Werte gespeichert werden
    const LIMITS = {
        emaFast: [2, 50], emaSlow: [3, 200],
        rsiPeriod: [2, 50], rsiLow: [5, 49], rsiHigh: [51, 95],
        bbPeriod: [5, 100], bbMult: [0.5, 4],
        atrPeriod: [2, 50], atrMult: [0.5, 5], rr: [0.5, 5],
    };

    let current = load();

    function load() {
        try {
            const stored = JSON.parse(localStorage.getItem(KEY)) || {};
            return sanitize({ ...DEFAULTS, ...stored });
        } catch {
            return { ...DEFAULTS };
        }
    }

    function sanitize(cfg) {
        const out = { ...cfg };
        for (const [k, [min, max]] of Object.entries(LIMITS)) {
            const v = parseFloat(out[k]);
            out[k] = isNaN(v) ? DEFAULTS[k] : Math.min(max, Math.max(min, v));
        }
        return out;
    }

    function get() { return current; }

    function set(patch) {
        current = sanitize({ ...current, ...patch });
        localStorage.setItem(KEY, JSON.stringify(current));
        return current;
    }

    function reset() {
        current = { ...DEFAULTS };
        localStorage.removeItem(KEY);
        return current;
    }

    return { get, set, reset, DEFAULTS, LIMITS };
})();
