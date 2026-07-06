/**
 * Fortification system: walls, gates, towers, and field defenses.
 *
 * Walls are drawn by the player as a polyline; the engine "blends" the line
 * into the terrain before building it:
 *   1. each segment is subdivided at roughly one-cell intervals,
 *   2. every sample point is pulled toward the highest ground within a small
 *      search radius (ridge snapping),
 *   3. the pulled polyline is smoothed (Chaikin) and rasterized with a
 *      supercover line so the wall has no diagonal gaps.
 *
 * Every rasterized cell becomes an independent WallPiece with its own HP, so
 * attackers breach a *point* in the wall rather than deleting the whole
 * curtain. Pieces remember their terrain elevation; height advantage feeds
 * combat (attackers hit uphill walls for less) and pathfinding (uphill walls
 * are less attractive to storm).
 */
(function () {
    const F = window.Fortress;

    // Heights/ranges are metres now — intimate, football-field scale.
    F.WALL_TIERS = [
        { name: 'Palisade',       hp: 160, height: 2.6, cost: 4,  color: 0x8a6a3c },
        { name: 'Stone Wall',     hp: 340, height: 4.0, cost: 14, color: 0x93938f },
        { name: 'Fortified Wall', hp: 680, height: 5.6, cost: 30, color: 0xb9b4a8 }
    ];
    F.GATE_STATS = { hpMult: 0.7, costMult: 1.6 };

    F.TOWER_TIERS = [
        { name: 'Watchtower',    cost: 110, range: 26, dmg: 10, rate: 0.85, hp: 260, aoe: 0,   projectile: 'arrow', color: 0x7a5c34, h: 5 },
        { name: 'Archer Tower',  cost: 250, range: 33, dmg: 16, rate: 0.6,  hp: 420, aoe: 0,   projectile: 'arrow', color: 0x8a8a8e, h: 7 },
        { name: 'Ballista Tower', cost: 520, range: 44, dmg: 52, rate: 1.7,  hp: 560, aoe: 2.6, projectile: 'bolt',  color: 0xb8b4aa, h: 8.5 }
    ];

    F.DEFENSE_COSTS = { oil: 45, stakes: 14, moat: 7, gateExtra: 0 };

    let nextId = 1;

    class FortManager {
        constructor(game) {
            this.game = game;
            this.wallGrid = new Int32Array(F.GRID_W * F.GRID_H); // piece id or 0
            this.pieces = new Map();   // id -> piece
            this.towers = [];
            this.towerGrid = new Int32Array(F.GRID_W * F.GRID_H);
            this.stakes = new Map();   // idx -> {gx,gy,uses}
            this.moat = new Uint8Array(F.GRID_W * F.GRID_H);
            this.outside = new Uint8Array(F.GRID_W * F.GRID_H); // 1 = reachable from map edge
            this.outsideDirty = true;
            this.walls = [];           // built wall runs: {pathPts, isGate} for 3D rendering
            this.meshDirty = true;     // renderer rebuilds wall geometry when set
        }

        pieceAt(gx, gy) {
            if (!F.inGrid(gx, gy)) return null;
            const id = this.wallGrid[F.idx(gx, gy)];
            return id ? this.pieces.get(id) : null;
        }

        towerAt(gx, gy) {
            if (!F.inGrid(gx, gy)) return null;
            const id = this.towerGrid[F.idx(gx, gy)];
            if (!id) return null;
            return this.towers.find(t => t.id === id) || null;
        }

        cellBuildable(gx, gy, forWall) {
            if (!F.inGrid(gx, gy)) return false;
            const g = this.game;
            if (g.terrain.slopeAtCell(gx, gy) > 1.0) return false; // too steep to build
            if (this.towerGrid[F.idx(gx, gy)]) return false;
            if (g.buildingAt(gx, gy)) return false;
            if (this.moat[F.idx(gx, gy)]) return false;
            if (forWall && this.wallGrid[F.idx(gx, gy)]) return false; // existing wall cells are just reused
            return true;
        }

        /**
         * Tiny-Glade-style snapping: pull a drawn point onto a nearby wall
         * so new runs join existing masonry seamlessly.
         */
        snapPoint(x, y, radius) {
            const r = radius || 2.5;
            let best = null, bestD = r;
            const g0x = F.toCell(x - r), g1x = F.toCell(x + r);
            const g0y = F.toCellY(y - r), g1y = F.toCellY(y + r);
            for (let gy = g0y; gy <= g1y; gy++) {
                for (let gx = g0x; gx <= g1x; gx++) {
                    if (!this.wallGrid[F.idx(gx, gy)]) continue;
                    const d = F.dist(x, y, F.cellCx(gx), F.cellCy(gy));
                    if (d < bestD) { bestD = d; best = { x: F.cellCx(gx), y: F.cellCy(gy) }; }
                }
            }
            return best;
        }

        /* ------------------------------------------------------------------ *
         * Terrain blending
         * ------------------------------------------------------------------ */

        /** Pull a point toward the highest *buildable* ground within ~3 m. */
        blendPoint(x, y) {
            const t = this.game.terrain;
            const gx = F.toCell(x), gy = F.toCellY(y);
            let bestH = t.heightAtPx(x, y), bx = x, by = y;
            const R = 3;
            for (let dy = -R; dy <= R; dy++) {
                for (let dx = -R; dx <= R; dx++) {
                    const nx = gx + dx, ny = gy + dy;
                    if (!F.inGrid(nx, ny) || t.slopeAtCell(nx, ny) > 1.0) continue;
                    const h = t.heightAtCell(nx, ny);
                    if (h > bestH + 0.15) {
                        bestH = h;
                        bx = F.cellCx(nx);
                        by = F.cellCy(ny);
                    }
                }
            }
            // Partial pull keeps the player's intent while favoring ridges.
            return { x: F.lerp(x, bx, 0.55), y: F.lerp(y, by, 0.55) };
        }

        /** Blend a drawn polyline into the terrain; returns smoothed points. */
        blendPath(nodes) {
            if (nodes.length < 2) return nodes.slice();
            const sampled = [];
            for (let s = 0; s < nodes.length - 1; s++) {
                const a = nodes[s], b = nodes[s + 1];
                const len = F.dist(a.x, a.y, b.x, b.y);
                const steps = Math.max(1, Math.round(len / (F.CELL * 1.4)));
                for (let k = 0; k < steps; k++) {
                    const t = k / steps;
                    sampled.push({ x: F.lerp(a.x, b.x, t), y: F.lerp(a.y, b.y, t) });
                }
            }
            sampled.push(nodes[nodes.length - 1]);

            const pulled = sampled.map(p => this.blendPoint(p.x, p.y));
            // One round of Chaikin smoothing so the wall flows with the land.
            const smooth = [pulled[0]];
            for (let i = 0; i < pulled.length - 1; i++) {
                const a = pulled[i], b = pulled[i + 1];
                smooth.push({ x: F.lerp(a.x, b.x, 0.25), y: F.lerp(a.y, b.y, 0.25) });
                smooth.push({ x: F.lerp(a.x, b.x, 0.75), y: F.lerp(a.y, b.y, 0.75) });
            }
            smooth.push(pulled[pulled.length - 1]);
            return smooth;
        }

        /**
         * Plan a wall along drawn nodes. Returns
         * { cells, path, cost, valid, reason } without committing anything.
         */
        planWall(nodes, tier, isGate) {
            const path = this.blendPath(nodes);
            const seen = new Set();
            const cells = [];
            let invalid = 0;
            for (let i = 0; i < path.length - 1; i++) {
                const line = F.supercoverLine(
                    F.toCell(path[i].x), F.toCellY(path[i].y),
                    F.toCell(path[i + 1].x), F.toCellY(path[i + 1].y)
                );
                for (const [gx, gy] of line) {
                    const key = F.idx(gx, gy);
                    if (seen.has(key)) continue;
                    seen.add(key);
                    if (this.wallGrid[key]) continue; // merge with existing wall
                    if (!this.cellBuildable(gx, gy, true)) { invalid++; continue; }
                    cells.push([gx, gy]);
                }
            }
            const t = this.game.terrain;
            const stats = F.WALL_TIERS[tier];
            let cost = 0;
            for (const [gx, gy] of cells) {
                const slopeMult = 1 + F.clamp(t.slopeAtCell(gx, gy), 0, 1.5) * 1.6;
                cost += stats.cost * slopeMult;
            }
            if (isGate) cost *= F.GATE_STATS.costMult;
            cost = Math.round(cost);
            const valid = cells.length > 0 && invalid === 0;
            return {
                cells, path, cost, valid,
                reason: invalid > 0 ? 'Path crosses cliffs, buildings or defenses' :
                        cells.length === 0 ? 'No new wall footprint' : null
            };
        }

        buildWall(plan, tier, isGate) {
            const t = this.game.terrain;
            const stats = F.WALL_TIERS[tier];
            for (const [gx, gy] of plan.cells) {
                const elev = t.heightAtCell(gx, gy);
                // Elevation advantage: how far this cell rises above its lowest neighbor.
                let minN = elev;
                for (let dy = -1; dy <= 1; dy++) {
                    for (let dx = -1; dx <= 1; dx++) {
                        if (F.inGrid(gx + dx, gy + dy)) {
                            minN = Math.min(minN, t.heightAtCell(gx + dx, gy + dy));
                        }
                    }
                }
                const hp = Math.round(stats.hp * (isGate ? F.GATE_STATS.hpMult : 1));
                const piece = {
                    id: nextId++, gx, gy, tier, isGate: !!isGate,
                    hp, maxHp: hp,
                    elev, advantage: (elev - minN) + stats.height,
                    oil: null
                };
                this.pieces.set(piece.id, piece);
                this.wallGrid[F.idx(gx, gy)] = piece.id;
            }
            // Keep the smoothed path so the renderer draws a continuous wall.
            this.walls.push({ pathPts: plan.path.slice(), isGate: !!isGate });
            this.markDirty();
        }

        damagePiece(piece, dmg) {
            piece.hp -= dmg;
            if (piece.hp <= 0) {
                this.destroyPiece(piece);
                return true;
            }
            return false;
        }

        destroyPiece(piece) {
            this.pieces.delete(piece.id);
            this.wallGrid[F.idx(piece.gx, piece.gy)] = 0;
            this.game.onWallBreached(piece);
            this.markDirty();
        }

        /** Contiguous run of wall pieces with the same tier (for upgrade/repair). */
        contiguousRun(piece, sameTier) {
            const run = [];
            const seen = new Set([piece.id]);
            const queue = [piece];
            while (queue.length) {
                const p = queue.pop();
                run.push(p);
                for (let dy = -1; dy <= 1; dy++) {
                    for (let dx = -1; dx <= 1; dx++) {
                        const n = this.pieceAt(p.gx + dx, p.gy + dy);
                        if (n && !seen.has(n.id) && (!sameTier || n.tier === p.tier)) {
                            seen.add(n.id);
                            queue.push(n);
                        }
                    }
                }
            }
            return run;
        }

        upgradeCost(run) {
            let cost = 0;
            for (const p of run) {
                if (p.tier >= F.WALL_TIERS.length - 1) continue;
                const diff = F.WALL_TIERS[p.tier + 1].cost - F.WALL_TIERS[p.tier].cost;
                cost += diff * (p.isGate ? F.GATE_STATS.costMult : 1);
            }
            return Math.round(cost);
        }

        upgradeRun(run) {
            for (const p of run) {
                if (p.tier >= F.WALL_TIERS.length - 1) continue;
                p.tier++;
                const stats = F.WALL_TIERS[p.tier];
                const newMax = Math.round(stats.hp * (p.isGate ? F.GATE_STATS.hpMult : 1));
                p.hp = Math.round(p.hp / p.maxHp * newMax);
                p.hp = Math.max(p.hp, Math.round(newMax * 0.5));
                p.maxHp = newMax;
                p.advantage = p.advantage - F.WALL_TIERS[p.tier - 1].height + stats.height;
            }
            this.markDirty();
        }

        repairCost(run) {
            let cost = 0;
            for (const p of run) {
                const missing = 1 - p.hp / p.maxHp;
                cost += missing * F.WALL_TIERS[p.tier].cost * 0.6;
            }
            return Math.round(cost);
        }

        repairRun(run) {
            for (const p of run) p.hp = p.maxHp;
        }

        /* ------------------------------------------------------------------ *
         * Towers & field defenses
         * ------------------------------------------------------------------ */

        canPlaceTower(gx, gy) {
            if (!F.inGrid(gx, gy)) return false;
            const g = this.game;
            if (g.terrain.slopeAtCell(gx, gy) > 1.0) return false;
            if (this.towerGrid[F.idx(gx, gy)]) return false;
            if (g.buildingAt(gx, gy)) return false;
            if (this.moat[F.idx(gx, gy)]) return false;
            return true; // may sit on open ground or on a wall piece
        }

        placeTower(gx, gy, tier) {
            const stats = F.TOWER_TIERS[tier];
            const piece = this.pieceAt(gx, gy);
            const baseElev = this.game.terrain.heightAtCell(gx, gy);
            const tower = {
                id: nextId++, gx, gy,
                x: F.cellCx(gx), y: F.cellCy(gy),
                tier, hp: stats.hp, maxHp: stats.hp,
                cooldown: 0, kills: 0,
                // Towers on walls fire from the rampart: extra elevation.
                elev: baseElev + stats.h + (piece ? F.WALL_TIERS[piece.tier].height : 0),
                onWall: !!piece
            };
            this.towers.push(tower);
            this.towerGrid[F.idx(gx, gy)] = tower.id;
            this.markDirty();
            return tower;
        }

        damageTower(tower, dmg) {
            tower.hp -= dmg;
            if (tower.hp <= 0) {
                this.removeTower(tower);
                this.game.message(`${F.TOWER_TIERS[tower.tier].name} destroyed!`, 'bad');
                return true;
            }
            return false;
        }

        removeTower(tower) {
            this.towerGrid[F.idx(tower.gx, tower.gy)] = 0;
            const i = this.towers.indexOf(tower);
            if (i >= 0) this.towers.splice(i, 1);
            this.markDirty();
        }

        placeOil(piece) {
            piece.oil = { cooldown: 0 };
        }

        placeStakes(gx, gy) {
            this.stakes.set(F.idx(gx, gy), { gx, gy, uses: F.CONFIG.balance.stakesUses });
        }

        digMoat(gx, gy) {
            this.moat[F.idx(gx, gy)] = 1;
            this.markDirty();
        }

        markDirty() {
            this.outsideDirty = true;
            this.meshDirty = true;
            if (this.game.flow) this.game.flow.dirty = true;
        }

        /* ------------------------------------------------------------------ *
         * Enclosure detection
         * ------------------------------------------------------------------ */

        /**
         * Flood-fill from the map border across cells not blocked by wall
         * pieces or towers. Cells left unreached are "inside" a fortification.
         * Uses the same diagonal-squeeze rule as unit movement, so a spot is
         * protected exactly when attackers cannot walk to it.
         */
        recomputeOutside() {
            const W = F.GRID_W, H = F.GRID_H;
            this.outside.fill(0);
            const cliff = this.game.terrain.cliff;
            const queue = [];
            const push = (gx, gy) => {
                const i = F.idx(gx, gy);
                if (this.outside[i] || this.wallGrid[i] || this.towerGrid[i] || cliff[i]) return;
                this.outside[i] = 1;
                queue.push(i);
            };
            for (let gx = 0; gx < W; gx++) { push(gx, 0); push(gx, H - 1); }
            for (let gy = 0; gy < H; gy++) { push(0, gy); push(W - 1, gy); }

            // Cliffs seal ground as effectively as masonry: walling off a
            // ravine mouth protects the whole box canyon behind it.
            const solid = (gx, gy) => !F.inGrid(gx, gy) ||
                this.wallGrid[F.idx(gx, gy)] !== 0 || this.towerGrid[F.idx(gx, gy)] !== 0 ||
                cliff[F.idx(gx, gy)] !== 0;

            while (queue.length) {
                const cur = queue.pop();
                const cx = cur % W, cy = (cur / W) | 0;
                for (let dy = -1; dy <= 1; dy++) {
                    for (let dx = -1; dx <= 1; dx++) {
                        if (!dx && !dy) continue;
                        const nx = cx + dx, ny = cy + dy;
                        if (!F.inGrid(nx, ny)) continue;
                        if (dx && dy && solid(cx, ny) && solid(nx, cy)) continue;
                        push(nx, ny);
                    }
                }
            }
            this.outsideDirty = false;
        }

        isProtected(gx, gy) {
            if (this.outsideDirty) this.recomputeOutside();
            return this.outside[F.idx(gx, gy)] === 0;
        }

        /** Does the enclosure containing (gx,gy) include at least one gate? */
        enclosureHasGate(gx, gy) {
            if (this.outsideDirty) this.recomputeOutside();
            if (this.outside[F.idx(gx, gy)]) return false;
            // BFS the inside region; check gates on its wall boundary.
            const seen = new Uint8Array(F.GRID_W * F.GRID_H);
            const queue = [F.idx(gx, gy)];
            seen[queue[0]] = 1;
            while (queue.length) {
                const cur = queue.pop();
                const cx = cur % F.GRID_W, cy = (cur / F.GRID_W) | 0;
                for (let dy = -1; dy <= 1; dy++) {
                    for (let dx = -1; dx <= 1; dx++) {
                        if (!dx && !dy) continue;
                        const nx = cx + dx, ny = cy + dy;
                        if (!F.inGrid(nx, ny)) continue;
                        const ni = F.idx(nx, ny);
                        if (seen[ni]) continue;
                        const piece = this.pieceAt(nx, ny);
                        if (piece) {
                            seen[ni] = 1;
                            if (piece.isGate) return true;
                            continue;
                        }
                        if (this.towerGrid[ni] || this.outside[ni] ||
                            this.game.terrain.cliff[ni]) { seen[ni] = 1; continue; }
                        seen[ni] = 1;
                        queue.push(ni);
                    }
                }
            }
            return false;
        }
    }

    F.FortManager = FortManager;
})();
