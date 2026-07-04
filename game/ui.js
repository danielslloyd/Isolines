/**
 * DOM wiring: sidebar, overlays, canvas input, keyboard shortcuts.
 */
(function () {
    const F = window.Fortress;
    const $ = (id) => document.getElementById(id);

    document.addEventListener('DOMContentLoaded', () => {
        const canvas = $('board');
        const game = new F.Game(canvas);
        window.game = game; // handy for debugging

        /* ------------------------- canvas input -------------------------- */
        let dragging = false;

        function canvasPos(e) {
            const rect = canvas.getBoundingClientRect();
            return {
                x: (e.clientX - rect.left) * (canvas.width / rect.width),
                y: (e.clientY - rect.top) * (canvas.height / rect.height)
            };
        }

        canvas.addEventListener('contextmenu', e => e.preventDefault());
        canvas.addEventListener('mousedown', e => {
            const p = canvasPos(e);
            dragging = e.button === 0;
            game.pointerDown(p.x, p.y, e.button);
        });
        canvas.addEventListener('mousemove', e => {
            const p = canvasPos(e);
            game.pointerMove(p.x, p.y);
            if (dragging) game.pointerDrag(p.x, p.y);
        });
        window.addEventListener('mouseup', () => { dragging = false; });
        canvas.addEventListener('mouseleave', () => { game.hover = null; });
        canvas.addEventListener('dblclick', e => {
            e.preventDefault();
            game.commitWall();
        });

        window.addEventListener('keydown', e => {
            if (e.target.tagName === 'INPUT') return;
            if (e.key === 'Enter') { game.commitWall(); }
            else if (e.key === 'Escape') { game.cancelWallDraw(); game.selected = null; }
            else if (e.key === ' ') {
                e.preventDefault();
                if (game.state === 'build') game.startWave();
                else game.paused = !game.paused;
            }
        });

        /* --------------------------- tools ------------------------------- */
        const toolHints = {
            inspect: 'Click terrain, walls, towers or units to inspect them.',
            wall: 'Click to lay wall points along ridges — the engine blends the line into the terrain. Enter/double-click to build, right-click to undo.',
            gatewall: 'Draw a short gate section in a wall line. Gates are weaker and draw rams — but enclosures with a gate earn +25% trade income.',
            tower: 'Place on open ground or on a wall. Height extends range: hills and ramparts are prime spots.',
            oil: 'Mount on a wall section. Scalds everything at the foot of the wall every 9s.',
            stakes: 'Sharpened stakes wound and slow the first six attackers who cross them.',
            moat: 'Click and drag to dig. Attackers wade at one-third speed — pair with towers.',
            upgrade: 'Click a wall to upgrade its whole connected run to the next tier.',
            repair: 'Click a wall run or tower to restore it to full strength.',
            demolish: 'Remove a wall section, tower, stakes or moat for a 30% refund.'
        };

        document.querySelectorAll('.tool-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('on'));
                btn.classList.add('on');
                game.setTool(btn.dataset.tool);
                $('tool-hint').textContent = toolHints[btn.dataset.tool] || '';
                $('wall-tiers').classList.toggle('show', btn.dataset.tool === 'wall' || btn.dataset.tool === 'gatewall');
                $('tower-tiers').classList.toggle('show', btn.dataset.tool === 'tower');
            });
        });

        $('wall-tiers').querySelectorAll('button').forEach(btn => {
            btn.addEventListener('click', () => {
                $('wall-tiers').querySelectorAll('button').forEach(b => b.classList.remove('on'));
                btn.classList.add('on');
                game.wallTier = +btn.dataset.t;
                $('wall-cost').textContent = `${F.WALL_TIERS[game.wallTier].cost}g/section`;
            });
        });
        $('tower-tiers').querySelectorAll('button').forEach(btn => {
            btn.addEventListener('click', () => {
                $('tower-tiers').querySelectorAll('button').forEach(b => b.classList.remove('on'));
                btn.classList.add('on');
                game.towerTier = +btn.dataset.t;
                $('tower-cost').textContent = `${F.TOWER_TIERS[game.towerTier].cost}g`;
            });
        });

        /* ------------------------ wave / speed ---------------------------- */
        $('wave-btn').addEventListener('click', () => game.startWave());
        [1, 2, 3].forEach(s => {
            $(`speed-${s}`).addEventListener('click', () => {
                game.speed = s;
                [1, 2, 3].forEach(k => $(`speed-${k}`).classList.toggle('on', k === s));
            });
        });
        $('pause-btn').addEventListener('click', () => {
            game.paused = !game.paused;
            $('pause-btn').textContent = game.paused ? '▶' : '⏸';
        });

        /* --------------------------- overlays ----------------------------- */
        $('seed-input').value = game.seedStr;
        $('regen-btn').addEventListener('click', () => {
            const seed = String(Math.floor(Math.random() * 1e9));
            $('seed-input').value = seed;
            game.newRun(seed);
            game.state = 'menu';
        });
        $('seed-input').addEventListener('change', () => {
            game.newRun($('seed-input').value || 'default');
            game.state = 'menu';
        });
        $('diff-row').querySelectorAll('button').forEach(btn => {
            btn.addEventListener('click', () => {
                $('diff-row').querySelectorAll('button').forEach(b => b.classList.remove('on'));
                btn.classList.add('on');
                game.difficulty = btn.dataset.d;
            });
        });
        $('begin-btn').addEventListener('click', () => {
            $('menu-overlay').classList.remove('show');
            game.state = 'build';
            game.emit('state');
        });
        $('retry-btn').addEventListener('click', () => {
            game.newRun(game.seedStr);
            $('over-overlay').classList.remove('show');
            game.state = 'build';
            game.emit('state');
        });
        $('newland-btn').addEventListener('click', () => {
            game.newRun(String(Math.floor(Math.random() * 1e9)));
            $('seed-input').value = game.seedStr;
            $('over-overlay').classList.remove('show');
            $('menu-overlay').classList.add('show');
        });

        game.on('state', () => {
            if (game.state === 'gameover') {
                const civ = game.civilianStats();
                $('over-title').textContent = 'The Keep Has Fallen';
                $('over-stats').innerHTML =
                    `You held for <b>${game.level}</b> level${game.level > 1 ? 's' : ''} into the ` +
                    `<b>${F.eraForLevel(game.level).name}</b>.<br>` +
                    `${game.kills} attackers slain · ${civ.total} civilians in the village · ` +
                    `${game.civiliansLost} lost to the flames.`;
                $('over-overlay').classList.add('show');
            }
        });

        /* -------------------------- HUD updates --------------------------- */
        const log = $('log');
        game.on('message', () => {
            log.innerHTML = game.messages.slice(-14).map(m =>
                `<div class="${m.cls}">${m.text}</div>`).join('');
            log.scrollTop = log.scrollHeight;
        });

        function updateHud() {
            $('st-gold').textContent = Math.floor(game.gold);
            $('st-level').textContent = game.level;
            $('st-era').textContent = F.eraForLevel(game.level).name;
            $('st-wave').textContent = `${game.wave}/${F.wavesInLevel(game.level)}`;
            const civ = game.civilianStats();
            $('st-civ').textContent = `${civ.protected}/${civ.total}`;

            const btn = $('wave-btn');
            if (game.state === 'combat') {
                btn.disabled = true;
                btn.textContent = `⚔ ${game.attackers.length + game.spawnQueue.length} attackers`;
                btn.classList.remove('building');
            } else if (game.state === 'build') {
                btn.disabled = false;
                btn.classList.add('building');
                btn.textContent = `⚔ Start Wave ${game.wave}`;
            } else {
                btn.disabled = true;
                btn.textContent = '⚔ Start Wave';
            }

            $('wave-preview').innerHTML = game.state === 'combat'
                ? `<b>Under siege!</b> Hold the walls.`
                : `<b>Next:</b> ${F.wavePreview(game.level, game.wave)}`;

            updateInfoPanel();
        }

        function updateInfoPanel() {
            const el = $('info-panel');
            if (game.selected) {
                const s = game.selected;
                if (s.kind === 'tower' && game.forts.towers.includes(s.obj)) {
                    const st = F.TOWER_TIERS[s.obj.tier];
                    el.innerHTML = `<b>${st.name}</b> ${s.obj.onWall ? '(on wall)' : ''}<br>` +
                        `HP ${Math.ceil(s.obj.hp)}/${s.obj.maxHp} · dmg ${st.dmg} · base range ${st.range}<br>` +
                        `Firing height ${s.obj.elev.toFixed(0)}m · kills: ${s.obj.kills}`;
                    return;
                }
                if (s.kind === 'wall' && game.forts.pieces.has(s.obj.id)) {
                    const p = s.obj;
                    el.innerHTML = `<b>${p.isGate ? 'Gate — ' : ''}${F.WALL_TIERS[p.tier].name}</b><br>` +
                        `HP ${Math.ceil(p.hp)}/${p.maxHp} · elevation ${p.elev.toFixed(0)}m<br>` +
                        `Terrain advantage +${p.advantage.toFixed(1)}m${p.oil ? ' · 🔥 oil mounted' : ''}`;
                    return;
                }
                if (s.kind === 'building' && s.obj.hp > 0) {
                    const b = s.obj;
                    const prot = game.forts.isProtected(b.gx, b.gy);
                    el.innerHTML = `<b>${b.kind === 'keep' ? 'The Keep' : 'House'}</b><br>` +
                        `HP ${Math.ceil(b.hp)}/${b.maxHp} · ${b.civilians} civilians<br>` +
                        (prot ? '✔ Safely behind walls' : '⚠ <span style="color:#f2a09d">Exposed — wall it in!</span>');
                    return;
                }
                if (s.kind === 'attacker' && !s.obj.dead) {
                    const a = s.obj;
                    el.innerHTML = `<b>${a.type.name}</b> (${F.ERAS.find(e => e.key === a.type.era).name})<br>` +
                        `HP ${Math.ceil(a.hp)}/${a.maxHp} · dmg ${a.dmg.toFixed(0)} · bounty ${a.type.bounty}g<br>` +
                        `<span style="color:#9fb2c4">${a.type.desc}</span>`;
                    return;
                }
            }
            if (game.hover) {
                const { gx, gy } = game.hover;
                const t = game.terrain;
                const h = t.heightAtCell(gx, gy);
                const water = t.isWater(gx, gy);
                el.innerHTML = `<b>${water ? 'Water' : 'Terrain'}</b> at (${gx}, ${gy})<br>` +
                    `Elevation ${h.toFixed(1)} m · slope ${(t.slopeAtCell(gx, gy) * 100).toFixed(0)}%<br>` +
                    (water ? 'Impassable to builders; attackers wade slowly.'
                           : game.forts.isProtected(gx, gy) ? '✔ Inside your fortifications'
                           : 'Open ground — attackers can reach here.');
                return;
            }
            el.textContent = 'Hover the map…';
        }

        let hudTimer = 0;
        game.on('frame', () => {
            // ~10 HUD refreshes per second is plenty
            const now = performance.now();
            if (now - hudTimer > 100) { hudTimer = now; updateHud(); }
        });

        updateHud();
        game.emit('message');
    });
})();
