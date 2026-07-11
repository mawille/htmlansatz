/*
 * Empfehlungs-Engine: verdichtet Signal-Score, Trend, Volatilität,
 * Volumen und Uhrzeit zu einer konkreten Handlungsempfehlung
 * (KAUFEN / VERKAUFEN / ABWARTEN) mit nachvollziehbarer Begründung.
 *
 * Dazu: Handelszeiten-Heuristiken – bewertet, wie gut die aktuelle
 * Uhrzeit (deutsche Zeit) zum Day-Trading geeignet ist.
 *
 * WICHTIG: Alles hier sind vereinfachte Faustregeln, keine Anlageberatung.
 */

const Recommendation = (() => {

    /* ---------- Handelszeiten (deutsche Uhrzeit) ---------- */

    // quality: 3 = gut, 2 = brauchbar, 1 = eher meiden, 0 = Börse zu
    const PHASES = [
        { from: 0, to: 480, quality: 0, name: 'Börse geschlossen',
          text: 'Xetra und US-Börsen sind zu. Kurse außerhalb der Handelszeiten sind dünn und wenig aussagekräftig.',
          simple: 'Die Börse hat gerade zu – jetzt kannst du in Ruhe schauen und lernen, aber nicht sinnvoll handeln.' },
        { from: 480, to: 540, quality: 1, name: 'Vorbörse',
          text: 'Vorbörslicher Handel: wenig Volumen, breite Spreads. Nur zur Orientierung nutzen.',
          simple: 'Der richtige Handel hat noch nicht begonnen. Die Preise können jetzt stark springen – lieber noch warten.' },
        { from: 540, to: 555, quality: 1, name: 'Xetra-Eröffnung',
          text: 'Erste Viertelstunde nach Eröffnung: chaotische Kursfindung, hohe Spreads. Klassische Anfängerfalle.',
          simple: 'Die Börse hat gerade erst geöffnet. Die ersten 15 Minuten sind sehr hektisch – Profis schauen da oft nur zu.' },
        { from: 555, to: 690, quality: 3, name: 'DE-Vormittag',
          text: 'Gute Phase für deutsche Aktien und ETFs: ordentliches Volumen, Tagestrend bildet sich aus.',
          simple: 'Gute Zeit für deutsche Aktien und ETFs: Es wird viel gehandelt und die Richtung des Tages wird sichtbar.' },
        { from: 690, to: 930, quality: 1, name: 'Mittagsflaute',
          text: 'Typisch niedriges Volumen, richtungslose Kurse. Statistisch die schwächste Phase des Tages.',
          simple: 'Über die Mittagszeit passiert an der Börse meist wenig. Viele falsche Signale – eher Pause machen.' },
        { from: 930, to: 945, quality: 2, name: 'US-Eröffnung',
          text: 'Wall-Street-Eröffnung: extreme Volatilität. Große Chancen, aber die ersten 15 Minuten nur mit Erfahrung handeln.',
          simple: 'Die US-Börse öffnet gerade – die Preise schwanken jetzt sehr stark. Für den Anfang: erst mal nur zuschauen.' },
        { from: 945, to: 1050, quality: 3, name: 'Beste Phase',
          text: 'EU- und US-Markt parallel offen: höchste Liquidität des Tages, saubere Trends. Statistisch beste Day-Trading-Zeit.',
          simple: 'Jetzt sind Europa und die USA gleichzeitig aktiv – die beste Zeit des Tages: viel Handel, verlässlichere Bewegungen.' },
        { from: 1050, to: 1200, quality: 2, name: 'US-Handel',
          text: 'EU-Börsen geschlossen, US-Markt läuft normal. Für US-Aktien und -ETFs weiterhin brauchbar.',
          simple: 'Die deutschen Börsen haben zu, in den USA läuft der Handel normal weiter – US-Werte gehen noch gut.' },
        { from: 1200, to: 1320, quality: 2, name: 'US-Schlussphase',
          text: 'Letzte Handelsstunden der Wall Street: Volumen zieht wieder an, Bewegungen können abrupt drehen.',
          simple: 'Kurz vor US-Börsenschluss wird es noch einmal lebhaft – aber die Richtung kann schnell wechseln.' },
        { from: 1320, to: 1440, quality: 0, name: 'Börse geschlossen',
          text: 'US-Börsen haben geschlossen. Bis zur Vorbörse passiert wenig Verwertbares.',
          simple: 'Die Börse hat Feierabend – morgen geht es weiter.' },
    ];

    // Faustregeln zum Timing, für die statische Anzeige
    const RULES = [
        { time: '09:00–09:15', label: 'Xetra-Eröffnung', quality: 1 },
        { time: '09:15–11:30', label: 'DE-Vormittag – gute Phase', quality: 3 },
        { time: '11:30–15:30', label: 'Mittagsflaute – eher meiden', quality: 1 },
        { time: '15:30–15:45', label: 'US-Eröffnung – nur für Erfahrene', quality: 2 },
        { time: '15:45–17:30', label: 'Beste Phase (EU + US offen)', quality: 3 },
        { time: '17:30–20:00', label: 'Nur US-Markt – brauchbar', quality: 2 },
        { time: '20:00–22:00', label: 'US-Schluss – lebhaft, aber launisch', quality: 2 },
    ];

    function timingInfo(date = new Date()) {
        const dow = date.getDay();
        if (dow === 0 || dow === 6) {
            return { quality: 0, name: 'Wochenende',
                text: 'Die Börsen sind am Wochenende geschlossen.',
                simple: 'Am Wochenende ist die Börse zu – gute Gelegenheit zum Lernen statt Handeln.',
                fridayWarning: false };
        }
        const m = date.getHours() * 60 + date.getMinutes();
        const phase = PHASES.find(p => m >= p.from && m < p.to) || PHASES[0];
        // Freitags spätnachmittags: Positionen übers Wochenende vermeiden
        const fridayWarning = dow === 5 && m >= 945 && phase.quality > 0;
        return { ...phase, fridayWarning };
    }

    /* ---------- Empfehlung ---------- */

    /**
     * @param {Array} candles Kerzen
     * @param {Object} ind vorberechnete Indikatoren
     * @param {Object} sig Ergebnis von Signals.evaluate()
     * @returns {{ action, checks, passed, total, timing, downgraded }}
     */
    function recommend(candles, ind, sig, date = new Date()) {
        const i = candles.length - 1;
        const c = candles[i];
        const timing = timingInfo(date);
        const checks = [];
        const add = (ok, text, simple) => checks.push({ ok, text, simple });

        // Rohrichtung aus dem Signal-Score
        let action = 'ABWARTEN';
        if (sig.score >= 2.5) action = 'KAUFEN';
        else if (sig.score <= -2.5) action = 'VERKAUFEN';
        const dir = action === 'KAUFEN' ? 1 : action === 'VERKAUFEN' ? -1 : 0;

        // 1) Signallage: wie eindeutig sind die Indikatoren?
        add(Math.abs(sig.score) >= 2.5,
            `Signallage: Score ${sig.score >= 0 ? '+' : ''}${sig.score.toFixed(1)} ` +
                (Math.abs(sig.score) >= 2.5 ? '– eindeutig' : '– nicht eindeutig genug'),
            Math.abs(sig.score) >= 2.5
                ? 'Die Anzeichen zeigen klar in eine Richtung.'
                : 'Die Anzeichen widersprechen sich noch – kein klares Bild.');

        // 2) Trendfilter: EMA-20-Steigung über die letzten 5 Kerzen
        const e20 = ind.ema20[i], e20old = ind.ema20[i - 5];
        if (e20 !== null && e20old !== null && e20old !== undefined) {
            const slope = e20 - e20old;
            const aligned = dir === 0 ? Math.abs(slope) < e20 * 0.0005
                : (dir === 1 ? slope > 0 : slope < 0);
            add(aligned,
                aligned ? 'Trendfilter: Bewegung läuft mit dem übergeordneten Trend'
                        : 'Trendfilter: Signal läuft gegen den übergeordneten Trend',
                aligned ? 'Die Empfehlung passt zur größeren Richtung des Kurses – das erhöht die Trefferquote.'
                        : 'Vorsicht: Das Signal läuft gegen die größere Richtung des Kurses. Gegen den Strom schwimmen geht oft schief.');
        }

        // 3) Volatilität: Ist genug (aber nicht zu viel) Bewegung im Markt?
        const atrValue = ind.atr[i];
        if (atrValue !== null) {
            const atrPct = (atrValue / c.close) * 100;
            const okVola = atrPct >= 0.05 && atrPct <= 2.5;
            add(okVola,
                `Volatilität: ATR ${atrPct.toFixed(2)} % vom Kurs ` +
                    (atrPct < 0.05 ? '– zu wenig Bewegung' : atrPct > 2.5 ? '– extrem nervöser Markt' : '– im gesunden Bereich'),
                atrPct < 0.05 ? 'Der Kurs bewegt sich kaum – da lässt sich wenig verdienen, aber Gebühren fallen trotzdem an.'
                    : atrPct > 2.5 ? 'Der Kurs schwankt gerade extrem stark – das Verlustrisiko ist ungewöhnlich hoch.'
                    : 'Der Kurs bewegt sich genug, um Chancen zu bieten, ohne völlig verrückt zu spielen.');
        }

        // 4) Volumen: Ist überhaupt Handel im Markt?
        let volAvg = 0, n = 0;
        for (let j = Math.max(0, i - 20); j < i; j++) { volAvg += candles[j].volume; n++; }
        volAvg = n ? volAvg / n : 0;
        if (volAvg > 0) {
            const volOk = c.volume >= 0.8 * volAvg;
            add(volOk,
                volOk ? 'Volumen: normale bis erhöhte Handelsaktivität'
                      : 'Volumen: unterdurchschnittlich – Signale wenig belastbar',
                volOk ? 'Es wird gerade normal viel gehandelt – die Preise sind aussagekräftig.'
                      : 'Es wird gerade wenig gehandelt – die Preisbewegungen sind weniger verlässlich.');
        }

        // 5) Uhrzeit: Handelsphasen-Heuristik
        add(timing.quality >= 2,
            `Handelszeit: ${timing.name} ` + (timing.quality >= 3 ? '– gute Phase' : timing.quality === 2 ? '– brauchbare Phase' : timing.quality === 1 ? '– schwache Phase' : '– Börse geschlossen'),
            timing.simple);

        // Auswertung: Zu viele Gegenargumente => auf ABWARTEN herabstufen
        const passed = checks.filter(ch => ch.ok).length;
        const failed = checks.length - passed;
        let downgraded = false;
        if (dir !== 0 && (failed >= 2 || timing.quality === 0)) {
            action = 'ABWARTEN';
            downgraded = true;
        }

        return { action, checks, passed, total: checks.length, timing, downgraded, score: sig.score };
    }

    /* ---------- Kauf-/Verkaufs-Markierungen für den Chart ---------- */

    /**
     * Historische Signalpunkte: EMA-9/20-Kreuz, bestätigt durch die
     * Lage zum VWAP. Zeigt, wo die Strategie in der Vergangenheit
     * ein- bzw. ausgestiegen wäre.
     * @returns {Array<{index:number, type:'buy'|'sell'}>}
     */
    function markers(candles, ind) {
        const out = [];
        for (let i = 1; i < candles.length; i++) {
            const e9 = ind.ema9[i], e20 = ind.ema20[i];
            const e9p = ind.ema9[i - 1], e20p = ind.ema20[i - 1];
            const vw = ind.vwap[i];
            if (e9 === null || e20 === null || e9p === null || e20p === null || vw === null) continue;
            if (e9p <= e20p && e9 > e20 && candles[i].close > vw) out.push({ index: i, type: 'buy' });
            else if (e9p >= e20p && e9 < e20 && candles[i].close < vw) out.push({ index: i, type: 'sell' });
        }
        return out;
    }

    return { recommend, timingInfo, markers, RULES };
})();
