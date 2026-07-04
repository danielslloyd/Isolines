/**
 * Fortress — core constants and shared helpers.
 * The game world is a fixed grid; all modules attach to window.Fortress.
 */
(function () {
    const Fortress = window.Fortress = window.Fortress || {};

    // World grid
    Fortress.GRID_W = 220;          // cells across
    Fortress.GRID_H = 140;          // cells down
    Fortress.CELL = 5;              // pixels per cell
    Fortress.CELL_M = 6;            // metres represented by one cell (for slope math)
    Fortress.WORLD_W = Fortress.GRID_W * Fortress.CELL;   // 1100 px
    Fortress.WORLD_H = Fortress.GRID_H * Fortress.CELL;   // 700 px

    Fortress.idx = (gx, gy) => gy * Fortress.GRID_W + gx;
    Fortress.inGrid = (gx, gy) => gx >= 0 && gy >= 0 && gx < Fortress.GRID_W && gy < Fortress.GRID_H;
    Fortress.cellCx = (gx) => (gx + 0.5) * Fortress.CELL;
    Fortress.cellCy = (gy) => (gy + 0.5) * Fortress.CELL;
    Fortress.toCell = (px) => Math.max(0, Math.min(Fortress.GRID_W - 1, Math.floor(px / Fortress.CELL)));
    Fortress.toCellY = (px) => Math.max(0, Math.min(Fortress.GRID_H - 1, Math.floor(px / Fortress.CELL)));

    Fortress.dist2 = (ax, ay, bx, by) => {
        const dx = ax - bx, dy = ay - by;
        return dx * dx + dy * dy;
    };
    Fortress.dist = (ax, ay, bx, by) => Math.sqrt(Fortress.dist2(ax, ay, bx, by));
    Fortress.clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
    Fortress.lerp = (a, b, t) => a + (b - a) * t;

    /** Deterministic PRNG (mulberry32). */
    Fortress.mulberry32 = function (seed) {
        let a = seed >>> 0;
        return function () {
            a |= 0; a = (a + 0x6D2B79F5) | 0;
            let t = Math.imul(a ^ (a >>> 15), 1 | a);
            t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
    };

    /** Hash an arbitrary string into a 32-bit seed. */
    Fortress.hashSeed = function (str) {
        let h = 2166136261 >>> 0;
        for (let i = 0; i < str.length; i++) {
            h ^= str.charCodeAt(i);
            h = Math.imul(h, 16777619);
        }
        return h >>> 0;
    };

    /**
     * Supercover line rasterization (like Bresenham but includes every cell
     * the segment touches, so diagonal walls have no gaps).
     */
    Fortress.supercoverLine = function (x0, y0, x1, y1) {
        const cells = [];
        let dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0);
        let x = x0, y = y0;
        const xInc = x1 > x0 ? 1 : -1;
        const yInc = y1 > y0 ? 1 : -1;
        let err = dx - dy;
        dx *= 2; dy *= 2;
        let n = 1 + Math.abs(x1 - x0) + Math.abs(y1 - y0);
        for (; n > 0; n--) {
            cells.push([x, y]);
            if (err > 0) { x += xInc; err -= dy; }
            else if (err < 0) { y += yInc; err += dx; }
            else { // passes exactly through a corner: take both cells
                cells.push([x + xInc, y]);
                x += xInc; y += yInc;
                err += dx - dy;
                n--;
            }
        }
        return cells;
    };

    /** Simple binary min-heap keyed on numeric priority. */
    class MinHeap {
        constructor() { this.items = []; this.prios = []; }
        get size() { return this.items.length; }
        push(item, prio) {
            const it = this.items, pr = this.prios;
            it.push(item); pr.push(prio);
            let i = it.length - 1;
            while (i > 0) {
                const p = (i - 1) >> 1;
                if (pr[p] <= pr[i]) break;
                [it[p], it[i]] = [it[i], it[p]];
                [pr[p], pr[i]] = [pr[i], pr[p]];
                i = p;
            }
        }
        pop() {
            const it = this.items, pr = this.prios;
            const top = it[0];
            const lastI = it.pop(), lastP = pr.pop();
            if (it.length > 0) {
                it[0] = lastI; pr[0] = lastP;
                let i = 0;
                for (;;) {
                    const l = i * 2 + 1, r = l + 1;
                    let m = i;
                    if (l < it.length && pr[l] < pr[m]) m = l;
                    if (r < it.length && pr[r] < pr[m]) m = r;
                    if (m === i) break;
                    [it[m], it[i]] = [it[i], it[m]];
                    [pr[m], pr[i]] = [pr[i], pr[m]];
                    i = m;
                }
            }
            return top;
        }
    }
    Fortress.MinHeap = MinHeap;
})();
