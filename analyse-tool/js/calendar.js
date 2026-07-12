/*
 * Termin-Radar: bekannte Markttermine, an denen Day-Trading besonders
 * riskant ist. Läuft komplett offline – die Termine sind entweder
 * berechenbar (Arbeitsmarktbericht, Verfallstage, US-Feiertage) oder
 * fest hinterlegt (Fed-Sitzungen laut veröffentlichtem Kalender).
 *
 * Alle Uhrzeiten in deutscher Zeit (ca.-Angaben).
 */

const EconCalendar = (() => {

    // Fed-Zinsentscheide (zweiter Sitzungstag, Bekanntgabe ~20:00 Uhr dt. Zeit).
    // Geplante Termine laut Fed-Kalender – bei Jahreswechsel ergänzen!
    const FOMC_DATES = [
        '2026-01-28', '2026-03-18', '2026-04-29', '2026-06-17',
        '2026-07-29', '2026-09-16', '2026-10-28', '2026-12-09',
    ];

    /* ---------- Datums-Helfer ---------- */

    function nthWeekday(year, month, weekday, n) {
        const d = new Date(year, month, 1);
        let count = 0;
        while (true) {
            if (d.getDay() === weekday) {
                count++;
                if (count === n) return new Date(d);
            }
            d.setDate(d.getDate() + 1);
        }
    }

    function lastWeekday(year, month, weekday) {
        const d = new Date(year, month + 1, 0); // letzter Tag des Monats
        while (d.getDay() !== weekday) d.setDate(d.getDate() - 1);
        return d;
    }

    // Ostersonntag nach Gauß – für Karfreitag (US-Börse geschlossen)
    function easterSunday(year) {
        const a = year % 19, b = Math.floor(year / 100), c = year % 100;
        const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
        const g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
        const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7;
        const m = Math.floor((a + 11 * h + 22 * l) / 451);
        const month = Math.floor((h + l - 7 * m + 114) / 31) - 1;
        const day = ((h + l - 7 * m + 114) % 31) + 1;
        return new Date(year, month, day);
    }

    // Beobachteter Feiertag: Samstag -> Freitag davor, Sonntag -> Montag danach
    function observed(date) {
        const d = new Date(date);
        if (d.getDay() === 6) d.setDate(d.getDate() - 1);
        else if (d.getDay() === 0) d.setDate(d.getDate() + 1);
        return d;
    }

    function sameDay(a, b) { return a.toDateString() === b.toDateString(); }

    /* ---------- US-Feiertage (Börse geschlossen) ---------- */

    function usHolidays(year) {
        const goodFriday = new Date(easterSunday(year));
        goodFriday.setDate(goodFriday.getDate() - 2);
        return [
            { date: observed(new Date(year, 0, 1)), name: 'Neujahr' },
            { date: nthWeekday(year, 0, 1, 3), name: 'Martin-Luther-King-Tag' },
            { date: nthWeekday(year, 1, 1, 3), name: 'Presidents’ Day' },
            { date: goodFriday, name: 'Karfreitag' },
            { date: lastWeekday(year, 4, 1), name: 'Memorial Day' },
            { date: observed(new Date(year, 5, 19)), name: 'Juneteenth' },
            { date: observed(new Date(year, 6, 4)), name: 'Unabhängigkeitstag' },
            { date: nthWeekday(year, 8, 1, 1), name: 'Labor Day' },
            { date: nthWeekday(year, 10, 4, 4), name: 'Thanksgiving' },
            { date: observed(new Date(year, 11, 25)), name: 'Weihnachten' },
        ];
    }

    /* ---------- Ereignisse eines Tages ---------- */

    function eventsOn(date) {
        const out = [];
        const y = date.getFullYear(), m = date.getMonth();

        // US-Arbeitsmarktbericht: erster Freitag im Monat, 14:30 Uhr
        if (sameDay(date, nthWeekday(y, m, 5, 1))) {
            out.push({
                time: '14:30', impact: 3, title: 'US-Arbeitsmarktbericht (NFP)',
                advice: 'Um 14:30 Uhr herum springen die Kurse oft heftig – eine halbe Stunde vorher und nachher nicht handeln.',
            });
        }

        // Fed-Zinsentscheid (fest hinterlegte Termine)
        const iso = `${y}-${String(m + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
        if (FOMC_DATES.includes(iso)) {
            out.push({
                time: '20:00', impact: 3, title: 'Fed-Zinsentscheid (FOMC)',
                advice: 'Ab 20:00 Uhr (Bekanntgabe) und 20:30 Uhr (Pressekonferenz) ist alles möglich – der Nachmittag ist oft schon nervös.',
            });
        }

        // Verfallstag: dritter Freitag im Monat, großer Verfall im Quartalsmonat
        if (sameDay(date, nthWeekday(y, m, 5, 3))) {
            const big = [2, 5, 8, 11].includes(m);
            out.push({
                time: 'ganztags', impact: big ? 3 : 2,
                title: big ? 'Großer Verfallstag („Hexensabbat")' : 'Options-Verfallstag',
                advice: big
                    ? 'Futures und Optionen laufen gleichzeitig aus – Kurse bewegen sich oft unlogisch. Signale heute mit Vorsicht genießen.'
                    : 'Monatlicher Optionsverfall – gegen Nachmittag können die Kurse zu runden Marken hingezogen werden.',
            });
        }

        // US-Feiertage
        for (const h of usHolidays(y)) {
            if (sameDay(date, h.date)) {
                out.push({
                    time: 'ganztags', impact: 2, title: `US-Börsen geschlossen (${h.name})`,
                    advice: 'Ohne die Wall Street fehlt das Volumen – auch europäische Kurse dümpeln dann meist nur.',
                });
            }
        }

        return out;
    }

    /* ---------- Öffentliche API ---------- */

    /** Kommende Termine der nächsten `days` Tage (heute eingeschlossen) */
    function upcoming(days = 14, from = new Date()) {
        const out = [];
        const d = new Date(from);
        d.setHours(0, 0, 0, 0);
        for (let i = 0; i <= days; i++) {
            for (const ev of eventsOn(d)) {
                out.push({ ...ev, date: new Date(d), daysAway: i });
            }
            d.setDate(d.getDate() + 1);
        }
        return out;
    }

    /** Warnhinweise für heute (für Empfehlungs- und Einsteiger-Box) */
    function todayWarnings(from = new Date()) {
        return eventsOn(from).map(ev =>
            `📅 Heute${ev.time !== 'ganztags' ? ' ' + ev.time + ' Uhr' : ''}: ${ev.title}. ${ev.advice}`);
    }

    return { upcoming, todayWarnings, eventsOn };
})();
