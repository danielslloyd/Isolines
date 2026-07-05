/**
 * Fractal terrain generation — box-canyon edition.
 *
 * The land is a high plateau (diamond-square fractal relief) with a ravine
 * carved from the south edge that opens into a sheltered bowl: a natural
 * fortress. The ravine narrows to a neck a dozen metres wide — the opening
 * the player walls off first. Two side ramps connect the approach valley to
 * the plateau, so later assaults (and later city growth) climb out of the
 * canyon.
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

    class Terrain {
        constructor(seed) {
            this.seed = seed;
            this.generate();
        }

        generate() {
            const rng = F.mulberry32(this.seed);
            const broad = diamondSquare(7, 1.0, rng);
            const detail = diamondSquare(7, 1.0, F.mulberry32(this.seed ^ 0x9e3779b9));
            const W = F.GRID_W, H = F.GRID_H;

            this.h = new Float32Array(W * H);
            this.slope = new Float32Array(W * H);
            this.cliff = new Uint8Array(W * H);
            this.water = new Uint8Array(W * H);   // kept for API compat; no water here

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

            // --- Derived fields -------------------------------------------
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
