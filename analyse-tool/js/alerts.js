/*
 * Kurs-Alarme: "Sag Bescheid, wenn NVDA unter 145 fällt."
 * Alarme werden lokal gespeichert (localStorage) und immer dann geprüft,
 * wenn frische Daten für das jeweilige Symbol geladen werden – am
 * nützlichsten zusammen mit dem Auto-Update.
 *
 * Dazu: ein kleines Toast-/Benachrichtigungssystem für alle Meldungen.
 */

const Alerts = (() => {

    const KEY = 'price_alerts_v1';

    /* ---------- Speicherung ---------- */

    function load() {
        try {
            const data = JSON.parse(localStorage.getItem(KEY));
            return Array.isArray(data) ? data : [];
        } catch { return []; }
    }

    function save(alerts) {
        localStorage.setItem(KEY, JSON.stringify(alerts));
    }

    function add(symbol, type, price) {
        const alerts = load();
        alerts.push({
            id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
            symbol, type, price, triggered: false,
        });
        save(alerts);
        return alerts;
    }

    function remove(id) {
        const alerts = load().filter(a => a.id !== id);
        save(alerts);
        return alerts;
    }

    /**
     * Prüft alle offenen Alarme eines Symbols gegen den aktuellen Kurs.
     * Ausgelöste Alarme werden markiert (One-Shot) und zurückgegeben.
     */
    function check(symbol, price) {
        const alerts = load();
        const fired = [];
        for (const a of alerts) {
            if (a.triggered || a.symbol !== symbol) continue;
            if ((a.type === 'above' && price >= a.price) ||
                (a.type === 'below' && price <= a.price)) {
                a.triggered = true;
                fired.push(a);
            }
        }
        if (fired.length) save(alerts);
        return fired;
    }

    /* ---------- Benachrichtigungen ---------- */

    /** Browser-Benachrichtigungen anfragen (beim ersten Alarm) */
    function requestPermission() {
        if ('Notification' in window && Notification.permission === 'default') {
            Notification.requestPermission();
        }
    }

    /**
     * Meldung anzeigen: immer als Toast unten rechts, zusätzlich als
     * Browser-Benachrichtigung, falls erlaubt (dann auch bei anderem Tab).
     */
    function notify(title, body, kind = 'info') {
        toast(`<strong>${title}</strong><br>${body}`, kind);
        if ('Notification' in window && Notification.permission === 'granted') {
            try { new Notification(title, { body }); } catch { /* z. B. ohne HTTPS */ }
        }
    }

    function toast(html, kind = 'info') {
        let container = document.getElementById('toast-container');
        if (!container) {
            container = document.createElement('div');
            container.id = 'toast-container';
            document.body.appendChild(container);
        }
        const t = document.createElement('div');
        t.className = 'toast ' + kind;
        t.innerHTML = html;
        container.appendChild(t);
        // Nach 8 Sekunden ausblenden, per Klick sofort
        const dismiss = () => { t.classList.add('gone'); setTimeout(() => t.remove(), 300); };
        t.addEventListener('click', dismiss);
        setTimeout(dismiss, 8000);
    }

    return { load, add, remove, check, requestPermission, notify, toast };
})();
