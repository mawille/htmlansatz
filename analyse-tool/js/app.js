/*
 * Hauptlogik: verbindet Watchlist, Datenversorgung, Chart,
 * Signal-Engine und Positionsgrößen-Rechner.
 */

(() => {
    const state = {
        symbol: DataProvider.WATCHLIST[0].symbol,
        interval: '5min',
        apiKey: localStorage.getItem('td_api_key') || '',
        view: localStorage.getItem('view') || 'pro', // 'pro' | 'simple'
        candles: [],
        ind: null,
        live: false,
        lastSignals: null,
        quotes: {}, // symbol -> { price, changePct } für die Watchlist
    };

    const el = id => document.getElementById(id);
    const chart = new TradingChart(el('chart'));
    const simpleChart = new SimpleChart(el('simple-chart'));

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
            simpleChart.setData(candles);
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
                simpleChart.setData(candles);
                renderHeader();
                renderSignals();
                renderPosition();
            }
        }
    }

    /** Tagesveränderung in Prozent (letzter Kurs vs. erste Kerze des Tages) */
    function dayChange(candles) {
        const last = candles[candles.length - 1];
        const today = new Date(last.time).toDateString();
        let dayOpen = last.open;
        for (const cd of candles) {
            if (new Date(cd.time).toDateString() === today) { dayOpen = cd.open; break; }
        }
        return ((last.close - dayOpen) / dayOpen) * 100;
    }

    function renderHeader() {
        const entry = DataProvider.WATCHLIST.find(w => w.symbol === state.symbol);
        el('symbol-title').textContent = state.symbol + (entry ? ' – ' + entry.name : '');
        const c = state.candles;
        if (!c.length) return;
        const last = c[c.length - 1];
        const chg = dayChange(c);
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
        state.lastSignals = result;
        renderPosition();
        renderSimpleView();
    }

    /* ---------- Einsteiger-Ansicht ---------- */

    function setView(view) {
        state.view = view;
        localStorage.setItem('view', view);
        el('view-pro-btn').classList.toggle('active', view === 'pro');
        el('view-simple-btn').classList.toggle('active', view === 'simple');
        el('pro-chart-section').classList.toggle('hidden', view !== 'pro');
        el('pro-panel').classList.toggle('hidden', view !== 'pro');
        el('simple-chart-section').classList.toggle('hidden', view !== 'simple');
        el('simple-panel').classList.toggle('hidden', view !== 'simple');
        // Der zuvor versteckte Canvas hatte Größe 0 – nach dem Einblenden neu zeichnen
        requestAnimationFrame(() => {
            if (view === 'pro') chart.draw(); else simpleChart.draw();
        });
    }

    function renderSimpleView() {
        const c = state.candles;
        if (!c.length || !state.ind || !state.lastSignals) return;
        const last = c[c.length - 1];
        const entry = DataProvider.WATCHLIST.find(w => w.symbol === state.symbol);
        el('s-symbol-title').textContent = state.symbol + (entry ? ' – ' + entry.name : '');

        // Zusammenfassung in einem Satz
        const chg = dayChange(c);
        const richtung = chg >= 0 ? 'gestiegen 📈' : 'gefallen 📉';
        const typ = entry && entry.type === 'ETF' ? 'einem Anteil dieses Aktienkorbs (ETF)' : 'einer Aktie dieser Firma';
        el('s-summary').innerHTML =
            `Ein Anteil kostet gerade <strong>${fmt(last.close)} €</strong>. ` +
            `Seit Handelsbeginn heute ist der Preis um <strong class="${chg >= 0 ? 'pos' : 'neg'}">` +
            `${fmt(Math.abs(chg))} %</strong> ${richtung} – du schaust auf den Preisverlauf von ${typ}.`;

        // Ampel
        const verdict = state.lastSignals.verdict;
        const isLong = verdict.includes('LONG');
        const isShort = verdict.includes('SHORT');
        el('light-green').classList.toggle('on', isLong);
        el('light-yellow').classList.toggle('on', !isLong && !isShort);
        el('light-red').classList.toggle('on', isShort);
        let text;
        if (verdict === 'LONG') text = 'Grün: Mehrere Anzeichen sprechen im Moment für steigende Preise.';
        else if (verdict === 'LEICHT LONG') text = 'Grün (schwach): Die Anzeichen sprechen leicht für steigende Preise – aber nicht eindeutig.';
        else if (verdict === 'SHORT') text = 'Rot: Mehrere Anzeichen sprechen im Moment für fallende Preise.';
        else if (verdict === 'LEICHT SHORT') text = 'Rot (schwach): Die Anzeichen sprechen leicht für fallende Preise – aber nicht eindeutig.';
        else text = 'Gelb: Kein klares Bild – die Anzeichen widersprechen sich gerade. Abwarten ist auch eine Entscheidung.';
        el('s-verdict-text').textContent = text;

        // Signale in Alltagssprache
        const list = el('s-signal-list');
        list.innerHTML = '';
        for (const item of state.lastSignals.items) {
            const li = document.createElement('li');
            const icon = item.dir > 0 ? '👍' : item.dir < 0 ? '👎' : '➖';
            li.innerHTML = `<span class="s-icon">${icon}</span> ${item.simple}
                <span class="s-tag" title="So heißt dieses Signal in der Fachsprache">${item.name}</span>`;
            list.appendChild(li);
        }

        renderSimplePlan();
    }

    function renderSimplePlan() {
        const c = state.candles;
        if (!c.length || !state.ind) return;
        const i = c.length - 1;
        const atrValue = state.ind.atr[i];
        const box = el('s-plan-text');
        if (atrValue === null) { box.innerHTML = '<p class="muted">Noch zu wenige Daten für eine Rechnung.</p>'; return; }

        const capital = parseFloat(el('s-capital').value) || 0;
        const riskPct = parseFloat(el('s-risk').value) || 0;
        const verdict = state.lastVerdict || '';

        if (verdict.includes('SHORT')) {
            box.innerHTML = `<p>Die Zeichen stehen gerade eher auf <strong>fallende Preise</strong>.
                Für Einsteiger heißt das meist: <strong>jetzt lieber nicht kaufen</strong> und abwarten,
                bis sich das Bild aufhellt. (Profis können auch auf fallende Kurse setzen –
                das ist aber nichts für den Anfang.)</p>`;
            return;
        }

        const plan = Signals.positionPlan('LONG', c[i].close, atrValue, capital, riskPct);
        const riskEuro = capital * (riskPct / 100);
        if (plan.shares < 1) {
            box.innerHTML = `<p>Mit diesem Budget und Risiko geht sich hier kein ganzer Anteil aus –
                ein Anteil kostet gerade <strong>${fmt(c[i].close)} €</strong>.
                Erhöhe testweise das Budget oder das Risiko, um die Rechnung zu sehen.</p>`;
            return;
        }
        box.innerHTML = `
            <p>Du hast <strong>${fmt(capital)} €</strong> und willst höchstens
               <strong>${fmt(riskEuro)} €</strong> (${riskPct.toLocaleString('de-DE')} %) verlieren. Dann gilt:</p>
            <ul class="plan-steps">
                <li>🛒 Kaufe höchstens <strong>${plan.shares.toLocaleString('de-DE')} Anteile</strong>
                    (zusammen ${fmt(plan.positionValue)} €).</li>
                <li>🛑 Setze eine Notbremse (Stop-Loss) bei <strong>${fmt(plan.stop)} €</strong>:
                    Fällt der Preis dorthin, wird automatisch verkauft und dein Verlust bleibt begrenzt.</li>
                <li>🎯 Steigt der Preis auf <strong>${fmt(plan.target1)} €</strong>, hast du mehr gewonnen,
                    als du riskiert hast – ein guter Punkt, um über Verkaufen nachzudenken.</li>
            </ul>
            ${plan.cappedByCapital ? '<p class="muted">Hinweis: Die Stückzahl ist durch dein Budget begrenzt – mehr Anteile kannst du dir ohne Kredit nicht leisten.</p>' : ''}`;
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
        // Ansicht umschalten: Profi <-> Einsteiger
        el('view-pro-btn').addEventListener('click', () => setView('pro'));
        el('view-simple-btn').addEventListener('click', () => setView('simple'));

        // Budget/Risiko beider Ansichten synchron halten
        const syncInputs = (from, to) => el(from).addEventListener('input', () => {
            el(to).value = el(from).value;
            renderPosition();
            renderSimplePlan();
        });
        syncInputs('s-capital', 'capital');
        syncInputs('s-risk', 'risk');

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

        // Rechner-Eingaben (Profi-Ansicht), in die Einsteiger-Felder spiegeln
        el('capital').addEventListener('input', () => {
            el('s-capital').value = el('capital').value;
            renderPosition();
            renderSimplePlan();
        });
        el('risk').addEventListener('input', () => {
            el('s-risk').value = el('risk').value;
            renderPosition();
            renderSimplePlan();
        });

        // Aktualisieren-Button
        el('refresh').addEventListener('click', loadSymbol);
    }

    function fmt(v) {
        return v.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }

    /* ---------- Start ---------- */

    bindUi();
    setView(state.view);
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
