/**
 * Fractal terrain generation.
 *
 * Two modes, selected in F.CONFIG.terrain.mode:
 *
 *   'valley'  — the forced box-canyon fortress. A high plateau (diamond-square
 *               relief) with a ravine carved from the south edge that opens
 *               into a sheltered bowl. The ravine narrows to a neck; two side
 *               ramps climb to the plateau. A guaranteed natural stronghold.
 *
 *   'fractal' — a random diamond-square landform that is then weathered:
 *               hydraulic (droplet) erosion carves drainage valleys and ridges,
 *               and a priority-flood fill removes pits so water drains. The keep
 *               is dropped into the lowest sheltered basin the weathering leaves
 *               behind, so no two maps play alike.
 *
 * Heights are metres on an invisible 1 m simulation grid. Cells steeper than
 * CLIFF_SLOPE are impassable to everyone — cliffs are walls nature built.
 */
(function () {
    const F = window.Fortress;

    const CLIFF_SLOPE = 1.15;

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
            for (let y = half; y < size; y += step) {
                for (let x = half; x < size; x += step) {
                    const avg = (get(x - half, y - half) + get(x + half, y - half) +
                                 get(x - half, y + half) + get(x + half, y + half)) / 4;
                    set(x, y, avg + (rng() * 2 - 1) * scale);
                }
            }
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
            scale *= Math.pow(2, -0.9);
        }
        // normalize to 0..1
        let min = Infinity, max = -Infinity;
        for (let i = 0; i < map.length; i++) {
            if (map[i] < min) min = map[i];
            if (map[i] > max) max = map[i];
        }
        for (let i = 0; i < map.length; i++) map[i] = (map[i] - min) / (max - min);
        return { map, size };
    }

    function sampleDS(ds, u, v) {
        const fx = F.clamp(u, 0, 1) * (ds.size - 1);
        const fy = F.clamp(v, 0, 1) * (ds.size - 1);
        const x0 = Math.floor(fx), y0 = Math.floor(fy);
        const x1 = Math.min(ds.size - 1, x0 + 1), y1 = Math.min(ds.size - 1, y0 + 1);
        const tx = fx - x0, ty = fy - y0;
        const a = ds.map[y0 * ds.size + x0], b = ds.map[y0 * ds.size + x1];
        const c = ds.map[y1 * ds.size + x0], d = ds.map[y1 * ds.size + x1];
        return F.lerp(F.lerp(a, b, tx), F.lerp(c, d, tx), ty);
    }

    const smoothstep = (t) => { t = F.clamp(t, 0, 1); return t * t * (3 - 2 * t); };

    function normalizeGrid(h) {
        let min = Infinity, max = -Infinity;
        for (let i = 0; i < h.length; i++) { if (h[i] < min) min = h[i]; if (h[i] > max) max = h[i]; }
        const span = (max - min) || 1;
        for (let i = 0; i < h.length; i++) h[i] = (h[i] - min) / span;
    }

    /* ------------------------------------------------------------------ *
     * Weathering: droplet erosion + depression filling + smoothing
     * ------------------------------------------------------------------ */

    /** Circular erosion brush: normalized [dx, dy, weight] offsets. */
    function makeBrush(radius) {
        const r = Math.max(0, Math.round(radius));
        const brush = [];
        let sum = 0;
        for (let dy = -r; dy <= r; dy++) {
            for (let dx = -r; dx <= r; dx++) {
                const d = Math.hypot(dx, dy);
                if (d > r) continue;
                let w = r - d;
                if (dx === 0 && dy === 0 && w <= 0) w = 1; // radius 0: single cell
                if (w <= 0) continue;
                brush.push([dx, dy, w]);
                sum += w;
            }
        }
        for (const e of brush) e[2] /= sum || 1;
        return brush;
    }

    /**
     * Hydraulic erosion on a W×H height grid (normalized units), in place.
     * A classic droplet model (Beyer / Lague): each raindrop follows the
     * gradient, picking up rock on steep descents and dropping sediment where
     * the slope eases, cutting drainage valleys into the fractal.
     */
    function hydraulicErode(h, W, H, p, rng) {
        const brush = makeBrush(p.radius);
        const inertia = F.clamp(p.inertia, 0, 0.99);

        const heightGrad = (posX, posY) => {
            const nx = posX | 0, ny = posY | 0;
            const x = posX - nx, y = posY - ny;
            const i = ny * W + nx;
            const nw = h[i], ne = h[i + 1], sw = h[i + W], se = h[i + W + 1];
            return {
                nx, ny, x, y,
                height: nw * (1 - x) * (1 - y) + ne * x * (1 - y) + sw * (1 - x) * y + se * x * y,
                gradX: (ne - nw) * (1 - y) + (se - sw) * y,
                gradY: (sw - nw) * (1 - x) + (se - ne) * x
            };
        };

        for (let d = 0; d < p.droplets; d++) {
            let posX = 1 + rng() * (W - 3);
            let posY = 1 + rng() * (H - 3);
            let dirX = 0, dirY = 0, speed = 1, water = 1, sediment = 0;

            for (let life = 0; life < p.lifetime; life++) {
                const s = heightGrad(posX, posY);
                dirX = dirX * inertia - s.gradX * (1 - inertia);
                dirY = dirY * inertia - s.gradY * (1 - inertia);
                const len = Math.hypot(dirX, dirY);
                if (len < 1e-6) break;              // stuck in a flat pit
                dirX /= len; dirY /= len;
                posX += dirX; posY += dirY;
                if (posX < 1 || posX >= W - 2 || posY < 1 || posY >= H - 2) break;

                const newHeight = heightGrad(posX, posY).height;
                const deltaH = newHeight - s.height;   // <0 downhill

                const capacity = Math.max(-deltaH, p.minSlope) * speed * water * p.capacity;

                if (sediment > capacity || deltaH > 0) {
                    // Drop sediment (fully fill an uphill step, else settle a share).
                    const amount = deltaH > 0
                        ? Math.min(deltaH, sediment)
                        : (sediment - capacity) * p.deposition;
                    sediment -= amount;
                    const i = s.ny * W + s.nx;
                    h[i]         += amount * (1 - s.x) * (1 - s.y);
                    h[i + 1]     += amount * s.x * (1 - s.y);
                    h[i + W]     += amount * (1 - s.x) * s.y;
                    h[i + W + 1] += amount * s.x * s.y;
                } else {
                    // Erode, spread across the brush, never below the drop.
                    const amount = Math.min((capacity - sediment) * p.erosion, -deltaH);
                    sediment += amount;
                    for (const [bx, by, bw] of brush) {
                        const cx = s.nx + bx, cy = s.ny + by;
                        if (cx < 0 || cy < 0 || cx >= W || cy >= H) continue;
                        h[cy * W + cx] -= amount * bw;
                    }
                }

                speed = Math.sqrt(Math.max(0, speed * speed + deltaH * p.gravity));
                water *= (1 - p.evaporation);
                if (water < 1e-3) break;
            }
        }
    }

    /**
     * Priority-flood depression fill (Barnes 2014). Returns a surface where
     * every interior cell can drain to the border, with a tiny epsilon slope so
     * flats still shed water. Blended over the raw map by `strength`.
     */
    function fillDepressions(h, W, H, eps) {
        const N = W * H;
        const out = new Float32Array(N);
        const closed = new Uint8Array(N);
        const heap = new F.MinHeap();
        const seed = (i, v) => { out[i] = v; closed[i] = 1; heap.push(i, v); };

        for (let gx = 0; gx < W; gx++) { seed(gx, h[gx]); seed((H - 1) * W + gx, h[(H - 1) * W + gx]); }
        for (let gy = 0; gy < H; gy++) { seed(gy * W, h[gy * W]); seed(gy * W + W - 1, h[gy * W + W - 1]); }

        while (heap.size > 0) {
            const c = heap.pop();
            const cx = c % W, cy = (c / W) | 0;
            for (let dy = -1; dy <= 1; dy++) {
                for (let dx = -1; dx <= 1; dx++) {
                    if (!dx && !dy) continue;
                    const nx = cx + dx, ny = cy + dy;
                    if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
                    const ni = ny * W + nx;
                    if (closed[ni]) continue;
                    out[ni] = Math.max(h[ni], out[c] + eps);
                    closed[ni] = 1;
                    heap.push(ni, out[ni]);
                }
            }
        }
        return out;
    }

    /** In-place box-blur passes, each blended by `strength`. */
    function smoothGrid(h, W, H, passes, strength) {
        if (passes <= 0 || strength <= 0) return;
        const tmp = new Float32Array(h.length);
        for (let pass = 0; pass < passes; pass++) {
            for (let gy = 0; gy < H; gy++) {
                for (let gx = 0; gx < W; gx++) {
                    let sum = 0, cnt = 0;
                    for (let dy = -1; dy <= 1; dy++) {
                        for (let dx = -1; dx <= 1; dx++) {
                            const nx = gx + dx, ny = gy + dy;
                            if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
                            sum += h[ny * W + nx]; cnt++;
                        }
                    }
                    tmp[gy * W + gx] = sum / cnt;
                }
            }
            for (let i = 0; i < h.length; i++) h[i] = F.lerp(h[i], tmp[i], strength);
        }
    }

    class Terrain {
        constructor(seed) {
            this.seed = seed;
            this.generate();
        }

        generate() {
            const cfg = (F.CONFIG && F.CONFIG.terrain) || { mode: 'valley' };
            const W = F.GRID_W, H = F.GRID_H;
            this.h = new Float32Array(W * H);
            this.slope = new Float32Array(W * H);
            this.cliff = new Uint8Array(W * H);
            this.water = new Uint8Array(W * H);   // kept for API compat; no water here
            this.ramps = [];

            const rng = F.mulberry32(this.seed);
            if (cfg.mode === 'fractal') this.generateFractal(rng, cfg);
            else this.generateValley(rng, cfg);

            this.deriveFields();
            if (cfg.mode === 'fractal') this.placeFractalLandmarks();
        }

        /* -------------------------- valley mode -------------------------- */

        generateValley(rng, cfg) {
            const broad = diamondSquare(7, 1.0, rng);
            const detail = diamondSquare(7, 1.0, F.mulberry32(this.seed ^ 0x9e3779b9));
            const W = F.GRID_W, H = F.GRID_H;

            // --- Landform key points (south edge is gy = 0) --------------
            const wob = (rng() - 0.5) * 14;
            this.bowl = { x: W / 2 + wob * 0.4, z: H * 0.64, rx: 24, rz: 19 };
            const bowl = this.bowl;

            // Ravine spine from the south edge up into the bowl.
            const spine = [];
            const mouthX = W / 2 + wob;
            const NECK_T = 0.66;
            for (let i = 0; i <= 40; i++) {
                const t = i / 40;
                const x = F.lerp(mouthX, bowl.x, smoothstep(t)) +
                          Math.sin(t * Math.PI * 2.2) * 6 * (1 - t);
                const z = t * (bowl.z - bowl.rz * 0.55);
                // Valley half-width: broad at the mouth, pinched at the neck.
                const neckPinch = Math.exp(-Math.pow((t - NECK_T) / 0.14, 2));
                const w = F.lerp(9, 7.5, t) - neckPinch * 3.6;
                const fh = 1.2 + t * 2.2;   // floor climbs gently inland
                spine.push({ x, z, w, fh });
            }
            this.neck = spine[Math.round(NECK_T * 40)];

            // Side ramps: approach valley (outside the neck) up to the plateau.
            const rampA = this.makeRamp(spine[14], { x: W * 0.16, z: H * 0.38 });
            const rampB = this.makeRamp(spine[11], { x: W * 0.86, z: H * 0.30 });
            this.ramps = [rampA, rampB];

            // --- Height field ---------------------------------------------
            for (let gy = 0; gy < H; gy++) {
                for (let gx = 0; gx < W; gx++) {
                    const x = gx + 0.5, z = gy + 0.5;
                    const u = gx / (W - 1), v = gy / (H - 1);

                    const plateau = 15 + (sampleDS(broad, u, v) - 0.45) * 11;
                    let h = plateau;

                    // Ravine carve. The 4.5 m cliff band keeps the canyon
                    // sides above the impassable-slope threshold everywhere.
                    let best = Infinity;
                    for (const s of spine) {
                        const d = Math.hypot(x - s.x, z - s.z);
                        const k = smoothstep((d - s.w) / 4.5);
                        const cand = F.lerp(s.fh, plateau, k);
                        if (cand < best) best = cand;
                    }
                    h = Math.min(h, best);

                    // Bowl carve (elliptical box-canyon floor)
                    const e = Math.hypot((x - bowl.x) / bowl.rx, (z - bowl.z) / bowl.rz);
                    const bowlFloor = 3.4 + e * e * 1.4; // gentle dish
                    const kb = smoothstep((e - 1) * bowl.rx / 4.5);
                    h = Math.min(h, F.lerp(bowlFloor, plateau, kb));

                    // Ramps carve gentler grades out of the valley
                    for (const ramp of this.ramps) {
                        let cand = Infinity;
                        for (const s of ramp) {
                            const d = Math.hypot(x - s.x, z - s.z);
                            const k = smoothstep((d - s.w) / 5);
                            const c = F.lerp(s.fh, plateau, k);
                            if (c < cand) cand = c;
                        }
                        h = Math.min(h, cand);
                    }

                    // Fractal detail
                    h += (sampleDS(detail, u * 1.0, v * 1.0) - 0.5) * 0.9;
                    this.h[F.idx(gx, gy)] = h;
                }
            }
        }

        /* -------------------------- fractal mode ------------------------- */

        generateFractal(rng, cfg) {
            const W = F.GRID_W, H = F.GRID_H;
            const octaves = Math.max(5, Math.round(cfg.fractalOctaves || 7));
            const base = diamondSquare(octaves, cfg.fractalRoughness || 1.0, rng);
            const detail = diamondSquare(octaves, cfg.fractalRoughness || 1.0,
                F.mulberry32(this.seed ^ 0x9e3779b9));

            // Sample the fractal onto the working grid in normalized [0,1].
            const hm = new Float32Array(W * H);
            for (let gy = 0; gy < H; gy++) {
                for (let gx = 0; gx < W; gx++) {
                    hm[F.idx(gx, gy)] = sampleDS(base, gx / (W - 1), gy / (H - 1));
                }
            }

            // Weather it: erode, then fill depressions and smooth.
            const ero = cfg.erosion || {};
            if (ero.enabled && ero.droplets > 0) {
                hydraulicErode(hm, W, H, ero, rng);
                normalizeGrid(hm);
            }
            const fl = cfg.fill || {};
            if (fl.enabled) {
                const filled = fillDepressions(hm, W, H, fl.epsilon || 0);
                const s = F.clamp(fl.strength == null ? 1 : fl.strength, 0, 1);
                for (let i = 0; i < hm.length; i++) hm[i] = F.lerp(hm[i], filled[i], s);
                smoothGrid(hm, W, H, fl.smoothPasses | 0, F.clamp(fl.smoothStrength || 0, 0, 1));
            }
            normalizeGrid(hm);

            // Lift into metres and layer a little fine fractal detail on top.
            const base0 = cfg.baseHeight || 0;
            const relief = cfg.reliefScale || 20;
            const amp = cfg.detailAmp || 0;
            for (let gy = 0; gy < H; gy++) {
                for (let gx = 0; gx < W; gx++) {
                    const i = F.idx(gx, gy);
                    const u = gx / (W - 1), v = gy / (H - 1);
                    this.h[i] = base0 + hm[i] * relief + (sampleDS(detail, u, v) - 0.5) * amp;
                }
            }
        }

        /**
         * With no forced valley, drop the keep into the best natural stronghold
         * the weathering produced: a low, flat, non-cliff spot toward the middle
         * of the map. Synthesize the bowl/neck the renderer and economy expect.
         */
        placeFractalLandmarks() {
            const W = F.GRID_W, H = F.GRID_H;
            let best = null, bestScore = Infinity;
            const x0 = Math.floor(W * 0.20), x1 = Math.ceil(W * 0.80);
            const y0 = Math.floor(H * 0.28), y1 = Math.ceil(H * 0.78);
            for (let gy = y0; gy <= y1; gy++) {
                for (let gx = x0; gx <= x1; gx++) {
                    const i = F.idx(gx, gy);
                    if (this.cliff[i]) continue;
                    if (this.slope[i] > 0.4) continue;
                    // Prefer low ground (sheltered) that is also flat.
                    const score = this.h[i] + this.slope[i] * 28;
                    if (score < bestScore) { bestScore = score; best = [gx, gy]; }
                }
            }
            if (!best) best = [Math.round(W / 2), Math.round(H / 2)];
            const [kx, ky] = best;

            this.bowl = { x: kx + 0.5, z: ky + 0.5, rx: 18, rz: 15 };
            // Neck: a point partway toward the nearest map edge, used only to
            // frame the opening shot. Head toward the closest border.
            const toN = ky, toS = H - ky, toW = kx, toE = W - kx;
            const m = Math.min(toN, toS, toW, toE);
            let nx = kx, nz = ky;
            if (m === toN) nz = ky * 0.5;
            else if (m === toS) nz = ky + (H - ky) * 0.5;
            else if (m === toW) nx = kx * 0.5;
            else nx = kx + (W - kx) * 0.5;
            this.neck = { x: nx + 0.5, z: nz + 0.5, w: 9, fh: this.h[F.idx(kx, ky)] };
        }

        /* -------------------------- shared ------------------------------ */

        /** Derive min/max, slope and cliff mask from the metres height field. */
        deriveFields() {
            const W = F.GRID_W, H = F.GRID_H;
            let min = Infinity, max = -Infinity;
            for (let i = 0; i < this.h.length; i++) {
                if (this.h[i] < min) min = this.h[i];
                if (this.h[i] > max) max = this.h[i];
            }
            this.minH = min; this.maxH = max;
            this.waterLevel = min - 10; // no water on this map

            for (let gy = 0; gy < H; gy++) {
                for (let gx = 0; gx < W; gx++) {
                    const xl = this.h[F.idx(Math.max(0, gx - 1), gy)];
                    const xr = this.h[F.idx(Math.min(W - 1, gx + 1), gy)];
                    const yu = this.h[F.idx(gx, Math.max(0, gy - 1))];
                    const yd = this.h[F.idx(gx, Math.min(H - 1, gy + 1))];
                    const s = Math.hypot((xr - xl) / 2, (yd - yu) / 2);
                    this.slope[F.idx(gx, gy)] = s;
                    this.cliff[F.idx(gx, gy)] = s > CLIFF_SLOPE ? 1 : 0;
                }
            }
        }

        makeRamp(fromSpine, top) {
            const pts = [];
            for (let i = 0; i <= 16; i++) {
                const t = i / 16;
                pts.push({
                    x: F.lerp(fromSpine.x, top.x, t),
                    z: F.lerp(fromSpine.z, top.z, t) + Math.sin(t * Math.PI) * 4,
                    w: 4.5,
                    fh: F.lerp(fromSpine.fh, 15.5, smoothstep(t))
                });
            }
            return pts;
        }

        heightAtCell(gx, gy) {
            return this.h[F.idx(F.clamp(gx, 0, F.GRID_W - 1), F.clamp(gy, 0, F.GRID_H - 1))];
        }

        /** Bilinear height at world coordinates (metres). */
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

        isCliff(gx, gy) {
            return F.inGrid(gx, gy) ? this.cliff[F.idx(gx, gy)] === 1 : true;
        }

        isWater(gx, gy) {
            return false;
        }
    }

    F.Terrain = Terrain;
})();
