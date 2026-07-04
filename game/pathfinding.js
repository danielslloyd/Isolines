/**
 * Flow-field pathfinding.
 *
 * Instead of per-unit A*, a single Dijkstra "integration field" is computed
 * outward from all attack targets (houses + keep). Walls and towers are
 * *soft* obstacles: entering their cell carries a large cost proportional to
 * their remaining HP and the elevation they stand on. Attackers descend the
 * field gradient, which naturally makes them converge on the cheapest way in
 * — a gate, a low saddle, or the weakest stretch of wall — and stop to batter
 * whatever blocks them. This is what makes terrain placement matter.
 */
(function () {
    const F = window.Fortress;

    const SQRT2 = Math.SQRT2;
    const NEIGHBORS = [
        [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
        [1, 1, SQRT2], [1, -1, SQRT2], [-1, 1, SQRT2], [-1, -1, SQRT2]
    ];

    class FlowField {
        constructor(game) {
            this.game = game;
            this.dist = new Float32Array(F.GRID_W * F.GRID_H);
            this.dirty = true;
            this._cooldown = 0;
        }

        /** Movement/entry cost of a cell for the Dijkstra expansion. */
        enterCost(gx, gy) {
            const g = this.game;
            const i = F.idx(gx, gy);
            let c = 1 + F.clamp(g.terrain.slope[i], 0, 1.6) * 2.4;
            if (g.forts.moat[i]) c *= 5;
            if (g.buildingAt(gx, gy)) c += 8; // discourage cutting through yards
            const piece = g.forts.pieceAt(gx, gy);
            if (piece) {
                // Cost of fighting through this wall: HP plus terrain advantage.
                c += (piece.isGate ? 16 : 24) + piece.hp / 12 + piece.advantage * 0.5;
            }
            const tower = g.forts.towerAt(gx, gy);
            if (tower) c += 30 + tower.hp / 12;
            return c;
        }

        isSolid(gx, gy) {
            return !!(this.game.forts.pieceAt(gx, gy) || this.game.forts.towerAt(gx, gy));
        }

        /** Cliffs are impassable; diagonals may not squeeze between solids. */
        canStep(fx, fy, tx, ty) {
            if (!F.inGrid(tx, ty)) return false;
            if (this.game.terrain.cliff[F.idx(tx, ty)]) return false;
            if (fx !== tx && fy !== ty) {
                if (this.isSolid(fx, ty) && this.isSolid(tx, fy)) return false;
            }
            return true;
        }

        recompute() {
            const g = this.game;
            const dist = this.dist;
            dist.fill(Infinity);
            const heap = new F.MinHeap();

            for (const b of g.buildings) {
                if (b.hp <= 0) continue;
                const i = F.idx(b.gx, b.gy);
                if (dist[i] > 0) {
                    dist[i] = 0;
                    heap.push(i, 0);
                }
            }

            while (heap.size > 0) {
                const cur = heap.pop();
                const cx = cur % F.GRID_W, cy = (cur / F.GRID_W) | 0;
                const cd = dist[cur];
                for (const [dx, dy, len] of NEIGHBORS) {
                    const nx = cx + dx, ny = cy + dy;
                    if (!this.canStep(cx, cy, nx, ny)) continue;
                    const ni = F.idx(nx, ny);
                    const nd = cd + this.enterCost(nx, ny) * len;
                    if (nd < dist[ni]) {
                        dist[ni] = nd;
                        heap.push(ni, nd);
                    }
                }
            }
            this.dirty = false;
            this._cooldown = 0.4; // throttle recomputes during combat
        }

        update(dt) {
            if (this._cooldown > 0) this._cooldown -= dt;
            if (this.dirty && this._cooldown <= 0) this.recompute();
        }

        /**
         * Best next cell from (gx,gy) descending the field.
         * Returns {gx, gy, solid} or null when already at a target.
         */
        nextStep(gx, gy) {
            let best = null, bestD = this.dist[F.idx(gx, gy)];
            for (const [dx, dy] of NEIGHBORS) {
                const nx = gx + dx, ny = gy + dy;
                if (!this.canStep(gx, gy, nx, ny)) continue;
                const d = this.dist[F.idx(nx, ny)];
                if (d < bestD) {
                    bestD = d;
                    best = { gx: nx, gy: ny, solid: this.isSolid(nx, ny) };
                }
            }
            return best;
        }
    }

    F.FlowField = FlowField;
})();
