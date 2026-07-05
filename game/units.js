/**
 * Attacker unit definitions across three eras, plus projectiles.
 *
 * speed  m/s           range  0 = melee, else metres
 * dmg    per hit       rate   seconds between hits
 * wallMult  damage multiplier vs walls/towers
 * special: 'ram' | 'sapper' | 'siegetower' | 'artillery' | 'ranged' | 'boss'
 */
(function () {
    const F = window.Fortress;

    F.ERAS = [
        { key: 'bronze',   name: 'Bronze Age',    levels: [1, 3] },
        { key: 'iron',     name: 'Iron Age',      levels: [4, 6] },
        { key: 'medieval', name: 'Medieval Era',  levels: [7, 99] }
    ];

    F.UNIT_TYPES = {
        // --- Bronze Age -----------------------------------------------------
        raider: {
            name: 'Raider', era: 'bronze', hp: 34, speed: 4.4, dmg: 5, rate: 0.9,
            range: 0, wallMult: 0.3, radius: 0.45, bounty: 6, color: '#c46a3a',
            desc: 'Fast, lightly armed. Swarms weak points and burns houses.'
        },
        spearman: {
            name: 'Spearman', era: 'bronze', hp: 62, speed: 3.4, dmg: 9, rate: 1.0,
            range: 0, wallMult: 0.7, radius: 0.5, bounty: 9, color: '#a8542e',
            desc: 'Bronze-tipped spears. Steady wall-breakers in numbers.'
        },
        slinger: {
            name: 'Slinger', era: 'bronze', hp: 30, speed: 3.8, dmg: 8, rate: 1.4,
            range: 20, wallMult: 0.15, radius: 0.42, bounty: 8, color: '#d8964a',
            special: 'ranged',
            desc: 'Pelts your towers from range. Kill them before they whittle defenses.'
        },
        chieftain: {
            name: 'War Chieftain', era: 'bronze', hp: 420, speed: 2.8, dmg: 26, rate: 1.1,
            range: 0, wallMult: 1.2, radius: 0.8, bounty: 60, color: '#8c2f18',
            special: 'boss',
            desc: 'Bronze Age warlord. Hits walls hard and soaks arrows.'
        },
        // --- Iron Age --------------------------------------------------------
        swordsman: {
            name: 'Swordsman', era: 'iron', hp: 95, speed: 3.6, dmg: 13, rate: 0.85,
            range: 0, wallMult: 0.7, radius: 0.5, bounty: 12, color: '#7c8894',
            desc: 'Iron blades and shields. The backbone of the assault.'
        },
        archer: {
            name: 'Archer', era: 'iron', hp: 48, speed: 3.8, dmg: 12, rate: 1.2,
            range: 27, wallMult: 0.1, radius: 0.42, bounty: 12, color: '#5c7a4a',
            special: 'ranged',
            desc: 'Outranges watchtowers. Screens the assault troops.'
        },
        ram: {
            name: 'Battering Ram', era: 'iron', hp: 520, speed: 1.6, dmg: 65, rate: 1.6,
            range: 0, wallMult: 6, radius: 0.95, bounty: 45, color: '#6a4a26',
            special: 'ram',
            desc: 'Crawls to your gate and smashes through. Weak to dropped oil.'
        },
        shieldbearer: {
            name: 'Shieldbearer', era: 'iron', hp: 210, speed: 2.8, dmg: 8, rate: 1.1,
            range: 0, wallMult: 0.5, radius: 0.6, bounty: 18, color: '#4a5a6a',
            desc: 'Heavy shields absorb tower fire while others climb.'
        },
        // --- Medieval ---------------------------------------------------------
        knight: {
            name: 'Knight', era: 'medieval', hp: 300, speed: 5.2, dmg: 22, rate: 0.8,
            range: 0, wallMult: 0.6, radius: 0.6, bounty: 30, color: '#3c4c74',
            desc: 'Fast, armored cavalry. Punishes any breach instantly.'
        },
        crossbowman: {
            name: 'Crossbowman', era: 'medieval', hp: 70, speed: 3.4, dmg: 26, rate: 1.6,
            range: 31, wallMult: 0.1, radius: 0.45, bounty: 18, color: '#2e5a3e',
            special: 'ranged',
            desc: 'Armor-piercing bolts shred towers and oil crews.'
        },
        sapper: {
            name: 'Sapper', era: 'medieval', hp: 85, speed: 4.8, dmg: 4, rate: 1,
            range: 0, wallMult: 1, radius: 0.45, bounty: 25, color: '#6a6a3a',
            special: 'sapper',
            desc: 'Sprints to the wall and sets a charge: 280 damage in a blast.'
        },
        catapult: {
            name: 'Catapult', era: 'medieval', hp: 380, speed: 1.4, dmg: 70, rate: 4.0,
            range: 38, wallMult: 1, radius: 0.95, bounty: 55, color: '#5a4632',
            special: 'artillery',
            desc: 'Lobs stones at walls and towers from range.'
        },
        siegetower: {
            name: 'Siege Tower', era: 'medieval', hp: 700, speed: 1.3, dmg: 0, rate: 2.0,
            range: 0, wallMult: 0, radius: 1.1, bounty: 70, color: '#7a6248',
            special: 'siegetower',
            desc: 'Docks against your wall and pours swordsmen over the top.'
        },
        trebuchet: {
            name: 'Trebuchet', era: 'medieval', hp: 450, speed: 1.0, dmg: 130, rate: 6.0,
            range: 48, wallMult: 1, radius: 1.05, bounty: 90, color: '#4a3a28',
            special: 'artillery',
            desc: 'Massive range. Counter it with ballistae on high ground.'
        },
        warlord: {
            name: 'Warlord', era: 'medieval', hp: 1500, speed: 2.6, dmg: 45, rate: 0.9,
            range: 0, wallMult: 1.5, radius: 0.9, bounty: 250, color: '#241c3c',
            special: 'boss',
            desc: 'The enemy commander takes the field himself.'
        }
    };

    let unitId = 1;

    class Attacker {
        constructor(typeKey, x, y, scale) {
            const t = F.UNIT_TYPES[typeKey];
            this.id = unitId++;
            this.typeKey = typeKey;
            this.type = t;
            this.x = x; this.y = y;
            this.hp = Math.round(t.hp * scale.hp);
            this.maxHp = this.hp;
            this.dmgScale = scale.dmg;
            this.cooldown = Math.random() * t.rate;
            this.slow = 0;              // remaining slow seconds (stakes)
            // Lane jitter must stay well inside one cell, or a unit's jittered
            // waypoint can land in its *current* cell and freeze it in place.
            this.jx = (Math.random() - 0.5) * F.CELL * 0.55;
            this.jy = (Math.random() - 0.5) * F.CELL * 0.55;
            this.fuse = -1;             // sapper charge timer
            this.deployed = 0;          // siege tower troops released
            this.docked = false;
            this.dead = false;
        }

        get gx() { return F.toCell(this.x); }
        get gy() { return F.toCellY(this.y); }
        get dmg() { return this.type.dmg * this.dmgScale; }
    }

    class Projectile {
        /** target: {x,y} snapshot; onHit(game, x, y) applied on arrival */
        constructor(x, y, tx, ty, speed, kind, onHit) {
            this.x = x; this.y = y;
            this.sx = x; this.sy = y;
            this.tx = tx; this.ty = ty;
            this.kind = kind;           // 'arrow' | 'bolt' | 'stone' | 'fire'
            this.onHit = onHit;
            this.t = 0;
            this.dur = Math.max(0.08, F.dist(x, y, tx, ty) / speed);
            this.dead = false;
        }

        update(dt, game) {
            this.t += dt;
            const k = Math.min(1, this.t / this.dur);
            this.x = F.lerp(this.sx, this.tx, k);
            this.y = F.lerp(this.sy, this.ty, k);
            if (k >= 1) {
                this.dead = true;
                this.onHit(game, this.tx, this.ty);
            }
        }

        /** Visual arc height for lobbed projectiles. */
        arcOffset() {
            if (this.kind !== 'stone') return 0;
            const k = Math.min(1, this.t / this.dur);
            const d = F.dist(this.sx, this.sy, this.tx, this.ty);
            return Math.sin(Math.PI * k) * Math.min(12, d * 0.3);
        }
    }

    F.Attacker = Attacker;
    F.Projectile = Projectile;
})();
