/**
 * Contour Map Creator - Main Application
 */

class ContourMapApp {
    constructor() {
        this.map = null;
        this.selectedBounds = null;
        this.selectionRectangle = null;
        this.isSelecting = false;
        this.startPoint = null;
        this.contourLayer = null;
        this.originalContours = null;
        this.currentContours = null;
        this.samples = [];
        this.currentPane = 1;
        this.previewCanvas = null;
        this.previewCtx = null;
        this.heatmapCanvas = null;
        this.heatmapCtx = null;
        this.refinementPoints = [];
        this.simplificationPointRanking = [];
        this.showTriangulation = false;
        this.showMapSnapshot = false;
        this.mapSnapshotDataURL = null;

        this.init();
    }

    init() {
        this.initMap();
        this.initControls();
        this.initPanes();
        this.setupRightClickSelection();

        // Re-render canvases on window resize so panes fit properly
        window.addEventListener('resize', () => {
            if (this._resizeTimer) clearTimeout(this._resizeTimer);
            this._resizeTimer = setTimeout(() => {
                if (this.currentPane === 1 && this.map) {
                    this.map.invalidateSize();
                } else if (this.currentPane === 2 && this.selectedBounds) {
                    this.updatePreview();
                } else if (this.currentPane === 3 && this.samples && this.samples.length > 0) {
                    this.drawHeatmap();
                } else if (this.currentPane === 4 && this.currentContours) {
                    this.updateSVGPreview();
                }
            }, 150);
        });
    }

    initMap() {
        // Initialize Leaflet map
        this.map = L.map('map', {
            center: [40.7128, -74.0060], // Default to NYC
            zoom: 13,
            zoomControl: true
        });

        // Add Esri World Imagery tile layer with CORS support
        L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
            attribution: 'Leaflet | Powered by Esri | Earthstar Geographics',
            maxZoom: 18,
            crossOrigin: 'anonymous'
        }).addTo(this.map);

        // Create layer for contours
        this.contourLayer = L.layerGroup().addTo(this.map);

        // Invalidate map size after a short delay to ensure proper rendering
        setTimeout(() => {
            this.map.invalidateSize();
        }, 100);
    }

    initControls() {
        // No longer needed - all controls are in panes
    }

    initPanes() {
        // Setup pane headers for toggling
        const paneHeaders = document.querySelectorAll('.pane-header');
        paneHeaders.forEach(header => {
            header.addEventListener('click', () => {
                const pane = header.parentElement;
                const paneNumber = parseInt(pane.dataset.pane);
                this.togglePane(paneNumber);
            });
        });

        // Initialize preview canvas
        this.previewCanvas = document.getElementById('preview-canvas');
        this.previewCtx = this.previewCanvas.getContext('2d');

        // Initialize heatmap canvas
        this.heatmapCanvas = document.getElementById('heatmap-canvas');
        this.heatmapCtx = this.heatmapCanvas.getContext('2d');

        // Sample terrain button
        document.getElementById('lock-points-btn').addEventListener('click', () => {
            this.lockPointsAndFetchElevations();
        });

        // Generate contours button
        document.getElementById('generate-contours-btn').addEventListener('click', () => {
            this.generateContoursFromElevations();
        });

        // Pane 4 controls
        const showMapSnapshotCheckbox = document.getElementById('show-map-snapshot');
        showMapSnapshotCheckbox.addEventListener('change', (e) => {
            this.showMapSnapshot = e.target.checked;
            this.updateSVGPreview();
        });

        const showTriangulationCheckbox = document.getElementById('show-triangulation');
        showTriangulationCheckbox.addEventListener('change', (e) => {
            this.showTriangulation = e.target.checked;
            this.updateSVGPreview();
        });

        const paneSimplifySlider = document.getElementById('pane-simplify-slider');
        const paneSimplifyValue = document.getElementById('pane-simplify-value');
        paneSimplifySlider.addEventListener('input', (e) => {
            const removeCount = parseInt(e.target.value);
            paneSimplifyValue.textContent = removeCount + ' points';
            this.applySimplificationByCount(removeCount);
        });

        // Contour interval changes should regenerate contours
        const contourIntervalInput = document.getElementById('pane-contour-interval');
        contourIntervalInput.addEventListener('input', () => {
            if (this.samples && this.samples.length > 0) {
                const interval = parseFloat(contourIntervalInput.value);
                this.generateContourLinesFromTriangles(this.samples, interval);
                this.displayContours();
                this.updateSVGPreview();
            }
        });

        document.getElementById('pane-export-btn').addEventListener('click', () => {
            this.exportSVG();
        });

        // Open first pane by default
        this.openPane(1);
    }

    togglePane(paneNumber) {
        const pane = document.querySelector(`.workflow-pane[data-pane="${paneNumber}"]`);
        if (pane.classList.contains('open')) {
            pane.classList.remove('open');
        } else {
            this.openPane(paneNumber);
        }
    }

    openPane(paneNumber) {
        // Close all panes
        document.querySelectorAll('.workflow-pane').forEach(p => {
            p.classList.remove('open');
        });

        // Open the selected pane
        const pane = document.querySelector(`.workflow-pane[data-pane="${paneNumber}"]`);
        if (pane) {
            pane.classList.add('open');
            this.currentPane = paneNumber;

            // After layout settles, refresh size-dependent content
            requestAnimationFrame(() => {
                if (paneNumber === 1 && this.map) {
                    this.map.invalidateSize();
                } else if (paneNumber === 2 && this.selectedBounds) {
                    this.updatePreview();
                } else if (paneNumber === 3 && this.samples && this.samples.length > 0) {
                    this.drawHeatmap();
                } else if (paneNumber === 4 && this.currentContours) {
                    this.updateSVGPreview();
                }
            });
        }
    }

    completePane(paneNumber) {
        const pane = document.querySelector(`.workflow-pane[data-pane="${paneNumber}"]`);
        if (pane) {
            const header = pane.querySelector('.pane-header');
            header.classList.add('completed');
            header.classList.remove('active');
            const icon = header.querySelector('.status-icon');
            icon.textContent = '✓';
        }
    }

    activatePane(paneNumber) {
        const pane = document.querySelector(`.workflow-pane[data-pane="${paneNumber}"]`);
        if (pane) {
            const header = pane.querySelector('.pane-header');
            header.classList.add('active');
            header.classList.remove('completed');
            const icon = header.querySelector('.status-icon');
            icon.textContent = '⏵';
        }
    }

    setupRightClickSelection() {
        const mapContainer = this.map.getContainer();

        // Suppress right-click context menu on map and all children (capture phase)
        mapContainer.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            e.stopPropagation();
        }, true);
        // Also prevent via Leaflet's own event system
        this.map.on('contextmenu', (e) => { L.DomEvent.preventDefault(e); });

        // Mouse down - start selection
        mapContainer.addEventListener('mousedown', (e) => {
            if (e.button === 2) { // Right-click
                this.isSelecting = true;
                const rect = mapContainer.getBoundingClientRect();
                const x = e.clientX - rect.left;
                const y = e.clientY - rect.top;
                this.startPoint = this.map.containerPointToLatLng([x, y]);

                // Remove existing selection
                if (this.selectionRectangle) {
                    this.map.removeLayer(this.selectionRectangle);
                }

                // Clear contours
                this.clearContours();

                e.preventDefault();
            }
        });

        // Mouse move - update selection
        mapContainer.addEventListener('mousemove', (e) => {
            if (this.isSelecting && this.startPoint) {
                const rect = mapContainer.getBoundingClientRect();
                const x = e.clientX - rect.left;
                const y = e.clientY - rect.top;
                const currentPoint = this.map.containerPointToLatLng([x, y]);

                const bounds = L.latLngBounds(this.startPoint, currentPoint);

                if (this.selectionRectangle) {
                    this.map.removeLayer(this.selectionRectangle);
                }

                this.selectionRectangle = L.rectangle(bounds, {
                    className: 'selection-box',
                    weight: 2,
                    fillOpacity: 0.1
                }).addTo(this.map);
            }
        });

        // Mouse up - finish selection
        mapContainer.addEventListener('mouseup', (e) => {
            if (e.button === 2 && this.isSelecting) {
                this.isSelecting = false;

                if (this.selectionRectangle) {
                    this.selectedBounds = this.selectionRectangle.getBounds();
                    this.updateBoundsDisplay();

                    // Capture map snapshot after bounds are selected
                    this.captureMapSnapshot();

                    // Complete pane 1 and open pane 2
                    this.completePane(1);
                    this.activatePane(2);
                    this.openPane(2);
                }
            }
        });

        // Handle mouse leaving map
        mapContainer.addEventListener('mouseleave', () => {
            if (this.isSelecting) {
                this.isSelecting = false;
            }
        });
    }

    updateBoundsDisplay() {
        const paneInfo = document.getElementById('pane-bounds-info');
        if (this.selectedBounds) {
            const sw = this.selectedBounds.getSouthWest();
            const ne = this.selectedBounds.getNorthEast();
            const html = `
                <strong>SW:</strong> ${sw.lat.toFixed(6)}, ${sw.lng.toFixed(6)}<br>
                <strong>NE:</strong> ${ne.lat.toFixed(6)}, ${ne.lng.toFixed(6)}
            `;
            if (paneInfo) paneInfo.innerHTML = html;
        } else {
            if (paneInfo) paneInfo.textContent = 'No area selected';
        }
    }

    captureMapSnapshot() {
        try {
            // Get the map container's tile layers
            const mapContainer = this.map.getContainer();

            // Create a temporary canvas to capture the map view
            const canvas = document.createElement('canvas');
            const bounds = this.selectedBounds;
            const sw = bounds.getSouthWest();
            const ne = bounds.getNorthEast();

            // Get pixel coordinates for the bounds
            const swPoint = this.map.latLngToContainerPoint(sw);
            const nePoint = this.map.latLngToContainerPoint(ne);

            const width = Math.abs(nePoint.x - swPoint.x);
            const height = Math.abs(swPoint.y - nePoint.y);

            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');

            // Get all tile layers
            const tiles = mapContainer.querySelectorAll('.leaflet-tile-pane img');

            // Draw tiles onto canvas
            let drawnAny = false;
            tiles.forEach(tile => {
                if (tile.complete && tile.naturalHeight !== 0) {
                    const tileRect = tile.getBoundingClientRect();
                    const mapRect = mapContainer.getBoundingClientRect();

                    const x = tileRect.left - mapRect.left - Math.min(swPoint.x, nePoint.x);
                    const y = tileRect.top - mapRect.top - Math.min(nePoint.y, swPoint.y);

                    try {
                        ctx.drawImage(tile, x, y);
                        drawnAny = true;
                    } catch (e) {
                        console.warn('Could not draw tile:', e);
                    }
                }
            });

            // Convert to data URL - this will fail if canvas is tainted
            if (drawnAny) {
                this.mapSnapshotDataURL = canvas.toDataURL('image/png');
                console.log('Map snapshot captured successfully');
            } else {
                console.warn('No tiles were drawn to canvas');
                this.mapSnapshotDataURL = null;
            }
        } catch (e) {
            console.error('Failed to capture map snapshot:', e.message);
            console.warn('Map snapshot feature disabled due to CORS restrictions. The tile server does not support cross-origin canvas access.');
            this.mapSnapshotDataURL = null;

            // Disable the checkbox since it won't work
            const checkbox = document.getElementById('show-map-snapshot');
            if (checkbox) {
                checkbox.disabled = true;
                checkbox.checked = false;
                const label = checkbox.parentElement;
                if (label) {
                    label.title = 'Map snapshot unavailable due to CORS restrictions';
                    label.style.opacity = '0.5';
                }
            }
        }
    }

    // --- Iterative edge-splitting sampling helpers ---

    isOnBoundary(point, bounds) {
        const eps = 1e-9;
        return Math.abs(point.x - bounds.minX) < eps ||
               Math.abs(point.x - bounds.maxX) < eps ||
               Math.abs(point.y - bounds.minY) < eps ||
               Math.abs(point.y - bounds.maxY) < eps;
    }

    getPerimeterParam(point, bounds) {
        const w = bounds.maxX - bounds.minX;
        const h = bounds.maxY - bounds.minY;
        const eps = 1e-9;
        // Walk counterclockwise from SW corner: bottom -> right -> top -> left
        if (Math.abs(point.y - bounds.minY) < eps) return point.x - bounds.minX;                    // bottom
        if (Math.abs(point.x - bounds.maxX) < eps) return w + (point.y - bounds.minY);              // right
        if (Math.abs(point.y - bounds.maxY) < eps) return w + h + (bounds.maxX - point.x);          // top
        if (Math.abs(point.x - bounds.minX) < eps) return 2 * w + h + (bounds.maxY - point.y);     // left
        return -1;
    }

    snapToBoundary(point, bounds) {
        const dists = [
            { d: Math.abs(point.y - bounds.minY), side: 'bottom' },
            { d: Math.abs(point.y - bounds.maxY), side: 'top' },
            { d: Math.abs(point.x - bounds.minX), side: 'left' },
            { d: Math.abs(point.x - bounds.maxX), side: 'right' }
        ];
        const closest = dists.reduce((a, b) => a.d < b.d ? a : b);
        if (closest.side === 'bottom') point.y = bounds.minY;
        else if (closest.side === 'top') point.y = bounds.maxY;
        else if (closest.side === 'left') point.x = bounds.minX;
        else point.x = bounds.maxX;
    }

    buildEdges(points, bounds) {
        // 1. Build boundary chain: sort boundary points by perimeter parameter
        const boundaryIndices = [];
        for (let i = 0; i < points.length; i++) {
            if (this.isOnBoundary(points[i], bounds)) {
                boundaryIndices.push({ index: i, param: this.getPerimeterParam(points[i], bounds) });
            }
        }
        boundaryIndices.sort((a, b) => a.param - b.param);

        const boundaryEdgeSet = new Set();
        const edges = [];

        // Connect consecutive boundary points (wrapping around)
        for (let i = 0; i < boundaryIndices.length; i++) {
            const a = boundaryIndices[i].index;
            const b = boundaryIndices[(i + 1) % boundaryIndices.length].index;
            const key = Math.min(a, b) + '_' + Math.max(a, b);
            boundaryEdgeSet.add(key);
            const elevDiff = (points[a].elevation != null && points[b].elevation != null)
                ? Math.abs(points[a].elevation - points[b].elevation) : 0;
            edges.push({ a, b, elevDiff, isBoundary: true });
        }

        // 2. Add Delaunay triangulation edges (excluding boundary duplicates)
        if (points.length >= 3) {
            const pointsArray = points.map(p => [p.x, p.y]);
            const delaunay = d3.Delaunay.from(pointsArray);
            const triangles = delaunay.triangles;
            const seen = new Set();

            for (let i = 0; i < triangles.length; i += 3) {
                const tri = [triangles[i], triangles[i + 1], triangles[i + 2]];
                const pairs = [[tri[0], tri[1]], [tri[1], tri[2]], [tri[2], tri[0]]];
                for (const [a, b] of pairs) {
                    const key = Math.min(a, b) + '_' + Math.max(a, b);
                    if (!seen.has(key) && !boundaryEdgeSet.has(key)) {
                        seen.add(key);
                        const elevDiff = (points[a].elevation != null && points[b].elevation != null)
                            ? Math.abs(points[a].elevation - points[b].elevation) : 0;
                        edges.push({ a, b, elevDiff, isBoundary: false });
                    }
                }
            }
        }

        return edges;
    }

    async fetchElevations(points) {
        // Use Open-Meteo elevation API (free, CORS-enabled)
        const batchSize = 100; // Keep URL length reasonable for GET request
        const batches = [];
        for (let i = 0; i < points.length; i += batchSize) {
            batches.push(points.slice(i, i + batchSize));
        }

        for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
            const batch = batches[batchIndex];
            const batchStartIdx = batchIndex * batchSize;
            const lats = batch.map(p => p.y.toFixed(6)).join(',');
            const lngs = batch.map(p => p.x.toFixed(6)).join(',');
            const url = `https://api.open-meteo.com/v1/elevation?latitude=${lats}&longitude=${lngs}`;

            try {
                const response = await fetch(url);
                if (!response.ok) throw new Error(`Elevation API error: ${response.status}`);

                const data = await response.json();
                const elevations = data.elevation;
                elevations.forEach((elev, index) => {
                    const pointIndex = batchStartIdx + index;
                    if (pointIndex < points.length) {
                        points[pointIndex].elevation = elev;
                    }
                });
                console.log(`Batch ${batchIndex + 1}/${batches.length}: ${elevations.length} elevations`);

                if (batchIndex < batches.length - 1) await this.delay(100);
            } catch (error) {
                console.error('Error fetching elevations:', error);
                throw new Error('Failed to fetch elevation data. Please try a smaller area.');
            }
        }
        return points;
    }

    generateContourLinesFromTriangles(points, interval) {
        console.log(`Starting contour generation with ${points.length} points at ${interval}m interval`);

        // Filter out points without valid elevations
        const validPoints = points.filter(p => p.elevation !== null && p.elevation !== undefined);
        console.log(`  - ${validPoints.length} points have valid elevations`);
        console.log(`  - ${points.length - validPoints.length} points missing elevations`);

        if (validPoints.length < 3) {
            console.error('Not enough points with elevations to generate contours');
            return;
        }

        // Find min and max elevations
        let minElev = Infinity;
        let maxElev = -Infinity;

        for (const point of validPoints) {
            minElev = Math.min(minElev, point.elevation);
            maxElev = Math.max(maxElev, point.elevation);
        }

        console.log(`  - Elevation range: ${minElev.toFixed(1)}m to ${maxElev.toFixed(1)}m`);

        // Generate contour levels
        const levels = [];
        const startLevel = Math.ceil(minElev / interval) * interval;
        for (let level = startLevel; level <= maxElev; level += interval) {
            levels.push(level);
        }

        console.log(`  - Generating ${levels.length} contour levels`);

        // Build Delaunay triangulation using only valid points
        const pointsArray = validPoints.map(p => [p.x, p.y]);
        const elevations = validPoints.map(p => p.elevation);
        const delaunay = d3.Delaunay.from(pointsArray);
        const triangles = delaunay.triangles;

        console.log(`  - Created ${triangles.length / 3} triangles from ${validPoints.length} points`);

        // Extract contour segments for each level
        const contourSegments = {};
        levels.forEach(level => {
            contourSegments[level] = [];
        });

        // Process each triangle
        for (let i = 0; i < triangles.length; i += 3) {
            const i0 = triangles[i];
            const i1 = triangles[i + 1];
            const i2 = triangles[i + 2];

            const p0 = { x: pointsArray[i0][0], y: pointsArray[i0][1], z: elevations[i0] };
            const p1 = { x: pointsArray[i1][0], y: pointsArray[i1][1], z: elevations[i1] };
            const p2 = { x: pointsArray[i2][0], y: pointsArray[i2][1], z: elevations[i2] };

            // For each contour level, check if it intersects this triangle
            for (const level of levels) {
                const segments = this.getTriangleContourSegments(p0, p1, p2, level);
                if (segments.length > 0) {
                    contourSegments[level].push(...segments);
                }
            }
        }

        // Connect segments into polylines and smooth them
        this.originalContours = {};
        for (const level in contourSegments) {
            const segments = contourSegments[level];
            const connected = this.connectContourSegments(segments);
            // Apply Chaikin subdivision for organic-looking curves
            this.originalContours[level] = connected.map(line => this.smoothContourLine(line, 2));
        }

        this.currentContours = JSON.parse(JSON.stringify(this.originalContours));

        // Calculate simplification point ranking
        this.calculateSimplificationRanking();
    }

    calculateSimplificationRanking() {
        // Build a list of all removable points across all contours with their importance
        const allRemovablePoints = [];

        for (const level in this.originalContours) {
            const lines = this.originalContours[level];

            lines.forEach((line, lineIndex) => {
                if (line.length <= 2) return;

                // Calculate effective area for each interior point
                for (let i = 1; i < line.length - 1; i++) {
                    const area = Math.abs(
                        (line[i].x - line[i-1].x) * (line[i+1].y - line[i-1].y) -
                        (line[i+1].x - line[i-1].x) * (line[i].y - line[i-1].y)
                    ) / 2;

                    allRemovablePoints.push({
                        level,
                        lineIndex,
                        pointIndex: i,
                        area,
                        point: line[i]
                    });
                }
            });
        }

        // Sort by area (smallest = least important = removed first)
        allRemovablePoints.sort((a, b) => a.area - b.area);

        this.simplificationPointRanking = allRemovablePoints;

        // Update slider max
        const slider = document.getElementById('pane-simplify-slider');
        if (slider) {
            slider.max = allRemovablePoints.length;
            slider.value = 0;
            document.getElementById('pane-simplify-value').textContent = '0 points';
        }
    }

    getTriangleContourSegments(p0, p1, p2, level) {
        // Find where the contour level intersects the triangle edges
        const intersections = [];

        // Check edge p0-p1
        const edge01 = this.getEdgeIntersection(p0, p1, level);
        if (edge01) intersections.push(edge01);

        // Check edge p1-p2
        const edge12 = this.getEdgeIntersection(p1, p2, level);
        if (edge12) intersections.push(edge12);

        // Check edge p2-p0
        const edge20 = this.getEdgeIntersection(p2, p0, level);
        if (edge20) intersections.push(edge20);

        // If we have exactly 2 intersections, create a segment
        if (intersections.length === 2) {
            return [{
                start: intersections[0],
                end: intersections[1]
            }];
        }

        return [];
    }

    getEdgeIntersection(p0, p1, level) {
        // Check if the level is between the two elevations
        const minZ = Math.min(p0.z, p1.z);
        const maxZ = Math.max(p0.z, p1.z);

        if (level < minZ || level > maxZ || Math.abs(maxZ - minZ) < 1e-10) {
            return null;
        }

        // Linear interpolation to find intersection point
        const t = (level - p0.z) / (p1.z - p0.z);
        return {
            x: p0.x + t * (p1.x - p0.x),
            y: p0.y + t * (p1.y - p0.y)
        };
    }

    connectContourSegments(segments) {
        if (segments.length === 0) return [];

        const lines = [];
        const used = new Set();
        const tolerance = 1e-8;

        // Helper to check if two points are close
        const pointsEqual = (p1, p2) => {
            return Math.abs(p1.x - p2.x) < tolerance && Math.abs(p1.y - p2.y) < tolerance;
        };

        // Try to connect segments into polylines
        for (let i = 0; i < segments.length; i++) {
            if (used.has(i)) continue;

            const currentLine = [segments[i].start, segments[i].end];
            used.add(i);

            let extended = true;
            while (extended) {
                extended = false;

                // Try to extend from the end
                for (let j = 0; j < segments.length; j++) {
                    if (used.has(j)) continue;

                    const lastPoint = currentLine[currentLine.length - 1];

                    if (pointsEqual(lastPoint, segments[j].start)) {
                        currentLine.push(segments[j].end);
                        used.add(j);
                        extended = true;
                        break;
                    } else if (pointsEqual(lastPoint, segments[j].end)) {
                        currentLine.push(segments[j].start);
                        used.add(j);
                        extended = true;
                        break;
                    }
                }

                // Try to extend from the start
                if (!extended) {
                    for (let j = 0; j < segments.length; j++) {
                        if (used.has(j)) continue;

                        const firstPoint = currentLine[0];

                        if (pointsEqual(firstPoint, segments[j].end)) {
                            currentLine.unshift(segments[j].start);
                            used.add(j);
                            extended = true;
                            break;
                        } else if (pointsEqual(firstPoint, segments[j].start)) {
                            currentLine.unshift(segments[j].end);
                            used.add(j);
                            extended = true;
                            break;
                        }
                    }
                }
            }

            lines.push(currentLine);
        }

        return lines;
    }

    /**
     * Smooth a contour polyline using Chaikin's corner-cutting algorithm.
     * Each iteration replaces each interior segment with two points at 1/4 and 3/4,
     * producing progressively smoother curves that stay within the convex hull
     * of the original polyline (so contour lines won't cross).
     */
    smoothContourLine(line, iterations = 2) {
        if (line.length <= 2) return line;

        let current = line;
        for (let iter = 0; iter < iterations; iter++) {
            const smoothed = [current[0]]; // Keep first point

            for (let i = 0; i < current.length - 1; i++) {
                const p0 = current[i];
                const p1 = current[i + 1];

                // Q = 3/4 * P0 + 1/4 * P1
                smoothed.push({
                    x: 0.75 * p0.x + 0.25 * p1.x,
                    y: 0.75 * p0.y + 0.25 * p1.y
                });

                // R = 1/4 * P0 + 3/4 * P1
                smoothed.push({
                    x: 0.25 * p0.x + 0.75 * p1.x,
                    y: 0.25 * p0.y + 0.75 * p1.y
                });
            }

            smoothed.push(current[current.length - 1]); // Keep last point
            current = smoothed;
        }

        return current;
    }

    createGrid(points) {
        // Create a regular grid using Delaunay triangulation for interpolation
        const sw = this.selectedBounds.getSouthWest();
        const ne = this.selectedBounds.getNorthEast();

        // Determine grid resolution
        const gridSize = 50;
        const width = ne.lng - sw.lng;
        const height = ne.lat - sw.lat;

        const cols = gridSize;
        const rows = Math.round(gridSize * (height / width));

        const grid = {
            data: [],
            x: [],
            y: [],
            cols,
            rows
        };

        // Create grid coordinates
        for (let i = 0; i < cols; i++) {
            grid.x.push(sw.lng + (i / (cols - 1)) * width);
        }
        for (let j = 0; j < rows; j++) {
            grid.y.push(sw.lat + (j / (rows - 1)) * height);
        }

        // Create Delaunay triangulation from sample points
        const pointsArray = points.map(p => [p.x, p.y]);
        const elevations = points.map(p => p.elevation);

        const delaunay = d3.Delaunay.from(pointsArray);

        // Interpolate elevation at each grid point using Delaunay triangulation
        for (let i = 0; i < cols; i++) {
            grid.data[i] = [];
            for (let j = 0; j < rows; j++) {
                const x = grid.x[i];
                const y = grid.y[j];

                // Find which triangle contains this point
                const triangleIndex = delaunay.find(x, y);

                // Use barycentric interpolation within the triangle
                grid.data[i][j] = this.interpolateDelaunay(x, y, triangleIndex, delaunay, pointsArray, elevations);
            }
        }

        return grid;
    }

    interpolateDelaunay(x, y, nearestIndex, delaunay, points, elevations) {
        // Find the triangle containing this point using the Delaunay triangulation
        const triangles = delaunay.triangles;

        // Find which triangle contains the nearest point
        // We'll use IDW with nearby points from the triangulation
        const neighbors = [];

        // Get points from triangles that include the nearest point
        for (let i = 0; i < triangles.length; i += 3) {
            if (triangles[i] === nearestIndex || triangles[i+1] === nearestIndex || triangles[i+2] === nearestIndex) {
                neighbors.push(triangles[i], triangles[i+1], triangles[i+2]);
            }
        }

        // Remove duplicates
        const uniqueNeighbors = [...new Set(neighbors)];

        // Use IDW with these neighbors
        if (uniqueNeighbors.length === 0) {
            return elevations[nearestIndex];
        }

        let numerator = 0;
        let denominator = 0;

        for (const idx of uniqueNeighbors) {
            const px = points[idx][0];
            const py = points[idx][1];
            const dx = x - px;
            const dy = y - py;
            const distance = Math.sqrt(dx * dx + dy * dy);

            if (distance < 1e-10) {
                return elevations[idx];
            }

            const weight = 1 / (distance * distance);
            numerator += weight * elevations[idx];
            denominator += weight;
        }

        return numerator / denominator;
    }

    interpolateElevation(x, y, points) {
        // Inverse Distance Weighting (IDW)
        const power = 2;
        let numerator = 0;
        let denominator = 0;

        for (const point of points) {
            const dx = x - point.x;
            const dy = y - point.y;
            const distance = Math.sqrt(dx * dx + dy * dy);

            if (distance < 1e-10) {
                return point.elevation;
            }

            const weight = 1 / Math.pow(distance, power);
            numerator += weight * point.elevation;
            denominator += weight;
        }

        return numerator / denominator;
    }

    generateContourLines(grid, interval) {
        // Find min and max elevations
        let minElev = Infinity;
        let maxElev = -Infinity;

        for (let i = 0; i < grid.cols; i++) {
            for (let j = 0; j < grid.rows; j++) {
                minElev = Math.min(minElev, grid.data[i][j]);
                maxElev = Math.max(maxElev, grid.data[i][j]);
            }
        }

        // Generate contour levels
        const levels = [];
        const startLevel = Math.ceil(minElev / interval) * interval;
        for (let level = startLevel; level <= maxElev; level += interval) {
            levels.push(level);
        }

        // Run CONREC
        const conrec = new Conrec();
        const contours = conrec.contour(grid.data, grid.x, grid.y, levels);

        // Convert segments to polylines
        this.originalContours = {};
        for (const level in contours) {
            const segments = contours[level];
            const lines = conrec.connectSegments(segments);
            this.originalContours[level] = lines;
        }

        this.currentContours = JSON.parse(JSON.stringify(this.originalContours));
    }

    displayContours() {
        this.contourLayer.clearLayers();

        if (!this.currentContours) return;

        const levels = Object.keys(this.currentContours).map(Number).sort((a, b) => a - b);
        const minLevel = Math.min(...levels);
        const maxLevel = Math.max(...levels);
        const range = maxLevel - minLevel;

        for (const level in this.currentContours) {
            const lines = this.currentContours[level];
            const normalized = range > 0 ? (parseFloat(level) - minLevel) / range : 0;
            const color = this.getColorForElevation(normalized);

            lines.forEach(line => {
                if (line.length < 2) return;

                const latLngs = line.map(p => [p.y, p.x]);
                L.polyline(latLngs, {
                    color: color,
                    weight: 2,
                    opacity: 0.7
                }).addTo(this.contourLayer);
            });
        }
    }

    getColorForElevation(normalized) {
        // Color gradient from blue (low) to red (high)
        const hue = (1 - normalized) * 240; // 240 = blue, 0 = red
        return `hsl(${hue}, 70%, 50%)`;
    }

    applySimplification(threshold) {
        if (!this.originalContours) return;

        this.currentContours = {};

        for (const level in this.originalContours) {
            const lines = this.originalContours[level];
            this.currentContours[level] = Visvalingam.simplifyLines(lines, threshold);
        }

        this.displayContours();
        this.updateSVGPreview();
    }

    applySimplificationByCount(removeCount) {
        if (!this.originalContours || !this.simplificationPointRanking) return;

        // Start with a copy of the original contours
        this.currentContours = JSON.parse(JSON.stringify(this.originalContours));

        if (removeCount === 0) {
            console.log('Simplification: No points to remove (slider at 0)');
            this.displayContours();
            this.updateSVGPreview();
            return;
        }

        // Process points in order of importance (smallest area first)
        // Skip points whose removal would create line crossings
        const pointsToRemove = this.simplificationPointRanking.slice(0, removeCount);
        console.log(`Simplification: Attempting to remove ${removeCount} points...`);

        // Build a map of points to remove for quick lookup
        // Track which points should actually be removed after crossing checks
        const removalMap = {};

        for (const removal of pointsToRemove) {
            const key = `${removal.level}_${removal.lineIndex}`;
            const line = this.currentContours[removal.level][removal.lineIndex];

            // Build a "keep" array for this line
            if (!removalMap[key]) {
                removalMap[key] = {
                    line: line,
                    keep: new Array(line.length).fill(true)
                };
            }

            const lineData = removalMap[key];

            // Check if removing this point would create an intersection
            if (!this.wouldCreateIntersection(lineData.line, lineData.keep, removal.pointIndex)) {
                lineData.keep[removal.pointIndex] = false;
            }
            // If it would create an intersection, skip this point (keep it)
        }

        // Apply the removals
        for (const level in this.currentContours) {
            const lines = this.currentContours[level];
            const newLines = [];

            lines.forEach((line, lineIndex) => {
                const key = `${level}_${lineIndex}`;
                const lineData = removalMap[key];

                if (!lineData) {
                    // No removals for this line
                    newLines.push(line);
                } else {
                    // Filter out the removed points
                    const newLine = line.filter((point, idx) => lineData.keep[idx]);
                    if (newLine.length >= 2) {
                        newLines.push(newLine);
                    }
                }
            });

            this.currentContours[level] = newLines;
        }

        // Count total points before and after
        let originalPoints = 0;
        let currentPoints = 0;
        for (const level in this.originalContours) {
            this.originalContours[level].forEach(line => originalPoints += line.length);
        }
        for (const level in this.currentContours) {
            this.currentContours[level].forEach(line => currentPoints += line.length);
        }

        console.log(`Simplification complete: ${originalPoints} -> ${currentPoints} points (removed ${originalPoints - currentPoints})`);

        // Update displays
        this.displayContours();
        this.updateSVGPreview();
    }

    // Check if removing a point would create an intersection (from Visvalingam algorithm)
    wouldCreateIntersection(points, keep, removeIndex) {
        // Find previous and next kept points
        let prevIndex = removeIndex - 1;
        while (prevIndex >= 0 && !keep[prevIndex]) {
            prevIndex--;
        }

        let nextIndex = removeIndex + 1;
        while (nextIndex < points.length && !keep[nextIndex]) {
            nextIndex++;
        }

        if (prevIndex < 0 || nextIndex >= points.length) {
            return false;
        }

        const newSegment = {
            p1: points[prevIndex],
            p2: points[nextIndex]
        };

        // Check against all other segments
        for (let i = 0; i < points.length - 1; i++) {
            if (!keep[i]) continue;

            let j = i + 1;
            while (j < points.length && !keep[j]) {
                j++;
            }

            if (j >= points.length) break;

            // Skip any segment that shares an endpoint with the new shortcut segment
            // (prevIndex and nextIndex are the new segment's endpoints)
            if (i === prevIndex || j === prevIndex || i === nextIndex || j === nextIndex ||
                i === removeIndex || j === removeIndex) {
                continue;
            }

            const existingSegment = {
                p1: points[i],
                p2: points[j]
            };

            if (this.segmentsIntersect(newSegment, existingSegment)) {
                return true;
            }
        }

        return false;
    }

    // Check if two line segments intersect
    segmentsIntersect(seg1, seg2) {
        const p1 = seg1.p1;
        const p2 = seg1.p2;
        const p3 = seg2.p1;
        const p4 = seg2.p2;

        const d1 = this.direction(p3, p4, p1);
        const d2 = this.direction(p3, p4, p2);
        const d3 = this.direction(p1, p2, p3);
        const d4 = this.direction(p1, p2, p4);

        if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) &&
            ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) {
            return true;
        }

        // Check for collinear cases
        if (d1 === 0 && this.onSegment(p3, p1, p4)) return true;
        if (d2 === 0 && this.onSegment(p3, p2, p4)) return true;
        if (d3 === 0 && this.onSegment(p1, p3, p2)) return true;
        if (d4 === 0 && this.onSegment(p1, p4, p2)) return true;

        return false;
    }

    // Calculate direction of point p3 relative to line p1-p2
    direction(p1, p2, p3) {
        return (p3.x - p1.x) * (p2.y - p1.y) - (p2.x - p1.x) * (p3.y - p1.y);
    }

    // Check if point p2 is on segment p1-p3
    onSegment(p1, p2, p3) {
        return p2.x >= Math.min(p1.x, p3.x) && p2.x <= Math.max(p1.x, p3.x) &&
               p2.y >= Math.min(p1.y, p3.y) && p2.y <= Math.max(p1.y, p3.y);
    }

    clearContours() {
        this.contourLayer.clearLayers();
        this.originalContours = null;
        this.currentContours = null;
        this.samples = [];
        // Element no longer exists in pane workflow
        const simplifyControls = document.getElementById('simplify-controls');
        if (simplifyControls) {
            simplifyControls.classList.remove('show');
        }
    }

    exportSVG() {
        if (!this.currentContours) {
            this.showStatus('No contours to export', 'error');
            return;
        }

        const sw = this.selectedBounds.getSouthWest();
        const ne = this.selectedBounds.getNorthEast();

        // Calculate SVG dimensions (preserve aspect ratio)
        const width = 1000;
        const aspectRatio = (ne.lat - sw.lat) / (ne.lng - sw.lng);
        const height = width * aspectRatio;

        // Create SVG
        let svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
    <rect width="100%" height="100%" fill="white"/>
`;

        // Add map snapshot as background layer if enabled
        if (this.showMapSnapshot && this.mapSnapshotDataURL) {
            svg += `    <image href="${this.mapSnapshotDataURL}" x="0" y="0" width="${width}" height="${height}" opacity="0.5" preserveAspectRatio="none"/>\n`;
        }

        svg += `    <g id="contours">
`;

        const levels = Object.keys(this.currentContours).map(Number).sort((a, b) => a - b);
        const minLevel = Math.min(...levels);
        const maxLevel = Math.max(...levels);
        const range = maxLevel - minLevel;

        for (const level in this.currentContours) {
            const lines = this.currentContours[level];
            const normalized = range > 0 ? (parseFloat(level) - minLevel) / range : 0;
            const color = this.getColorForElevation(normalized);

            lines.forEach(line => {
                if (line.length < 2) return;

                let pathData = '';
                line.forEach((point, index) => {
                    const x = ((point.x - sw.lng) / (ne.lng - sw.lng)) * width;
                    const y = height - ((point.y - sw.lat) / (ne.lat - sw.lat)) * height;
                    pathData += (index === 0 ? 'M' : 'L') + x.toFixed(2) + ',' + y.toFixed(2) + ' ';
                });

                svg += `        <path d="${pathData}" stroke="${color}" fill="none" stroke-width="1.5" opacity="0.7" data-elevation="${level}"/>\n`;
            });
        }

        svg += `    </g>
</svg>`;

        // Download SVG
        const blob = new Blob([svg], { type: 'image/svg+xml' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'contour-map.svg';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        this.showStatus('SVG exported successfully!', 'success');
    }

    sizeCanvasToPane(canvas) {
        if (!this.selectedBounds) return null;
        const sw = this.selectedBounds.getSouthWest();
        const ne = this.selectedBounds.getNorthEast();
        const pane = canvas.closest('.pane-content-inner');
        const paneRect = pane ? pane.getBoundingClientRect() : null;
        const rect = canvas.getBoundingClientRect();
        const containerWidth = rect.width || 360;
        const availableHeight = paneRect ? Math.max(100, paneRect.height - 120) : 400;
        const aspectRatio = (ne.lat - sw.lat) / (ne.lng - sw.lng);

        let canvasWidth, canvasHeight;
        if (containerWidth / availableHeight > 1 / aspectRatio) {
            canvasHeight = availableHeight;
            canvasWidth = canvasHeight / aspectRatio;
        } else {
            canvasWidth = containerWidth - 20;
            canvasHeight = canvasWidth * aspectRatio;
            if (canvasHeight > availableHeight) {
                canvasHeight = availableHeight;
                canvasWidth = canvasHeight / aspectRatio;
            }
        }
        canvas.width = canvasWidth;
        canvas.height = canvasHeight;
        return { canvasWidth, canvasHeight };
    }

    updatePreview() {
        if (!this.selectedBounds) return;

        const size = this.sizeCanvasToPane(this.previewCanvas);
        if (!size) return;
        const { canvasWidth, canvasHeight } = size;

        const sw = this.selectedBounds.getSouthWest();
        const ne = this.selectedBounds.getNorthEast();
        const ctx = this.previewCtx;

        ctx.fillStyle = '#f9f9f9';
        ctx.fillRect(0, 0, canvasWidth, canvasHeight);
        ctx.strokeStyle = '#3498db';
        ctx.lineWidth = 2;
        ctx.strokeRect(0, 0, canvasWidth, canvasHeight);

        if (!this.samples || this.samples.length < 2) return;

        const geoWidth = ne.lng - sw.lng;
        const geoHeight = ne.lat - sw.lat;
        const bounds = { minX: sw.lng, maxX: ne.lng, minY: sw.lat, maxY: ne.lat };
        const toX = (lng) => ((lng - sw.lng) / geoWidth) * canvasWidth;
        const toY = (lat) => canvasHeight - ((lat - sw.lat) / geoHeight) * canvasHeight;

        // Draw edges (boundary + Delaunay)
        const edges = this.buildEdges(this.samples, bounds);
        for (const edge of edges) {
            const pa = this.samples[edge.a];
            const pb = this.samples[edge.b];
            ctx.strokeStyle = edge.isBoundary ? 'rgba(52,152,219,0.5)' : 'rgba(200,200,200,0.3)';
            ctx.lineWidth = edge.isBoundary ? 1.5 : 0.5;
            ctx.beginPath();
            ctx.moveTo(toX(pa.x), toY(pa.y));
            ctx.lineTo(toX(pb.x), toY(pb.y));
            ctx.stroke();
        }

        // Draw points
        for (const p of this.samples) {
            const isBnd = this.isOnBoundary(p, bounds);
            ctx.fillStyle = isBnd ? '#e74c3c' : '#3498db';
            ctx.beginPath();
            ctx.arc(toX(p.x), toY(p.y), isBnd ? 3 : 2, 0, Math.PI * 2);
            ctx.fill();
        }

        // Legend
        ctx.font = '12px -apple-system, sans-serif';
        ctx.fillStyle = 'rgba(255,255,255,0.9)';
        ctx.fillRect(8, 8, 150, 54);
        ctx.fillStyle = '#e74c3c';  ctx.fillRect(10, 10, 12, 12);
        ctx.fillStyle = '#2c3e50';  ctx.fillText('Boundary', 28, 20);
        ctx.fillStyle = '#3498db';  ctx.fillRect(10, 30, 12, 12);
        ctx.fillStyle = '#2c3e50';  ctx.fillText('Interior', 28, 40);
        ctx.fillStyle = '#888';     ctx.fillText(`${this.samples.length} points`, 10, 56);
    }

    async lockPointsAndFetchElevations() {
        if (!this.selectedBounds) return;

        const btn = document.getElementById('lock-points-btn');
        btn.disabled = true;

        try {
            const targetCount = parseInt(document.getElementById('pane-total-samples').value);
            const sw = this.selectedBounds.getSouthWest();
            const ne = this.selectedBounds.getNorthEast();
            const bounds = { minX: sw.lng, maxX: ne.lng, minY: sw.lat, maxY: ne.lat };

            // Start with 4 corners + center = 5 initial points
            this.samples = [
                { x: bounds.minX, y: bounds.minY, elevation: null },
                { x: bounds.maxX, y: bounds.minY, elevation: null },
                { x: bounds.maxX, y: bounds.maxY, elevation: null },
                { x: bounds.minX, y: bounds.maxY, elevation: null },
                { x: (bounds.minX + bounds.maxX) / 2, y: (bounds.minY + bounds.maxY) / 2, elevation: null },
            ];
            this.refinementPoints = [];

            btn.textContent = `Sampling... 5/${targetCount}`;
            await this.fetchElevations(this.samples);
            this.updatePreview();

            // Iteratively split the edge with the most elevation change
            while (this.samples.length < targetCount) {
                const edges = this.buildEdges(this.samples, bounds);
                if (edges.length === 0) break;

                // Sort by elevation difference (largest first)
                edges.sort((a, b) => b.elevDiff - a.elevDiff);

                // Batch: take top edges, capped to remaining budget and API batch size
                const remaining = targetCount - this.samples.length;
                const batchSize = Math.min(remaining, Math.max(5, Math.ceil(remaining * 0.25)), 200);
                const toSplit = edges.slice(0, batchSize);

                const newPoints = [];
                for (const edge of toSplit) {
                    const pa = this.samples[edge.a];
                    const pb = this.samples[edge.b];
                    const mid = {
                        x: (pa.x + pb.x) / 2,
                        y: (pa.y + pb.y) / 2,
                        elevation: null
                    };
                    if (edge.isBoundary) this.snapToBoundary(mid, bounds);
                    newPoints.push(mid);
                }

                await this.fetchElevations(newPoints);
                this.samples.push(...newPoints);

                btn.textContent = `Sampling... ${this.samples.length}/${targetCount}`;
                this.updatePreview();
                await this.delay(30); // allow UI repaint
            }

            console.log(`Iterative sampling complete: ${this.samples.length} points`);

            // Complete pane 2 and open pane 3
            this.completePane(2);
            this.activatePane(3);
            this.openPane(3);
            this.drawHeatmap();

        } catch (error) {
            console.error('Error during sampling:', error);
            alert('Error: ' + error.message);
        } finally {
            btn.disabled = false;
            btn.textContent = 'Sample Terrain';
        }
    }

    drawHeatmap() {
        if (!this.samples || this.samples.length === 0) return;

        const size = this.sizeCanvasToPane(this.heatmapCanvas);
        if (!size) return;
        const { canvasWidth, canvasHeight } = size;

        const sw = this.selectedBounds.getSouthWest();
        const ne = this.selectedBounds.getNorthEast();
        const ctx = this.heatmapCtx;

        ctx.fillStyle = '#f9f9f9';
        ctx.fillRect(0, 0, canvasWidth, canvasHeight);
        ctx.strokeStyle = '#3498db';
        ctx.lineWidth = 2;
        ctx.strokeRect(0, 0, canvasWidth, canvasHeight);

        let minElev = Infinity, maxElev = -Infinity;
        this.samples.forEach(p => {
            if (p.elevation != null) {
                minElev = Math.min(minElev, p.elevation);
                maxElev = Math.max(maxElev, p.elevation);
            }
        });
        const elevRange = maxElev - minElev;
        const geoW = ne.lng - sw.lng;
        const geoH = ne.lat - sw.lat;
        const toX = (lng) => ((lng - sw.lng) / geoW) * canvasWidth;
        const toY = (lat) => canvasHeight - ((lat - sw.lat) / geoH) * canvasHeight;

        this.samples.forEach(p => {
            if (p.elevation == null) return;
            const x = toX(p.x), y = toY(p.y);
            if (!isFinite(x) || !isFinite(y)) return;
            const normalized = elevRange > 0 ? (p.elevation - minElev) / elevRange : 0;
            const hue = (1 - normalized) * 240;
            ctx.fillStyle = `hsl(${hue}, 70%, 50%)`;
            ctx.beginPath();
            ctx.arc(x, y, 4, 0, Math.PI * 2);
            ctx.fill();
        });

        const statsDiv = document.getElementById('elevation-stats');
        statsDiv.innerHTML = `
            <strong>Elevation Range:</strong> ${minElev.toFixed(1)}m - ${maxElev.toFixed(1)}m<br>
            <strong>Total Points:</strong> ${this.samples.length}
        `;
    }

    async generateContoursFromElevations() {
        const btn = document.getElementById('generate-contours-btn');
        btn.disabled = true;
        btn.textContent = 'Generating contours...';

        try {
            // Generate contours directly from triangulation
            const interval = parseFloat(document.getElementById('pane-contour-interval').value);
            this.generateContourLinesFromTriangles(this.samples, interval);

            // Display on map
            this.displayContours();

            // Complete pane 3 and open pane 4
            this.completePane(3);
            this.activatePane(4);
            this.openPane(4);

            // Show SVG preview
            this.updateSVGPreview();

        } catch (error) {
            console.error('Error generating contours:', error);
            alert('Error: ' + error.message);
        } finally {
            btn.disabled = false;
            btn.textContent = 'Generate Contours';
        }
    }

    updateSVGPreview() {
        if (!this.currentContours) return;

        const sw = this.selectedBounds.getSouthWest();
        const ne = this.selectedBounds.getNorthEast();

        // Calculate SVG dimensions to fill container while preserving aspect ratio
        const preview = document.getElementById('svg-preview');
        const rect = preview.getBoundingClientRect();
        const containerWidth = rect.width || 340;
        const containerHeight = rect.height || 400;

        const aspectRatio = (ne.lat - sw.lat) / (ne.lng - sw.lng);

        // Fit to container while maintaining aspect ratio
        let width, height;
        if (containerWidth / containerHeight > 1 / aspectRatio) {
            // Container is wider than needed
            height = containerHeight - 20;
            width = height / aspectRatio;
        } else {
            // Container is taller than needed
            width = containerWidth - 20;
            height = width * aspectRatio;
        }

        // Create SVG that scales to fit container
        let svg = `<svg width="100%" height="100%" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid meet" style="max-width: 100%; max-height: 100%;">
    <rect width="100%" height="100%" fill="white"/>
`;

        // Add map snapshot as background layer if enabled
        if (this.showMapSnapshot && this.mapSnapshotDataURL) {
            svg += `    <image href="${this.mapSnapshotDataURL}" x="0" y="0" width="${width}" height="${height}" opacity="0.5" preserveAspectRatio="none"/>\n`;
        }

        svg += ``;

        // Add triangulation overlay if enabled (shown in preview only, not exported)
        if (this.showTriangulation && this.samples && this.samples.length > 0) {
            console.log(`Drawing triangulation overlay with ${this.samples.length} sample points`);

            svg += `    <g id="triangulation-overlay">
`;
            // Build Delaunay triangulation from sample points
            const pointsArray = this.samples.map(p => [p.x, p.y]);
            const delaunay = d3.Delaunay.from(pointsArray);
            const triangles = delaunay.triangles;

            // Draw triangulation edges
            const drawnEdges = new Set();
            for (let i = 0; i < triangles.length; i += 3) {
                const i0 = triangles[i];
                const i1 = triangles[i + 1];
                const i2 = triangles[i + 2];

                // Draw each edge only once
                const edges = [
                    [i0, i1],
                    [i1, i2],
                    [i2, i0]
                ];

                edges.forEach(([a, b]) => {
                    const key = a < b ? `${a}_${b}` : `${b}_${a}`;
                    if (!drawnEdges.has(key)) {
                        drawnEdges.add(key);

                        const x1 = ((pointsArray[a][0] - sw.lng) / (ne.lng - sw.lng)) * width;
                        const y1 = height - ((pointsArray[a][1] - sw.lat) / (ne.lat - sw.lat)) * height;
                        const x2 = ((pointsArray[b][0] - sw.lng) / (ne.lng - sw.lng)) * width;
                        const y2 = height - ((pointsArray[b][1] - sw.lat) / (ne.lat - sw.lat)) * height;

                        svg += `        <line x1="${x1.toFixed(2)}" y1="${y1.toFixed(2)}" x2="${x2.toFixed(2)}" y2="${y2.toFixed(2)}" stroke="#ccc" stroke-width="0.5" opacity="0.4"/>\n`;
                    }
                });
            }

            // Draw sample point nodes
            this.samples.forEach(p => {
                const x = ((p.x - sw.lng) / (ne.lng - sw.lng)) * width;
                const y = height - ((p.y - sw.lat) / (ne.lat - sw.lat)) * height;
                svg += `        <circle cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="1.5" fill="#999" opacity="0.5"/>\n`;
            });

            svg += `    </g>
`;
        }

        // Add simplification preview (show next 10 triangles to be removed in red)
        if (this.simplificationPointRanking && this.simplificationPointRanking.length > 0) {
            const slider = document.getElementById('pane-simplify-slider');
            const removeCount = slider ? parseInt(slider.value) : 0;

            if (removeCount < this.simplificationPointRanking.length) {
                svg += `    <g id="simplification-preview">
`;
                // Show the NEXT 10 triangles that would be removed
                const nextBatch = Math.min(10, this.simplificationPointRanking.length - removeCount);
                const nextPoints = this.simplificationPointRanking.slice(removeCount, removeCount + nextBatch);

                // Draw triangles for these points
                nextPoints.forEach(removal => {
                    const line = this.originalContours[removal.level][removal.lineIndex];
                    if (!line || removal.pointIndex >= line.length) return;

                    const prevIdx = removal.pointIndex - 1;
                    const nextIdx = removal.pointIndex + 1;

                    if (prevIdx >= 0 && nextIdx < line.length) {
                        const p1 = line[prevIdx];
                        const p2 = line[removal.pointIndex];
                        const p3 = line[nextIdx];

                        const x1 = ((p1.x - sw.lng) / (ne.lng - sw.lng)) * width;
                        const y1 = height - ((p1.y - sw.lat) / (ne.lat - sw.lat)) * height;
                        const x2 = ((p2.x - sw.lng) / (ne.lng - sw.lng)) * width;
                        const y2 = height - ((p2.y - sw.lat) / (ne.lat - sw.lat)) * height;
                        const x3 = ((p3.x - sw.lng) / (ne.lng - sw.lng)) * width;
                        const y3 = height - ((p3.y - sw.lat) / (ne.lat - sw.lat)) * height;

                        svg += `        <polygon points="${x1.toFixed(2)},${y1.toFixed(2)} ${x2.toFixed(2)},${y2.toFixed(2)} ${x3.toFixed(2)},${y3.toFixed(2)}" fill="red" opacity="0.5" stroke="none"/>\n`;
                    }
                });

                svg += `    </g>
`;
            }
        }

        // Add contour lines
        svg += `    <g id="contours">
`;

        const levels = Object.keys(this.currentContours).map(Number).sort((a, b) => a - b);
        const minLevel = Math.min(...levels);
        const maxLevel = Math.max(...levels);
        const range = maxLevel - minLevel;

        for (const level in this.currentContours) {
            const lines = this.currentContours[level];
            const normalized = range > 0 ? (parseFloat(level) - minLevel) / range : 0;
            const color = this.getColorForElevation(normalized);

            lines.forEach(line => {
                if (line.length < 2) return;

                let pathData = '';
                line.forEach((point, index) => {
                    const x = ((point.x - sw.lng) / (ne.lng - sw.lng)) * width;
                    const y = height - ((point.y - sw.lat) / (ne.lat - sw.lat)) * height;
                    pathData += (index === 0 ? 'M' : 'L') + x.toFixed(2) + ',' + y.toFixed(2) + ' ';
                });

                svg += `        <path d="${pathData}" stroke="${color}" fill="none" stroke-width="1.5" opacity="0.7"/>\n`;
            });
        }

        svg += `    </g>
</svg>`;

        // Display preview
        preview.innerHTML = svg;
    }

    showStatus(message, type = 'info') {
        const status = document.getElementById('status');
        if (status) {
            status.textContent = message;
            status.className = 'show ' + type;
        }
    }

    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

// Initialize app when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    new ContourMapApp();
});
