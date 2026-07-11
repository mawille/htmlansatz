/*
 * Datenversorgung für das Analysetool.
 *
 * Zwei Quellen:
 *  1. Demo-Modus (Standard): realistisch simulierte Intraday-Kerzen,
 *     deterministisch pro Symbol (gleiches Symbol => gleicher Chart).
 *  2. Live-Modus: echte Kurse über die Twelve-Data-API
 *     (kostenloser API-Key auf https://twelvedata.com, CORS-fähig).
 */

const DataProvider = (() => {

    // Vordefinierte Watchlist: gängige ETFs und die beliebtesten
    // Day-Trading-Aktien – alle über Trade Republic handelbar.
    // US-Symbole funktionieren auch im Live-Modus (Twelve Data, Gratis-Tarif).
    const WATCHLIST = [
        // --- ETFs ---
        { symbol: 'SPY',  name: 'SPDR S&P 500 ETF',        type: 'ETF',   basePrice: 545,  vola: 0.0009 },
        { symbol: 'QQQ',  name: 'Invesco Nasdaq-100 ETF',  type: 'ETF',   basePrice: 480,  vola: 0.0012 },
        { symbol: 'IWM',  name: 'iShares Russell 2000 ETF',type: 'ETF',   basePrice: 215,  vola: 0.0013 },
        { symbol: 'EUNL', name: 'iShares Core MSCI World', type: 'ETF',   basePrice: 105,  vola: 0.0007 },
        { symbol: 'EXS1', name: 'iShares Core DAX ETF',    type: 'ETF',   basePrice: 155,  vola: 0.0010 },
        // --- US-Tech-Schwergewichte (hohes Volumen, enge Spreads) ---
        { symbol: 'NVDA', name: 'NVIDIA Corp.',            type: 'Aktie', basePrice: 152,  vola: 0.0024 },
        { symbol: 'TSLA', name: 'Tesla Inc.',              type: 'Aktie', basePrice: 305,  vola: 0.0030 },
        { symbol: 'AAPL', name: 'Apple Inc.',              type: 'Aktie', basePrice: 212,  vola: 0.0014 },
        { symbol: 'MSFT', name: 'Microsoft Corp.',         type: 'Aktie', basePrice: 465,  vola: 0.0012 },
        { symbol: 'AMD',  name: 'AMD Inc.',                type: 'Aktie', basePrice: 138,  vola: 0.0026 },
        { symbol: 'META', name: 'Meta Platforms',          type: 'Aktie', basePrice: 715,  vola: 0.0018 },
        { symbol: 'AMZN', name: 'Amazon.com',              type: 'Aktie', basePrice: 223,  vola: 0.0015 },
        { symbol: 'GOOGL',name: 'Alphabet (Google)',       type: 'Aktie', basePrice: 182,  vola: 0.0014 },
        { symbol: 'NFLX', name: 'Netflix Inc.',            type: 'Aktie', basePrice: 1240, vola: 0.0017 },
        { symbol: 'AVGO', name: 'Broadcom Inc.',           type: 'Aktie', basePrice: 275,  vola: 0.0020 },
        // --- Day-Trading-Favoriten (hohe Volatilität – Vorsicht!) ---
        { symbol: 'PLTR', name: 'Palantir Technologies',   type: 'Aktie', basePrice: 142,  vola: 0.0034 },
        { symbol: 'COIN', name: 'Coinbase Global',         type: 'Aktie', basePrice: 355,  vola: 0.0038 },
        { symbol: 'MSTR', name: 'MicroStrategy (Strategy)',type: 'Aktie', basePrice: 390,  vola: 0.0045 },
        { symbol: 'HOOD', name: 'Robinhood Markets',       type: 'Aktie', basePrice: 98,   vola: 0.0036 },
        { symbol: 'SMCI', name: 'Super Micro Computer',    type: 'Aktie', basePrice: 47,   vola: 0.0040 },
        { symbol: 'GME',  name: 'GameStop Corp.',          type: 'Aktie', basePrice: 27,   vola: 0.0042 },
        { symbol: 'SOFI', name: 'SoFi Technologies',       type: 'Aktie', basePrice: 21,   vola: 0.0035 },
        // --- Deutsche Trading-Favoriten (Live-Daten: nur mit Bezahl-Tarif) ---
        { symbol: 'RHM',  name: 'Rheinmetall AG',          type: 'Aktie', basePrice: 1750, vola: 0.0026 },
        { symbol: 'SAP',  name: 'SAP SE',                  type: 'Aktie', basePrice: 260,  vola: 0.0013 },
        { symbol: 'SIE',  name: 'Siemens AG',              type: 'Aktie', basePrice: 218,  vola: 0.0012 },
        { symbol: 'ENR',  name: 'Siemens Energy',          type: 'Aktie', basePrice: 92,   vola: 0.0030 },
        { symbol: 'IFX',  name: 'Infineon Technologies',   type: 'Aktie', basePrice: 37,   vola: 0.0024 },
        { symbol: 'DBK',  name: 'Deutsche Bank',           type: 'Aktie', basePrice: 27,   vola: 0.0022 },
    ];

    // Gruppenüberschriften für die Watchlist-Anzeige
    const GROUP_START = {
        SPY: 'ETFs',
        NVDA: 'US-Schwergewichte',
        PLTR: 'Trading-Favoriten (sehr volatil)',
        RHM: 'Deutschland',
    };
    let currentGroup = '';
    for (const w of WATCHLIST) {
        if (GROUP_START[w.symbol]) currentGroup = GROUP_START[w.symbol];
        w.group = currentGroup;
    }

    const INTERVALS = {
        '1min':  { minutes: 1,  label: '1 Min',  days: 2 },
        '5min':  { minutes: 5,  label: '5 Min',  days: 5 },
        '15min': { minutes: 15, label: '15 Min', days: 10 },
        '1h':    { minutes: 60, label: '1 Std',  days: 30 },
    };

    /* ---------- Demo-Daten (deterministischer Zufallsgenerator) ---------- */

    // Mulberry32-PRNG: deterministisch, damit jedes Symbol stabile Demo-Daten hat
    function makeRng(seed) {
        let a = seed >>> 0;
        return function () {
            a |= 0; a = (a + 0x6D2B79F5) | 0;
            let t = Math.imul(a ^ (a >>> 15), 1 | a);
            t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
    }

    function seedFromSymbol(symbol) {
        let h = 2166136261;
        for (let i = 0; i < symbol.length; i++) {
            h ^= symbol.charCodeAt(i);
            h = Math.imul(h, 16777619);
        }
        return h >>> 0;
    }

    // Erzeugt annähernd normalverteilten Zufall (Box-Muller)
    function gauss(rng) {
        const u = Math.max(rng(), 1e-12);
        const v = rng();
        return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    }

    /**
     * Simuliert Intraday-Kerzen als Random Walk mit:
     *  - Tagestrend (Drift), der pro Tag wechselt
     *  - U-förmigem Volumenprofil (viel Volumen zur Eröffnung/zum Schluss)
     *  - erhöhter Volatilität in der ersten Handelsstunde
     * Nur Handelszeiten 09:30–16:00 (US-Kernzeit vereinfacht).
     */
    function generateDemoCandles(entry, intervalKey) {
        const iv = INTERVALS[intervalKey];
        const rng = makeRng(seedFromSymbol(entry.symbol + intervalKey));
        const candles = [];
        let price = entry.basePrice * (0.97 + rng() * 0.06);

        const now = new Date();
        const start = new Date(now);
        start.setDate(start.getDate() - iv.days);

        const day = new Date(start);
        while (day <= now) {
            const dow = day.getDay();
            if (dow !== 0 && dow !== 6) { // Wochenenden überspringen
                const drift = (rng() - 0.5) * 0.004; // Tagestrend
                const open = new Date(day); open.setHours(9, 30, 0, 0);
                const close = new Date(day); close.setHours(16, 0, 0, 0);
                const t = new Date(open);
                while (t < close && t <= now) {
                    const minutesIntoDay = (t - open) / 60000;
                    const sessionLen = (close - open) / 60000;
                    const progress = minutesIntoDay / sessionLen;
                    // U-Profil: Faktor 1.8 am Rand, 0.7 in der Mitte
                    const uShape = 0.7 + 1.1 * (4 * (progress - 0.5) ** 2);
                    const volaBoost = progress < 0.15 ? 1.6 : 1.0;

                    const sigma = entry.vola * Math.sqrt(iv.minutes) * volaBoost;
                    const ret = drift / (sessionLen / iv.minutes) + gauss(rng) * sigma;
                    const o = price;
                    const c = o * (1 + ret);
                    const wick = Math.abs(gauss(rng)) * sigma * o * 0.8;
                    const h = Math.max(o, c) + wick;
                    const l = Math.min(o, c) - Math.abs(gauss(rng)) * sigma * o * 0.8;
                    const vol = Math.round((80000 + rng() * 60000) * uShape * iv.minutes);

                    candles.push({
                        time: t.getTime(),
                        open: round2(o), high: round2(h),
                        low: round2(l), close: round2(c),
                        volume: vol,
                    });
                    price = c;
                    t.setMinutes(t.getMinutes() + iv.minutes);
                }
            }
            day.setDate(day.getDate() + 1);
        }
        return candles;
    }

    function round2(x) { return Math.round(x * 100) / 100; }

    /* ---------- Live-Daten über Twelve Data ---------- */

    async function fetchLiveCandles(symbol, intervalKey, apiKey) {
        const iv = { '1min': '1min', '5min': '5min', '15min': '15min', '1h': '1h' }[intervalKey];
        const url = `https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(symbol)}` +
            `&interval=${iv}&outputsize=500&apikey=${encodeURIComponent(apiKey)}`;
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        if (json.status === 'error') throw new Error(json.message || 'API-Fehler');
        if (!json.values) throw new Error('Keine Daten erhalten');
        // Twelve Data liefert neueste zuerst -> umdrehen
        return json.values.map(v => ({
            time: new Date(v.datetime).getTime(),
            open: parseFloat(v.open),
            high: parseFloat(v.high),
            low: parseFloat(v.low),
            close: parseFloat(v.close),
            volume: parseFloat(v.volume || 0),
        })).reverse();
    }

    /**
     * Lädt Kerzen für ein Symbol. Fällt ohne API-Key automatisch
     * auf Demo-Daten zurück.
     * @returns {Promise<{candles: Array, live: boolean}>}
     */
    async function getCandles(symbol, intervalKey, apiKey) {
        if (apiKey) {
            const candles = await fetchLiveCandles(symbol, intervalKey, apiKey);
            return { candles, live: true };
        }
        const entry = WATCHLIST.find(w => w.symbol === symbol)
            || { symbol, basePrice: 100, vola: 0.0015 };
        return { candles: generateDemoCandles(entry, intervalKey), live: false };
    }

    return { WATCHLIST, INTERVALS, getCandles };
})();
