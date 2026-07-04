/**
 * Fractal terrain generation and rendering.
 *
 * Heightmap is built from scratch with the diamond-square algorithm on a
 * 257x257 lattice, blended with a second, higher-frequency fractal pass for
 * detail, then bilinearly sampled onto the game grid. Contour lines are
 * extracted with the repo's CONREC implementation so the game keeps the
 * Isolines visual identity.
 */
(function () {
    const F = window.Fortress;

    /** Diamond-square fractal heightmap on a (2^n + 1) square lattice. */
    function diamondSquare(n, roughness, rng) {
        const size = (1 << n) + 1;
        const map = new Float32Array(size * size);
        const get = (x, y) => map[y * size + x];
        const set = (x, y, v) => { map[y * size + x] = v; };

        set(0, 0, rng());
        set(size - 1, 0, rng());
        set(0, size - 1, rng());
        set(size - 1, size - 1, rng());

        let step = size - 1;
        let scale = roughness;
        while (step > 1) {
            const half = step / 2;
            // Diamond step
            for (let y = half; y < size; y += step) {
                for (let x = half; x < size; x += step) {
                    const avg = (get(x - half, y - half) + get(x + half, y - half) +
                                 get(x - half, y + half) + get(x + half, y + half)) / 4;
                    set(x, y, avg + (rng() * 2 - 1) * scale);
                }
            }
            // Square step
            for (let y = 0; y < size; y += half) {
                for (let x = (y + half) % step; x < size; x += step) {
                    let sum = 0, cnt = 0;
                    if (x - half >= 0) { sum += get(x - half, y); cnt++; }
                    if (x + half < size) { sum += get(x + half, y); cnt++; }
                    if (y - half >= 0) { sum += get(x, y - half); cnt++; }
                    if (y + half < size) { sum += get(x, y + half); cnt++; }
                    set(x, y, sum / cnt + (rng() * 2 - 1) * scale);
                }
            }
            step = half;
            scale *= Math.pow(2, -0.92); // Hurst-like falloff -> rolling hills
        }
        return { map, size };
    }

    class Terrain {
        constructor(seed) {
            this.seed = seed;
            this.generate();
        }

        generate() {
            const rng = F.mulberry32(this.seed);
            const base = diamondSquare(8, 1.0, rng);          // broad landforms
            const detail = diamondSquare(8, 1.0, F.mulberry32(this.seed ^ 0x9e3779b9));

            const W = F.GRID_W, H = F.GRID_H;
            this.h = new Float32Array(W * H);   // metres
            this.water = new Uint8Array(W * H);
            this.slope = new Float32Array(W * H); // |grad| in m per m

            // Sample the square lattice onto the rectangular game grid.
            const sample = (ds, u, v) => {
                const fx = u * (ds.size - 1), fy = v * (ds.size - 1);
                const x0 = Math.floor(fx), y0 = Math.floor(fy);
                const x1 = Math.min(ds.size - 1, x0 + 1), y1 = Math.min(ds.size - 1, y0 + 1);
                const tx = fx - x0, ty = fy - y0;
                const a = ds.map[y0 * ds.size + x0], b = ds.map[y0 * ds.size + x1];
                const c = ds.map[y1 * ds.size + x0], d = ds.map[y1 * ds.size + x1];
                return F.lerp(F.lerp(a, b, tx), F.lerp(c, d, tx), ty);
            };

            let min = Infinity, max = -Infinity;
            const raw = new Float32Array(W * H);
            for (let gy = 0; gy < H; gy++) {
                for (let gx = 0; gx < W; gx++) {
                    const u = gx / (W - 1), v = gy / (H - 1);
                    const val = sample(base, u, v) + 0.3 * sample(detail, u, v);
                    raw[F.idx(gx, gy)] = val;
                    if (val < min) min = val;
                    if (val > max) max = val;
                }
            }

            // Normalize to metres with a gentle curve for hilly (not alpine) relief.
            const RELIEF = 85; // total metres of relief
            for (let i = 0; i < raw.length; i++) {
                const t = (raw[i] - min) / (max - min);
                this.h[i] = Math.pow(t, 1.18) * RELIEF;
            }

            // Water level at the 7th percentile of heights.
            const sorted = Array.from(this.h).sort((a, b) => a - b);
            this.waterLevel = sorted[Math.floor(sorted.length * 0.07)];
            this.minH = sorted[0];
            this.maxH = sorted[sorted.length - 1];
            for (let i = 0; i < this.h.length; i++) {
                this.water[i] = this.h[i] <= this.waterLevel ? 1 : 0;
            }

            // Slope magnitude via central differences.
            for (let gy = 0; gy < H; gy++) {
                for (let gx = 0; gx < W; gx++) {
                    const xl = this.h[F.idx(Math.max(0, gx - 1), gy)];
                    const xr = this.h[F.idx(Math.min(W - 1, gx + 1), gy)];
                    const yu = this.h[F.idx(gx, Math.max(0, gy - 1))];
                    const yd = this.h[F.idx(gx, Math.min(H - 1, gy + 1))];
                    const dhdx = (xr - xl) / (2 * F.CELL_M);
                    const dhdy = (yd - yu) / (2 * F.CELL_M);
                    this.slope[F.idx(gx, gy)] = Math.sqrt(dhdx * dhdx + dhdy * dhdy);
                }
            }
        }

        heightAtCell(gx, gy) {
            return this.h[F.idx(F.clamp(gx, 0, F.GRID_W - 1), F.clamp(gy, 0, F.GRID_H - 1))];
        }

        /** Bilinear height at pixel coordinates. */
        heightAtPx(x, y) {
            const fx = F.clamp(x / F.CELL - 0.5, 0, F.GRID_W - 1.001);
            const fy = F.clamp(y / F.CELL - 0.5, 0, F.GRID_H - 1.001);
            const x0 = Math.floor(fx), y0 = Math.floor(fy);
            const tx = fx - x0, ty = fy - y0;
            const a = this.heightAtCell(x0, y0), b = this.heightAtCell(x0 + 1, y0);
            const c = this.heightAtCell(x0, y0 + 1), d = this.heightAtCell(x0 + 1, y0 + 1);
            return F.lerp(F.lerp(a, b, tx), F.lerp(c, d, tx), ty);
        }

        slopeAtCell(gx, gy) {
            return this.slope[F.idx(F.clamp(gx, 0, F.GRID_W - 1), F.clamp(gy, 0, F.GRID_H - 1))];
        }

        isWater(gx, gy) {
            return F.inGrid(gx, gy) ? this.water[F.idx(gx, gy)] === 1 : true;
        }

        /**
         * Render the static terrain (hypsometric tint + hillshade + CONREC
         * contours) into an offscreen canvas, once per map.
         */
        renderToCanvas() {
            const canvas = document.createElement('canvas');
            canvas.width = F.WORLD_W;
            canvas.height = F.WORLD_H;
            const ctx = canvas.getContext('2d');

            const img = ctx.createImageData(F.WORLD_W, F.WORLD_H);
            const data = img.data;

            // Elevation color ramp (t in 0..1 above water)
            const ramp = [
                [0.00, 116, 154, 92],
                [0.25, 140, 168, 98],
                [0.45, 172, 179, 106],
                [0.65, 186, 168, 112],
                [0.82, 176, 148, 110],
                [1.00, 208, 200, 192]
            ];
            const rampColor = (t) => {
                for (let i = 1; i < ramp.length; i++) {
                    if (t <= ramp[i][0]) {
                        const [t0, r0, g0, b0] = ramp[i - 1];
                        const [t1, r1, g1, b1] = ramp[i];
                        const k = (t - t0) / (t1 - t0);
                        return [F.lerp(r0, r1, k), F.lerp(g0, g1, k), F.lerp(b0, b1, k)];
                    }
                }
                return [208, 200, 192];
            };

            const range = Math.max(1e-6, this.maxH - this.waterLevel);
            // Light from the north-west for hillshade.
            const lx = -0.62, ly = -0.62, lz = 0.48;

            for (let py = 0; py < F.WORLD_H; py++) {
                for (let px = 0; px < F.WORLD_W; px++) {
                    const h = this.heightAtPx(px + 0.5, py + 0.5);
                    let r, g, b;
                    if (h <= this.waterLevel) {
                        const depth = F.clamp((this.waterLevel - h) / 6, 0, 1);
                        r = F.lerp(96, 42, depth);
                        g = F.lerp(146, 92, depth);
                        b = F.lerp(178, 140, depth);
                    } else {
                        const t = F.clamp((h - this.waterLevel) / range, 0, 1);
                        [r, g, b] = rampColor(t);
                        // Hillshade from screen-space gradient.
                        const e = 1.5;
                        const dhx = this.heightAtPx(px + e, py) - this.heightAtPx(px - e, py);
                        const dhy = this.heightAtPx(px, py + e) - this.heightAtPx(px, py - e);
                        const nz = 2.2;
                        const len = Math.sqrt(dhx * dhx + dhy * dhy + nz * nz);
                        const shade = F.clamp((-dhx * lx + -dhy * ly + nz * lz) / len, 0, 1);
                        const sh = 0.62 + shade * 0.55;
                        r *= sh; g *= sh; b *= sh;
                    }
                    const o = (py * F.WORLD_W + px) * 4;
                    data[o] = r; data[o + 1] = g; data[o + 2] = b; data[o + 3] = 255;
                }
            }
            ctx.putImageData(img, 0, 0);

            this.drawContours(ctx);
            return canvas;
        }

        /** Draw contour lines using the repo's CONREC algorithm. */
        drawContours(ctx) {
            const W = F.GRID_W, H = F.GRID_H;
            // CONREC wants d[i][j] with coordinate arrays.
            const d = [];
            const xs = [], ys = [];
            for (let i = 0; i < W; i++) {
                xs.push((i + 0.5) * F.CELL);
                d.push(null);
            }
            for (let j = 0; j < H; j++) ys.push((j + 0.5) * F.CELL);
            for (let i = 0; i < W; i++) {
                const col = new Float32Array(H);
                for (let j = 0; j < H; j++) col[j] = this.h[F.idx(i, j)];
                d[i] = col;
            }

            const interval = 5; // metres between contours
            const levels = [];
            for (let z = Math.ceil(this.waterLevel / interval) * interval; z < this.maxH; z += interval) {
                levels.push(z);
            }
            const conrec = new Conrec();
            const contours = conrec.contour(d, xs, ys, levels);

            ctx.lineCap = 'round';
            levels.forEach(level => {
                const major = level % (interval * 4) === 0;
                ctx.strokeStyle = major ? 'rgba(74, 52, 28, 0.42)' : 'rgba(74, 52, 28, 0.22)';
                ctx.lineWidth = major ? 1.0 : 0.55;
                ctx.beginPath();
                (contours[level] || []).forEach(s => {
                    ctx.moveTo(s.x1, s.y1);
                    ctx.lineTo(s.x2, s.y2);
                });
                ctx.stroke();
            });
        }
    }

    F.Terrain = Terrain;
})();
