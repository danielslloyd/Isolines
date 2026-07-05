/**
 * Low-poly 3D renderer (Three.js).
 *
 * Presentation is fully 3D and organic: the simulation grid is never shown.
 * Terrain is a flat-shaded fractal mesh; walls are continuous extruded runs
 * that follow the player's smoothed, ridge-blended path; buildings, towers,
 * units and projectiles are all low-poly meshes. RTS camera: pan, rotate,
 * zoom.
 */
(function () {
    const F = window.Fortress;

    /* ------------------------- geometry builder -------------------------- */

    class GeomBuilder {
        constructor() { this.pos = []; this.col = []; }
        tri(a, b, c, color) {
            this.pos.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
            for (let i = 0; i < 3; i++) this.col.push(color.r, color.g, color.b);
        }
        quad(a, b, c, d, color) { // a-b-c-d counter-clockwise
            this.tri(a, b, c, color);
            this.tri(a, c, d, color);
        }
        box(cx, cy, cz, w, h, d, color, yaw) {
            const hw = w / 2, hd = d / 2;
            const cos = Math.cos(yaw || 0), sin = Math.sin(yaw || 0);
            const pt = (x, y, z) => [cx + x * cos - z * sin, cy + y, cz + x * sin + z * cos];
            const p = [
                pt(-hw, 0, -hd), pt(hw, 0, -hd), pt(hw, 0, hd), pt(-hw, 0, hd),
                pt(-hw, h, -hd), pt(hw, h, -hd), pt(hw, h, hd), pt(-hw, h, hd)
            ];
            this.quad(p[7], p[6], p[5], p[4], color);            // top (+y out)
            this.quad(p[4], p[5], p[1], p[0], color);            // sides (outward)
            this.quad(p[5], p[6], p[2], p[1], color);
            this.quad(p[6], p[7], p[3], p[2], color);
            this.quad(p[7], p[4], p[0], p[3], color);
        }
        build() {
            const geom = new THREE.BufferGeometry();
            geom.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
            geom.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
            geom.computeVertexNormals();
            return geom;
        }
    }

    // DoubleSide keeps hand-wound roof/cap triangles visible from any angle.
    const flatMat = () => new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });

    function mergeGeoms(geoms) {
        // simple non-indexed merge (position + normal)
        let total = 0;
        const nonIdx = geoms.map(g => g.index ? g.toNonIndexed() : g);
        for (const g of nonIdx) total += g.attributes.position.count;
        const pos = new Float32Array(total * 3);
        const nrm = new Float32Array(total * 3);
        let o = 0;
        for (const g of nonIdx) {
            pos.set(g.attributes.position.array, o * 3);
            nrm.set(g.attributes.normal.array, o * 3);
            o += g.attributes.position.count;
        }
        const out = new THREE.BufferGeometry();
        out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        out.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
        return out;
    }

    /* ----------------------------- renderer ------------------------------ */

    class Renderer3D {
        constructor(game, container) {
            this.game = game;
            this.container = container;

            this.renderer = new THREE.WebGLRenderer({ antialias: true });
            this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
            this.renderer.shadowMap.enabled = true;
            this.renderer.shadowMap.type = THREE.PCFShadowMap;
            container.appendChild(this.renderer.domElement);

            this.scene = new THREE.Scene();
            this.scene.background = new THREE.Color(0x9fc4e0);
            this.scene.fog = new THREE.Fog(0xaecde4, 150, 380);

            this.camera = new THREE.PerspectiveCamera(48, 1, 0.5, 700);
            this.cam = { target: new THREE.Vector3(80, 4, 70), yaw: Math.PI, pitch: 0.86, dist: 62 };

            const hemi = new THREE.HemisphereLight(0xbcd8f0, 0x8a7a5a, 0.9);
            this.scene.add(hemi);
            this.sun = new THREE.DirectionalLight(0xfff2dc, 1.0);
            this.sun.position.set(140, 110, 30);
            this.sun.castShadow = true;
            this.sun.shadow.mapSize.set(2048, 2048);
            this.sun.shadow.bias = -0.0004;
            this.sun.shadow.normalBias = 1.4;
            const sc = this.sun.shadow.camera;
            sc.left = -120; sc.right = 120; sc.top = 100; sc.bottom = -100;
            sc.near = 20; sc.far = 320;
            this.sun.target.position.set(80, 0, 60);
            this.scene.add(this.sun, this.sun.target);

            // dynamic object containers
            this.terrainMesh = null;
            this.decoMesh = null;
            this.wallMesh = null;
            this.defenseMesh = null;   // moat + stakes
            this.buildingGroups = new Map(); // building index -> Group
            this.towerGroups = new Map();    // tower id -> Group
            this.ghostGroup = new THREE.Group();
            this.scene.add(this.ghostGroup);
            this.beaconGroup = new THREE.Group();
            this.scene.add(this.beaconGroup);
            this._lastPreviewPlan = undefined;
            this._wallRebuildCooldown = 0;

            this.initUnitMeshes();
            this.initProjectiles();
            this.initEffects();
            this.initSelectionRing();

            this.raycaster = new THREE.Raycaster();
            this._resize();
            window.addEventListener('resize', () => this._resize());

            this.onNewMap(game);
        }

        _resize() {
            const w = this.container.clientWidth, h = this.container.clientHeight;
            this.renderer.setSize(w, h);
            this.camera.aspect = w / h;
            this.camera.updateProjectionMatrix();
        }

        /* ------------------------- static world -------------------------- */

        onNewMap(game) {
            const t = game.terrain;
            if (this.terrainMesh) { this.scene.remove(this.terrainMesh); this.terrainMesh.geometry.dispose(); }
            if (this.decoMesh) { this.scene.remove(this.decoMesh); this.decoMesh.geometry.dispose(); }
            for (const g of this.buildingGroups.values()) this.scene.remove(g);
            this.buildingGroups.clear();
            for (const g of this.towerGroups.values()) this.scene.remove(g);
            this.towerGroups.clear();
            if (this.wallMesh) { this.scene.remove(this.wallMesh); this.wallMesh.geometry.dispose(); this.wallMesh = null; }
            if (this.defenseMesh) { this.scene.remove(this.defenseMesh); this.defenseMesh.geometry.dispose(); this.defenseMesh = null; }

            this.terrainMesh = this.buildTerrain(t);
            this.scene.add(this.terrainMesh);
            this.decoMesh = this.buildDecoration(t, game.seed);
            this.scene.add(this.decoMesh);
            this.syncBuildings(game);
            this.rebuildWalls(game);
            this.rebuildDefenses(game);

            // Frame both the keep and the ravine mouth on arrival.
            const keep = game.buildings[0];
            const neck = t.neck;
            const tx = F.lerp(keep.x, neck.x, 0.42);
            const tz = F.lerp(keep.y, neck.z, 0.42);
            this.cam.target.set(tx, t.heightAtPx(tx, tz), tz);
            this.cam.yaw = Math.PI;      // look up the ravine from the south
            this.cam.pitch = 0.82;
            this.cam.dist = 74;
        }

        terrainColor(t, x, z, rng01) {
            const h = t.heightAtPx(x, z);
            const gx = F.toCell(x), gy = F.toCellY(z);
            const s = t.slopeAtCell(gx, gy);
            let c;
            if (s > 1.02) {
                // cliff rock, banded by height
                const band = (Math.sin(h * 1.7) + 1) * 0.5;
                c = new THREE.Color().setRGB(
                    0.42 + band * 0.07, 0.375 + band * 0.055, 0.32 + band * 0.045);
            } else if (s > 0.62) {
                c = new THREE.Color(0x8a8060); // scree / dry scrub
            } else if (h < 5.2) {
                c = new THREE.Color(0x5e9c4c); // lush valley floor
            } else if (h < 12) {
                c = new THREE.Color(0x74a655);
            } else {
                const dry = F.clamp((h - 14) / 9, 0, 1);
                c = new THREE.Color().lerpColors(
                    new THREE.Color(0x8cab58), new THREE.Color(0xa8a468), dry);
            }
            const j = (rng01 - 0.5) * 0.07;
            c.offsetHSL(0, 0, j);
            return c;
        }

        /**
         * Organic terrain surface: a seeded point set evened out with Lloyd
         * relaxation (centroidal Voronoi), densified along cliffs, then
         * Delaunay-triangulated. No rectangular lattice anywhere in view —
         * every facet is irregular.
         */
        buildTerrain(t) {
            const W = F.WORLD_W, H = F.WORLD_H;
            const rng = F.mulberry32(this.game.seed ^ 0x0b5e55ed);

            // 1. Seeded random interior points
            const pts = [];
            const BASE = 5200;
            for (let i = 0; i < BASE; i++) {
                pts.push([1.5 + rng() * (W - 3), 1.5 + rng() * (H - 3)]);
            }

            // 2. Lloyd relaxation: move each point to its Voronoi cell centroid
            for (let iter = 0; iter < 2; iter++) {
                const vor = d3.Delaunay.from(pts).voronoi([0.5, 0.5, W - 0.5, H - 0.5]);
                for (let i = 0; i < pts.length; i++) {
                    const poly = vor.cellPolygon(i);
                    if (!poly) continue;
                    let cx = 0, cz = 0, area = 0;
                    for (let k = 0; k < poly.length - 1; k++) {
                        const cross = poly[k][0] * poly[k + 1][1] - poly[k + 1][0] * poly[k][1];
                        area += cross;
                        cx += (poly[k][0] + poly[k + 1][0]) * cross;
                        cz += (poly[k][1] + poly[k + 1][1]) * cross;
                    }
                    if (Math.abs(area) > 1e-9) {
                        pts[i] = [cx / (3 * area), cz / (3 * area)];
                    }
                }
            }

            // 3. Densify where the land is steep so cliff faces stay crisp
            let added = 0, tries = 0;
            while (added < 2400 && tries < 30000) {
                tries++;
                const x = 1 + rng() * (W - 2), z = 1 + rng() * (H - 2);
                if (t.slopeAtCell(F.toCell(x), F.toCellY(z)) > 0.7) {
                    pts.push([x, z]);
                    added++;
                }
            }

            // 4. Boundary ring so the hull stays rectangular
            for (let x = 0; x <= W; x += 2.5) { pts.push([x, 0], [x, H]); }
            for (let z = 2.5; z < H; z += 2.5) { pts.push([0, z], [W, z]); }

            // 5. Triangulate and emit flat-shaded facets
            const del = d3.Delaunay.from(pts);
            const gb = new GeomBuilder();
            const tris = del.triangles;
            for (let i = 0; i < tris.length; i += 3) {
                const a = pts[tris[i]], b = pts[tris[i + 1]], c = pts[tris[i + 2]];
                const cx = (a[0] + b[0] + c[0]) / 3, cz = (a[1] + b[1] + c[1]) / 3;
                const col = this.terrainColor(t, cx, cz, rng());
                // Delaunay triangles are CCW in x/z; emit with +y winding
                gb.tri(
                    [a[0], t.heightAtPx(a[0], a[1]), a[1]],
                    [c[0], t.heightAtPx(c[0], c[1]), c[1]],
                    [b[0], t.heightAtPx(b[0], b[1]), b[1]],
                    col
                );
            }
            const mesh = new THREE.Mesh(gb.build(), flatMat());
            mesh.receiveShadow = true;
            return mesh;
        }

        buildDecoration(t, seed) {
            const rng = F.mulberry32(seed ^ 0x5eed);
            const gb = new GeomBuilder();
            const trunk = new THREE.Color(0x6a4a2e);
            const canopies = [new THREE.Color(0x3e7a3a), new THREE.Color(0x4d8a40), new THREE.Color(0x5e8a38)];
            const rock = new THREE.Color(0x7d756a);

            let trees = 0, tries = 0;
            while (trees < 150 && tries < 3000) {
                tries++;
                const x = 3 + rng() * (F.WORLD_W - 6);
                const z = 3 + rng() * (F.WORLD_H - 6);
                const gx = F.toCell(x), gy = F.toCellY(z);
                const s = t.slopeAtCell(gx, gy);
                const h = t.heightAtPx(x, z);
                if (s > 0.38) continue;
                // keep the bowl and the approach valley mostly clear
                const e = Math.hypot((x - t.bowl.x) / t.bowl.rx, (z - t.bowl.z) / t.bowl.rz);
                if (e < 1.25 && rng() > 0.12) continue;
                if (h < 6 && rng() > 0.25) continue;
                const y = h;
                const sc = 0.7 + rng() * 0.8;
                const canopy = canopies[(rng() * 3) | 0].clone().offsetHSL(0, 0, (rng() - 0.5) * 0.05);
                // trunk
                gb.box(x, y, z, 0.3 * sc, 0.9 * sc, 0.3 * sc, trunk, rng() * 3);
                // canopy: stacked pyramid (two boxes rotated)
                gb.box(x, y + 0.8 * sc, z, 1.7 * sc, 1.5 * sc, 1.7 * sc, canopy, rng() * 3);
                gb.box(x, y + 1.9 * sc, z, 1.0 * sc, 1.1 * sc, 1.0 * sc, canopy, rng() * 3 + 0.6);
                trees++;
            }
            let rocks = 0; tries = 0;
            while (rocks < 50 && tries < 2000) {
                tries++;
                const x = 3 + rng() * (F.WORLD_W - 6);
                const z = 3 + rng() * (F.WORLD_H - 6);
                const s = t.slopeAtCell(F.toCell(x), F.toCellY(z));
                if (s < 0.5 || s > 1.05) continue;
                const y = t.heightAtPx(x, z) - 0.2;
                const sc = 0.5 + rng() * 1.1;
                gb.box(x, y, z, sc, sc * 0.8, sc * 0.9, rock.clone().offsetHSL(0, 0, (rng() - 0.5) * 0.06), rng() * 3);
                rocks++;
            }
            const mesh = new THREE.Mesh(gb.build(), flatMat());
            mesh.castShadow = true;
            mesh.receiveShadow = true;
            return mesh;
        }

        /* --------------------------- walls -------------------------------- */

        /**
         * Extrude every built wall run as a continuous low-poly curtain.
         * Segments whose simulation piece was destroyed become gaps with
         * rubble stumps — the breach is visible at a glance.
         */
        rebuildWalls(game) {
            if (this.wallMesh) {
                this.scene.remove(this.wallMesh);
                this.wallMesh.geometry.dispose();
                this.wallMesh = null;
            }
            const t = game.terrain;
            const gb = new GeomBuilder();
            const rubbleC = new THREE.Color(0x6b6258);

            for (const wall of game.forts.walls) {
                // resample the smoothed path at ~1.1 m spacing
                const pts = [];
                let acc = 0;
                for (let i = 0; i < wall.pathPts.length; i++) {
                    const p = wall.pathPts[i];
                    if (i === 0) { pts.push(p); continue; }
                    const prev = pts[pts.length - 1];
                    acc = F.dist(p.x, p.y, prev.x, prev.y);
                    if (acc >= 1.05) pts.push(p);
                }
                const last = wall.pathPts[wall.pathPts.length - 1];
                if (pts.length && F.dist(last.x, last.y, pts[pts.length - 1].x, pts[pts.length - 1].y) > 0.4) pts.push(last);

                for (let i = 0; i < pts.length - 1; i++) {
                    const a = pts[i], b = pts[i + 1];
                    const mx = (a.x + b.x) / 2, mz = (a.y + b.y) / 2;
                    const piece = game.forts.pieceAt(F.toCell(mx), F.toCellY(mz));
                    const hA = t.heightAtPx(a.x, a.y), hB = t.heightAtPx(b.x, b.y);

                    if (!piece) {
                        // breach: rubble stump
                        gb.box(mx, Math.min(hA, hB) - 0.2, mz, 1.2, 0.5, 1.2, rubbleC, i * 0.7);
                        continue;
                    }
                    const tier = F.WALL_TIERS[piece.tier];
                    const width = piece.isGate ? 1.9 : (piece.tier === 0 ? 0.9 : 1.5);
                    const height = tier.height * (piece.isGate ? 0.85 : 1);
                    const dmg = piece.hp / piece.maxHp;
                    const col = new THREE.Color(piece.isGate ? 0x7a5228 : tier.color)
                        .multiplyScalar(0.5 + 0.5 * dmg);

                    // direction & perpendicular
                    const dx = b.x - a.x, dz = b.y - a.y;
                    const len = Math.max(0.001, Math.hypot(dx, dz));
                    const px = -dz / len, pz = dx / len;
                    const w2 = width / 2;
                    const base = Math.min(hA, hB) - 0.5;
                    const topA = hA + height, topB = hB + height;

                    const v = (sx, sz, y, side) => [sx + px * w2 * side, y, sz + pz * w2 * side];
                    const A1 = v(a.x, a.y, base, 1), A2 = v(a.x, a.y, base, -1);
                    const B1 = v(b.x, b.y, base, 1), B2 = v(b.x, b.y, base, -1);
                    const A1t = v(a.x, a.y, topA, 1), A2t = v(a.x, a.y, topA, -1);
                    const B1t = v(b.x, b.y, topB, 1), B2t = v(b.x, b.y, topB, -1);

                    gb.quad(A1, B1, B1t, A1t, col);      // side +
                    gb.quad(B2, A2, A2t, B2t, col);      // side -
                    gb.quad(A1t, B1t, B2t, A2t, col);    // walkway top
                    gb.quad(A2, A1, A1t, A2t, col);      // caps (cheap; hidden at joins)
                    gb.quad(B1, B2, B2t, B1t, col);

                    // battlements / palisade tips
                    const topMid = (topA + topB) / 2;
                    if (piece.tier === 0 && !piece.isGate) {
                        if (i % 2 === 0) gb.box(mx, topMid - 0.1, mz, 0.45, 0.55, 0.45, col, Math.atan2(dz, dx));
                    } else if (!piece.isGate && i % 2 === 0) {
                        const yaw = Math.atan2(dz, dx);
                        gb.box(mx + px * w2 * 0.7, topMid, mz + pz * w2 * 0.7, 0.5, 0.5, 0.34, col, yaw);
                        gb.box(mx - px * w2 * 0.7, topMid, mz - pz * w2 * 0.7, 0.5, 0.5, 0.34, col, yaw);
                    }
                    if (piece.isGate) {
                        // lintel beam & studs
                        gb.box(mx, topMid + 0.05, mz, 1.4, 0.5, width + 0.3, new THREE.Color(0x4e3418), Math.atan2(dz, dx));
                    }
                    if (piece.oil) {
                        const ready = piece.oil.cooldown <= 0;
                        gb.box(mx, topMid + 0.15, mz, 0.7, 0.55, 0.7,
                            new THREE.Color(ready ? 0x2c2118 : 0x554a3a), 0);
                    }
                }
            }
            const mesh = new THREE.Mesh(gb.build(), flatMat());
            mesh.castShadow = true;
            mesh.receiveShadow = true;
            this.wallMesh = mesh;
            this.scene.add(mesh);
        }

        rebuildDefenses(game) {
            if (this.defenseMesh) {
                this.scene.remove(this.defenseMesh);
                this.defenseMesh.geometry.dispose();
                this.defenseMesh = null;
            }
            const t = game.terrain;
            const gb = new GeomBuilder();
            const moatC = new THREE.Color(0x2e4d63);
            const stakeC = new THREE.Color(0x6b4a26);
            for (let gy = 0; gy < F.GRID_H; gy++) {
                for (let gx = 0; gx < F.GRID_W; gx++) {
                    if (!game.forts.moat[F.idx(gx, gy)]) continue;
                    const x = F.cellCx(gx), z = F.cellCy(gy);
                    const y = t.heightAtPx(x, z);
                    gb.box(x, y - 0.65, z, 1.05, 0.5, 1.05, moatC, 0);
                }
            }
            for (const st of game.forts.stakes.values()) {
                const x = F.cellCx(st.gx), z = F.cellCy(st.gy);
                const y = t.heightAtPx(x, z);
                for (let k = 0; k < 3; k++) {
                    const ox = ((k * 37) % 10) / 10 - 0.45, oz = ((k * 53) % 10) / 10 - 0.45;
                    gb.box(x + ox, y, z + oz, 0.14, 0.8, 0.14, stakeC, k * 0.9);
                }
            }
            const mesh = new THREE.Mesh(gb.build(), flatMat());
            mesh.receiveShadow = true;
            this.defenseMesh = mesh;
            this.scene.add(mesh);
        }

        /* ----------------------- buildings & towers ----------------------- */

        makeHouse(b, t) {
            const g = new THREE.Group();
            const rng = F.mulberry32((b.gx * 7919) ^ (b.gy * 104729));
            const wallC = new THREE.Color().setHSL(0.09 + rng() * 0.03, 0.32, 0.6 + rng() * 0.08);
            const roofC = new THREE.Color().setHSL(0.02 + rng() * 0.04, 0.5, 0.32 + rng() * 0.08);
            const gb = new GeomBuilder();
            const w = 2.6 + rng() * 0.8, d = 2.1 + rng() * 0.6, h = 1.7;
            gb.box(0, 0, 0, w, h, d, wallC, 0);
            // hip roof: pyramid over the box
            const rh = 1.3;
            const p = [[-w / 2 - 0.25, h, -d / 2 - 0.25], [w / 2 + 0.25, h, -d / 2 - 0.25],
                       [w / 2 + 0.25, h, d / 2 + 0.25], [-w / 2 - 0.25, h, d / 2 + 0.25]];
            const apexA = [-w * 0.18, h + rh, 0], apexB = [w * 0.18, h + rh, 0];
            gb.tri(p[0], p[1], apexB, roofC); gb.tri(p[0], apexB, apexA, roofC);
            gb.tri(p[1], p[2], apexB, roofC);
            gb.tri(p[2], p[3], apexA, roofC); gb.tri(p[2], apexA, apexB, roofC);
            gb.tri(p[3], p[0], apexA, roofC);
            const mesh = new THREE.Mesh(gb.build(), flatMat());
            mesh.castShadow = true; mesh.receiveShadow = true;
            g.add(mesh);
            g.rotation.y = b.rot;
            g.position.set(b.x, t.heightAtPx(b.x, b.y) - 0.15, b.y);
            return g;
        }

        makeKeep(b, t) {
            const g = new THREE.Group();
            const gb = new GeomBuilder();
            const stone = new THREE.Color(0x8d8d94);
            const dark = new THREE.Color(0x6f6f76);
            const roof = new THREE.Color(0x8c3b2e);
            gb.box(0, 0, 0, 5.4, 3.2, 5.4, dark, 0);          // bailey
            gb.box(0, 3.2, 0, 4.2, 3.6, 4.2, stone, 0);       // main tower
            gb.box(1.9, 6.4, 1.9, 1.1, 1.1, 1.1, stone, 0);   // corner merlons
            gb.box(-1.9, 6.4, 1.9, 1.1, 1.1, 1.1, stone, 0);
            gb.box(1.9, 6.4, -1.9, 1.1, 1.1, 1.1, stone, 0);
            gb.box(-1.9, 6.4, -1.9, 1.1, 1.1, 1.1, stone, 0);
            // roof pyramid + banner
            const p = [[-1.6, 6.8, -1.6], [1.6, 6.8, -1.6], [1.6, 6.8, 1.6], [-1.6, 6.8, 1.6]];
            const apex = [0, 9.2, 0];
            gb.tri(p[0], p[1], apex, roof); gb.tri(p[1], p[2], apex, roof);
            gb.tri(p[2], p[3], apex, roof); gb.tri(p[3], p[0], apex, roof);
            gb.box(0, 9.2, 0, 0.14, 1.6, 0.14, dark, 0);
            gb.box(0.45, 10.4, 0, 0.9, 0.5, 0.06, new THREE.Color(0xc03028), 0);
            const mesh = new THREE.Mesh(gb.build(), flatMat());
            mesh.castShadow = true; mesh.receiveShadow = true;
            g.add(mesh);
            g.position.set(b.x, t.heightAtPx(b.x, b.y) - 0.2, b.y);
            return g;
        }

        makeRuin(b, t) {
            const gb = new GeomBuilder();
            const c = new THREE.Color(0x3d3833);
            gb.box(0, 0, 0, 2.4, 0.5, 2, c, 0.4);
            gb.box(0.6, 0, -0.4, 0.9, 1.0, 0.7, c, 0.9);
            const mesh = new THREE.Mesh(gb.build(), flatMat());
            mesh.castShadow = true;
            const g = new THREE.Group();
            g.add(mesh);
            g.position.set(b.x, t.heightAtPx(b.x, b.y) - 0.1, b.y);
            return g;
        }

        syncBuildings(game) {
            const t = game.terrain;
            game.buildings.forEach((b, i) => {
                const existing = this.buildingGroups.get(i);
                const wantRuin = b.hp <= 0;
                if (existing && existing.userData.ruin === wantRuin) return;
                if (existing) this.scene.remove(existing);
                const g = wantRuin ? this.makeRuin(b, t)
                    : (b.kind === 'keep' ? this.makeKeep(b, t) : this.makeHouse(b, t));
                g.userData.ruin = wantRuin;
                this.buildingGroups.set(i, g);
                this.scene.add(g);
            });
        }

        makeTower(tw, game) {
            const stats = F.TOWER_TIERS[tw.tier];
            const g = new THREE.Group();
            const gb = new GeomBuilder();
            const c = new THREE.Color(stats.color);
            const h = stats.h;
            const r = 1.15 + tw.tier * 0.25;
            // hexagonal shaft via rotated boxes (chunky low-poly)
            gb.box(0, 0, 0, r * 2, h, r * 2, c, 0);
            gb.box(0, 0, 0, r * 2, h, r * 2, c.clone().multiplyScalar(0.92), Math.PI / 4);
            // crown
            gb.box(0, h, 0, r * 2.6, 0.7, r * 2.6, c.clone().multiplyScalar(1.08), 0);
            for (let k = 0; k < 4; k++) {
                const a = k * Math.PI / 2 + Math.PI / 4;
                gb.box(Math.cos(a) * r * 1.15, h + 0.7, Math.sin(a) * r * 1.15, 0.5, 0.55, 0.5, c, a);
            }
            if (tw.tier === 2) { // ballista arms
                gb.box(0, h + 0.9, 0, 2.6, 0.18, 0.18, new THREE.Color(0x4a3520), 0.6);
                gb.box(0, h + 0.9, 0, 0.18, 0.18, 2.6, new THREE.Color(0x4a3520), 0.6);
            }
            const mesh = new THREE.Mesh(gb.build(), flatMat());
            mesh.castShadow = true; mesh.receiveShadow = true;
            g.add(mesh);
            const t = game.terrain;
            const piece = game.forts.pieceAt(tw.gx, tw.gy);
            const baseY = t.heightAtPx(tw.x, tw.y) + (piece ? F.WALL_TIERS[piece.tier].height * 0.55 : 0) - 0.2;
            g.position.set(tw.x, baseY, tw.y);
            g.userData.mesh = mesh;
            return g;
        }

        syncTowers(game) {
            const live = new Set();
            for (const tw of game.forts.towers) {
                live.add(tw.id);
                if (!this.towerGroups.has(tw.id)) {
                    const g = this.makeTower(tw, game);
                    this.towerGroups.set(tw.id, g);
                    this.scene.add(g);
                }
            }
            for (const [id, g] of this.towerGroups) {
                if (!live.has(id)) {
                    this.scene.remove(g);
                    this.towerGroups.delete(id);
                }
            }
        }

        /* ------------------------ units (instanced) ------------------------ */

        initUnitMeshes() {
            // infantry: cone body + head
            const body = new THREE.ConeGeometry(0.42, 1.5, 5);
            body.translate(0, 0.75, 0);
            const head = new THREE.IcosahedronGeometry(0.24, 0);
            head.translate(0, 1.62, 0);
            const infGeom = mergeGeoms([body, head]);

            // engine: hull + frame
            const hull = new THREE.BoxGeometry(1.6, 1.0, 2.4);
            hull.translate(0, 0.8, 0);
            const frame = new THREE.BoxGeometry(1.0, 0.8, 1.4);
            frame.translate(0, 1.7, 0);
            const engGeom = mergeGeoms([hull, frame]);

            // siege tower: tall shaft
            const shaft = new THREE.BoxGeometry(1.9, 4.2, 1.9);
            shaft.translate(0, 2.1, 0);
            const cap = new THREE.BoxGeometry(2.3, 0.6, 2.3);
            cap.translate(0, 4.4, 0);
            const stGeom = mergeGeoms([shaft, cap]);

            const mat = new THREE.MeshLambertMaterial();
            this.unitPools = {
                inf: new THREE.InstancedMesh(infGeom, mat.clone(), 260),
                eng: new THREE.InstancedMesh(engGeom, mat.clone(), 40),
                st:  new THREE.InstancedMesh(stGeom, mat.clone(), 16)
            };
            const white = new THREE.Color(0xffffff);
            for (const m of Object.values(this.unitPools)) {
                m.castShadow = true;
                m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
                // Pre-create instanceColor so the shader compiles with the
                // per-instance color path from the very first frame.
                for (let i = 0; i < m.instanceMatrix.count; i++) m.setColorAt(i, white);
                m.instanceColor.setUsage(THREE.DynamicDrawUsage);
                m.count = 0;
                this.scene.add(m);
            }
            this._dummy = new THREE.Object3D();
            this._color = new THREE.Color();
        }

        unitClass(type) {
            if (type.special === 'siegetower') return 'st';
            if (type.special === 'artillery' || type.special === 'ram') return 'eng';
            return 'inf';
        }

        updateUnits(game) {
            const counts = { inf: 0, eng: 0, st: 0 };
            const t = game.terrain;
            for (const a of game.attackers) {
                if (a.dead) continue;
                const cls = this.unitClass(a.type);
                const pool = this.unitPools[cls];
                const i = counts[cls]++;
                if (i >= pool.instanceMatrix.count) continue;
                const d = this._dummy;
                d.position.set(a.x, t.heightAtPx(a.x, a.y), a.y);
                d.rotation.set(0, a.heading || 0, 0);
                const s = cls === 'inf' ? a.type.radius / 0.45 : a.type.radius / 0.95;
                d.scale.set(s, cls === 'inf' && a.type.special === 'boss' ? s * 1.15 : s, s);
                d.updateMatrix();
                pool.setMatrixAt(i, d.matrix);
                this._color.set(a.type.color);
                if (a.fuse >= 0) this._color.lerp(new THREE.Color(0xff4020), (Math.sin(performance.now() / 60) + 1) / 2);
                pool.setColorAt(i, this._color);
            }
            for (const [cls, pool] of Object.entries(this.unitPools)) {
                pool.count = counts[cls];
                pool.instanceMatrix.needsUpdate = true;
                if (pool.instanceColor) pool.instanceColor.needsUpdate = true;
            }
        }

        /* -------------------------- projectiles --------------------------- */

        initProjectiles() {
            const arrowG = new THREE.BoxGeometry(0.07, 0.07, 0.9);
            const stoneG = new THREE.IcosahedronGeometry(0.34, 0);
            const mat = new THREE.MeshBasicMaterial({ color: 0x2f2418 });
            const stoneMat = new THREE.MeshLambertMaterial({ color: 0x55504a });
            this.arrowPool = new THREE.InstancedMesh(arrowG, mat, 120);
            this.stonePool = new THREE.InstancedMesh(stoneG, stoneMat, 40);
            this.arrowPool.count = 0; this.stonePool.count = 0;
            this.arrowPool.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
            this.stonePool.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
            this.scene.add(this.arrowPool, this.stonePool);
        }

        updateProjectiles(game) {
            const t = game.terrain;
            let na = 0, ns = 0;
            const d = this._dummy;
            for (const p of game.projectiles) {
                const k = Math.min(1, p.t / p.dur);
                const y0 = t.heightAtPx(p.sx, p.sy) + 2.2;
                const y1 = t.heightAtPx(p.tx, p.ty) + 1.2;
                if (p.kind === 'stone') {
                    if (ns >= 40) continue;
                    d.position.set(p.x, F.lerp(y0, y1, k) + p.arcOffset(), p.y);
                    d.rotation.set(k * 5, 0, k * 3);
                    d.scale.setScalar(1);
                    d.updateMatrix();
                    this.stonePool.setMatrixAt(ns++, d.matrix);
                } else {
                    if (na >= 120) continue;
                    const arc = Math.sin(Math.PI * k) * Math.min(3, p.dur * 6);
                    d.position.set(p.x, F.lerp(y0, y1, k) + arc, p.y);
                    d.rotation.set(0, Math.atan2(p.tx - p.sx, p.ty - p.sy), 0);
                    d.scale.set(1, 1, p.kind === 'bolt' ? 1.5 : 1);
                    d.updateMatrix();
                    this.arrowPool.setMatrixAt(na++, d.matrix);
                }
            }
            this.arrowPool.count = na;
            this.stonePool.count = ns;
            this.arrowPool.instanceMatrix.needsUpdate = true;
            this.stonePool.instanceMatrix.needsUpdate = true;
        }

        /* ---------------------------- effects ------------------------------ */

        initEffects() {
            this.effectPool = [];
            const geom = new THREE.IcosahedronGeometry(1, 0);
            for (let i = 0; i < 28; i++) {
                const m = new THREE.Mesh(geom, new THREE.MeshBasicMaterial({
                    transparent: true, opacity: 0.7, depthWrite: false
                }));
                m.visible = false;
                this.effectPool.push(m);
                this.scene.add(m);
            }
        }

        updateEffects(game) {
            const t = game.terrain;
            const colors = {
                explosion: 0xff8a30, oil: 0xff9010, death: 0x701810, hit: 0xfff0c8
            };
            let i = 0;
            for (const e of game.effects) {
                if (i >= this.effectPool.length) break;
                const m = this.effectPool[i++];
                const k = e.t / e.dur;
                m.visible = true;
                m.position.set(e.x, t.heightAtPx(e.x, e.y) + 0.8 + k * e.r * 0.5, e.y);
                m.scale.setScalar(Math.max(0.05, e.r * (0.35 + k * 0.9)));
                m.material.color.set(colors[e.kind] || 0xffffff);
                m.material.opacity = 0.75 * (1 - k);
            }
            for (; i < this.effectPool.length; i++) this.effectPool[i].visible = false;
        }

        /* ------------------- selection / ghosts / beacons ------------------ */

        initSelectionRing() {
            const ring = new THREE.Mesh(
                new THREE.RingGeometry(1, 1.18, 24),
                new THREE.MeshBasicMaterial({ color: 0xf2e090, transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false })
            );
            ring.rotation.x = -Math.PI / 2;
            ring.visible = false;
            this.selRing = ring;
            this.scene.add(ring);

            const rangeRing = new THREE.Mesh(
                new THREE.RingGeometry(0.97, 1, 48),
                new THREE.MeshBasicMaterial({ color: 0xf2e090, transparent: true, opacity: 0.5, side: THREE.DoubleSide, depthWrite: false })
            );
            rangeRing.rotation.x = -Math.PI / 2;
            rangeRing.visible = false;
            this.rangeRing = rangeRing;
            this.scene.add(rangeRing);

            // beacons for incoming attacks
            const beaconGeom = new THREE.ConeGeometry(1.2, 4, 5);
            beaconGeom.translate(0, 2, 0);
            this.beaconMat = new THREE.MeshBasicMaterial({ color: 0xe03828, transparent: true, opacity: 0.7 });
            this.beaconGeom = beaconGeom;
        }

        updateSelection(game) {
            const t = game.terrain;
            const s = game.selected;
            this.selRing.visible = false;
            this.rangeRing.visible = false;
            if (!s) return;
            let x, z, r = 1.4, elev = null, range = 0;
            if (s.kind === 'tower' && game.forts.towers.includes(s.obj)) {
                x = s.obj.x; z = s.obj.y; r = 2.2;
                range = F.TOWER_TIERS[s.obj.tier].range;
            } else if (s.kind === 'building' && s.obj.hp > 0) {
                x = s.obj.x; z = s.obj.y; r = s.obj.kind === 'keep' ? 4.4 : 2.6;
            } else if (s.kind === 'attacker' && !s.obj.dead) {
                x = s.obj.x; z = s.obj.y; r = s.obj.type.radius + 0.7;
            } else if (s.kind === 'wall' && game.forts.pieces.has(s.obj.id)) {
                x = F.cellCx(s.obj.gx); z = F.cellCy(s.obj.gy); r = 1.3;
            } else return;
            this.selRing.visible = true;
            this.selRing.position.set(x, t.heightAtPx(x, z) + 0.15, z);
            this.selRing.scale.setScalar(r);
            if (range > 0) {
                this.rangeRing.visible = true;
                this.rangeRing.position.copy(this.selRing.position);
                this.rangeRing.scale.setScalar(range);
            }
        }

        updateGhost(game) {
            const plan = game.preview && game.preview.plan;
            const hover = game.hover;
            const key = JSON.stringify([
                plan ? plan.cost : -1, plan ? plan.cells.length : -1,
                game.tool, game.towerTier,
                hover ? [Math.round(hover.x * 2), Math.round(hover.y * 2)] : null,
                game.wallNodes.length
            ]);
            if (key === this._ghostKey) return;
            this._ghostKey = key;

            // clear
            while (this.ghostGroup.children.length) {
                const c = this.ghostGroup.children.pop();
                if (c.geometry) c.geometry.dispose();
                this.ghostGroup.remove(c);
            }
            const t = game.terrain;

            if ((game.tool === 'wall' || game.tool === 'gatewall') && plan) {
                const ok = plan.valid && plan.cost <= game.gold;
                const col = new THREE.Color(ok ? 0x54d060 : 0xe05038);
                const gb = new GeomBuilder();
                const tier = F.WALL_TIERS[game.wallTier];
                for (let i = 0; i < plan.path.length - 1; i++) {
                    const a = plan.path[i], b = plan.path[i + 1];
                    const hA = t.heightAtPx(a.x, a.y), hB = t.heightAtPx(b.x, b.y);
                    const dx = b.x - a.x, dz = b.y - a.y;
                    const len = Math.max(0.001, Math.hypot(dx, dz));
                    const px = -dz / len, pz = dx / len;
                    const w2 = 0.5;
                    const base = Math.min(hA, hB) - 0.3;
                    gb.quad([a.x + px * w2, base, a.y + pz * w2], [b.x + px * w2, base, b.y + pz * w2],
                            [b.x + px * w2, hB + tier.height, b.y + pz * w2], [a.x + px * w2, hA + tier.height, a.y + pz * w2], col);
                    gb.quad([b.x - px * w2, base, b.y - pz * w2], [a.x - px * w2, base, a.y - pz * w2],
                            [a.x - px * w2, hA + tier.height, a.y - pz * w2], [b.x - px * w2, hB + tier.height, b.y - pz * w2], col);
                    gb.quad([a.x + px * w2, hA + tier.height, a.y + pz * w2], [b.x + px * w2, hB + tier.height, b.y + pz * w2],
                            [b.x - px * w2, hB + tier.height, b.y - pz * w2], [a.x - px * w2, hA + tier.height, a.y - pz * w2], col);
                }
                const mesh = new THREE.Mesh(gb.build(), new THREE.MeshBasicMaterial({
                    vertexColors: true, transparent: true, opacity: 0.45, depthWrite: false
                }));
                this.ghostGroup.add(mesh);
                // node markers
                for (const n of game.wallNodes) {
                    const s = new THREE.Mesh(new THREE.IcosahedronGeometry(0.4, 0),
                        new THREE.MeshBasicMaterial({ color: 0xffffff }));
                    s.position.set(n.x, t.heightAtPx(n.x, n.y) + 0.5, n.y);
                    this.ghostGroup.add(s);
                }
            }

            if (game.tool === 'tower' && hover) {
                const stats = F.TOWER_TIERS[game.towerTier];
                const ok = game.forts.canPlaceTower(hover.gx, hover.gy) && game.gold >= stats.cost;
                const col = ok ? 0x54d060 : 0xe05038;
                const cyl = new THREE.Mesh(new THREE.CylinderGeometry(1.3, 1.5, stats.h, 6),
                    new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.4, depthWrite: false }));
                const y = t.heightAtPx(hover.x, hover.y);
                cyl.position.set(hover.x, y + stats.h / 2, hover.y);
                this.ghostGroup.add(cyl);
                const ring = new THREE.Mesh(new THREE.RingGeometry(0.97, 1, 48),
                    new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.4, side: THREE.DoubleSide, depthWrite: false }));
                ring.rotation.x = -Math.PI / 2;
                const piece = game.forts.pieceAt(hover.gx, hover.gy);
                const elev = y + stats.h + (piece ? F.WALL_TIERS[piece.tier].height : 0);
                const avg = (t.minH + t.maxH) / 2;
                ring.scale.setScalar(stats.range * (1 + Math.max(0, elev - avg) * 0.03));
                ring.position.set(hover.x, y + 0.2, hover.y);
                this.ghostGroup.add(ring);
            }

            if ((game.tool === 'moat' || game.tool === 'stakes' || game.tool === 'oil') && hover) {
                const box = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.3, 1.1),
                    new THREE.MeshBasicMaterial({ color: 0xf2e090, transparent: true, opacity: 0.5, depthWrite: false }));
                box.position.set(hover.x, t.heightAtPx(hover.x, hover.y) + 0.2, hover.y);
                this.ghostGroup.add(box);
            }
        }

        updateBeacons(game) {
            const want = (game.state === 'combat' && game.spawnQueue.length > 0)
                ? (game.spawnBeacons || []) : [];
            const key = JSON.stringify(want);
            if (key !== this._beaconKey) {
                this._beaconKey = key;
                while (this.beaconGroup.children.length) this.beaconGroup.remove(this.beaconGroup.children[0]);
                for (const b of want) {
                    const m = new THREE.Mesh(this.beaconGeom, this.beaconMat);
                    m.position.set(b.x, game.terrain.heightAtPx(b.x, b.y) + 1, b.y);
                    this.beaconGroup.add(m);
                }
            }
            const pulse = 0.75 + Math.sin(performance.now() / 180) * 0.25;
            for (const m of this.beaconGroup.children) m.scale.setScalar(pulse);
        }

        /* ----------------------------- camera ------------------------------ */

        updateCamera(dt, keys) {
            const c = this.cam;
            const speed = c.dist * 0.9;
            const fx = Math.sin(c.yaw), fz = Math.cos(c.yaw);
            if (keys.w) { c.target.x -= fx * speed * dt; c.target.z -= fz * speed * dt; }
            if (keys.s) { c.target.x += fx * speed * dt; c.target.z += fz * speed * dt; }
            if (keys.a) { c.target.x -= fz * speed * dt; c.target.z += fx * speed * dt; }
            if (keys.d) { c.target.x += fz * speed * dt; c.target.z -= fx * speed * dt; }
            c.target.x = F.clamp(c.target.x, 6, F.WORLD_W - 6);
            c.target.z = F.clamp(c.target.z, 6, F.WORLD_H - 6);
            const groundY = this.game.terrain.heightAtPx(c.target.x, c.target.z);
            c.target.y += (groundY - c.target.y) * Math.min(1, dt * 6);

            c.pitch = F.clamp(c.pitch, 0.35, 1.35);
            c.dist = F.clamp(c.dist, 16, 150);
            const cx = c.target.x + Math.sin(c.yaw) * Math.cos(c.pitch) * c.dist;
            const cz = c.target.z + Math.cos(c.yaw) * Math.cos(c.pitch) * c.dist;
            const cy = c.target.y + Math.sin(c.pitch) * c.dist;
            this.camera.position.set(cx, cy, cz);
            this.camera.lookAt(c.target);
        }

        /** Raycast a screen point onto the terrain; returns {x, y} sim coords. */
        pick(clientX, clientY) {
            const rect = this.renderer.domElement.getBoundingClientRect();
            const ndc = new THREE.Vector2(
                ((clientX - rect.left) / rect.width) * 2 - 1,
                -((clientY - rect.top) / rect.height) * 2 + 1
            );
            this.raycaster.setFromCamera(ndc, this.camera);
            const hits = this.raycaster.intersectObject(this.terrainMesh);
            if (!hits.length) return null;
            const p = hits[0].point;
            return { x: F.clamp(p.x, 0.5, F.WORLD_W - 0.5), y: F.clamp(p.z, 0.5, F.WORLD_H - 0.5) };
        }

        /** Project a world point to screen px; null when behind the camera. */
        project(x, yWorld, z) {
            const v = new THREE.Vector3(x, yWorld, z).project(this.camera);
            if (v.z > 1) return null;
            const rect = this.renderer.domElement.getBoundingClientRect();
            return { x: (v.x + 1) / 2 * rect.width, y: (1 - v.y) / 2 * rect.height };
        }

        /* ------------------------------ frame ------------------------------ */

        render(game, dt) {
            this._wallRebuildCooldown -= dt;
            if (game.forts.meshDirty && this._wallRebuildCooldown <= 0) {
                game.forts.meshDirty = false;
                this._wallRebuildCooldown = 0.12;
                this.rebuildWalls(game);
                this.rebuildDefenses(game);
            }
            this.syncTowers(game);
            this.updateUnits(game);
            this.updateProjectiles(game);
            this.updateEffects(game);
            this.updateGhost(game);
            this.updateSelection(game);
            this.updateBeacons(game);
            this.updateCamera(dt, this.keys || {});
            this.renderer.render(this.scene, this.camera);
        }
    }

    F.Renderer3D = Renderer3D;
})();
