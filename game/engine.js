/**
 * Game engine: state machine (menu → build ⇄ siege → game over), economy,
 * village growth, combat resolution, and player input tools.
 */
(function () {
    const F = window.Fortress;

    const B = () => F.CONFIG.balance;

    class Game {
        constructor() {
            this.renderer = null;   // set by the UI once the 3D scene exists
            this.state = 'menu';
            this.difficulty = 'normal';
            this.speed = 1;
            this.paused = false;
            this.listeners = {};
            this.newRun(String(Math.floor(Math.random() * 1e9)));

            this._last = performance.now();
            requestAnimationFrame(this._frame.bind(this));
        }

        on(evt, fn) { (this.listeners[evt] = this.listeners[evt] || []).push(fn); }
        emit(evt, arg) { (this.listeners[evt] || []).forEach(fn => fn(arg)); }

        /* ------------------------------------------------------------------ *
         * Run / level lifecycle
         * ------------------------------------------------------------------ */

        newRun(seedStr) {
            this.seedStr = seedStr;
            this.seed = F.hashSeed(seedStr);
            this.rng = F.mulberry32(this.seed ^ 0xabcdef);
            this.terrain = new F.Terrain(this.seed);
            this.forts = new F.FortManager(this);
            this.flow = new F.FlowField(this);

            this.buildings = [];
            this.buildingGrid = new Int32Array(F.GRID_W * F.GRID_H);
            this.attackers = [];
            this.projectiles = [];
            this.effects = [];
            this.messages = [];

            this.gold = B().startGold;
            this.level = 1;
            this.wave = 1;
            this.civiliansLost = 0;
            this.kills = 0;
            this.spawnQueue = [];
            this.combatTime = 0;
            this.spawnEdges = [];

            this.tool = 'inspect';
            this.wallTier = 0;
            this.towerTier = 0;
            this.wallNodes = [];
            this.preview = null;
            this.hover = null;
            this.selected = null;

            this.placeVillage();
            this.flow.recompute();
            this.message('A sheltered ravine. Wall off its mouth before the raiders come.', 'good');
            this.emit('state');
            this.emit('newmap');
        }

        /** The keep sits at the heart of the box canyon. */
        placeVillage() {
            const bowl = this.terrain.bowl;
            const kx = Math.round(bowl.x), ky = Math.round(bowl.z);
            this.addBuilding('keep', kx, ky, B().keepHp);
            this.growVillage(4);
        }

        addBuilding(kind, gx, gy, hp) {
            const b = {
                kind, gx, gy,
                x: F.cellCx(gx), y: F.cellCy(gy),
                hp, maxHp: hp,
                footprint: kind === 'keep' ? 2 : 1,   // half-extent in cells
                attackR: kind === 'keep' ? 3.6 : 2.6, // melee reach to strike it
                civilians: kind === 'house' ? B().civPerHouse : B().civPerHouse * 2,
                rot: this.rng() * Math.PI * 2
            };
            this.buildings.push(b);
            const id = this.buildings.length; // 1-based
            const fp = b.footprint;
            for (let dy = -fp; dy <= fp; dy++) {
                for (let dx = -fp; dx <= fp; dx++) {
                    if (F.inGrid(gx + dx, gy + dy)) {
                        this.buildingGrid[F.idx(gx + dx, gy + dy)] = id;
                    }
                }
            }
            return b;
        }

        buildingAt(gx, gy) {
            if (!F.inGrid(gx, gy)) return null;
            const i = this.buildingGrid[F.idx(gx, gy)];
            if (!i) return null;
            const b = this.buildings[i - 1];
            return b.hp > 0 ? b : null;
        }

        /** Add houses in an expanding ring around the keep. */
        growVillage(count) {
            const keep = this.buildings[0];
            const t = this.terrain;
            const baseR = 7 + this.level * 3.2;
            let placed = 0, tries = 0;
            while (placed < count && tries < 1200) {
                tries++;
                const ang = this.rng() * Math.PI * 2;
                const r = baseR + this.rng() * (5 + this.level);
                const gx = Math.round(keep.gx + Math.cos(ang) * r);
                const gy = Math.round(keep.gy + Math.sin(ang) * r * 0.85);
                if (!F.inGrid(gx, gy) || gx < 5 || gy < 5 || gx > F.GRID_W - 6 || gy > F.GRID_H - 6) continue;
                if (t.slopeAtCell(gx, gy) > 0.45) continue;
                if (this.buildingAt(gx, gy) || this.forts.pieceAt(gx, gy) || this.forts.towerAt(gx, gy)) continue;
                let blocked = false;
                for (let dy = -3; dy <= 3 && !blocked; dy++) {
                    for (let dx = -3; dx <= 3; dx++) {
                        if (this.buildingAt(gx + dx, gy + dy) ||
                            this.forts.pieceAt(gx + dx, gy + dy) ||
                            (Math.abs(dx) <= 1 && Math.abs(dy) <= 1 && t.cliff[F.idx(F.clamp(gx + dx, 0, F.GRID_W - 1), F.clamp(gy + dy, 0, F.GRID_H - 1))])) {
                            blocked = true; break;
                        }
                    }
                }
                if (blocked) continue;
                this.addBuilding('house', gx, gy, B().houseHp);
                placed++;
            }
            this.forts.markDirty();
            this.emit('buildings');
        }

        civilianStats() {
            let total = 0, prot = 0;
            for (const b of this.buildings) {
                if (b.hp <= 0) continue;
                total += b.civilians;
                if (this.forts.isProtected(b.gx, b.gy)) prot += b.civilians;
            }
            return { total, protected: prot };
        }

        /* ------------------------------------------------------------------ *
         * Waves
         * ------------------------------------------------------------------ */

        startWave() {
            if (this.state !== 'build') return;
            this.state = 'combat';
            this.combatTime = 0;
            this.spawnQueue = [];
            this.cancelWallDraw();

            const groups = F.composeWave(this.level, this.wave);
            // Early raids come up the ravine; later armies also cross the plateau.
            const primaryEdge = this.level <= 2 ? 0 : Math.floor(Math.random() * 4);
            const secondEdge = (primaryEdge + 1 + Math.floor(Math.random() * 3)) % 4;
            this.spawnEdges = [primaryEdge];

            groups.forEach((grp, gi) => {
                const edge = gi >= 3 ? secondEdge : primaryEdge;
                if (edge === secondEdge && !this.spawnEdges.includes(secondEdge)) {
                    this.spawnEdges.push(secondEdge);
                }
                const anchor = 0.15 + Math.random() * 0.7; // along the edge
                for (let i = 0; i < grp.count; i++) {
                    this.spawnQueue.push({
                        time: grp.delay + i * 0.5 + Math.random() * 0.6,
                        type: grp.type, edge,
                        along: F.clamp(anchor + (Math.random() - 0.5) * 0.22, 0.03, 0.97)
                    });
                }
            });
            this.spawnQueue.sort((a, b) => a.time - b.time);
            // Beacon markers where the assault will enter the map.
            this.spawnBeacons = [];
            for (const edge of this.spawnEdges) {
                const cell = this.findSpawnCell(edge, 0.5);
                if (cell) this.spawnBeacons.push({ x: F.cellCx(cell[0]), y: F.cellCy(cell[1]) });
            }
            this.message(`Wave ${this.wave} of ${F.wavesInLevel(this.level)} — they come!`, 'bad');
            this.emit('state');
        }

        /** Walkable spawn cell on the given edge: not a cliff, can reach targets. */
        findSpawnCell(edge, along) {
            const W = F.GRID_W - 1, H = F.GRID_H - 1;
            const cellAt = (a) => {
                if (edge === 0) return [Math.round(F.clamp(a, 0.02, 0.98) * W), 2];
                if (edge === 1) return [W - 2, Math.round(F.clamp(a, 0.02, 0.98) * H)];
                if (edge === 2) return [Math.round(F.clamp(a, 0.02, 0.98) * W), H - 2];
                return [2, Math.round(F.clamp(a, 0.02, 0.98) * H)];
            };
            for (let k = 0; k < 60; k++) {
                const off = (k % 2 ? -1 : 1) * Math.ceil(k / 2) * 0.02;
                const [gx, gy] = cellAt(along + off);
                if (!this.terrain.cliff[F.idx(gx, gy)] && this.flow.dist[F.idx(gx, gy)] < Infinity) {
                    return [gx, gy];
                }
            }
            return null;
        }

        spawnAttacker(entry) {
            const cell = this.findSpawnCell(entry.edge, entry.along) ||
                         this.findSpawnCell(0, 0.5); // ravine approach always works
            if (!cell) return;
            const scale = F.waveScale(this.level, this.difficulty);
            this.attackers.push(new F.Attacker(entry.type, F.cellCx(cell[0]), F.cellCy(cell[1]), scale));
        }

        onWaveEnd() {
            const b = B();
            const civ = this.civilianStats();
            let income = b.incomeBase + this.level * b.incomePerLevel + civ.protected * b.incomePerCivilian;
            const keep = this.buildings[0];
            if (this.forts.enclosureHasGate(keep.gx, keep.gy)) {
                income = Math.round(income * b.gateIncomeMult);
                const pct = Math.round((b.gateIncomeMult - 1) * 100);
                this.message(`Trade flows through your gate: +${pct}% income.`, 'good');
            }
            this.gold += income;
            this.message(`Wave repelled! +${income} gold. ${civ.protected}/${civ.total} civilians behind walls.`, 'good');

            if (this.wave >= F.wavesInLevel(this.level)) {
                this.levelUp();
            } else {
                this.wave++;
            }
            this.state = 'build';
            this.emit('state');
        }

        levelUp() {
            this.level++;
            this.wave = 1;
            const b = B();
            const grant = b.levelGrantBase + this.level * b.levelGrantPerLevel;
            this.gold += grant;
            const newHouses = b.housesPerLevelBase + Math.floor(this.level / 2);
            const prevEra = F.eraForLevel(this.level - 1);
            const era = F.eraForLevel(this.level);
            this.growVillage(newHouses);
            this.message(`Level ${this.level}. The village grows: ${newHouses} new households settle. +${grant} gold.`, 'good');
            if (era.key !== prevEra.key) {
                this.message(`⚠ A new age dawns: ${era.name}. Expect ${era.key === 'iron' ? 'armored troops and battering rams' : 'siege engines, sappers and trebuchets'}.`, 'bad');
            }
        }

        defeat() {
            this.state = 'gameover';
            this.message('The keep has fallen. The land is lost.', 'bad');
            this.emit('state');
        }

        /* ------------------------------------------------------------------ *
         * Main loop
         * ------------------------------------------------------------------ */

        _frame(now) {
            const raw = Math.min(0.1, (now - this._last) / 1000);
            this._last = now;
            if (!this.paused && this.state !== 'menu') {
                let dt = raw * this.speed;
                while (dt > 0) {
                    const step = Math.min(dt, 1 / 30);
                    this.update(step);
                    dt -= step;
                }
            }
            if (this.renderer) this.renderer.render(this, raw);
            this.emit('frame');
            requestAnimationFrame(this._frame.bind(this));
        }

        update(dt) {
            this.flow.update(dt);
            if (this.forts.outsideDirty) this.forts.recomputeOutside();

            if (this.state === 'combat') {
                this.combatTime += dt;
                while (this.spawnQueue.length && this.spawnQueue[0].time <= this.combatTime) {
                    this.spawnAttacker(this.spawnQueue.shift());
                }
                this.updateAttackers(dt);
                if (this.spawnQueue.length === 0 && this.attackers.length === 0) {
                    this.onWaveEnd();
                }
            }
            this.updateTowers(dt);
            this.updateOil(dt);
            this.updateProjectiles(dt);
            this.effects = this.effects.filter(e => (e.t += dt) < e.dur);
        }

        /* ------------------------------------------------------------------ *
         * Combat
         * ------------------------------------------------------------------ */

        /** Melee damage falls off when striking up at a raised wall. */
        meleeMult(attacker, piece) {
            const rate = attacker.type.special === 'ram' ? B().ramFalloff : B().meleeFalloff;
            const diff = Math.max(0, (piece.elev + F.WALL_TIERS[piece.tier].height) - this.terrain.heightAtPx(attacker.x, attacker.y));
            return 1 / (1 + diff * rate);
        }

        updateAttackers(dt) {
            const forts = this.forts;
            for (const a of this.attackers) {
                if (a.dead) continue;
                a.cooldown -= dt;
                if (a.slow > 0) a.slow -= dt;

                // Sapper charge counts down even while standing still.
                if (a.fuse >= 0) {
                    a.fuse -= dt;
                    if (a.fuse <= 0) this.sapperExplode(a);
                    continue;
                }

                const special = a.type.special;
                if (special === 'artillery' && this.artilleryAct(a, dt)) continue;
                if (special === 'ranged' && this.rangedAct(a, dt)) continue;
                if (special === 'siegetower' && a.docked) { this.siegeTowerAct(a, dt); continue; }

                // Adjacent building? Attack it.
                const bld = this.adjacentBuilding(a.x, a.y);
                if (bld) {
                    if (a.cooldown <= 0) {
                        a.cooldown = a.type.rate;
                        this.damageBuilding(bld, a.dmg);
                        this.effects.push({ kind: 'hit', x: bld.x, y: bld.y, t: 0, dur: 0.2, r: 1.3 });
                    }
                    continue;
                }

                const step = this.flow.nextStep(a.gx, a.gy);
                if (!step) continue;

                if (step.solid) {
                    const tx = F.cellCx(step.gx), ty = F.cellCy(step.gy);
                    if (F.dist(a.x, a.y, tx, ty) < F.CELL * 1.75) {
                        // Battering at the wall / tower
                        if (special === 'sapper') {
                            a.fuse = 2.2;
                            a.fuseTarget = { gx: step.gx, gy: step.gy };
                            this.message('A sapper sets a charge!', 'bad');
                            continue;
                        }
                        if (special === 'siegetower') {
                            a.docked = true;
                            a.dockTarget = { gx: step.gx, gy: step.gy };
                            this.message('A siege tower docks against your wall!', 'bad');
                            continue;
                        }
                        if (a.cooldown <= 0 && a.type.wallMult > 0) {
                            a.cooldown = a.type.rate;
                            const piece = forts.pieceAt(step.gx, step.gy);
                            if (piece) {
                                forts.damagePiece(piece, a.dmg * a.type.wallMult * this.meleeMult(a, piece));
                            } else {
                                const tower = forts.towerAt(step.gx, step.gy);
                                if (tower) forts.damageTower(tower, a.dmg * a.type.wallMult);
                            }
                            this.effects.push({ kind: 'hit', x: tx, y: ty, t: 0, dur: 0.2, r: 1.1 });
                        }
                        continue;
                    }
                    this.moveToward(a, tx, ty, dt);
                    continue;
                }
                let tx = F.cellCx(step.gx) + a.jx, ty = F.cellCy(step.gy) + a.jy;
                if (F.dist(a.x, a.y, tx, ty) < 0.8) { tx = F.cellCx(step.gx); ty = F.cellCy(step.gy); }
                this.moveToward(a, tx, ty, dt);
            }
            this.attackers = this.attackers.filter(a => !a.dead);
        }

        moveToward(a, tx, ty, dt) {
            const i = F.idx(a.gx, a.gy);
            let speed = a.type.speed / (1 + F.clamp(this.terrain.slope[i], 0, 1.6) * 1.1);
            if (this.forts.moat[i]) speed *= B().moatSlow;
            if (a.slow > 0) speed *= 0.5;
            const d = F.dist(a.x, a.y, tx, ty);
            if (d < 0.5) return;
            a.heading = Math.atan2(tx - a.x, ty - a.y); // yaw for the 3D renderer
            const k = Math.min(1, speed * dt / d);
            a.x += (tx - a.x) * k;
            a.y += (ty - a.y) * k;
            this.checkStakes(a);
        }

        checkStakes(a) {
            const key = F.idx(a.gx, a.gy);
            const st = this.forts.stakes.get(key);
            if (st && st.uses > 0) {
                st.uses--;
                this.damageAttacker(a, B().stakesDamage);
                a.slow = B().stakesSlow;
                this.effects.push({ kind: 'hit', x: a.x, y: a.y, t: 0, dur: 0.25, r: 1.2 });
                if (st.uses <= 0) this.forts.stakes.delete(key);
            }
        }

        /** Ranged infantry: shoot towers first, then buildings in range. */
        rangedAct(a, dt) {
            const myElev = this.terrain.heightAtPx(a.x, a.y);
            let target = null, kind = null, bestD = Infinity;
            for (const t of this.forts.towers) {
                const eff = a.type.range * (1 + Math.max(0, myElev - t.elev) * 0.03);
                const d = F.dist(a.x, a.y, t.x, t.y);
                if (d < eff && d < bestD) { bestD = d; target = t; kind = 'tower'; }
            }
            if (!target) {
                for (const b of this.buildings) {
                    if (b.hp <= 0) continue;
                    const d = F.dist(a.x, a.y, b.x, b.y);
                    if (d < a.type.range && d < bestD) { bestD = d; target = b; kind = 'building'; }
                }
            }
            if (!target) return false;
            if (a.cooldown <= 0) {
                a.cooldown = a.type.rate;
                const dmg = a.dmg;
                this.projectiles.push(new F.Projectile(a.x, a.y, target.x, target.y, 32, 'arrow', (g) => {
                    if (kind === 'tower' && g.forts.towers.includes(target)) g.forts.damageTower(target, dmg);
                    else if (kind === 'building' && target.hp > 0) g.damageBuilding(target, dmg);
                }));
            }
            return true;
        }

        /** Catapults & trebuchets: bombard walls and towers from range. */
        artilleryAct(a, dt) {
            const myElev = this.terrain.heightAtPx(a.x, a.y);
            const effRange = (t) => a.type.range * (1 + Math.max(0, myElev - t) * 0.03);
            let target = null, bestD = Infinity;
            for (const p of this.forts.pieces.values()) {
                const px = F.cellCx(p.gx), py = F.cellCy(p.gy);
                const d = F.dist(a.x, a.y, px, py);
                if (d < effRange(p.elev) && d < bestD) { bestD = d; target = { x: px, y: py }; }
            }
            for (const t of this.forts.towers) {
                const d = F.dist(a.x, a.y, t.x, t.y);
                if (d < effRange(t.elev) && d < bestD) { bestD = d; target = { x: t.x, y: t.y }; }
            }
            if (!target) return false;
            if (a.cooldown <= 0) {
                a.cooldown = a.type.rate;
                const dmg = a.dmg;
                const scatter = 1.8;
                const tx = target.x + (Math.random() - 0.5) * scatter;
                const ty = target.y + (Math.random() - 0.5) * scatter;
                this.projectiles.push(new F.Projectile(a.x, a.y, tx, ty, 17, 'stone', (g, hx, hy) => {
                    g.effects.push({ kind: 'explosion', x: hx, y: hy, t: 0, dur: 0.45, r: 3.4 });
                    g.areaDamageDefenses(hx, hy, 3.4, dmg);
                }));
            }
            return true;
        }

        siegeTowerAct(a, dt) {
            if (a.deployed >= 6) {
                // Crew abandons the spent tower; it collapses.
                a.dead = true;
                this.effects.push({ kind: 'explosion', x: a.x, y: a.y, t: 0, dur: 0.6, r: 3 });
                return;
            }
            if (a.cooldown > 0) return;
            a.cooldown = a.type.rate;
            const { gx, gy } = a.dockTarget;
            if (!this.forts.pieceAt(gx, gy) && !this.forts.towerAt(gx, gy)) {
                a.docked = false; // wall it docked on is gone; resume rolling
                return;
            }
            // Deploy over the wall: neighbor cell with the lowest flow distance.
            let best = null, bestD = Infinity;
            for (let dy = -1; dy <= 1; dy++) {
                for (let dx = -1; dx <= 1; dx++) {
                    const nx = gx + dx, ny = gy + dy;
                    if (!F.inGrid(nx, ny) || this.flow.isSolid(nx, ny)) continue;
                    const d = this.flow.dist[F.idx(nx, ny)];
                    if (d < bestD) { bestD = d; best = [nx, ny]; }
                }
            }
            if (best) {
                const scale = F.waveScale(this.level, this.difficulty);
                const u = new F.Attacker('swordsman', F.cellCx(best[0]), F.cellCy(best[1]), scale);
                this.attackers.push(u);
                a.deployed++;
                this.effects.push({ kind: 'hit', x: u.x, y: u.y, t: 0, dur: 0.3, r: 1.5 });
            }
        }

        sapperExplode(a) {
            a.dead = true;
            const r = B().sapperRadius;
            this.effects.push({ kind: 'explosion', x: a.x, y: a.y, t: 0, dur: 0.6, r: r + 0.5 });
            this.areaDamageDefenses(a.x, a.y, r, B().sapperDamage);
        }

        /** Damage walls and towers in a radius (siege blasts). */
        areaDamageDefenses(x, y, r, dmg) {
            const g0x = F.toCell(x - r), g1x = F.toCell(x + r);
            const g0y = F.toCellY(y - r), g1y = F.toCellY(y + r);
            const hit = [];
            for (let gy = g0y; gy <= g1y; gy++) {
                for (let gx = g0x; gx <= g1x; gx++) {
                    if (F.dist(F.cellCx(gx), F.cellCy(gy), x, y) > r) continue;
                    const p = this.forts.pieceAt(gx, gy);
                    if (p && !hit.includes(p)) hit.push(p);
                    const t = this.forts.towerAt(gx, gy);
                    if (t && !hit.includes(t)) hit.push(t);
                }
            }
            for (const obj of hit) {
                if (this.forts.pieces.has(obj.id)) this.forts.damagePiece(obj, dmg);
                else if (this.forts.towers.includes(obj)) this.forts.damageTower(obj, dmg);
            }
            // Splash also hurts buildings at the epicenter.
            const b = this.nearestBuilding(x, y, r);
            if (b) this.damageBuilding(b, dmg * 0.5);
        }

        nearestBuilding(x, y, maxDist) {
            let best = null, bestD = maxDist;
            for (const b of this.buildings) {
                if (b.hp <= 0) continue;
                const d = F.dist(x, y, b.x, b.y);
                if (d < bestD) { bestD = d; best = b; }
            }
            return best;
        }

        /** Building within melee reach (buildings have physical footprints). */
        adjacentBuilding(x, y) {
            for (const b of this.buildings) {
                if (b.hp > 0 && F.dist(x, y, b.x, b.y) < b.attackR) return b;
            }
            return null;
        }

        damageBuilding(b, dmg) {
            if (b.hp <= 0) return;
            b.hp -= dmg;
            if (b.hp <= 0) {
                b.hp = 0;
                for (let dy = -b.footprint; dy <= b.footprint; dy++) {
                    for (let dx = -b.footprint; dx <= b.footprint; dx++) {
                        if (F.inGrid(b.gx + dx, b.gy + dy)) {
                            this.buildingGrid[F.idx(b.gx + dx, b.gy + dy)] = 0;
                        }
                    }
                }
                this.emit('buildings');
                this.effects.push({ kind: 'explosion', x: b.x, y: b.y, t: 0, dur: 0.7, r: 4 });
                if (b.kind === 'keep') {
                    this.defeat();
                } else {
                    this.civiliansLost += b.civilians;
                    this.message(`A house burns — ${b.civilians} civilians lost.`, 'bad');
                    this.flow.dirty = true;
                }
            }
        }

        damageAttacker(a, dmg) {
            if (a.dead) return;
            a.hp -= dmg;
            if (a.hp <= 0) {
                a.dead = true;
                this.kills++;
                this.gold += a.type.bounty;
                this.effects.push({ kind: 'death', x: a.x, y: a.y, t: 0, dur: 0.4, r: a.type.radius + 0.6 });
            }
        }

        onWallBreached(piece) {
            this.effects.push({
                kind: 'explosion',
                x: F.cellCx(piece.gx), y: F.cellCy(piece.gy),
                t: 0, dur: 0.5, r: 2.4
            });
            if (this.state === 'combat') this.message('Your wall is breached!', 'bad');
        }

        /* ------------------------------------------------------------------ *
         * Defenses
         * ------------------------------------------------------------------ */

        updateTowers(dt) {
            for (const t of this.forts.towers) {
                t.cooldown -= dt;
                if (t.cooldown > 0 || this.attackers.length === 0) continue;
                const stats = F.TOWER_TIERS[t.tier];
                let target = null, bestScore = -Infinity;
                for (const a of this.attackers) {
                    if (a.dead) continue;
                    const aElev = this.terrain.heightAtPx(a.x, a.y);
                    // High ground extends reach — build on hills and walls.
                    const eff = stats.range * (1 + Math.max(0, t.elev - aElev) * 0.03);
                    const d = F.dist(t.x, t.y, a.x, a.y);
                    if (d > eff) continue;
                    // Ballistae prefer siege engines; others shoot the closest.
                    const score = t.tier === 2 ? a.maxHp : -d;
                    if (score > bestScore) { bestScore = score; target = a; }
                }
                if (!target) continue;
                t.cooldown = stats.rate;
                const dmg = stats.dmg * B().towerDamageMult, aoe = stats.aoe;
                const tgt = target;
                this.projectiles.push(new F.Projectile(
                    t.x, t.y, tgt.x, tgt.y, stats.projectile === 'bolt' ? 45 : 34, stats.projectile,
                    (g, hx, hy) => {
                        if (aoe > 0) {
                            g.effects.push({ kind: 'hit', x: hx, y: hy, t: 0, dur: 0.25, r: aoe });
                            for (const a of g.attackers) {
                                if (!a.dead && F.dist(a.x, a.y, hx, hy) <= aoe + a.type.radius) {
                                    g.damageAttacker(a, dmg);
                                    if (a.dead) t.kills++;
                                }
                            }
                        } else if (!tgt.dead && F.dist(tgt.x, tgt.y, hx, hy) < 2.2) {
                            g.damageAttacker(tgt, dmg);
                            if (tgt.dead) t.kills++;
                        }
                    }
                ));
            }
        }

        updateOil(dt) {
            const b = B();
            const oilR = b.oilRadius;
            for (const p of this.forts.pieces.values()) {
                if (!p.oil) continue;
                p.oil.cooldown -= dt;
                if (p.oil.cooldown > 0) continue;
                const px = F.cellCx(p.gx), py = F.cellCy(p.gy);
                let any = false;
                for (const a of this.attackers) {
                    if (!a.dead && F.dist(a.x, a.y, px, py) < oilR) { any = true; break; }
                }
                if (!any) continue;
                p.oil.cooldown = b.oilCooldown;
                this.effects.push({ kind: 'oil', x: px, y: py, t: 0, dur: 0.6, r: oilR });
                for (const a of this.attackers) {
                    if (!a.dead && F.dist(a.x, a.y, px, py) < oilR + a.type.radius) {
                        this.damageAttacker(a, b.oilDamage);
                    }
                }
            }
        }

        updateProjectiles(dt) {
            for (const p of this.projectiles) p.update(dt, this);
            this.projectiles = this.projectiles.filter(p => !p.dead);
        }

        /* ------------------------------------------------------------------ *
         * Player tools & input
         * ------------------------------------------------------------------ */

        setTool(tool) {
            this.tool = tool;
            this.cancelWallDraw();
            this.selected = null;
            this.emit('tool');
        }

        cancelWallDraw() {
            this.wallNodes = [];
            this.preview = null;
        }

        attackerNear(gx, gy) {
            const cx = F.cellCx(gx), cy = F.cellCy(gy);
            return this.attackers.some(a => !a.dead && F.dist(a.x, a.y, cx, cy) < F.CELL * 1.5);
        }

        pointerMove(x, y) {
            // Organic snapping: wall drawing magnetizes to existing masonry.
            if (this.tool === 'wall' || this.tool === 'gatewall') {
                const snap = this.forts.snapPoint(x, y, 2.2);
                if (snap) { x = snap.x; y = snap.y; }
            }
            this.hover = { x, y, gx: F.toCell(x), gy: F.toCellY(y) };
            if (this.tool === 'wall' || this.tool === 'gatewall') {
                if (this.wallNodes.length > 0) {
                    const nodes = this.wallNodes.concat([{ x, y }]);
                    this.preview = {
                        plan: this.forts.planWall(nodes, this.wallTier, this.tool === 'gatewall'),
                        tier: this.wallTier, isGate: this.tool === 'gatewall'
                    };
                }
            }
            this.emit('hover');
        }

        pointerDown(x, y, button) {
            const gx = F.toCell(x), gy = F.toCellY(y);
            if (this.state === 'gameover' || this.state === 'menu') return;

            if (button === 2) { // right-click: undo node / cancel
                if (this.wallNodes.length > 0) {
                    this.wallNodes.pop();
                    if (this.wallNodes.length === 0) this.preview = null;
                    else this.pointerMove(x, y);
                }
                return;
            }

            switch (this.tool) {
                case 'wall':
                case 'gatewall': {
                    const snap = this.forts.snapPoint(x, y, 2.2);
                    this.wallNodes.push(snap ? { x: snap.x, y: snap.y } : { x, y });
                    this.pointerMove(x, y);
                    break;
                }
                case 'tower': this.tryPlaceTower(gx, gy); break;
                case 'oil': this.tryPlaceOil(gx, gy); break;
                case 'stakes': this.tryPlaceStakes(gx, gy); break;
                case 'moat': this.tryDigMoat(gx, gy); break;
                case 'upgrade': this.tryUpgrade(gx, gy); break;
                case 'repair': this.tryRepair(gx, gy); break;
                case 'demolish': this.tryDemolish(gx, gy); break;
                default: this.select(gx, gy); break;
            }
        }

        pointerDrag(x, y) {
            if (this.tool === 'moat') this.tryDigMoat(F.toCell(x), F.toCellY(y), true);
        }

        commitWall() {
            if (!this.preview || this.wallNodes.length < 2) {
                // allow single-node + hover commit
                if (!this.preview) return;
            }
            const { plan, tier, isGate } = this.preview;
            if (!plan.valid) { this.message(plan.reason || 'Invalid wall path.', 'bad'); return; }
            if (plan.cost > this.gold) { this.message(`Not enough gold (${plan.cost} needed).`, 'bad'); return; }
            if (plan.cells.some(([gx, gy]) => this.attackerNear(gx, gy))) {
                this.message('Enemies are standing on the build site!', 'bad');
                return;
            }
            this.gold -= plan.cost;
            this.forts.buildWall(plan, tier, isGate);
            this.message(`${isGate ? 'Gatehouse' : F.WALL_TIERS[tier].name} built (${plan.cells.length} sections, ${plan.cost}g).`, 'good');
            this.cancelWallDraw();
        }

        tryPlaceTower(gx, gy) {
            const stats = F.TOWER_TIERS[this.towerTier];
            if (!this.forts.canPlaceTower(gx, gy)) { this.message('Cannot build a tower there.', 'bad'); return; }
            if (this.gold < stats.cost) { this.message(`Not enough gold (${stats.cost} needed).`, 'bad'); return; }
            if (this.attackerNear(gx, gy)) { this.message('Enemies too close to build!', 'bad'); return; }
            this.gold -= stats.cost;
            const t = this.forts.placeTower(gx, gy, this.towerTier);
            this.message(`${stats.name} raised${t.onWall ? ' on the wall — commanding view!' : ''} (${stats.cost}g).`, 'good');
        }

        tryPlaceOil(gx, gy) {
            const piece = this.forts.pieceAt(gx, gy);
            if (!piece) { this.message('Oil cauldrons sit on wall sections.', 'bad'); return; }
            if (piece.oil) { this.message('That section already has a cauldron.', 'bad'); return; }
            if (this.gold < F.DEFENSE_COSTS.oil) { this.message(`Not enough gold (${F.DEFENSE_COSTS.oil} needed).`, 'bad'); return; }
            this.gold -= F.DEFENSE_COSTS.oil;
            this.forts.placeOil(piece);
            this.message('Oil cauldron mounted.', 'good');
        }

        tryPlaceStakes(gx, gy) {
            if (!this.forts.cellBuildable(gx, gy, true) || this.forts.pieceAt(gx, gy)) {
                this.message('Stakes need open ground.', 'bad'); return;
            }
            if (this.forts.stakes.has(F.idx(gx, gy))) return;
            if (this.gold < F.DEFENSE_COSTS.stakes) { this.message(`Not enough gold (${F.DEFENSE_COSTS.stakes} needed).`, 'bad'); return; }
            this.gold -= F.DEFENSE_COSTS.stakes;
            this.forts.placeStakes(gx, gy);
        }

        tryDigMoat(gx, gy, silent) {
            if (this.forts.moat[F.idx(gx, gy)]) return;
            if (!this.forts.cellBuildable(gx, gy, true) || this.forts.pieceAt(gx, gy) || this.forts.stakes.has(F.idx(gx, gy))) {
                if (!silent) this.message('Moats need open ground.', 'bad');
                return;
            }
            if (this.gold < F.DEFENSE_COSTS.moat) { if (!silent) this.message('Not enough gold.', 'bad'); return; }
            this.gold -= F.DEFENSE_COSTS.moat;
            this.forts.digMoat(gx, gy);
        }

        tryUpgrade(gx, gy) {
            const piece = this.forts.pieceAt(gx, gy);
            if (!piece) { this.message('Click a wall to upgrade it.', 'bad'); return; }
            if (piece.tier >= F.WALL_TIERS.length - 1) { this.message('Already at the highest tier.', 'bad'); return; }
            const run = this.forts.contiguousRun(piece, true);
            const cost = this.forts.upgradeCost(run);
            if (cost > this.gold) { this.message(`Upgrading this ${run.length}-section run costs ${cost}g.`, 'bad'); return; }
            this.gold -= cost;
            this.forts.upgradeRun(run);
            this.message(`${run.length} sections upgraded to ${F.WALL_TIERS[run[0].tier].name} (${cost}g).`, 'good');
        }

        tryRepair(gx, gy) {
            const tower = this.forts.towerAt(gx, gy);
            if (tower) {
                const stats = F.TOWER_TIERS[tower.tier];
                const cost = Math.round((1 - tower.hp / tower.maxHp) * stats.cost * 0.5);
                if (cost === 0) return;
                if (cost > this.gold) { this.message(`Repair costs ${cost}g.`, 'bad'); return; }
                this.gold -= cost;
                tower.hp = tower.maxHp;
                this.message(`Tower repaired (${cost}g).`, 'good');
                return;
            }
            const piece = this.forts.pieceAt(gx, gy);
            if (!piece) { this.message('Click a wall or tower to repair.', 'bad'); return; }
            const run = this.forts.contiguousRun(piece, false);
            const cost = this.forts.repairCost(run);
            if (cost === 0) { this.message('No damage to repair.', 'good'); return; }
            if (cost > this.gold) { this.message(`Repairing this wall costs ${cost}g.`, 'bad'); return; }
            this.gold -= cost;
            this.forts.repairRun(run);
            this.message(`Wall repaired (${cost}g).`, 'good');
        }

        tryDemolish(gx, gy) {
            const key = F.idx(gx, gy);
            const tower = this.forts.towerAt(gx, gy);
            if (tower) {
                this.gold += Math.round(F.TOWER_TIERS[tower.tier].cost * 0.3);
                this.forts.removeTower(tower);
                return;
            }
            const piece = this.forts.pieceAt(gx, gy);
            if (piece) {
                this.gold += Math.round(F.WALL_TIERS[piece.tier].cost * 0.3);
                this.forts.pieces.delete(piece.id);
                this.forts.wallGrid[key] = 0;
                this.forts.markDirty();
                return;
            }
            if (this.forts.stakes.has(key)) { this.forts.stakes.delete(key); return; }
            if (this.forts.moat[key]) { this.forts.moat[key] = 0; this.forts.markDirty(); }
        }

        select(gx, gy) {
            const tower = this.forts.towerAt(gx, gy);
            if (tower) { this.selected = { kind: 'tower', obj: tower }; return; }
            const piece = this.forts.pieceAt(gx, gy);
            if (piece) { this.selected = { kind: 'wall', obj: piece }; return; }
            const bld = this.buildingAt(gx, gy);
            if (bld) { this.selected = { kind: 'building', obj: bld }; return; }
            const cx = F.cellCx(gx), cy = F.cellCy(gy);
            for (const a of this.attackers) {
                if (!a.dead && F.dist(a.x, a.y, cx, cy) < a.type.radius + 1.2) {
                    this.selected = { kind: 'attacker', obj: a };
                    return;
                }
            }
            this.selected = null;
        }

        message(text, cls) {
            this.messages.push({ text, cls: cls || '', time: Date.now() });
            if (this.messages.length > 40) this.messages.shift();
            this.emit('message');
        }
    }

    F.Game = Game;
})();
