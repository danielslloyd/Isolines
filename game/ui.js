/**
 * DOM wiring: sidebar, overlays, RTS camera controls, raycast picking, and
 * the 2D overlay (health bars, threat markers, cost tag).
 */
(function () {
    const F = window.Fortress;
    const $ = (id) => document.getElementById(id);

    document.addEventListener('DOMContentLoaded', () => {
        const container = $('board-wrap3d');
        const overlay = $('overlay-2d');
        const octx = overlay.getContext('2d');

        const game = new F.Game();
        const renderer = new F.Renderer3D(game, container);
        game.renderer = renderer;
        window.game = game; // handy for debugging
        window.gameRenderer = renderer;

        game.on('newmap', () => renderer.onNewMap(game));
        game.on('buildings', () => renderer.syncBuildings(game));

        function sizeOverlay() {
            overlay.width = container.clientWidth;
            overlay.height = container.clientHeight;
        }
        sizeOverlay();
        window.addEventListener('resize', sizeOverlay);

        /* --------------------- camera + pointer input --------------------- */
        const keys = {};
        renderer.keys = keys;
        let rotating = false, lastMX = 0, lastMY = 0, leftDown = false;

        const dom = renderer.renderer.domElement;
        dom.addEventListener('contextmenu', e => e.preventDefault());

        dom.addEventListener('mousedown', e => {
            if (e.button === 1) { rotating = true; lastMX = e.clientX; lastMY = e.clientY; e.preventDefault(); return; }
            const p = renderer.pick(e.clientX, e.clientY);
            if (!p) return;
            if (e.button === 0) leftDown = true;
            game.pointerDown(p.x, p.y, e.button);
        });
        dom.addEventListener('mousemove', e => {
            if (rotating) {
                renderer.cam.yaw -= (e.clientX - lastMX) * 0.007;
                renderer.cam.pitch += (e.clientY - lastMY) * 0.005;
                lastMX = e.clientX; lastMY = e.clientY;
                return;
            }
            const p = renderer.pick(e.clientX, e.clientY);
            if (!p) { game.hover = null; return; }
            game.pointerMove(p.x, p.y);
            if (leftDown) game.pointerDrag(p.x, p.y);
        });
        window.addEventListener('mouseup', e => {
            if (e.button === 1) rotating = false;
            if (e.button === 0) leftDown = false;
        });
        dom.addEventListener('mouseleave', () => { game.hover = null; });
        dom.addEventListener('dblclick', e => { e.preventDefault(); game.commitWall(); });
        dom.addEventListener('wheel', e => {
            e.preventDefault();
            renderer.cam.dist *= (1 + Math.sign(e.deltaY) * 0.1);
        }, { passive: false });

        window.addEventListener('keydown', e => {
            if (e.target.tagName === 'INPUT') return;
            const k = e.key.toLowerCase();
            if ('wasd'.includes(k)) { keys[k] = true; return; }
            if (k === 'q') { renderer.cam.yaw += 0.07; return; }
            if (k === 'e') { renderer.cam.yaw -= 0.07; return; }
            if (e.key === 'Enter') { game.commitWall(); }
            else if (e.key === 'Escape') { game.cancelWallDraw(); game.selected = null; }
            else if (e.key === ' ') {
                e.preventDefault();
                if (game.state === 'build') game.startWave();
                else game.paused = !game.paused;
            }
        });
        window.addEventListener('keyup', e => {
            const k = e.key.toLowerCase();
            if ('wasd'.includes(k)) keys[k] = false;
        });

        /* ------------------------------ tools ------------------------------ */
        const toolHints = {
            inspect: 'Click terrain, walls, towers or units to inspect them. Middle-drag rotates, wheel zooms, WASD pans.',
            wall: 'Click to lay wall points — the engine snaps them along ridges and onto existing walls. Enter or double-click builds, right-click undoes.',
            gatewall: 'Draw a short gate section in a wall line. Gates are weaker and draw rams — but a gated enclosure earns +25% trade income.',
            tower: 'Place on open ground or on a wall. Height extends range: cliff tops and ramparts are prime spots.',
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
                $('wall-cost').textContent = `${F.WALL_TIERS[game.wallTier].cost}g/m`;
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

        /* --------------------------- wave / speed -------------------------- */
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

        /* ----------------------------- overlays ---------------------------- */
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
                    `${game.kills} attackers slain · ${civ.total} civilians in the settlement · ` +
                    `${game.civiliansLost} lost to the flames.`;
                $('over-overlay').classList.add('show');
            }
        });

        /* ----------------------------- HUD --------------------------------- */
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
                        `HP ${Math.ceil(s.obj.hp)}/${s.obj.maxHp} · dmg ${st.dmg} · base range ${st.range}m<br>` +
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
                const cliff = t.isCliff(gx, gy);
                el.innerHTML = `<b>${cliff ? 'Cliff face' : 'Terrain'}</b><br>` +
                    `Elevation ${h.toFixed(1)} m · slope ${(t.slopeAtCell(gx, gy) * 100).toFixed(0)}%<br>` +
                    (cliff ? 'Impassable — nature\'s own wall.'
                           : game.forts.isProtected(gx, gy) ? '✔ Inside your defenses (walls & cliffs)'
                           : 'Open approach — attackers can reach here.');
                return;
            }
            el.textContent = 'Hover the terrain…';
        }

        /* -------------------- 2D overlay (bars & markers) ------------------ */
        function drawOverlay() {
            octx.clearRect(0, 0, overlay.width, overlay.height);
            if (game.state === 'menu') return;
            const t = game.terrain;

            const bar = (sx, sy, w, frac, color) => {
                octx.fillStyle = 'rgba(0,0,0,0.55)';
                octx.fillRect(sx - w / 2, sy, w, 4);
                octx.fillStyle = color;
                octx.fillRect(sx - w / 2, sy, w * F.clamp(frac, 0, 1), 4);
            };

            for (const a of game.attackers) {
                if (a.dead || a.hp >= a.maxHp) continue;
                const p = renderer.project(a.x, t.heightAtPx(a.x, a.y) + 2.4, a.y);
                if (p) bar(p.x, p.y, 26, a.hp / a.maxHp, '#e05038');
            }
            for (const tw of game.forts.towers) {
                if (tw.hp >= tw.maxHp) continue;
                const p = renderer.project(tw.x, tw.elev + 2, tw.y);
                if (p) bar(p.x, p.y, 30, tw.hp / tw.maxHp, '#5cd65c');
            }
            for (const b of game.buildings) {
                if (b.hp <= 0) continue;
                const y = t.heightAtPx(b.x, b.y) + (b.kind === 'keep' ? 11 : 4.2);
                if (b.hp < b.maxHp) {
                    const p = renderer.project(b.x, y, b.y);
                    if (p) bar(p.x, p.y, 32, b.hp / b.maxHp, '#5cd65c');
                }
                if (b.kind === 'house' && game.state === 'build' && !game.forts.isProtected(b.gx, b.gy)) {
                    const p = renderer.project(b.x, y + 1, b.y);
                    if (p) {
                        octx.font = 'bold 15px sans-serif';
                        octx.fillStyle = '#ff5844';
                        octx.textAlign = 'center';
                        octx.fillText('⚠', p.x, p.y);
                    }
                }
            }
            // wall-draw cost tag near the cursor
            const plan = game.preview && game.preview.plan;
            if (plan && game.hover) {
                const p = renderer.project(game.hover.x, t.heightAtPx(game.hover.x, game.hover.y) + 3, game.hover.y);
                if (p) {
                    const ok = plan.valid && plan.cost <= game.gold;
                    const label = `${plan.cost}g${plan.valid ? '' : ' ✕'}`;
                    octx.font = 'bold 13px sans-serif';
                    const w = octx.measureText(label).width + 10;
                    octx.fillStyle = 'rgba(0,0,0,0.7)';
                    octx.fillRect(p.x + 12, p.y - 20, w, 18);
                    octx.fillStyle = ok ? '#9df29d' : '#f2a09d';
                    octx.textAlign = 'left';
                    octx.fillText(label, p.x + 17, p.y - 6);
                }
            }
        }

        let hudTimer = 0;
        game.on('frame', () => {
            drawOverlay();
            const now = performance.now();
            if (now - hudTimer > 100) { hudTimer = now; updateHud(); }
        });

        updateHud();
        game.emit('message');
    });
})();
