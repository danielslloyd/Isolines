/**
 * Canvas renderer. The fractal terrain (tint + hillshade + contours) is
 * pre-rendered once per map; everything dynamic is drawn on top each frame.
 */
(function () {
    const F = window.Fortress;

    function roundRect(ctx, x, y, w, h, r) {
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.arcTo(x + w, y, x + w, y + h, r);
        ctx.arcTo(x + w, y + h, x, y + h, r);
        ctx.arcTo(x, y + h, x, y, r);
        ctx.arcTo(x, y, x + w, y, r);
        ctx.closePath();
    }

    function healthBar(ctx, x, y, w, frac, good) {
        ctx.fillStyle = 'rgba(0,0,0,0.55)';
        ctx.fillRect(x - w / 2, y, w, 3);
        ctx.fillStyle = good ? '#5cd65c' : (frac > 0.4 ? '#e8c33a' : '#e05038');
        ctx.fillRect(x - w / 2, y, w * F.clamp(frac, 0, 1), 3);
    }

    function drawWalls(ctx, game) {
        const C = F.CELL;
        for (const p of game.forts.pieces.values()) {
            const x = p.gx * C, y = p.gy * C;
            const tier = F.WALL_TIERS[p.tier];
            const dmg = p.hp / p.maxHp;
            if (p.isGate) {
                ctx.fillStyle = '#6a4526';
                ctx.fillRect(x, y, C, C);
                ctx.fillStyle = 'rgba(240,220,160,0.85)';
                ctx.fillRect(x + 1.5, y + 1.5, C - 3, C - 3);
                ctx.fillStyle = '#6a4526';
                ctx.fillRect(x + 2, y, 1, C);
                ctx.fillRect(x + C - 3, y, 1, C);
            } else {
                ctx.fillStyle = tier.color;
                ctx.fillRect(x, y, C, C);
                // crenellation dot & mortar line for texture
                ctx.fillStyle = 'rgba(0,0,0,0.22)';
                ctx.fillRect(x, y + C - 1, C, 1);
                ctx.fillStyle = 'rgba(255,255,255,0.28)';
                ctx.fillRect(x + ((p.gx + p.gy) % 2 ? 1 : 2.5), y + 1, 1.5, 1.5);
            }
            if (dmg < 1) {
                ctx.fillStyle = `rgba(20,10,5,${0.55 * (1 - dmg)})`;
                ctx.fillRect(x, y, C, C);
            }
            if (p.oil) {
                ctx.fillStyle = p.oil.cooldown <= 0 ? '#2c2c2c' : '#5a5a5a';
                ctx.beginPath();
                ctx.arc(x + C / 2, y + C / 2, 1.9, 0, Math.PI * 2);
                ctx.fill();
                ctx.strokeStyle = '#e8a020';
                ctx.lineWidth = 0.8;
                ctx.stroke();
            }
        }
    }

    function drawTowers(ctx, game) {
        for (const t of game.forts.towers) {
            const stats = F.TOWER_TIERS[t.tier];
            const r = 4.5 + t.tier;
            ctx.fillStyle = 'rgba(0,0,0,0.3)';
            ctx.beginPath(); ctx.arc(t.x + 1, t.y + 1.5, r, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = stats.color;
            ctx.beginPath(); ctx.arc(t.x, t.y, r, 0, Math.PI * 2); ctx.fill();
            ctx.strokeStyle = 'rgba(40,26,12,0.9)';
            ctx.lineWidth = 1;
            ctx.stroke();
            // battlements
            ctx.fillStyle = 'rgba(40,26,12,0.9)';
            for (let i = 0; i < 4 + t.tier; i++) {
                const a = (i / (4 + t.tier)) * Math.PI * 2;
                ctx.fillRect(t.x + Math.cos(a) * r - 0.8, t.y + Math.sin(a) * r - 0.8, 1.6, 1.6);
            }
            if (t.hp < t.maxHp) healthBar(ctx, t.x, t.y - r - 6, 14, t.hp / t.maxHp, true);
        }
    }

    function drawBuildings(ctx, game) {
        for (const b of game.buildings) {
            if (b.hp <= 0) {
                // ruin
                ctx.fillStyle = 'rgba(30,22,16,0.5)';
                ctx.beginPath(); ctx.arc(b.x, b.y, 4, 0, Math.PI * 2); ctx.fill();
                continue;
            }
            if (b.kind === 'keep') {
                ctx.fillStyle = 'rgba(0,0,0,0.3)';
                ctx.fillRect(b.x - 6, b.y - 5, 13, 12);
                ctx.fillStyle = '#7d7d84';
                ctx.fillRect(b.x - 7, b.y - 6, 13, 12);
                ctx.strokeStyle = '#2c2420'; ctx.lineWidth = 1;
                ctx.strokeRect(b.x - 7, b.y - 6, 13, 12);
                ctx.fillStyle = '#9d9da4';
                ctx.fillRect(b.x - 9, b.y - 8, 5, 5);
                ctx.fillRect(b.x + 4, b.y - 8, 5, 5);
                // banner
                ctx.strokeStyle = '#3a2c1c';
                ctx.beginPath(); ctx.moveTo(b.x, b.y - 6); ctx.lineTo(b.x, b.y - 13); ctx.stroke();
                ctx.fillStyle = '#c03028';
                ctx.fillRect(b.x, b.y - 13, 5, 3);
            } else {
                const prot = game.forts.isProtected(b.gx, b.gy);
                ctx.fillStyle = 'rgba(0,0,0,0.25)';
                ctx.fillRect(b.x - 2.5, b.y - 1.5, 7, 5.5);
                ctx.fillStyle = '#c9b089';
                ctx.fillRect(b.x - 3.5, b.y - 2.5, 7, 5.5);
                ctx.fillStyle = '#8c4a2c';
                ctx.beginPath();
                ctx.moveTo(b.x - 4.5, b.y - 2.5);
                ctx.lineTo(b.x, b.y - 6.5);
                ctx.lineTo(b.x + 4.5, b.y - 2.5);
                ctx.closePath();
                ctx.fill();
                if (!prot) { // unprotected marker
                    ctx.strokeStyle = 'rgba(224,80,56,0.9)';
                    ctx.lineWidth = 1;
                    ctx.beginPath();
                    ctx.arc(b.x, b.y - 1, 7.5, 0, Math.PI * 2);
                    ctx.stroke();
                }
            }
            if (b.hp < b.maxHp) healthBar(ctx, b.x, b.y - 12, 14, b.hp / b.maxHp, true);
        }
    }

    function drawAttackers(ctx, game) {
        for (const a of game.attackers) {
            if (a.dead) continue;
            const r = a.type.radius;
            ctx.fillStyle = 'rgba(0,0,0,0.3)';
            ctx.beginPath(); ctx.arc(a.x + 0.8, a.y + 1, r, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = a.type.color;
            ctx.beginPath(); ctx.arc(a.x, a.y, r, 0, Math.PI * 2); ctx.fill();
            ctx.strokeStyle = 'rgba(20,8,4,0.8)';
            ctx.lineWidth = 0.8;
            ctx.stroke();
            const sp = a.type.special;
            if (sp === 'ram' || sp === 'siegetower' || sp === 'artillery') {
                ctx.fillStyle = 'rgba(255,235,200,0.9)';
                ctx.fillRect(a.x - 1.4, a.y - 1.4, 2.8, 2.8);
            } else if (sp === 'boss') {
                ctx.fillStyle = '#f2d24a';
                ctx.beginPath();
                ctx.arc(a.x, a.y, r * 0.45, 0, Math.PI * 2);
                ctx.fill();
            } else if (sp === 'ranged') {
                ctx.strokeStyle = 'rgba(255,255,255,0.75)';
                ctx.beginPath();
                ctx.arc(a.x, a.y, r * 0.55, -0.6, 2.2);
                ctx.stroke();
            }
            if (a.fuse >= 0) {
                ctx.fillStyle = `rgba(255,${100 + Math.sin(a.fuse * 20) * 80},40,0.95)`;
                ctx.beginPath(); ctx.arc(a.x, a.y - r - 2.5, 1.6, 0, Math.PI * 2); ctx.fill();
            }
            if (a.hp < a.maxHp) healthBar(ctx, a.x, a.y - r - 6, Math.max(9, r * 2.4), a.hp / a.maxHp, false);
        }
    }

    function drawProjectiles(ctx, game) {
        for (const p of game.projectiles) {
            const yo = p.arcOffset();
            if (p.kind === 'stone') {
                ctx.fillStyle = 'rgba(0,0,0,0.25)';
                ctx.beginPath(); ctx.arc(p.x, p.y, 2.4, 0, Math.PI * 2); ctx.fill();
                ctx.fillStyle = '#4a4238';
                ctx.beginPath(); ctx.arc(p.x, p.y - yo, 2.6, 0, Math.PI * 2); ctx.fill();
            } else {
                const dx = p.tx - p.sx, dy = p.ty - p.sy;
                const len = Math.max(1, Math.hypot(dx, dy));
                const ux = dx / len, uy = dy / len;
                ctx.strokeStyle = p.kind === 'bolt' ? '#f0e0b8' : '#3c2f20';
                ctx.lineWidth = p.kind === 'bolt' ? 1.6 : 1;
                ctx.beginPath();
                ctx.moveTo(p.x - ux * 4, p.y - uy * 4);
                ctx.lineTo(p.x + ux * 2, p.y + uy * 2);
                ctx.stroke();
            }
        }
    }

    function drawEffects(ctx, game) {
        for (const e of game.effects) {
            const k = e.t / e.dur;
            if (e.kind === 'explosion') {
                ctx.fillStyle = `rgba(255,${170 - k * 120},40,${0.65 * (1 - k)})`;
                ctx.beginPath(); ctx.arc(e.x, e.y, e.r * (0.4 + k * 0.9), 0, Math.PI * 2); ctx.fill();
                ctx.strokeStyle = `rgba(60,40,20,${0.7 * (1 - k)})`;
                ctx.beginPath(); ctx.arc(e.x, e.y, e.r * k * 1.3, 0, Math.PI * 2); ctx.stroke();
            } else if (e.kind === 'oil') {
                ctx.fillStyle = `rgba(255,140,20,${0.6 * (1 - k)})`;
                ctx.beginPath(); ctx.arc(e.x, e.y, e.r * (0.3 + k), 0, Math.PI * 2); ctx.fill();
            } else if (e.kind === 'death') {
                ctx.strokeStyle = `rgba(120,20,10,${0.8 * (1 - k)})`;
                ctx.lineWidth = 1.4;
                ctx.beginPath(); ctx.arc(e.x, e.y, e.r * (0.6 + k), 0, Math.PI * 2); ctx.stroke();
            } else { // hit
                ctx.fillStyle = `rgba(255,240,200,${0.75 * (1 - k)})`;
                ctx.beginPath(); ctx.arc(e.x, e.y, e.r * (0.5 + k * 0.8), 0, Math.PI * 2); ctx.fill();
            }
        }
    }

    function drawFieldDefenses(ctx, game) {
        const C = F.CELL;
        // moat
        ctx.fillStyle = 'rgba(38,66,88,0.72)';
        for (let gy = 0; gy < F.GRID_H; gy++) {
            for (let gx = 0; gx < F.GRID_W; gx++) {
                if (game.forts.moat[F.idx(gx, gy)]) ctx.fillRect(gx * C, gy * C, C, C);
            }
        }
        // stakes
        ctx.strokeStyle = '#5c4326';
        ctx.lineWidth = 1;
        for (const st of game.forts.stakes.values()) {
            const x = st.gx * C, y = st.gy * C;
            ctx.beginPath();
            ctx.moveTo(x + 1, y + C - 1); ctx.lineTo(x + C / 2, y + 1);
            ctx.moveTo(x + C - 1, y + C - 1); ctx.lineTo(x + C / 2, y + 1);
            ctx.stroke();
        }
    }

    function drawPreview(ctx, game) {
        // wall drawing ghost
        if ((game.tool === 'wall' || game.tool === 'gatewall') && game.wallNodes.length > 0) {
            const plan = game.preview && game.preview.plan;
            if (plan) {
                const affordable = plan.cost <= game.gold;
                const C = F.CELL;
                ctx.fillStyle = plan.valid && affordable ? 'rgba(90,220,110,0.55)' : 'rgba(230,70,50,0.55)';
                for (const [gx, gy] of plan.cells) ctx.fillRect(gx * C, gy * C, C, C);
                // blended path line
                ctx.strokeStyle = 'rgba(255,255,255,0.7)';
                ctx.lineWidth = 1;
                ctx.setLineDash([3, 3]);
                ctx.beginPath();
                plan.path.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y));
                ctx.stroke();
                ctx.setLineDash([]);
                // cost tag near cursor
                if (game.hover) {
                    ctx.font = 'bold 11px sans-serif';
                    const label = `${plan.cost}g${plan.valid ? '' : ' ✕'}`;
                    ctx.fillStyle = 'rgba(0,0,0,0.7)';
                    const w = ctx.measureText(label).width + 8;
                    ctx.fillRect(game.hover.x + 10, game.hover.y - 18, w, 15);
                    ctx.fillStyle = affordable && plan.valid ? '#9df29d' : '#f2a09d';
                    ctx.fillText(label, game.hover.x + 14, game.hover.y - 6.5);
                }
            }
            // node markers
            ctx.fillStyle = 'rgba(255,255,255,0.9)';
            for (const n of game.wallNodes) {
                ctx.beginPath(); ctx.arc(n.x, n.y, 2.2, 0, Math.PI * 2); ctx.fill();
            }
        }
        // tower ghost
        if (game.tool === 'tower' && game.hover) {
            const { gx, gy } = game.hover;
            const stats = F.TOWER_TIERS[game.towerTier];
            const ok = game.forts.canPlaceTower(gx, gy) && game.gold >= stats.cost;
            const x = F.cellCx(gx), y = F.cellCy(gy);
            ctx.strokeStyle = ok ? 'rgba(120,220,140,0.85)' : 'rgba(230,80,60,0.85)';
            ctx.lineWidth = 1;
            ctx.beginPath(); ctx.arc(x, y, 5.5, 0, Math.PI * 2); ctx.stroke();
            // range preview with elevation bonus at this spot
            const piece = game.forts.pieceAt(gx, gy);
            const elev = game.terrain.heightAtCell(gx, gy) + 6 + (piece ? F.WALL_TIERS[piece.tier].height : 0);
            const avgElev = (game.terrain.minH + game.terrain.maxH) / 2;
            const range = stats.range * (1 + Math.max(0, elev - avgElev) * 0.015);
            ctx.strokeStyle = ok ? 'rgba(120,220,140,0.35)' : 'rgba(230,80,60,0.3)';
            ctx.setLineDash([4, 4]);
            ctx.beginPath(); ctx.arc(x, y, range, 0, Math.PI * 2); ctx.stroke();
            ctx.setLineDash([]);
        }
        // selected tower range ring
        if (game.selected && game.selected.kind === 'tower') {
            const t = game.selected.obj;
            ctx.strokeStyle = 'rgba(240,230,180,0.5)';
            ctx.setLineDash([4, 4]);
            ctx.beginPath(); ctx.arc(t.x, t.y, F.TOWER_TIERS[t.tier].range, 0, Math.PI * 2); ctx.stroke();
            ctx.setLineDash([]);
        }
    }

    function drawSpawnWarnings(ctx, game) {
        if (game.state !== 'combat' || game.spawnQueue.length === 0) return;
        const pulse = 0.5 + Math.sin(performance.now() / 200) * 0.3;
        ctx.fillStyle = `rgba(220,50,40,${pulse})`;
        for (const edge of game.spawnEdges) {
            if (edge === 0) ctx.fillRect(0, 0, F.WORLD_W, 3);
            else if (edge === 1) ctx.fillRect(F.WORLD_W - 3, 0, 3, F.WORLD_H);
            else if (edge === 2) ctx.fillRect(0, F.WORLD_H - 3, F.WORLD_W, 3);
            else ctx.fillRect(0, 0, 3, F.WORLD_H);
        }
    }

    F.render = function (game) {
        const ctx = game.ctx;
        ctx.clearRect(0, 0, F.WORLD_W, F.WORLD_H);
        ctx.drawImage(game.terrainCanvas, 0, 0);
        drawFieldDefenses(ctx, game);
        drawWalls(ctx, game);
        drawBuildings(ctx, game);
        drawTowers(ctx, game);
        drawAttackers(ctx, game);
        drawProjectiles(ctx, game);
        drawEffects(ctx, game);
        drawPreview(ctx, game);
        drawSpawnWarnings(ctx, game);
    };
})();
