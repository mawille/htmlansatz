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
        const cfg = Settings.get();
        const closes = candles.map(c => c.close);
        return {
            // Die Schlüssel heißen historisch ema9/ema20, enthalten aber
            // die konfigurierten Perioden (schnell/langsam)
            ema9: Indicators.ema(closes, cfg.emaFast),
            ema20: Indicators.ema(closes, cfg.emaSlow),
            rsi: Indicators.rsi(candles, cfg.rsiPeriod),
            macd: Indicators.macd(candles),
            bollinger: Indicators.bollinger(candles, cfg.bbPeriod, cfg.bbMult),
            vwap: Indicators.vwap(candles),
            atr: Indicators.atr(candles, cfg.atrPeriod),
        };
    }

    /** Alles neu rechnen und rendern, ohne Daten neu zu laden */
    function recompute() {
        if (!state.candles.length) return;
        state.ind = computeIndicators(state.candles);
        chart.setIndicatorConfig(Settings.get());
        chart.setData(state.candles, state.ind, true);
        chart.setMarkers(Recommendation.markers(state.candles, state.ind));
        renderSignals();
        renderPosition();
    }

    /* ---------- Laden & Rendern ---------- */

    async function loadSymbol(keepView = false) {
        const status = el('status');
        status.textContent = 'Lade Daten …';
        status.className = 'status';
        try {
            const { candles, live } = await DataProvider.getCandles(state.symbol, state.interval, state.apiKey);
            state.candles = candles;
            state.live = live;
            state.ind = computeIndicators(candles);
            chart.setData(candles, state.ind, keepView);
            chart.setMarkers(Recommendation.markers(candles, state.ind));
            simpleChart.setData(candles);
            status.textContent = (state.autoTimer ? '⟳ ' : '') +
                (live ? '● Live-Daten (Twelve Data)' : '● Demo-Daten (simuliert)');
            status.className = live ? 'status live' : 'status demo';
            renderHeader();
            renderSignals();
            renderPosition();
            updateWatchlistQuote(state.symbol, candles);
            checkAlerts();
        } catch (err) {
            status.textContent = 'Fehler: ' + err.message + ' – wechsle in den Demo-Modus.';
            status.className = 'status error';
            if (state.apiKey) {
                const { candles } = await DataProvider.getCandles(state.symbol, state.interval, '');
                state.candles = candles;
                state.live = false;
                state.ind = computeIndicators(candles);
                chart.setData(candles, state.ind);
                chart.setMarkers(Recommendation.markers(candles, state.ind));
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
        const result = Signals.evaluate(state.candles, state.ind, Settings.get());
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
        renderRecommendation();
        renderBacktest();
        renderSimpleView();
    }

    /* ---------- Backtest ---------- */

    function renderBacktest() {
        if (!state.candles.length || !state.ind) return;
        const cfg = Settings.get();
        const opts = {
            capital: parseFloat(el('capital').value) || 0,
            riskPct: parseFloat(el('risk').value) || 0,
            fee: parseFloat(el('bt-fee').value) || 0,
            allowShort: el('bt-short').checked,
            atrMult: cfg.atrMult,
            rr: cfg.rr,
        };
        const result = Backtest.run(state.candles, state.ind, opts);
        state.lastBacktest = result;
        const s = result.stats;

        el('bt-warning').innerHTML = state.live ? '' :
            '<p class="bt-demo-note">⚠️ Demo-Daten: Dieses Ergebnis ist nur eine Spielerei. ' +
            'Lade Live-Daten für eine echte Aussage.</p>';

        const stats = el('bt-stats');
        if (s.count === 0) {
            stats.innerHTML = '<p class="muted">Keine Trades im geladenen Zeitraum – die Strategie hat hier nie ausgelöst.</p>';
            el('bt-trades').innerHTML = '';
            Backtest.drawEquity(el('bt-equity'), [0, 0]);
            renderSimpleBacktest(result, opts);
            return;
        }
        const pf = s.profitFactor === Infinity ? '∞' : s.profitFactor.toFixed(2);
        stats.innerHTML = `
            <div class="bt-grid">
                <div class="bt-cell"><span>Ergebnis</span><strong class="${s.total >= 0 ? 'pos' : 'neg'}">${s.total >= 0 ? '+' : ''}${fmt(s.total)} € (${s.totalPct >= 0 ? '+' : ''}${fmt(s.totalPct)} %)</strong></div>
                <div class="bt-cell"><span>Trades</span><strong>${s.count} (${s.wins} ✓ / ${s.losses} ✗)</strong></div>
                <div class="bt-cell"><span>Trefferquote</span><strong>${s.winRate.toFixed(0)} %</strong></div>
                <div class="bt-cell"><span>Profitfaktor</span><strong>${pf}</strong></div>
                <div class="bt-cell"><span>Ø Gewinn / Ø Verlust</span><strong>${fmt(s.avgWin)} € / ${fmt(s.avgLoss)} €</strong></div>
                <div class="bt-cell"><span>Max. Drawdown</span><strong class="neg">−${fmt(s.maxDrawdown)} €</strong></div>
                <div class="bt-cell"><span>Bester / schlechtester Trade</span><strong>${s.best >= 0 ? '+' : ''}${fmt(s.best)} € / ${fmt(s.worst)} €</strong></div>
                <div class="bt-cell"><span>Gebühren gesamt</span><strong>−${fmt(s.fees)} €</strong></div>
            </div>`;

        Backtest.drawEquity(el('bt-equity'), result.equity);

        const table = el('bt-trades');
        const rows = result.trades.map(t => {
            const d = new Date(t.entryTime);
            return `<tr>
                <td>${d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' })} ${d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}</td>
                <td class="${t.dir === 1 ? 'pos' : 'neg'}">${t.dir === 1 ? 'Long' : 'Short'}</td>
                <td>${fmt(t.entry)} → ${fmt(t.exit)}</td>
                <td>${t.reason}</td>
                <td class="${t.pnl >= 0 ? 'pos' : 'neg'}">${t.pnl >= 0 ? '+' : ''}${fmt(t.pnl)} €</td>
            </tr>`;
        }).join('');
        table.innerHTML = `<tr><th>Einstieg</th><th>Richtung</th><th>Kurs</th><th>Ausstieg</th><th>Ergebnis</th></tr>${rows}`;

        renderSimpleBacktest(result, opts);
    }

    function renderSimpleBacktest(result, opts) {
        const s = result.stats;
        const days = Math.max(1, Math.round((state.candles[state.candles.length - 1].time - state.candles[0].time) / 86400000));
        if (s.count === 0) {
            el('s-bt-summary').textContent = 'In den letzten ' + days + ' Tagen hätte die Strategie hier gar nicht gehandelt.';
            el('s-bt-detail').textContent = 'Das ist nicht schlimm – kein Signal heißt: lieber gar kein Trade als ein schlechter.';
        } else {
            el('s-bt-summary').innerHTML =
                `Hätte man die Signale des Tools in den letzten ${days} Tagen automatisch befolgt ` +
                `(mit ${fmt(opts.capital)} € und ${opts.riskPct.toLocaleString('de-DE')} % Risiko pro Trade), ` +
                `stünden jetzt <strong class="${s.total >= 0 ? 'pos' : 'neg'}">${s.total >= 0 ? '+' : ''}${fmt(s.total)} €</strong> auf dem Zettel.`;
            el('s-bt-detail').textContent =
                `${s.count} Trades, davon ${s.wins} gewonnen und ${s.losses} verloren (Trefferquote ${s.winRate.toFixed(0)} %). ` +
                `Zwischendurch lag das Konto bis zu ${fmt(s.maxDrawdown)} € im Minus – solche Durststrecken muss man aushalten können. ` +
                (state.live ? '' : 'Achtung: Das sind simulierte Demo-Kurse, keine echten.');
        }
        Backtest.drawEquity(el('s-bt-equity'), result.equity.length > 1 ? result.equity : [0, 0]);
    }

    /* ---------- Empfehlung (Profi-Ansicht) ---------- */

    function verdictClass(action) {
        return action === 'KAUFEN' ? 'long' : action === 'VERKAUFEN' ? 'short' : 'neutral';
    }

    function timingClass(quality) {
        return quality >= 3 ? 'good' : quality === 2 ? 'ok' : quality === 1 ? 'weak' : 'closed';
    }

    function renderRecommendation() {
        if (!state.candles.length || !state.ind || !state.lastSignals) return;
        const reco = Recommendation.recommend(state.candles, state.ind, state.lastSignals);

        // Meldung, wenn die Empfehlung für dieses Symbol umschlägt
        if (!state.prevAction) state.prevAction = {};
        const prev = state.prevAction[state.symbol];
        if (prev && prev !== reco.action) {
            Alerts.notify(
                `${state.symbol}: Empfehlung jetzt ${reco.action}`,
                `Vorher ${prev} – ${reco.passed}/${reco.total} Kriterien erfüllt.`,
                reco.action === 'KAUFEN' ? 'good' : reco.action === 'VERKAUFEN' ? 'bad' : 'info');
        }
        state.prevAction[state.symbol] = reco.action;
        state.lastReco = reco;

        const actionEl = el('reco-action');
        actionEl.textContent = reco.action;
        actionEl.className = 'verdict ' + verdictClass(reco.action);
        el('reco-conf').textContent = reco.downgraded
            ? `auf ABWARTEN gestuft (${reco.passed}/${reco.total} Kriterien erfüllt)`
            : `${reco.passed}/${reco.total} Kriterien erfüllt`;

        const list = el('reco-checks');
        list.innerHTML = '';
        for (const ch of reco.checks) {
            const li = document.createElement('li');
            li.innerHTML = `<span class="dot ${ch.ok ? 'long' : 'short'}">${ch.ok ? '✓' : '✗'}</span> ${ch.text}`;
            list.appendChild(li);
        }

        const t = reco.timing;
        const econ = EconCalendar.todayWarnings();
        el('reco-timing').className = 'timing-box ' + timingClass(econ.length ? 1 : t.quality);
        el('reco-timing').innerHTML =
            `<strong>Marktphase jetzt (${new Date().toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })} Uhr): ${t.name}.</strong> ${t.text}` +
            (t.fridayWarning ? '<br>📅 Freitagnachmittag: keine neuen Positionen übers Wochenende halten.' : '') +
            econ.map(w => '<br>' + w).join('');
    }

    function renderEconCalendar() {
        const list = el('econ-list');
        const events = EconCalendar.upcoming(14);
        list.innerHTML = '';
        if (!events.length) {
            list.innerHTML = '<li class="muted">Keine besonderen Termine in den nächsten zwei Wochen. 🎉</li>';
            return;
        }
        for (const ev of events) {
            const li = document.createElement('li');
            li.className = 'impact-' + ev.impact + (ev.daysAway === 0 ? ' today' : '');
            const when = ev.daysAway === 0 ? 'Heute'
                : ev.daysAway === 1 ? 'Morgen'
                : ev.date.toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' });
            li.innerHTML = `
                <div class="econ-head">
                    <span class="econ-when">${when}${ev.time !== 'ganztags' ? ', ' + ev.time + ' Uhr' : ''}</span>
                    <strong>${ev.title}</strong>
                </div>
                <div class="econ-advice">${ev.advice}</div>`;
            list.appendChild(li);
        }
    }

    function renderTimingRules() {
        const ul = el('timing-rules');
        ul.innerHTML = '';
        for (const r of Recommendation.RULES) {
            const li = document.createElement('li');
            li.className = 'q' + r.quality;
            li.innerHTML = `<span class="rule-time">${r.time}</span> ${r.label}`;
            ul.appendChild(li);
        }
    }

    /* ---------- Einsteiger-Ansicht ---------- */

    function setView(view) {
        state.view = view;
        localStorage.setItem('view', view);
        el('view-pro-btn').classList.toggle('active', view === 'pro');
        el('view-simple-btn').classList.toggle('active', view === 'simple');
        el('view-journal-btn').classList.toggle('active', view === 'journal');
        el('pro-chart-section').classList.toggle('hidden', view !== 'pro');
        el('pro-panel').classList.toggle('hidden', view !== 'pro');
        el('simple-chart-section').classList.toggle('hidden', view !== 'simple');
        el('simple-panel').classList.toggle('hidden', view !== 'simple');
        el('journal-section').classList.toggle('hidden', view !== 'journal');
        // Die zuvor versteckten Canvas-Elemente hatten Größe 0 – neu zeichnen
        requestAnimationFrame(() => {
            if (view === 'pro') chart.draw();
            else if (view === 'simple') simpleChart.draw();
            if (state.lastBacktest && view !== 'journal') {
                const eq = state.lastBacktest.equity.length > 1 ? state.lastBacktest.equity : [0, 0];
                Backtest.drawEquity(el(view === 'pro' ? 'bt-equity' : 's-bt-equity'), eq);
            }
            if (view === 'journal') {
                prefillJournalForm();
                renderJournal();
            }
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

        renderSimpleReco();
        renderSimplePlan();
    }

    function renderSimpleReco() {
        const reco = state.lastReco
            || Recommendation.recommend(state.candles, state.ind, state.lastSignals);

        const actionEl = el('s-reco-action');
        const map = { KAUFEN: 'KAUFEN 🛒', VERKAUFEN: 'VERKAUFEN / NICHT KAUFEN ✋', ABWARTEN: 'ABWARTEN ⏳' };
        actionEl.textContent = map[reco.action];
        actionEl.className = 'verdict ' + verdictClass(reco.action);

        let text;
        if (reco.action === 'KAUFEN') {
            text = 'Die geprüften Punkte sprechen gerade dafür, dass der Preis eher steigt. ' +
                'Wer einsteigen will, findet unten im Rechner die passende Stückzahl und Notbremse.';
        } else if (reco.action === 'VERKAUFEN') {
            text = 'Die geprüften Punkte sprechen gerade dafür, dass der Preis eher fällt. ' +
                'Wer Anteile besitzt, kann über einen Verkauf nachdenken. Wer keine hat: jetzt nicht kaufen.';
        } else if (reco.downgraded) {
            text = 'Eigentlich zeigen die Anzeichen in eine Richtung – aber zu viele Prüfpunkte sprechen dagegen (siehe unten). ' +
                'In so einem Fall ist Nichtstun die klügste Entscheidung.';
        } else {
            text = 'Die Anzeichen widersprechen sich gerade – kein guter Moment für eine Entscheidung. ' +
                'Abwarten kostet nichts, ein schlechter Einstieg schon.';
        }
        el('s-reco-text').textContent = text;

        // Nur die Gegenargumente auflisten – die sind die wichtige Information
        const warn = el('s-reco-warnings');
        warn.innerHTML = '';
        for (const ch of reco.checks) {
            if (ch.ok) continue;
            const li = document.createElement('li');
            li.innerHTML = `<span class="s-icon">⚠️</span> ${ch.simple}`;
            warn.appendChild(li);
        }

        const t = reco.timing;
        const econ = EconCalendar.todayWarnings();
        el('s-reco-timing').className = 'timing-box ' + timingClass(econ.length ? 1 : t.quality);
        el('s-reco-timing').innerHTML = `<strong>Übrigens, zur Uhrzeit:</strong> ${t.simple}` +
            (t.fridayWarning ? '<br>📅 Und: Es ist Freitagnachmittag – was du jetzt kaufst, hältst du übers Wochenende. Das ist ein Extra-Risiko.' : '') +
            econ.map(w => '<br>' + w).join('');
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

        const cfgS = Settings.get();
        const plan = Signals.positionPlan('LONG', c[i].close, atrValue, capital, riskPct, cfgS.atrMult, cfgS.rr);
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
        const cfg = Settings.get();
        const direction = (state.lastVerdict || '').includes('SHORT') ? 'SHORT' : 'LONG';
        const plan = Signals.positionPlan(direction, c[i].close, atrValue, capital, riskPct, cfg.atrMult, cfg.rr);

        const de = v => v.toLocaleString('de-DE');
        el('atr-value').textContent = `ATR(${cfg.atrPeriod}): ` + fmt(atrValue);
        box.innerHTML = `
            <table class="plan">
                <tr><td>Richtung</td><td class="${direction === 'LONG' ? 'pos' : 'neg'}">${direction}</td></tr>
                <tr><td>Einstieg (letzter Kurs)</td><td>${fmt(c[i].close)}</td></tr>
                <tr><td>Stop-Loss (${de(cfg.atrMult)} × ATR)</td><td>${fmt(plan.stop)}</td></tr>
                <tr><td>Ziel 1 (${de(cfg.rr)} R)</td><td>${fmt(plan.target1)}</td></tr>
                <tr><td>Ziel 2 (${de(cfg.rr * 2)} R)</td><td>${fmt(plan.target2)}</td></tr>
                <tr><td>Risiko je Stück</td><td>${fmt(plan.riskPerShare)}</td></tr>
                <tr><td>Max. Risiko</td><td>${fmt(plan.riskAmount)} €</td></tr>
                <tr class="hl"><td>Stückzahl</td><td>${plan.shares.toLocaleString('de-DE')}</td></tr>
                <tr><td>Positionswert</td><td>${fmt(plan.positionValue)} €</td></tr>
            </table>
            ${plan.cappedByCapital ? '<p class="muted">Stückzahl durch das Kapital begrenzt (kein Hebel eingerechnet).</p>' : ''}`;
    }

    /* ---------- Indikator-Einstellungen ---------- */

    const SETTING_KEYS = ['emaFast', 'emaSlow', 'rsiPeriod', 'rsiLow', 'rsiHigh',
        'bbPeriod', 'bbMult', 'atrPeriod', 'atrMult', 'rr'];

    function fillSettingsForm() {
        const cfg = Settings.get();
        for (const k of SETTING_KEYS) el('set-' + k).value = cfg[k];
        el('ov-ema-label').textContent = `EMA ${cfg.emaFast}/${cfg.emaSlow}`;
    }

    function bindSettings() {
        for (const k of SETTING_KEYS) {
            el('set-' + k).addEventListener('change', () => {
                const patch = {};
                patch[k] = parseFloat(el('set-' + k).value);
                const cfg = Settings.set(patch);
                el('set-' + k).value = cfg[k]; // ggf. auf gültigen Bereich korrigiert
                el('set-hint').textContent = cfg.emaFast >= cfg.emaSlow
                    ? '⚠️ Der schnelle EMA sollte kürzer sein als der langsame, sonst sind die Kreuz-Signale sinnlos.'
                    : '';
                el('ov-ema-label').textContent = `EMA ${cfg.emaFast}/${cfg.emaSlow}`;
                recompute();
            });
        }
        el('set-reset').addEventListener('click', () => {
            Settings.reset();
            fillSettingsForm();
            el('set-hint').textContent = '';
            recompute();
        });
    }

    /* ---------- Kurs-Alarme & Auto-Update ---------- */

    function checkAlerts() {
        if (!state.candles.length) return;
        const price = state.candles[state.candles.length - 1].close;
        for (const a of Alerts.check(state.symbol, price)) {
            Alerts.notify(
                `🔔 Alarm: ${a.symbol}`,
                `Kurs ${a.type === 'above' ? 'über' : 'unter'} ${fmt(a.price)} € (aktuell ${fmt(price)} €).`,
                a.type === 'above' ? 'good' : 'bad');
        }
        renderAlerts();
    }

    function renderAlerts() {
        el('al-symbol').textContent = state.symbol;
        const list = el('al-list');
        const alerts = Alerts.load();
        list.innerHTML = '';
        if (!alerts.length) {
            list.innerHTML = '<li class="muted">Noch keine Alarme angelegt.</li>';
            return;
        }
        for (const a of alerts) {
            const li = document.createElement('li');
            li.className = a.triggered ? 'triggered' : '';
            li.innerHTML = `
                <span>${a.triggered ? '🔕' : '🔔'} <strong>${a.symbol}</strong>
                    ${a.type === 'above' ? 'steigt über' : 'fällt unter'} ${fmt(a.price)} €
                    ${a.triggered ? '<em>– ausgelöst</em>' : ''}</span>
                <button class="al-delete" data-id="${a.id}" title="Alarm löschen">✕</button>`;
            list.appendChild(li);
        }
    }

    function bindAlerts() {
        el('al-add').addEventListener('click', () => {
            const price = parseFloat(el('al-price').value);
            if (!(price > 0)) { el('al-price').focus(); return; }
            Alerts.requestPermission();
            Alerts.add(state.symbol, el('al-type').value, price);
            el('al-price').value = '';
            renderAlerts();
            checkAlerts(); // ggf. sofort auslösen, wenn Bedingung schon erfüllt ist
        });
        el('al-list').addEventListener('click', e => {
            const btn = e.target.closest('.al-delete');
            if (!btn) return;
            Alerts.remove(btn.dataset.id);
            renderAlerts();
        });
    }

    function setAutoRefresh(on) {
        if (state.autoTimer) { clearInterval(state.autoTimer); state.autoTimer = null; }
        if (on) {
            state.autoTimer = setInterval(() => {
                // Im Hintergrund-Tab keine API-Abfragen verschwenden
                if (!document.hidden) loadSymbol(true);
            }, 60000);
        }
        // Status-Anzeige aktualisieren
        const status = el('status');
        status.textContent = (on ? '⟳ ' : '') + status.textContent.replace(/^⟳ /, '');
    }

    /* ---------- Trading-Tagebuch ---------- */

    function prefillJournalForm() {
        // Datum/Zeit auf jetzt, Symbol und Kurs aus der aktuellen Auswahl
        const now = new Date();
        now.setSeconds(0, 0);
        const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
        el('j-time').value = local.toISOString().slice(0, 16);
        if (!el('j-symbol').value) el('j-symbol').value = state.symbol;
        if (!el('j-entry').value && state.candles.length) {
            el('j-entry').value = state.candles[state.candles.length - 1].close.toFixed(2);
        }
    }

    function journalPreview() {
        const shares = parseInt(el('j-shares').value, 10);
        const entry = parseFloat(el('j-entry').value);
        const exit = parseFloat(el('j-exit').value);
        const fees = parseFloat(el('j-fees').value) || 0;
        const dir = parseInt(el('j-dir').value, 10);
        const p = el('j-preview');
        if (shares > 0 && entry > 0 && exit > 0) {
            const pnl = (exit - entry) * dir * shares - fees;
            p.innerHTML = `Ergebnis dieses Trades: <strong class="${pnl >= 0 ? 'pos' : 'neg'}">${pnl >= 0 ? '+' : ''}${fmt(pnl)} €</strong> (nach Gebühren)`;
        } else {
            p.textContent = '';
        }
    }

    function renderJournal() {
        const trades = Journal.load();
        const s = Journal.stats(trades);

        // Bilanz
        const statsEl = el('j-stats');
        if (s.count === 0) {
            statsEl.innerHTML = '<p class="muted">Noch keine Trades erfasst. Trage links deinen ersten (echten oder Übungs-)Trade ein.</p>';
        } else {
            const pf = s.profitFactor === Infinity ? '∞' : s.profitFactor.toFixed(2);
            statsEl.innerHTML = `
                <div class="bt-grid">
                    <div class="bt-cell"><span>Gesamtergebnis</span><strong class="${s.total >= 0 ? 'pos' : 'neg'}">${s.total >= 0 ? '+' : ''}${fmt(s.total)} €</strong></div>
                    <div class="bt-cell"><span>Trades</span><strong>${s.count} (${s.wins} ✓ / ${s.losses} ✗)</strong></div>
                    <div class="bt-cell"><span>Trefferquote</span><strong>${s.winRate.toFixed(0)} %</strong></div>
                    <div class="bt-cell"><span>Profitfaktor</span><strong>${pf}</strong></div>
                    <div class="bt-cell"><span>Ø Gewinn</span><strong class="pos">+${fmt(s.avgWin)} €</strong></div>
                    <div class="bt-cell"><span>Ø Verlust</span><strong class="neg">−${fmt(s.avgLoss)} €</strong></div>
                </div>`;
        }
        Backtest.drawEquity(el('j-equity'), s.equity.length > 1 ? s.equity : [0, 0]);

        // Coaching-Hinweise
        el('j-insights').innerHTML = Journal.insights(trades)
            .map(i => `<p>${i}</p>`).join('');

        // Trade-Liste (neueste zuerst)
        const table = el('j-table');
        if (trades.length === 0) { table.innerHTML = ''; return; }
        const rows = [...trades].reverse().map(t => {
            const d = new Date(t.time);
            const pnl = Journal.pnl(t);
            return `<tr>
                <td>${d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: '2-digit' })} ${d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}</td>
                <td><strong>${t.symbol}</strong></td>
                <td class="${t.dir === 1 ? 'pos' : 'neg'}">${t.dir === 1 ? 'Long' : 'Short'}</td>
                <td>${t.shares} ×</td>
                <td>${fmt(t.entry)} → ${fmt(t.exit)}</td>
                <td class="${pnl >= 0 ? 'pos' : 'neg'}">${pnl >= 0 ? '+' : ''}${fmt(pnl)} €</td>
                <td class="j-note-cell" title="${(t.note || '').replace(/"/g, '&quot;')}">${t.note || ''}</td>
                <td><button class="j-delete" data-id="${t.id}" title="Trade löschen">✕</button></td>
            </tr>`;
        }).join('');
        table.innerHTML = '<tr><th>Zeit</th><th>Symbol</th><th>Richtung</th><th>Stück</th><th>Kurs</th><th>Ergebnis</th><th>Notiz</th><th></th></tr>' + rows;
    }

    function bindJournal() {
        el('journal-form').addEventListener('submit', e => {
            e.preventDefault();
            Journal.add({
                time: el('j-time').value,
                symbol: el('j-symbol').value.trim().toUpperCase(),
                dir: parseInt(el('j-dir').value, 10),
                shares: parseInt(el('j-shares').value, 10),
                entry: parseFloat(el('j-entry').value),
                exit: parseFloat(el('j-exit').value),
                fees: parseFloat(el('j-fees').value) || 0,
                note: el('j-note').value.trim(),
            });
            // Formular für den nächsten Trade leeren (Zeit/Symbol neu vorbelegen)
            for (const id of ['j-shares', 'j-entry', 'j-exit', 'j-note']) el(id).value = '';
            el('j-preview').textContent = '';
            prefillJournalForm();
            renderJournal();
        });

        for (const id of ['j-dir', 'j-shares', 'j-entry', 'j-exit', 'j-fees']) {
            el(id).addEventListener('input', journalPreview);
        }

        // Löschen einzelner Trades (Event-Delegation)
        el('j-table').addEventListener('click', e => {
            const btn = e.target.closest('.j-delete');
            if (!btn) return;
            Journal.remove(btn.dataset.id);
            renderJournal();
        });

        el('j-export').addEventListener('click', () => {
            const trades = Journal.load();
            if (!trades.length) return;
            const blob = new Blob(['﻿' + Journal.toCsv(trades)], { type: 'text/csv;charset=utf-8' });
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = 'trading-tagebuch.csv';
            a.click();
            URL.revokeObjectURL(a.href);
        });

        el('j-clear').addEventListener('click', () => {
            if (Journal.load().length === 0) return;
            if (confirm('Wirklich ALLE Tagebuch-Einträge unwiderruflich löschen?')) {
                Journal.clear();
                renderJournal();
            }
        });
    }

    /* ---------- Watchlist ---------- */

    function renderWatchlist() {
        const ul = el('watchlist');
        ul.innerHTML = '';
        let lastGroup = null;
        for (const entry of DataProvider.WATCHLIST) {
            if (entry.group && entry.group !== lastGroup) {
                lastGroup = entry.group;
                const header = document.createElement('li');
                header.className = 'wl-group';
                header.textContent = entry.group;
                ul.appendChild(header);
            }
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
        el('view-journal-btn').addEventListener('click', () => setView('journal'));
        bindJournal();
        bindAlerts();
        fillSettingsForm();
        bindSettings();
        chart.setIndicatorConfig(Settings.get());

        // Auto-Update (60-Sekunden-Takt)
        el('auto-refresh').addEventListener('change', e => setAutoRefresh(e.target.checked));

        // Budget/Risiko beider Ansichten synchron halten
        const syncInputs = (from, to) => el(from).addEventListener('input', () => {
            el(to).value = el(from).value;
            renderPosition();
            renderSimplePlan();
            renderBacktest();
        });
        syncInputs('s-capital', 'capital');
        syncInputs('s-risk', 'risk');

        // Backtest-Einstellungen
        el('bt-fee').addEventListener('input', renderBacktest);
        el('bt-short').addEventListener('change', renderBacktest);

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
        for (const name of ['ema', 'vwap', 'bollinger', 'markers']) {
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
            renderBacktest();
        });
        el('risk').addEventListener('input', () => {
            el('s-risk').value = el('risk').value;
            renderPosition();
            renderSimplePlan();
            renderBacktest();
        });

        // Aktualisieren-Button
        el('refresh').addEventListener('click', () => loadSymbol());

        // Klick auf die Status-Anzeige führt zur Live-Daten-Box
        el('status').addEventListener('click', () => {
            el('api-key').scrollIntoView({ behavior: 'smooth', block: 'center' });
            setTimeout(() => el('api-key').focus({ preventScroll: true }), 400);
        });
    }

    function fmt(v) {
        return v.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }

    /* ---------- Start ---------- */

    bindUi();
    setView(state.view);
    renderWatchlist();
    renderTimingRules();
    renderAlerts();
    renderEconCalendar();
    loadSymbol();

    // Die Marktphasen-Anzeige minütlich auffrischen (die Uhrzeit läuft weiter)
    setInterval(() => {
        if (state.candles.length && state.ind && state.lastSignals) {
            renderRecommendation();
            renderSimpleReco();
        }
    }, 60000);

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
