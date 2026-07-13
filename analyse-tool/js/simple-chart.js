/*
 * Einfacher Linien-Chart für die Einsteiger-Ansicht.
 * Zeigt dieselben Kursdaten wie der Profi-Chart, aber als eine
 * leicht lesbare Preislinie mit eingefärbter Fläche.
 * Beim Bewegen der Maus erscheint eine Sprechblase in Alltagssprache.
 */

class SimpleChart {
    constructor(canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.candles = [];
        this.mouse = null;

        this.colors = {
            bg: '#11151c',
            grid: '#232a36',
            text: '#8b98ab',
            up: '#26a69a',
            down: '#ef5350',
        };

        canvas.addEventListener('mousemove', e => {
            const rect = canvas.getBoundingClientRect();
            this.mouse = { x: e.clientX - rect.left, y: e.clientY - rect.top };
            this.draw();
        });
        canvas.addEventListener('mouseleave', () => { this.mouse = null; this.draw(); });
        window.addEventListener('resize', () => this.draw());

        // Touch: Finger auf der Linie zeigt die Sprechblase –
        // senkrechtes Wischen scrollt weiterhin die Seite
        let touch = null;
        const touchPos = e => {
            const rect = canvas.getBoundingClientRect();
            this.mouse = { x: e.touches[0].clientX - rect.left, y: e.touches[0].clientY - rect.top };
            this.draw();
        };
        canvas.addEventListener('touchstart', e => {
            touch = { x: e.touches[0].clientX, y: e.touches[0].clientY, locked: false };
            touchPos(e);
        }, { passive: true });
        canvas.addEventListener('touchmove', e => {
            if (!touch) return;
            if (!touch.locked) {
                const dx = e.touches[0].clientX - touch.x;
                const dy = e.touches[0].clientY - touch.y;
                if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
                if (Math.abs(dy) > Math.abs(dx)) {
                    touch = null;
                    this.mouse = null;
                    this.draw();
                    return;
                }
                touch.locked = true;
            }
            e.preventDefault();
            touchPos(e);
        }, { passive: false });
        canvas.addEventListener('touchend', () => {
            touch = null;
            setTimeout(() => { this.mouse = null; this.draw(); }, 2000);
        }, { passive: true });
    }

    setData(candles) {
        this.candles = candles;
        this.draw();
    }

    get pad() { return { left: 12, right: 66, top: 16, bottom: 28 }; }

    draw() {
        const c = this.canvas;
        const dpr = window.devicePixelRatio || 1;
        const rect = c.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return;
        if (c.width !== Math.round(rect.width * dpr) || c.height !== Math.round(rect.height * dpr)) {
            c.width = Math.round(rect.width * dpr);
            c.height = Math.round(rect.height * dpr);
        }
        const ctx = this.ctx;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        const w = rect.width, h = rect.height;

        ctx.fillStyle = this.colors.bg;
        ctx.fillRect(0, 0, w, h);
        if (!this.candles.length) return;

        const data = this.candles;
        const pad = this.pad;
        const plotW = w - pad.left - pad.right;
        const plotH = h - pad.top - pad.bottom;

        let min = Infinity, max = -Infinity;
        for (const cd of data) {
            min = Math.min(min, cd.close);
            max = Math.max(max, cd.close);
        }
        const span = (max - min) || max * 0.01 || 1;
        min -= span * 0.08;
        max += span * 0.08;

        const xOf = i => pad.left + (i / (data.length - 1 || 1)) * plotW;
        const yOf = v => pad.top + plotH - ((v - min) / (max - min)) * plotH;

        // Steigend oder fallend über den gezeigten Zeitraum?
        const rising = data[data.length - 1].close >= data[0].close;
        const lineColor = rising ? this.colors.up : this.colors.down;

        // Horizontale Hilfslinien mit Preis-Beschriftung
        ctx.font = '11px system-ui, sans-serif';
        for (let s = 0; s <= 4; s++) {
            const v = min + (max - min) * (s / 4);
            const y = yOf(v);
            ctx.strokeStyle = this.colors.grid;
            ctx.beginPath();
            ctx.moveTo(pad.left, y);
            ctx.lineTo(w - pad.right, y);
            ctx.stroke();
            ctx.fillStyle = this.colors.text;
            ctx.textAlign = 'left';
            ctx.fillText(this._fmt(v) + ' €', w - pad.right + 6, y + 4);
        }

        // Eingefärbte Fläche unter der Linie
        const grad = ctx.createLinearGradient(0, pad.top, 0, pad.top + plotH);
        grad.addColorStop(0, rising ? 'rgba(38,166,154,0.30)' : 'rgba(239,83,80,0.30)');
        grad.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.moveTo(xOf(0), yOf(data[0].close));
        for (let i = 1; i < data.length; i++) ctx.lineTo(xOf(i), yOf(data[i].close));
        ctx.lineTo(xOf(data.length - 1), pad.top + plotH);
        ctx.lineTo(xOf(0), pad.top + plotH);
        ctx.closePath();
        ctx.fill();

        // Preislinie
        ctx.strokeStyle = lineColor;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(xOf(0), yOf(data[0].close));
        for (let i = 1; i < data.length; i++) ctx.lineTo(xOf(i), yOf(data[i].close));
        ctx.stroke();
        ctx.lineWidth = 1;

        // Punkt + Label am aktuellen Preis
        const last = data[data.length - 1];
        ctx.fillStyle = lineColor;
        ctx.beginPath();
        ctx.arc(xOf(data.length - 1), yOf(last.close), 4, 0, Math.PI * 2);
        ctx.fill();
        const ly = yOf(last.close);
        ctx.fillRect(w - pad.right + 2, ly - 10, pad.right - 4, 20);
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 11px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(this._fmt(last.close) + ' €', w - pad.right / 2, ly + 4);

        // Zeitachse: Datum an Tageswechseln (oder Uhrzeiten bei nur einem Tag)
        this._drawTimeAxis(ctx, data, xOf, h, w);

        // Sprechblase beim Zeigen mit der Maus
        if (this.mouse) this._drawHover(ctx, data, xOf, yOf, w, h);
    }

    _drawTimeAxis(ctx, data, xOf, h, w) {
        ctx.fillStyle = this.colors.text;
        ctx.font = '11px system-ui, sans-serif';
        ctx.textAlign = 'center';
        const maxLabels = Math.max(2, Math.floor((w - this.pad.left - this.pad.right) / 90));
        const step = Math.max(1, Math.round(data.length / maxLabels));
        let lastDay = null;
        for (let i = 0; i < data.length; i += step) {
            const t = new Date(data[i].time);
            const day = t.toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' });
            const label = day !== lastDay ? day
                : t.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }) + ' Uhr';
            lastDay = day;
            ctx.fillText(label, xOf(i), h - 9);
        }
    }

    _drawHover(ctx, data, xOf, yOf, w, h) {
        const { x } = this.mouse;
        if (x < this.pad.left || x > w - this.pad.right) return;
        const plotW = w - this.pad.left - this.pad.right;
        const idx = Math.round(((x - this.pad.left) / plotW) * (data.length - 1));
        const cd = data[Math.max(0, Math.min(data.length - 1, idx))];
        const px = xOf(idx), py = yOf(cd.close);

        // Senkrechte Linie + Punkt
        ctx.strokeStyle = 'rgba(180, 195, 215, 0.45)';
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(px, this.pad.top);
        ctx.lineTo(px, h - this.pad.bottom);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = '#dde5f0';
        ctx.beginPath();
        ctx.arc(px, py, 4, 0, Math.PI * 2);
        ctx.fill();

        // Sprechblase in Alltagssprache
        const t = new Date(cd.time);
        const text = `Am ${t.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' })} um ` +
            `${t.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })} Uhr: ${this._fmt(cd.close)} €`;
        ctx.font = '12px system-ui, sans-serif';
        const tw = ctx.measureText(text).width;
        let bx = px - tw / 2 - 10;
        bx = Math.max(this.pad.left, Math.min(bx, w - this.pad.right - tw - 20));
        const by = Math.max(this.pad.top, py - 44);
        ctx.fillStyle = 'rgba(17, 21, 28, 0.92)';
        ctx.strokeStyle = this.colors.grid;
        ctx.beginPath();
        ctx.roundRect(bx, by, tw + 20, 26, 6);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = '#dde5f0';
        ctx.textAlign = 'left';
        ctx.fillText(text, bx + 10, by + 17);
    }

    _fmt(v) {
        return v.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }
}
