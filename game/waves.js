/**
 * Wave composition and era progression — tower-defense style.
 *
 * Levels 1-3: Bronze Age raiding parties.
 * Levels 4-6: Iron Age armies with rams and archer screens.
 * Levels 7+ : Full medieval siege trains.
 *
 * Each wave is a list of spawn groups; groups arrive from randomized map
 * edges with staggered delays. HP/damage scale gently with level so old
 * unit types stay relevant alongside new ones.
 */
(function () {
    const F = window.Fortress;

    F.eraForLevel = function (level) {
        for (const era of F.ERAS) {
            if (level >= era.levels[0] && level <= era.levels[1]) return era;
        }
        return F.ERAS[F.ERAS.length - 1];
    };

    F.wavesInLevel = (level) => Math.min(7, 2 + level);

    /** Difficulty scaling applied to unit stats. */
    F.waveScale = function (level, difficulty) {
        const d = { easy: 0.75, normal: 1.0, hard: 1.3 }[difficulty] || 1;
        return {
            hp: d * (1 + (level - 1) * 0.10),
            dmg: d * (1 + (level - 1) * 0.07)
        };
    };

    /**
     * Returns array of groups: { type, count, delay (s), edge }
     * edge: 0..3 (N,E,S,W) chosen by the caller per group.
     */
    F.composeWave = function (level, wave) {
        const g = [];
        const last = wave === F.wavesInLevel(level); // boss/climax wave
        const W = wave;

        if (level <= 3) {
            // ----- Bronze Age -----
            g.push({ type: 'raider', count: 4 + level * 2 + W * 2, delay: 0 });
            if (W >= 2) g.push({ type: 'spearman', count: 2 + level + W, delay: 4 });
            if (W >= 3 || level >= 2) g.push({ type: 'slinger', count: 1 + level, delay: 7 });
            if (last && level >= 2) g.push({ type: 'chieftain', count: level - 1, delay: 10 });
            if (last) g.push({ type: 'raider', count: 6 + level * 2, delay: 12 });
        } else if (level <= 6) {
            // ----- Iron Age -----
            g.push({ type: 'swordsman', count: 4 + level + W, delay: 0 });
            g.push({ type: 'raider', count: 4 + W, delay: 2 });
            if (W >= 2) g.push({ type: 'archer', count: 2 + Math.floor(level / 2) + W, delay: 5 });
            if (W >= 3) g.push({ type: 'shieldbearer', count: 1 + Math.floor(W / 2), delay: 8 });
            if (W >= 3 || last) g.push({ type: 'ram', count: 1 + Math.floor((level - 3) / 2) + (last ? 1 : 0), delay: 10 });
            if (last) {
                g.push({ type: 'chieftain', count: 2, delay: 14 });
                g.push({ type: 'swordsman', count: 6 + level, delay: 16 });
            }
        } else {
            // ----- Medieval -----
            g.push({ type: 'swordsman', count: 6 + W, delay: 0 });
            g.push({ type: 'knight', count: 1 + Math.floor(W / 2) + Math.floor((level - 7) / 2), delay: 3 });
            if (W >= 2) g.push({ type: 'crossbowman', count: 2 + W, delay: 6 });
            if (W >= 2) g.push({ type: 'sapper', count: 1 + Math.floor(W / 2), delay: 8 });
            if (W >= 3) g.push({ type: 'catapult', count: 1 + Math.floor((W - 2) / 2), delay: 10 });
            if (W >= 4) g.push({ type: 'siegetower', count: 1 + Math.floor((level - 7) / 3), delay: 13 });
            if (W >= 5 || last) g.push({ type: 'trebuchet', count: 1 + Math.floor((level - 7) / 3), delay: 16 });
            if (last) {
                g.push({ type: 'warlord', count: 1, delay: 20 });
                g.push({ type: 'knight', count: 3 + Math.floor(level / 3), delay: 22 });
            }
        }
        return g;
    };

    /** Human-readable preview, e.g. "12 Raiders, 4 Spearmen". */
    F.wavePreview = function (level, wave) {
        const counts = {};
        for (const grp of F.composeWave(level, wave)) {
            counts[grp.type] = (counts[grp.type] || 0) + grp.count;
        }
        return Object.entries(counts)
            .map(([k, n]) => `${n}× ${F.UNIT_TYPES[k].name}`)
            .join(', ');
    };
})();
