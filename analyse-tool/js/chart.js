/*
 * Canvas-basierter Candlestick-Chart mit Volumen, Indikator-Overlays
 * (EMA 9/20, VWAP, Bollinger) sowie RSI- und MACD-Unterfenstern.
 * Bedienung: Mausrad = Zoom, Ziehen = Verschieben, Bewegen = Fadenkreuz.
 */

class TradingChart {
    constructor(canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.candles = [];
        this.ind = null;
        this.overlays = { ema: true, vwap: true, bollinger: true };

        // Sichtfenster (Indizes in this.candles)
        this.viewStart = 0;
        this.viewEnd = 0;

        this.mouse = null;      // { x, y } in CSS-Pixeln
        this.dragging = false;
        this.dragStartX = 0;
        this.dragStartView = 0;

        this.colors = {
            bg: '#11151c',
            grid: '#232a36',
            text: '#8b98ab',
            up: '#26a69a',
            down: '#ef5350',
            ema9: '#f5c542',
            ema20: '#42a5f5',
            vwap: '#e040fb',
            bollinger: 'rgba(120, 144, 180, 0.55)',
            bollingerFill: 'rgba(120, 144, 180, 0.07)',
            volume: 'rgba(110, 130, 160, 0.35)',
            rsi: '#ce93d8',
            macd: '#42a5f5',
            macdSignal: '#ffa726',
            crosshair: 'rgba(180, 195, 215, 0.45)',
        };

        this._bindEvents();
    }

    setData(candles, indicators) {
        this.candles = candles;
        this.ind = indicators;
        const visible = Math.min(150, candles.length);
        this.viewEnd = candles.length;
        this.viewStart = candles.length - visible;
        this.draw();
    }

    setOverlay(name, on) {
        this.overlays[name] = on;
        this.draw();
    }

    /* ---------- Events ---------- */

    _bindEvents() {
        const c = this.canvas;
        c.addEventListener('wheel', e => {
            e.preventDefault();
            const span = this.viewEnd - this.viewStart;
            const zoom = e.deltaY > 0 ? 1.15 : 1 / 1.15;
            const newSpan = Math.max(20, Math.min(this.candles.length, Math.round(span * zoom)));
            // Um den Mauspunkt herum zoomen
            const rect = c.getBoundingClientRect();
            const frac = (e.clientX - rect.left - this.pad.left) /
                Math.max(1, rect.width - this.pad.left - this.pad.right);
            const anchor = this.viewStart + span * Math.min(Math.max(frac, 0), 1);
            let start = Math.round(anchor - newSpan * Math.min(Math.max(frac, 0), 1));
            start = Math.max(0, Math.min(start, this.candles.length - newSpan));
            this.viewStart = start;
            this.viewEnd = start + newSpan;
            this.draw();
        }, { passive: false });

        c.addEventListener('mousedown', e => {
            this.dragging = true;
            this.dragStartX = e.clientX;
            this.dragStartView = this.viewStart;
        });
        window.addEventListener('mouseup', () => { this.dragging = false; });
        c.addEventListener('mousemove', e => {
            const rect = c.getBoundingClientRect();
            this.mouse = { x: e.clientX - rect.left, y: e.clientY - rect.top };
            if (this.dragging) {
                const span = this.viewEnd - this.viewStart;
                const pxPerCandle = (rect.width - this.pad.left - this.pad.right) / span;
                const shift = Math.round((this.dragStartX - e.clientX) / pxPerCandle);
                let start = Math.max(0, Math.min(this.dragStartView + shift, this.candles.length - span));
                this.viewStart = start;
                this.viewEnd = start + span;
            }
            this.draw();
        });
        c.addEventListener('mouseleave', () => { this.mouse = null; this.draw(); });
        window.addEventListener('resize', () => this.draw());
    }

    /* ---------- Layout ---------- */

    get pad() { return { left: 10, right: 64, top: 8, bottom: 22 }; }

    _layout(w, h) {
        // Preis 62 %, RSI 15 %, MACD 15 %, Rest Zeitachse
        const usable = h - this.pad.top - this.pad.bottom;
        const priceH = usable * 0.62;
        const rsiH = usable * 0.16;
        const macdH = usable * 0.16;
        const gap = usable * 0.03;
        let y = this.pad.top;
        const price = { y, h: priceH }; y += priceH + gap;
        const rsi = { y, h: rsiH }; y += rsiH + gap;
        const macd = { y, h: macdH };
        return { price, rsi, macd };
    }

    /* ---------- Zeichnen ---------- */

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
        if (!this.candles.length) {
            ctx.fillStyle = this.colors.text;
            ctx.font = '14px system-ui, sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText('Keine Daten', w / 2, h / 2);
            return;
        }

        const view = this.candles.slice(this.viewStart, this.viewEnd);
        const panels = this._layout(w, h);
        const plotW = w - this.pad.left - this.pad.right;
        const xOf = i => this.pad.left + ((i - this.viewStart) + 0.5) * (plotW / view.length);
        const candleW = Math.max(1, Math.min(14, (plotW / view.length) * 0.7));

        this._drawPricePanel(ctx, view, panels.price, plotW, xOf, candleW, w);
        this._drawRsiPanel(ctx, panels.rsi, xOf, w);
        this._drawMacdPanel(ctx, panels.macd, xOf, candleW, w);
        this._drawTimeAxis(ctx, view, xOf, h, w);
        if (this.mouse) this._drawCrosshair(ctx, view, panels, xOf, w, h);
    }

    _niceRange(min, max) {
        const padVal = (max - min) * 0.06 || max * 0.01 || 1;
        return { min: min - padVal, max: max + padVal };
    }

    _drawPricePanel(ctx, view, panel, plotW, xOf, candleW, w) {
        let min = Infinity, max = -Infinity, volMax = 0;
        for (const cd of view) {
            min = Math.min(min, cd.low);
            max = Math.max(max, cd.high);
            volMax = Math.max(volMax, cd.volume);
        }
        // Bollinger in den sichtbaren Bereich einbeziehen
        if (this.overlays.bollinger && this.ind) {
            for (let i = this.viewStart; i < this.viewEnd; i++) {
                if (this.ind.bollinger.upper[i] !== null) {
                    max = Math.max(max, this.ind.bollinger.upper[i]);
                    min = Math.min(min, this.ind.bollinger.lower[i]);
                }
            }
        }
        const r = this._niceRange(min, max);
        this.priceScale = { panel, ...r };
        const yOf = v => panel.y + panel.h - ((v - r.min) / (r.max - r.min)) * panel.h;
        this.priceYOf = yOf;

        this._drawGridY(ctx, panel, r, w, v => this._fmtPrice(v));

        // Volumen unten im Preispanel (max. 18 % der Höhe)
        const volH = panel.h * 0.18;
        for (let i = 0; i < view.length; i++) {
            const cd = view[i];
            const vh = (cd.volume / volMax) * volH;
            ctx.fillStyle = this.colors.volume;
            ctx.fillRect(xOf(this.viewStart + i) - candleW / 2, panel.y + panel.h - vh, candleW, vh);
        }

        // Bollinger-Fläche
        if (this.overlays.bollinger && this.ind) {
            this._fillBand(ctx, xOf, yOf, this.ind.bollinger.upper, this.ind.bollinger.lower, this.colors.bollingerFill);
            this._drawLine(ctx, xOf, yOf, this.ind.bollinger.upper, this.colors.bollinger, 1);
            this._drawLine(ctx, xOf, yOf, this.ind.bollinger.lower, this.colors.bollinger, 1);
        }

        // Kerzen
        for (let i = 0; i < view.length; i++) {
            const cd = view[i];
            const x = xOf(this.viewStart + i);
            const up = cd.close >= cd.open;
            ctx.strokeStyle = ctx.fillStyle = up ? this.colors.up : this.colors.down;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(x, yOf(cd.high));
            ctx.lineTo(x, yOf(cd.low));
            ctx.stroke();
            const yO = yOf(cd.open), yC = yOf(cd.close);
            const bodyY = Math.min(yO, yC);
            const bodyH = Math.max(1, Math.abs(yC - yO));
            ctx.fillRect(x - candleW / 2, bodyY, candleW, bodyH);
        }

        // Overlays
        if (this.ind) {
            if (this.overlays.ema) {
                this._drawLine(ctx, xOf, yOf, this.ind.ema9, this.colors.ema9, 1.4);
                this._drawLine(ctx, xOf, yOf, this.ind.ema20, this.colors.ema20, 1.4);
            }
            if (this.overlays.vwap) {
                this._drawLine(ctx, xOf, yOf, this.ind.vwap, this.colors.vwap, 1.4, [5, 4]);
            }
        }

        // Letzter Kurs als Marker an der Preisachse
        const last = this.candles[this.candles.length - 1];
        if (last && this.viewEnd === this.candles.length) {
            const y = yOf(last.close);
            const up = last.close >= last.open;
            ctx.fillStyle = up ? this.colors.up : this.colors.down;
            ctx.fillRect(w - this.pad.right + 2, y - 9, this.pad.right - 4, 18);
            ctx.fillStyle = '#fff';
            ctx.font = 'bold 11px system-ui, sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText(this._fmtPrice(last.close), w - this.pad.right / 2, y + 4);
        }
    }

    _drawRsiPanel(ctx, panel, xOf, w) {
        this._panelFrame(ctx, panel, w, 'RSI (14)');
        const yOf = v => panel.y + panel.h - (v / 100) * panel.h;
        // 30/70-Zonen
        ctx.fillStyle = 'rgba(206, 147, 216, 0.07)';
        ctx.fillRect(this.pad.left, yOf(70), w - this.pad.left - this.pad.right, yOf(30) - yOf(70));
        for (const lvl of [30, 50, 70]) {
            ctx.strokeStyle = this.colors.grid;
            ctx.setLineDash([3, 3]);
            ctx.beginPath();
            ctx.moveTo(this.pad.left, yOf(lvl));
            ctx.lineTo(w - this.pad.right, yOf(lvl));
            ctx.stroke();
            ctx.setLineDash([]);
            ctx.fillStyle = this.colors.text;
            ctx.font = '10px system-ui, sans-serif';
            ctx.textAlign = 'left';
            ctx.fillText(String(lvl), w - this.pad.right + 4, yOf(lvl) + 3);
        }
        if (this.ind) this._drawLine(ctx, xOf, yOf, this.ind.rsi, this.colors.rsi, 1.3);
        this.rsiScale = { panel, min: 0, max: 100 };
    }

    _drawMacdPanel(ctx, panel, xOf, candleW, w) {
        this._panelFrame(ctx, panel, w, 'MACD (12, 26, 9)');
        if (!this.ind) return;
        const { macd, signal, histogram } = this.ind.macd;
        let ext = 0;
        for (let i = this.viewStart; i < this.viewEnd; i++) {
            for (const arr of [macd, signal, histogram]) {
                if (arr[i] !== null) ext = Math.max(ext, Math.abs(arr[i]));
            }
        }
        if (ext === 0) ext = 1;
        const yOf = v => panel.y + panel.h / 2 - (v / ext) * (panel.h / 2) * 0.9;

        // Nulllinie
        ctx.strokeStyle = this.colors.grid;
        ctx.beginPath();
        ctx.moveTo(this.pad.left, yOf(0));
        ctx.lineTo(w - this.pad.right, yOf(0));
        ctx.stroke();

        // Histogramm
        for (let i = this.viewStart; i < this.viewEnd; i++) {
            if (histogram[i] === null) continue;
            const x = xOf(i);
            ctx.fillStyle = histogram[i] >= 0 ? 'rgba(38,166,154,0.55)' : 'rgba(239,83,80,0.55)';
            const y0 = yOf(0), y1 = yOf(histogram[i]);
            ctx.fillRect(x - candleW / 2, Math.min(y0, y1), candleW, Math.max(1, Math.abs(y1 - y0)));
        }
        this._drawLine(ctx, xOf, yOf, macd, this.colors.macd, 1.2);
        this._drawLine(ctx, xOf, yOf, signal, this.colors.macdSignal, 1.2);
        this.macdScale = { panel, ext };
    }

    _drawTimeAxis(ctx, view, xOf, h, w) {
        ctx.fillStyle = this.colors.text;
        ctx.font = '10px system-ui, sans-serif';
        ctx.textAlign = 'center';
        const step = Math.max(1, Math.round(view.length / Math.max(2, Math.floor(w / 110))));
        let lastDay = null;
        for (let i = 0; i < view.length; i += step) {
            const t = new Date(view[i].time);
            const day = t.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' });
            const label = day !== lastDay
                ? `${day} ${t.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}`
                : t.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
            lastDay = day;
            ctx.fillText(label, xOf(this.viewStart + i), h - 7);
        }
    }

    _drawCrosshair(ctx, view, panels, xOf, w, h) {
        const { x, y } = this.mouse;
        if (x < this.pad.left || x > w - this.pad.right) return;
        const plotW = w - this.pad.left - this.pad.right;
        const idx = Math.min(view.length - 1,
            Math.max(0, Math.floor((x - this.pad.left) / (plotW / view.length))));
        const cd = view[idx];
        const cx = xOf(this.viewStart + idx);

        ctx.strokeStyle = this.colors.crosshair;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(cx, this.pad.top);
        ctx.lineTo(cx, h - this.pad.bottom);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(this.pad.left, y);
        ctx.lineTo(w - this.pad.right, y);
        ctx.stroke();
        ctx.setLineDash([]);

        // Preislabel am rechten Rand (nur im Preispanel)
        const ps = this.priceScale;
        if (ps && y >= ps.panel.y && y <= ps.panel.y + ps.panel.h) {
            const price = ps.max - ((y - ps.panel.y) / ps.panel.h) * (ps.max - ps.min);
            ctx.fillStyle = '#2c3547';
            ctx.fillRect(w - this.pad.right + 2, y - 9, this.pad.right - 4, 18);
            ctx.fillStyle = '#dde5f0';
            ctx.font = '11px system-ui, sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText(this._fmtPrice(price), w - this.pad.right / 2, y + 4);
        }

        // Info-Box (OHLCV) oben links
        const gi = this.viewStart + idx;
        const t = new Date(cd.time);
        const chg = ((cd.close - cd.open) / cd.open) * 100;
        const lines = [
            t.toLocaleDateString('de-DE') + ' ' + t.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }),
            `O ${this._fmtPrice(cd.open)}  H ${this._fmtPrice(cd.high)}  L ${this._fmtPrice(cd.low)}  C ${this._fmtPrice(cd.close)} (${chg >= 0 ? '+' : ''}${chg.toFixed(2)} %)`,
            `Vol ${this._fmtVol(cd.volume)}` +
                (this.ind && this.ind.rsi[gi] !== null ? `   RSI ${this.ind.rsi[gi].toFixed(1)}` : '') +
                (this.ind && this.ind.vwap[gi] !== null ? `   VWAP ${this._fmtPrice(this.ind.vwap[gi])}` : ''),
        ];
        ctx.font = '11px system-ui, sans-serif';
        let boxW = 0;
        for (const l of lines) boxW = Math.max(boxW, ctx.measureText(l).width);
        ctx.fillStyle = 'rgba(17, 21, 28, 0.88)';
        ctx.strokeStyle = this.colors.grid;
        const bx = this.pad.left + 6, by = this.pad.top + 6;
        ctx.fillRect(bx, by, boxW + 16, lines.length * 16 + 10);
        ctx.strokeRect(bx, by, boxW + 16, lines.length * 16 + 10);
        ctx.fillStyle = '#dde5f0';
        ctx.textAlign = 'left';
        lines.forEach((l, n) => ctx.fillText(l, bx + 8, by + 18 + n * 16));
    }

    /* ---------- Hilfsfunktionen ---------- */

    _panelFrame(ctx, panel, w, title) {
        ctx.strokeStyle = this.colors.grid;
        ctx.strokeRect(this.pad.left, panel.y, w - this.pad.left - this.pad.right, panel.h);
        ctx.fillStyle = this.colors.text;
        ctx.font = 'bold 10px system-ui, sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText(title, this.pad.left + 5, panel.y + 12);
    }

    _drawGridY(ctx, panel, range, w, fmt) {
        const steps = 5;
        ctx.font = '10px system-ui, sans-serif';
        for (let s = 0; s <= steps; s++) {
            const v = range.min + (range.max - range.min) * (s / steps);
            const y = panel.y + panel.h - (s / steps) * panel.h;
            ctx.strokeStyle = this.colors.grid;
            ctx.beginPath();
            ctx.moveTo(this.pad.left, y);
            ctx.lineTo(w - this.pad.right, y);
            ctx.stroke();
            ctx.fillStyle = this.colors.text;
            ctx.textAlign = 'left';
            ctx.fillText(fmt(v), w - this.pad.right + 4, y + 3);
        }
    }

    _drawLine(ctx, xOf, yOf, values, color, width, dash) {
        ctx.strokeStyle = color;
        ctx.lineWidth = width;
        if (dash) ctx.setLineDash(dash);
        ctx.beginPath();
        let started = false;
        for (let i = this.viewStart; i < this.viewEnd; i++) {
            if (values[i] === null || values[i] === undefined) { started = false; continue; }
            const x = xOf(i), y = yOf(values[i]);
            if (!started) { ctx.moveTo(x, y); started = true; }
            else ctx.lineTo(x, y);
        }
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.lineWidth = 1;
    }

    _fillBand(ctx, xOf, yOf, upper, lower, color) {
        ctx.fillStyle = color;
        ctx.beginPath();
        let started = false;
        for (let i = this.viewStart; i < this.viewEnd; i++) {
            if (upper[i] === null) continue;
            const x = xOf(i), y = yOf(upper[i]);
            if (!started) { ctx.moveTo(x, y); started = true; }
            else ctx.lineTo(x, y);
        }
        for (let i = this.viewEnd - 1; i >= this.viewStart; i--) {
            if (lower[i] === null) continue;
            ctx.lineTo(xOf(i), yOf(lower[i]));
        }
        ctx.closePath();
        ctx.fill();
    }

    _fmtPrice(v) {
        return v.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }

    _fmtVol(v) {
        if (v >= 1e6) return (v / 1e6).toFixed(2) + ' M';
        if (v >= 1e3) return (v / 1e3).toFixed(1) + ' K';
        return String(v);
    }
}
