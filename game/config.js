/**
 * Central, user-tunable configuration.
 *
 * Every worldgen and game-balance constant that used to be hard-coded across
 * the engine now lives here, so it can be inspected and adjusted from the
 * settings panel (or the dev console) before a run. The defaults reproduce the
 * original behaviour exactly — nothing changes unless a value is tweaked.
 *
 *   F.CONFIG           live configuration read by the other modules
 *   F.CONFIG_DEFAULTS  pristine copy for "reset to defaults"
 *   F.CONFIG_SCHEMA    declarative description the UI renders controls from
 *   F.configGet/Set    nested path access, e.g. configGet('balance.startGold')
 */
(function () {
    const F = window.Fortress;

    const CONFIG = {
        terrain: {
            // 'valley'  = the forced box-canyon fortress (original behaviour)
            // 'fractal' = a random diamond-square landform, then eroded and
            //             filled so it weathers into natural valleys and ridges
            mode: 'valley',
            fractalOctaves: 7,        // diamond-square subdivisions (2^n + 1)
            fractalRoughness: 1.0,    // initial displacement amplitude
            reliefScale: 26,          // metres of vertical relief (fractal mode)
            baseHeight: 6,            // metres added under the whole map
            detailAmp: 0.7,           // fine fractal roughness layered on top
            // Hydraulic (droplet) erosion — carves drainage valleys.
            erosion: {
                enabled: true,
                droplets: 12000,      // number of rain droplets simulated
                lifetime: 34,         // max steps each droplet travels
                inertia: 0.05,        // 0 = follows gradient, 1 = keeps momentum
                capacity: 4.0,        // sediment a droplet can carry
                erosion: 0.3,         // how fast rock is picked up
                deposition: 0.1,      // how fast sediment settles
                evaporation: 0.02,    // water lost per step
                gravity: 4.0,         // acceleration downhill
                radius: 3,            // erosion brush radius (cells)
                minSlope: 0.01        // floor on carrying capacity on flats
            },
            // Depression filling (priority-flood) + smoothing — weathers the
            // eroded surface so water drains and pits are softened.
            fill: {
                enabled: true,
                epsilon: 0.002,       // drainage slope imposed while filling
                strength: 1.0,        // blend of filled surface over raw (0..1)
                smoothPasses: 2,      // box-blur passes after filling
                smoothStrength: 0.5   // blur blend per pass (0..1)
            }
        },

        // Organic render surface: seeded points → Lloyd relaxation → cliff
        // densification → Delaunay triangulation (game/render3d.js).
        mesh: {
            basePoints: 5200,         // seeded interior points
            lloydRounds: 2,           // centroidal-Voronoi relaxation rounds
            densifyCount: 2400,       // extra points added along steep ground
            densifyTries: 30000,      // rejection-sampling attempts budget
            densifySlope: 0.7,        // slope above which to densify
            boundaryStep: 2.5         // spacing of the rectangular hull ring
        },

        balance: {
            // --- Economy -----------------------------------------------------
            startGold: 850,
            keepHp: 2400,
            houseHp: 380,
            civPerHouse: 5,           // keep holds twice this
            incomeBase: 55,
            incomePerLevel: 12,
            incomePerCivilian: 4,     // per protected civilian, each wave
            gateIncomeMult: 1.25,     // gated enclosure trade bonus
            levelGrantBase: 160,
            levelGrantPerLevel: 55,
            housesPerLevelBase: 2,    // + floor(level / 2) new houses per level

            // --- Difficulty & enemy scaling ---------------------------------
            diffEasy: 0.75,
            diffNormal: 1.0,
            diffHard: 1.3,
            hpPerLevel: 0.10,         // enemy HP growth per level
            dmgPerLevel: 0.07,        // enemy damage growth per level
            enemyHpMult: 1.0,         // global multiplier on all enemy HP
            enemyDmgMult: 1.0,        // global multiplier on all enemy damage
            enemyCountMult: 1.0,      // global multiplier on wave sizes
            towerDamageMult: 1.0,     // global multiplier on tower damage

            // --- Combat / terrain advantage ---------------------------------
            meleeFalloff: 0.05,       // uphill damage falloff per metre
            ramFalloff: 0.02,         // rams shrug off height better

            // --- Field defenses ---------------------------------------------
            oilDamage: 65,
            oilCooldown: 9,
            oilRadius: 4.5,
            stakesDamage: 24,
            stakesUses: 6,
            stakesSlow: 2,            // seconds of slow inflicted
            moatSlow: 0.35,          // movement multiplier while wading
            sapperDamage: 280,
            sapperRadius: 4
        },

        // Dijkstra flow-field weights (siege AI: where armies converge).
        flow: {
            moatCostMult: 5,          // entry-cost multiplier for moat cells
            wallCost: 24,             // base cost of fighting through a wall
            gateCost: 16,             // gates are the cheapest way in
            towerCost: 30             // base cost of fighting through a tower
        }
    };

    F.CONFIG = CONFIG;
    F.CONFIG_DEFAULTS = JSON.parse(JSON.stringify(CONFIG));

    /* --------------------------- path helpers --------------------------- */

    F.configGet = function (path, root) {
        return path.split('.').reduce((o, k) => (o == null ? o : o[k]), root || CONFIG);
    };

    F.configSet = function (path, value, root) {
        const keys = path.split('.');
        const last = keys.pop();
        let o = root || CONFIG;
        for (const k of keys) o = o[k];
        o[last] = value;
    };

    /** Restore every value to its shipped default (in place). */
    F.resetConfig = function () {
        const fresh = JSON.parse(JSON.stringify(F.CONFIG_DEFAULTS));
        const copy = (dst, src) => {
            for (const k in src) {
                if (src[k] && typeof src[k] === 'object') copy(dst[k], src[k]);
                else dst[k] = src[k];
            }
        };
        copy(CONFIG, fresh);
    };

    /* --------------------------- UI schema ------------------------------ *
     * Groups of controls the settings panel renders. `fractal: true` marks a
     * group that only affects the eroded-fractal terrain mode.               */

    F.CONFIG_SCHEMA = [
        {
            title: 'World generation',
            controls: [
                { path: 'terrain.mode', label: 'Terrain', type: 'select',
                  options: [['valley', 'Forced valley'], ['fractal', 'Fractal + erosion']] },
                { path: 'terrain.fractalOctaves', label: 'Fractal octaves', type: 'number', min: 5, max: 8, step: 1, int: true, fractal: true },
                { path: 'terrain.fractalRoughness', label: 'Roughness', type: 'number', min: 0.3, max: 1.6, step: 0.05, fractal: true },
                { path: 'terrain.reliefScale', label: 'Relief (m)', type: 'number', min: 8, max: 40, step: 1, fractal: true },
                { path: 'terrain.baseHeight', label: 'Base height (m)', type: 'number', min: 0, max: 15, step: 1, fractal: true },
                { path: 'terrain.detailAmp', label: 'Fine detail', type: 'number', min: 0, max: 2, step: 0.1, fractal: true }
            ]
        },
        {
            title: 'Erosion (fractal)', fractal: true,
            controls: [
                { path: 'terrain.erosion.enabled', label: 'Erosion on', type: 'checkbox' },
                { path: 'terrain.erosion.droplets', label: 'Droplets', type: 'number', min: 0, max: 40000, step: 500, int: true },
                { path: 'terrain.erosion.lifetime', label: 'Droplet life', type: 'number', min: 4, max: 80, step: 1, int: true },
                { path: 'terrain.erosion.inertia', label: 'Inertia', type: 'number', min: 0, max: 0.95, step: 0.05 },
                { path: 'terrain.erosion.capacity', label: 'Capacity', type: 'number', min: 0.5, max: 12, step: 0.5 },
                { path: 'terrain.erosion.erosion', label: 'Erode rate', type: 'number', min: 0, max: 1, step: 0.05 },
                { path: 'terrain.erosion.deposition', label: 'Deposit rate', type: 'number', min: 0, max: 1, step: 0.05 },
                { path: 'terrain.erosion.evaporation', label: 'Evaporation', type: 'number', min: 0, max: 0.2, step: 0.01 },
                { path: 'terrain.erosion.gravity', label: 'Gravity', type: 'number', min: 1, max: 20, step: 0.5 },
                { path: 'terrain.erosion.radius', label: 'Brush radius', type: 'number', min: 0, max: 5, step: 1, int: true }
            ]
        },
        {
            title: 'Filling & weathering (fractal)', fractal: true,
            controls: [
                { path: 'terrain.fill.enabled', label: 'Fill on', type: 'checkbox' },
                { path: 'terrain.fill.epsilon', label: 'Drain slope', type: 'number', min: 0, max: 0.02, step: 0.001 },
                { path: 'terrain.fill.strength', label: 'Fill strength', type: 'number', min: 0, max: 1, step: 0.05 },
                { path: 'terrain.fill.smoothPasses', label: 'Smooth passes', type: 'number', min: 0, max: 6, step: 1, int: true },
                { path: 'terrain.fill.smoothStrength', label: 'Smooth blend', type: 'number', min: 0, max: 1, step: 0.05 }
            ]
        },
        {
            title: 'Organic mesh surface',
            controls: [
                { path: 'mesh.basePoints', label: 'Seed points', type: 'number', min: 800, max: 12000, step: 100, int: true },
                { path: 'mesh.lloydRounds', label: 'Lloyd rounds', type: 'number', min: 0, max: 6, step: 1, int: true },
                { path: 'mesh.densifyCount', label: 'Densify points', type: 'number', min: 0, max: 6000, step: 100, int: true },
                { path: 'mesh.densifySlope', label: 'Densify slope', type: 'number', min: 0.1, max: 1.5, step: 0.05 },
                { path: 'mesh.densifyTries', label: 'Densify budget', type: 'number', min: 1000, max: 80000, step: 1000, int: true },
                { path: 'mesh.boundaryStep', label: 'Hull spacing', type: 'number', min: 1, max: 6, step: 0.5 }
            ]
        },
        {
            title: 'Economy',
            controls: [
                { path: 'balance.startGold', label: 'Start gold', type: 'number', min: 0, max: 5000, step: 50, int: true },
                { path: 'balance.keepHp', label: 'Keep HP', type: 'number', min: 400, max: 8000, step: 100, int: true },
                { path: 'balance.houseHp', label: 'House HP', type: 'number', min: 80, max: 2000, step: 20, int: true },
                { path: 'balance.civPerHouse', label: 'Civ/house', type: 'number', min: 1, max: 20, step: 1, int: true },
                { path: 'balance.incomeBase', label: 'Income base', type: 'number', min: 0, max: 400, step: 5, int: true },
                { path: 'balance.incomePerLevel', label: 'Income/level', type: 'number', min: 0, max: 100, step: 1, int: true },
                { path: 'balance.incomePerCivilian', label: 'Income/civ', type: 'number', min: 0, max: 40, step: 1, int: true },
                { path: 'balance.gateIncomeMult', label: 'Gate income ×', type: 'number', min: 1, max: 3, step: 0.05 },
                { path: 'balance.levelGrantBase', label: 'Level grant', type: 'number', min: 0, max: 1000, step: 10, int: true },
                { path: 'balance.levelGrantPerLevel', label: 'Grant/level', type: 'number', min: 0, max: 400, step: 5, int: true },
                { path: 'balance.housesPerLevelBase', label: 'Houses/level', type: 'number', min: 0, max: 12, step: 1, int: true }
            ]
        },
        {
            title: 'Difficulty & enemies',
            controls: [
                { path: 'balance.diffEasy', label: 'Easy ×', type: 'number', min: 0.3, max: 1.5, step: 0.05 },
                { path: 'balance.diffNormal', label: 'Normal ×', type: 'number', min: 0.5, max: 2, step: 0.05 },
                { path: 'balance.diffHard', label: 'Hard ×', type: 'number', min: 0.8, max: 3, step: 0.05 },
                { path: 'balance.hpPerLevel', label: 'HP/level', type: 'number', min: 0, max: 0.5, step: 0.01 },
                { path: 'balance.dmgPerLevel', label: 'Dmg/level', type: 'number', min: 0, max: 0.5, step: 0.01 },
                { path: 'balance.enemyHpMult', label: 'Enemy HP ×', type: 'number', min: 0.2, max: 4, step: 0.1 },
                { path: 'balance.enemyDmgMult', label: 'Enemy dmg ×', type: 'number', min: 0.2, max: 4, step: 0.1 },
                { path: 'balance.enemyCountMult', label: 'Wave size ×', type: 'number', min: 0.2, max: 4, step: 0.1 },
                { path: 'balance.towerDamageMult', label: 'Tower dmg ×', type: 'number', min: 0.2, max: 4, step: 0.1 },
                { path: 'balance.meleeFalloff', label: 'Uphill falloff', type: 'number', min: 0, max: 0.3, step: 0.01 },
                { path: 'balance.ramFalloff', label: 'Ram falloff', type: 'number', min: 0, max: 0.3, step: 0.01 }
            ]
        },
        {
            title: 'Field defenses',
            controls: [
                { path: 'balance.oilDamage', label: 'Oil damage', type: 'number', min: 0, max: 300, step: 5, int: true },
                { path: 'balance.oilCooldown', label: 'Oil cooldown', type: 'number', min: 1, max: 30, step: 0.5 },
                { path: 'balance.oilRadius', label: 'Oil radius', type: 'number', min: 1, max: 10, step: 0.5 },
                { path: 'balance.stakesDamage', label: 'Stakes damage', type: 'number', min: 0, max: 150, step: 2, int: true },
                { path: 'balance.stakesUses', label: 'Stakes uses', type: 'number', min: 1, max: 30, step: 1, int: true },
                { path: 'balance.stakesSlow', label: 'Stakes slow (s)', type: 'number', min: 0, max: 6, step: 0.5 },
                { path: 'balance.moatSlow', label: 'Moat speed ×', type: 'number', min: 0.1, max: 1, step: 0.05 },
                { path: 'balance.sapperDamage', label: 'Sapper damage', type: 'number', min: 0, max: 800, step: 20, int: true },
                { path: 'balance.sapperRadius', label: 'Sapper radius', type: 'number', min: 1, max: 10, step: 0.5 }
            ]
        },
        {
            title: 'Siege pathing weights',
            controls: [
                { path: 'flow.moatCostMult', label: 'Moat cost ×', type: 'number', min: 1, max: 12, step: 0.5 },
                { path: 'flow.wallCost', label: 'Wall cost', type: 'number', min: 4, max: 80, step: 2, int: true },
                { path: 'flow.gateCost', label: 'Gate cost', type: 'number', min: 2, max: 60, step: 2, int: true },
                { path: 'flow.towerCost', label: 'Tower cost', type: 'number', min: 4, max: 80, step: 2, int: true }
            ]
        }
    ];
})();
