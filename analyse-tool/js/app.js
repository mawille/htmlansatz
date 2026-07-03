/*
 * Hauptlogik: verbindet Watchlist, Datenversorgung, Chart,
 * Signal-Engine und Positionsgrößen-Rechner.
 */

(() => {
    const state = {
        symbol: DataProvider.WATCHLIST[0].symbol,
        interval: '5min',
        apiKey: localStorage.getItem('td_api_key') || '',
        candles: [],
        ind: null,
        live: false,
        quotes: {}, // symbol -> { price, changePct } für die Watchlist
    };

    const el = id => document.getElementById(id);
    const chart = new TradingChart(el('chart'));

    /* ---------- Indikatoren berechnen ---------- */

    function computeIndicators(candles) {
        const closes = candles.map(c => c.close);
        return {
            ema9: Indicators.ema(closes, 9),
            ema20: Indicators.ema(closes, 20),
            rsi: Indicators.rsi(candles, 14),
            macd: Indicators.macd(candles),
            bollinger: Indicators.bollinger(candles, 20, 2),
            vwap: Indicators.vwap(candles),
            atr: Indicators.atr(candles, 14),
        };
    }

    /* ---------- Laden & Rendern ---------- */

    async function loadSymbol() {
        const status = el('status');
        status.textContent = 'Lade Daten …';
        status.className = 'status';
        try {
            const { candles, live } = await DataProvider.getCandles(state.symbol, state.interval, state.apiKey);
            state.candles = candles;
            state.live = live;
            state.ind = computeIndicators(candles);
            chart.setData(candles, state.ind);
            status.textContent = live ? '● Live-Daten (Twelve Data)' : '● Demo-Daten (simuliert)';
            status.className = live ? 'status live' : 'status demo';
            renderHeader();
            renderSignals();
            renderPosition();
            updateWatchlistQuote(state.symbol, candles);
        } catch (err) {
            status.textContent = 'Fehler: ' + err.message + ' – wechsle in den Demo-Modus.';
            status.className = 'status error';
            if (state.apiKey) {
                const { candles } = await DataProvider.getCandles(state.symbol, state.interval, '');
                state.candles = candles;
                state.live = false;
                state.ind = computeIndicators(candles);
                chart.setData(candles, state.ind);
                renderHeader();
                renderSignals();
                renderPosition();
            }
        }
    }

    function renderHeader() {
        const entry = DataProvider.WATCHLIST.find(w => w.symbol === state.symbol);
        el('symbol-title').textContent = state.symbol + (entry ? ' – ' + entry.name : '');
        const c = state.candles;
        if (!c.length) return;
        const last = c[c.length - 1];
        // Vergleich zum ersten Kurs des aktuellen Tages
        const today = new Date(last.time).toDateString();
        let dayOpen = last.open;
        for (const cd of c) {
            if (new Date(cd.time).toDateString() === today) { dayOpen = cd.open; break; }
        }
        const chg = ((last.close - dayOpen) / dayOpen) * 100;
        el('symbol-price').textContent = fmt(last.close);
        const chgEl = el('symbol-change');
        chgEl.textContent = (chg >= 0 ? '+' : '') + chg.toFixed(2) + ' % heute';
        chgEl.className = 'change ' + (chg >= 0 ? 'pos' : 'neg');
    }

    /* ---------- Signale ---------- */

    function renderSignals() {
        const result = Signals.evaluate(state.candles, state.ind);
        const verdictEl = el('verdict');
        verdictEl.textContent = result.verdict;
        verdictEl.className = 'verdict ' +
            (result.verdict.includes('LONG') ? 'long' : result.verdict.includes('SHORT') ? 'short' : 'neutral');
        el('score').textContent = 'Score: ' + (result.score >= 0 ? '+' : '') + result.score.toFixed(1);

        const list = el('signal-list');
        list.innerHTML = '';
        for (const item of result.items) {
            const li = document.createElement('li');
            const dot = document.createElement('span');
            dot.className = 'dot ' + (item.dir > 0 ? 'long' : item.dir < 0 ? 'short' : 'neutral');
            dot.textContent = item.dir > 0 ? '▲' : item.dir < 0 ? '▼' : '●';
            const strong = document.createElement('strong');
            strong.textContent = item.name + ': ';
            li.appendChild(dot);
            li.appendChild(strong);
            li.appendChild(document.createTextNode(item.text));
            list.appendChild(li);
        }
        state.lastVerdict = result.verdict;
        renderPosition();
    }

    /* ---------- Positionsgrößen-Rechner ---------- */

    function renderPosition() {
        const c = state.candles;
        if (!c.length || !state.ind) return;
        const i = c.length - 1;
        const atrValue = state.ind.atr[i];
        const box = el('position-body');
        if (atrValue === null) { box.innerHTML = '<p class="muted">Zu wenige Daten für ATR.</p>'; return; }

        const capital = parseFloat(el('capital').value) || 0;
        const riskPct = parseFloat(el('risk').value) || 0;
        const direction = (state.lastVerdict || '').includes('SHORT') ? 'SHORT' : 'LONG';
        const plan = Signals.positionPlan(direction, c[i].close, atrValue, capital, riskPct);

        el('atr-value').textContent = 'ATR(14): ' + fmt(atrValue);
        box.innerHTML = `
            <table class="plan">
                <tr><td>Richtung</td><td class="${direction === 'LONG' ? 'pos' : 'neg'}">${direction}</td></tr>
                <tr><td>Einstieg (letzter Kurs)</td><td>${fmt(c[i].close)}</td></tr>
                <tr><td>Stop-Loss (1,5 × ATR)</td><td>${fmt(plan.stop)}</td></tr>
                <tr><td>Ziel 1 (1,5 R)</td><td>${fmt(plan.target1)}</td></tr>
                <tr><td>Ziel 2 (3 R)</td><td>${fmt(plan.target2)}</td></tr>
                <tr><td>Risiko je Stück</td><td>${fmt(plan.riskPerShare)}</td></tr>
                <tr><td>Max. Risiko</td><td>${fmt(plan.riskAmount)} €</td></tr>
                <tr class="hl"><td>Stückzahl</td><td>${plan.shares.toLocaleString('de-DE')}</td></tr>
                <tr><td>Positionswert</td><td>${fmt(plan.positionValue)} €</td></tr>
            </table>
            ${plan.cappedByCapital ? '<p class="muted">Stückzahl durch das Kapital begrenzt (kein Hebel eingerechnet).</p>' : ''}`;
    }

    /* ---------- Watchlist ---------- */

    function renderWatchlist() {
        const ul = el('watchlist');
        ul.innerHTML = '';
        for (const entry of DataProvider.WATCHLIST) {
            const li = document.createElement('li');
            li.dataset.symbol = entry.symbol;
            li.className = entry.symbol === state.symbol ? 'active' : '';
            const q = state.quotes[entry.symbol];
            li.innerHTML = `
                <div class="wl-main">
                    <span class="wl-symbol">${entry.symbol}</span>
                    <span class="wl-type">${entry.type}</span>
                </div>
                <div class="wl-name">${entry.name}</div>
                <div class="wl-quote">${q ? `<span>${fmt(q.price)}</span>
                    <span class="${q.changePct >= 0 ? 'pos' : 'neg'}">${q.changePct >= 0 ? '+' : ''}${q.changePct.toFixed(2)} %</span>` : ''}
                </div>`;
            li.addEventListener('click', () => {
                state.symbol = entry.symbol;
                renderWatchlist();
                loadSymbol();
            });
            ul.appendChild(li);
        }
    }

    function updateWatchlistQuote(symbol, candles) {
        if (!candles.length) return;
        const last = candles[candles.length - 1];
        const today = new Date(last.time).toDateString();
        let dayOpen = last.open;
        for (const cd of candles) {
            if (new Date(cd.time).toDateString() === today) { dayOpen = cd.open; break; }
        }
        state.quotes[symbol] = { price: last.close, changePct: ((last.close - dayOpen) / dayOpen) * 100 };
        renderWatchlist();
    }

    /* ---------- UI-Verdrahtung ---------- */

    function bindUi() {
        // Intervall-Buttons
        document.querySelectorAll('#intervals button').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.interval === state.interval);
            btn.addEventListener('click', () => {
                state.interval = btn.dataset.interval;
                document.querySelectorAll('#intervals button').forEach(b =>
                    b.classList.toggle('active', b === btn));
                loadSymbol();
            });
        });

        // Overlay-Checkboxen
        for (const name of ['ema', 'vwap', 'bollinger']) {
            el('ov-' + name).addEventListener('change', e => chart.setOverlay(name, e.target.checked));
        }

        // Suchfeld: beliebiges Symbol laden (im Live-Modus jede Aktie/jeder ETF)
        el('symbol-form').addEventListener('submit', e => {
            e.preventDefault();
            const v = el('symbol-input').value.trim().toUpperCase();
            if (!v) return;
            state.symbol = v;
            renderWatchlist();
            loadSymbol();
        });

        // API-Key
        el('api-key').value = state.apiKey;
        el('api-key-save').addEventListener('click', () => {
            state.apiKey = el('api-key').value.trim();
            localStorage.setItem('td_api_key', state.apiKey);
            loadSymbol();
        });

        // Rechner-Eingaben
        el('capital').addEventListener('input', renderPosition);
        el('risk').addEventListener('input', renderPosition);

        // Aktualisieren-Button
        el('refresh').addEventListener('click', loadSymbol);
    }

    function fmt(v) {
        return v.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }

    /* ---------- Start ---------- */

    bindUi();
    renderWatchlist();
    loadSymbol();

    // Demo-Daten aller Watchlist-Symbole im Hintergrund für die Kursanzeige laden
    (async () => {
        for (const entry of DataProvider.WATCHLIST) {
            if (entry.symbol === state.symbol) continue;
            try {
                const { candles } = await DataProvider.getCandles(entry.symbol, state.interval, '');
                updateWatchlistQuote(entry.symbol, candles);
            } catch { /* Kursanzeige ist optional */ }
        }
    })();
})();
