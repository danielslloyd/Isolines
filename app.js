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
        this.shortEdges = [];
        this.medianEdgeLength = 0;
        this.numBoundaryPoints = 0;

        this.init();
    }

    init() {
        this.initMap();
        this.initControls();
        this.initPanes();
        this.setupRightClickSelection();
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

        // Setup pane 2 controls
        const totalSamplesInput = document.getElementById('pane-total-samples');
        totalSamplesInput.addEventListener('input', () => this.updatePreview());

        // Lock points button
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

        // Prevent context menu on right-click
        mapContainer.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            return false;
        });

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
                    this.updatePreview();
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

    // Legacy method - no longer used with pane workflow
    async generateContours() {
        // This method is kept for compatibility but is no longer used
        // The workflow now uses lockPointsAndFetchElevations and generateContoursFromElevations
    }

    generateSamplePoints(totalSamples) {
        const sw = this.selectedBounds.getSouthWest();
        const ne = this.selectedBounds.getNorthEast();

        const bounds = {
            minX: sw.lng,
            maxX: ne.lng,
            minY: sw.lat,
            maxY: ne.lat
        };

        const width = bounds.maxX - bounds.minX;
        const height = bounds.maxY - bounds.minY;

        // 25% edge, 75% interior
        const edgeSamples = Math.round(totalSamples * 0.25);
        const interiorSamples = totalSamples - edgeSamples;

        // Calculate edge distribution
        const aspectRatio = width / height;
        const xSamples = Math.round(Math.sqrt(edgeSamples * aspectRatio));
        const ySamples = Math.round(edgeSamples / xSamples);

        const points = [];

        // Generate edge samples
        // Top edge
        for (let i = 0; i < xSamples; i++) {
            const x = bounds.minX + (i / (xSamples - 1)) * width;
            points.push({ x, y: bounds.maxY, elevation: null });
        }

        // Bottom edge
        for (let i = 0; i < xSamples; i++) {
            const x = bounds.minX + (i / (xSamples - 1)) * width;
            points.push({ x, y: bounds.minY, elevation: null });
        }

        // Left edge (excluding corners)
        for (let i = 1; i < ySamples - 1; i++) {
            const y = bounds.minY + (i / (ySamples - 1)) * height;
            points.push({ x: bounds.minX, y, elevation: null });
        }

        // Right edge (excluding corners)
        for (let i = 1; i < ySamples - 1; i++) {
            const y = bounds.minY + (i / (ySamples - 1)) * height;
            points.push({ x: bounds.maxX, y, elevation: null });
        }

        // Generate interior samples using Mitchell's best-candidate algorithm
        const mitchell = new MitchellSampling(bounds, 20); // 20 candidates per point
        const interiorPoints = mitchell.generate(interiorSamples);

        interiorPoints.forEach(p => {
            points.push({ x: p.x, y: p.y, elevation: null });
        });

        // Apply relaxation to push points apart (keeping edge points fixed)
        const numBoundaryPoints = points.length - interiorPoints.length;
        const edgePoints = points.slice(0, numBoundaryPoints);
        PointRelaxation.relax(points, edgePoints, bounds, 10);

        // Store boundary point count for later use
        this.numBoundaryPoints = numBoundaryPoints;

        // Calculate short edges for visualization (don't delete points)
        this.calculateShortEdges(points);

        return points;
    }

    calculateShortEdges(points) {
        // Build Delaunay triangulation to get edge lengths
        const pointsArray = points.map(p => [p.x, p.y]);
        const delaunay = d3.Delaunay.from(pointsArray);

        // Calculate all edge lengths from triangulation
        const edgeLengths = [];
        const triangles = delaunay.triangles;
        const edges = [];

        for (let i = 0; i < triangles.length; i += 3) {
            const i0 = triangles[i];
            const i1 = triangles[i + 1];
            const i2 = triangles[i + 2];

            // Add each edge
            const edgePairs = [
                [i0, i1],
                [i1, i2],
                [i2, i0]
            ];

            edgePairs.forEach(([a, b]) => {
                const key = a < b ? `${a}_${b}` : `${b}_${a}`;
                const dx = pointsArray[a][0] - pointsArray[b][0];
                const dy = pointsArray[a][1] - pointsArray[b][1];
                const length = Math.sqrt(dx * dx + dy * dy);

                edges.push({
                    key,
                    a,
                    b,
                    length,
                    p1: points[a],
                    p2: points[b]
                });
                edgeLengths.push(length);
            });
        }

        // Calculate median edge length
        edgeLengths.sort((a, b) => a - b);
        const median = edgeLengths[Math.floor(edgeLengths.length / 2)];
        const threshold = 0.25 * median;

        // Find all unique short edges
        const shortEdges = [];
        const seenKeys = new Set();

        edges.forEach(edge => {
            if (edge.length < threshold && !seenKeys.has(edge.key)) {
                seenKeys.add(edge.key);
                shortEdges.push(edge);
            }
        });

        // Store for visualization
        this.shortEdges = shortEdges;
        this.medianEdgeLength = median;

        console.log(`Found ${shortEdges.length} short edges (< ${threshold.toFixed(8)}, median: ${median.toFixed(8)})`);
    }

    async fetchElevations(points, numBoundaryPoints = 0) {
        // Use Open-Elevation API (free, no API key required)
        const batchSize = 200; // Limit batch size
        const batches = [];

        for (let i = 0; i < points.length; i += batchSize) {
            batches.push(points.slice(i, i + batchSize));
        }

        let totalReceived = 0;
        let totalBoundaryReceived = 0;
        let totalInteriorReceived = 0;

        for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
            const batch = batches[batchIndex];
            const batchStartIdx = batchIndex * batchSize;

            const locations = batch.map(p => ({
                latitude: p.y,
                longitude: p.x
            }));

            try {
                const response = await fetch('https://api.open-elevation.com/api/v1/lookup', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({ locations })
                });

                if (!response.ok) {
                    throw new Error(`Elevation API error: ${response.status}`);
                }

                const data = await response.json();

                // Track per-batch counts
                let batchBoundary = 0;
                let batchInterior = 0;

                data.results.forEach((result, index) => {
                    const pointIndex = batchStartIdx + index;
                    if (pointIndex < points.length) {
                        points[pointIndex].elevation = result.elevation;
                        totalReceived++;

                        const isBoundary = pointIndex < numBoundaryPoints;
                        if (isBoundary) {
                            totalBoundaryReceived++;
                            batchBoundary++;
                        } else {
                            totalInteriorReceived++;
                            batchInterior++;
                        }
                    }
                });

                console.log(`Batch ${batchIndex + 1}/${batches.length}: Received ${data.results.length} elevations (${batchBoundary} boundary, ${batchInterior} interior) | Total: ${totalBoundaryReceived} boundary, ${totalInteriorReceived} interior`);

                // Small delay between batches to avoid rate limiting
                if (batchIndex < batches.length - 1) {
                    await this.delay(100);
                }

            } catch (error) {
                console.error('Error fetching elevations:', error);
                throw new Error('Failed to fetch elevation data. Please try a smaller area.');
            }
        }

        return points;
    }

    async adaptiveRefinement(points) {
        // Calculate elevation differences between neighboring points
        const differences = [];

        for (let i = 0; i < points.length; i++) {
            for (let j = i + 1; j < points.length; j++) {
                const dx = points[i].x - points[j].x;
                const dy = points[i].y - points[j].y;
                const distance = Math.sqrt(dx * dx + dy * dy);

                // Consider points as neighbors if they're close
                const sw = this.selectedBounds.getSouthWest();
                const ne = this.selectedBounds.getNorthEast();
                const maxDist = Math.max(ne.lng - sw.lng, ne.lat - sw.lat) * 0.15;

                if (distance < maxDist) {
                    const elevDiff = Math.abs(points[i].elevation - points[j].elevation);
                    differences.push({
                        i, j, distance, elevDiff,
                        midpoint: {
                            x: (points[i].x + points[j].x) / 2,
                            y: (points[i].y + points[j].y) / 2
                        }
                    });
                }
            }
        }

        // Calculate 95th percentile
        differences.sort((a, b) => a.elevDiff - b.elevDiff);
        const percentile95Index = Math.floor(differences.length * 0.95);
        const threshold = differences[percentile95Index]?.elevDiff || 0;

        // Add midpoints for pairs with high elevation difference
        const newPoints = [];
        const addedPoints = new Set();

        for (const diff of differences) {
            if (diff.elevDiff >= threshold) {
                const key = `${diff.midpoint.x.toFixed(8)},${diff.midpoint.y.toFixed(8)}`;
                if (!addedPoints.has(key)) {
                    newPoints.push({
                        x: diff.midpoint.x,
                        y: diff.midpoint.y,
                        elevation: null
                    });
                    addedPoints.add(key);
                }
            }
        }

        if (newPoints.length > 0) {
            this.showStatus(`Adding ${newPoints.length} refinement points...`, 'info');
            await this.delay(100);

            await this.fetchElevations(newPoints);
            this.samples.push(...newPoints);
            this.refinementPoints = newPoints; // Track for highlighting
        }
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

        // Connect segments into polylines
        this.originalContours = {};
        for (const level in contourSegments) {
            const segments = contourSegments[level];
            this.originalContours[level] = this.connectContourSegments(segments);
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

            // Skip if this segment is adjacent to the new segment
            if (i === prevIndex || j === nextIndex || i === removeIndex || j === removeIndex) {
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

    updatePreview() {
        if (!this.selectedBounds) return;

        const sw = this.selectedBounds.getSouthWest();
        const ne = this.selectedBounds.getNorthEast();

        // Set canvas size to fit within visible pane area
        const pane = this.previewCanvas.closest('.pane-content-inner');
        const paneRect = pane ? pane.getBoundingClientRect() : null;
        const rect = this.previewCanvas.getBoundingClientRect();

        const containerWidth = rect.width || 360;
        // Calculate available height: pane height minus other elements (controls, margins, etc.)
        const availableHeight = paneRect ? Math.max(200, paneRect.height - 150) : 400;
        const aspectRatio = (ne.lat - sw.lat) / (ne.lng - sw.lng);

        // Fit canvas to available space while preserving aspect ratio
        let canvasWidth, canvasHeight;
        const containerAspectRatio = containerWidth / availableHeight;
        const mapAspectRatio = 1 / aspectRatio; // inverse because lat/lng

        if (containerAspectRatio > mapAspectRatio) {
            // Container is wider - fit to height
            canvasHeight = availableHeight;
            canvasWidth = canvasHeight / aspectRatio;
        } else {
            // Container is taller - fit to width
            canvasWidth = containerWidth - 20;
            canvasHeight = canvasWidth * aspectRatio;
            // Ensure it doesn't exceed available height
            if (canvasHeight > availableHeight) {
                canvasHeight = availableHeight;
                canvasWidth = canvasHeight / aspectRatio;
            }
        }

        this.previewCanvas.width = canvasWidth;
        this.previewCanvas.height = canvasHeight;

        const ctx = this.previewCtx;

        // Clear canvas
        ctx.fillStyle = '#f9f9f9';
        ctx.fillRect(0, 0, canvasWidth, canvasHeight);

        // Draw border (same aspect ratio as selected area)
        ctx.strokeStyle = '#3498db';
        ctx.lineWidth = 2;
        ctx.strokeRect(0, 0, canvasWidth, canvasHeight);

        // Get sample parameters
        const totalSamples = parseInt(document.getElementById('pane-total-samples').value);
        const edgeSamples = Math.round(totalSamples * 0.25);
        const interiorSamples = totalSamples - edgeSamples;

        // Preview points (simplified calculation)
        const bounds = {
            minX: sw.lng,
            maxX: ne.lng,
            minY: sw.lat,
            maxY: ne.lat
        };

        const width = bounds.maxX - bounds.minX;
        const height = bounds.maxY - bounds.minY;

        // Calculate edge distribution
        const xSamples = Math.round(Math.sqrt(edgeSamples * (width / height)));
        const ySamples = Math.round(edgeSamples / xSamples);

        // Draw edge points
        ctx.fillStyle = '#e74c3c';

        // Top edge
        for (let i = 0; i < xSamples; i++) {
            const x = (i / (xSamples - 1)) * canvasWidth;
            ctx.beginPath();
            ctx.arc(x, 0, 3, 0, Math.PI * 2);
            ctx.fill();
        }

        // Bottom edge
        for (let i = 0; i < xSamples; i++) {
            const x = (i / (xSamples - 1)) * canvasWidth;
            ctx.beginPath();
            ctx.arc(x, canvasHeight, 3, 0, Math.PI * 2);
            ctx.fill();
        }

        // Left edge
        for (let i = 1; i < ySamples - 1; i++) {
            const y = (i / (ySamples - 1)) * canvasHeight;
            ctx.beginPath();
            ctx.arc(0, y, 3, 0, Math.PI * 2);
            ctx.fill();
        }

        // Right edge
        for (let i = 1; i < ySamples - 1; i++) {
            const y = (i / (ySamples - 1)) * canvasHeight;
            ctx.beginPath();
            ctx.arc(canvasWidth, y, 3, 0, Math.PI * 2);
            ctx.fill();
        }

        // Draw interior points using Mitchell's best-candidate
        const canvasBounds = {
            minX: 5,
            maxX: canvasWidth - 5,
            minY: 5,
            maxY: canvasHeight - 5
        };

        const mitchell = new MitchellSampling(canvasBounds, 20);
        const interiorPoints = mitchell.generate(interiorSamples);

        // Collect all points for relaxation
        const allPoints = [];

        // Add edge points
        for (let i = 0; i < xSamples; i++) {
            const x = (i / (xSamples - 1)) * canvasWidth;
            allPoints.push({x, y: 0});
            allPoints.push({x, y: canvasHeight});
        }
        for (let i = 1; i < ySamples - 1; i++) {
            const y = (i / (ySamples - 1)) * canvasHeight;
            allPoints.push({x: 0, y});
            allPoints.push({x: canvasWidth, y});
        }

        const edgePointsForRelaxation = allPoints.slice();

        // Add interior points
        interiorPoints.forEach(p => {
            allPoints.push(p);
        });

        // Apply relaxation
        PointRelaxation.relax(allPoints, edgePointsForRelaxation, canvasBounds, 10);

        // Build Delaunay triangulation for visualization using relaxed points
        const allPreviewPoints = allPoints.map(p => [p.x, p.y]);

        // Draw Delaunay triangulation
        const delaunay = d3.Delaunay.from(allPreviewPoints);
        ctx.strokeStyle = 'rgba(200, 200, 200, 0.3)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        delaunay.render(ctx);
        ctx.stroke();

        // Highlight short edges (< 0.25 median)
        if (this.shortEdges && this.shortEdges.length > 0) {
            ctx.strokeStyle = '#f39c12'; // Orange for short edges
            ctx.lineWidth = 2;

            this.shortEdges.forEach(edge => {
                // Map geo coordinates to canvas coordinates
                const x1 = ((edge.p1.x - bounds.minX) / width) * canvasWidth;
                const y1 = canvasHeight - ((edge.p1.y - bounds.minY) / height) * canvasHeight;
                const x2 = ((edge.p2.x - bounds.minX) / width) * canvasWidth;
                const y2 = canvasHeight - ((edge.p2.y - bounds.minY) / height) * canvasHeight;

                ctx.beginPath();
                ctx.moveTo(x1, y1);
                ctx.lineTo(x2, y2);
                ctx.stroke();
            });
        }

        // Draw edge points (from relaxed points)
        ctx.fillStyle = '#e74c3c';
        const numEdgePoints = edgePointsForRelaxation.length;
        for (let i = 0; i < numEdgePoints; i++) {
            const p = allPoints[i];
            ctx.beginPath();
            ctx.arc(p.x, p.y, 3, 0, Math.PI * 2);
            ctx.fill();
        }

        // Draw interior points (from relaxed points)
        ctx.fillStyle = '#3498db';
        for (let i = numEdgePoints; i < allPoints.length; i++) {
            const p = allPoints[i];
            ctx.beginPath();
            ctx.arc(p.x, p.y, 2, 0, Math.PI * 2);
            ctx.fill();
        }

        // Add legend
        ctx.font = '12px -apple-system, sans-serif';
        ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
        const legendHeight = this.shortEdges && this.shortEdges.length > 0 ? 74 : 54;
        ctx.fillRect(8, 8, 140, legendHeight);

        ctx.fillStyle = '#e74c3c';
        ctx.fillRect(10, 10, 12, 12);
        ctx.fillStyle = '#2c3e50';
        ctx.fillText('Edge samples', 28, 20);

        ctx.fillStyle = '#3498db';
        ctx.fillRect(10, 30, 12, 12);
        ctx.fillText('Interior samples', 28, 40);

        ctx.strokeStyle = 'rgba(200, 200, 200, 0.5)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(10, 50);
        ctx.lineTo(22, 50);
        ctx.stroke();
        ctx.fillStyle = '#2c3e50';
        ctx.fillText('Triangulation', 28, 54);

        // Add short edges to legend if present
        if (this.shortEdges && this.shortEdges.length > 0) {
            ctx.strokeStyle = '#f39c12';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(10, 70);
            ctx.lineTo(22, 70);
            ctx.stroke();
            ctx.fillStyle = '#2c3e50';
            ctx.fillText(`Short edges (${this.shortEdges.length})`, 28, 74);
        }
    }

    async lockPointsAndFetchElevations() {
        if (!this.selectedBounds) return;

        const btn = document.getElementById('lock-points-btn');
        btn.disabled = true;
        btn.textContent = 'Fetching elevations...';

        try {
            // Generate sample points
            const totalSamples = parseInt(document.getElementById('pane-total-samples').value);

            this.samples = this.generateSamplePoints(totalSamples);

            console.log(`Generated ${this.samples.length} total sample points`);
            console.log(`  - ${this.numBoundaryPoints} boundary points`);
            console.log(`  - ${this.samples.length - this.numBoundaryPoints} interior points`);

            // Fetch elevations
            await this.fetchElevations(this.samples, this.numBoundaryPoints);

            // Count how many got elevations
            const withElevation = this.samples.filter(p => p.elevation !== null && p.elevation !== undefined).length;
            const withoutElevation = this.samples.length - withElevation;

            console.log(`Elevation fetch complete:`);
            console.log(`  - ${withElevation} points received elevations`);
            if (withoutElevation > 0) {
                console.warn(`  - ${withoutElevation} points missing elevations!`);
            }

            // Adaptive refinement
            await this.adaptiveRefinement(this.samples);

            // Complete pane 2 and open pane 3
            this.completePane(2);
            this.activatePane(3);
            this.openPane(3);

            // Draw heatmap
            this.drawHeatmap();

        } catch (error) {
            console.error('Error fetching elevations:', error);
            alert('Error: ' + error.message);
        } finally {
            btn.disabled = false;
            btn.textContent = 'Lock Points & Get Elevations';
        }
    }

    drawHeatmap() {
        if (!this.samples || this.samples.length === 0) return;

        const sw = this.selectedBounds.getSouthWest();
        const ne = this.selectedBounds.getNorthEast();

        // Set canvas size to fit within visible pane area
        const pane = this.heatmapCanvas.closest('.pane-content-inner');
        const paneRect = pane ? pane.getBoundingClientRect() : null;
        const rect = this.heatmapCanvas.getBoundingClientRect();

        const containerWidth = rect.width || 360;
        // Calculate available height: pane height minus other elements (controls, margins, button, etc.)
        const availableHeight = paneRect ? Math.max(200, paneRect.height - 100) : 400;
        const aspectRatio = (ne.lat - sw.lat) / (ne.lng - sw.lng);

        // Fit canvas to available space while preserving aspect ratio
        let canvasWidth, canvasHeight;
        const containerAspectRatio = containerWidth / availableHeight;
        const mapAspectRatio = 1 / aspectRatio; // inverse because lat/lng

        if (containerAspectRatio > mapAspectRatio) {
            // Container is wider - fit to height
            canvasHeight = availableHeight;
            canvasWidth = canvasHeight / aspectRatio;
        } else {
            // Container is taller - fit to width
            canvasWidth = containerWidth - 20;
            canvasHeight = canvasWidth * aspectRatio;
            // Ensure it doesn't exceed available height
            if (canvasHeight > availableHeight) {
                canvasHeight = availableHeight;
                canvasWidth = canvasHeight / aspectRatio;
            }
        }

        this.heatmapCanvas.width = canvasWidth;
        this.heatmapCanvas.height = canvasHeight;

        const ctx = this.heatmapCtx;

        // Clear canvas
        ctx.fillStyle = '#f9f9f9';
        ctx.fillRect(0, 0, canvasWidth, canvasHeight);

        // Draw border
        ctx.strokeStyle = '#3498db';
        ctx.lineWidth = 2;
        ctx.strokeRect(0, 0, canvasWidth, canvasHeight);

        // Find min/max elevations
        let minElev = Infinity;
        let maxElev = -Infinity;
        this.samples.forEach(p => {
            if (p.elevation !== null) {
                minElev = Math.min(minElev, p.elevation);
                maxElev = Math.max(maxElev, p.elevation);
            }
        });

        const elevRange = maxElev - minElev;

        // Convert geo coordinates to canvas coordinates
        const width = ne.lng - sw.lng;
        const height = ne.lat - sw.lat;

        // Draw points as fat dots with heatmap colors
        this.samples.forEach((p, index) => {
            if (p.elevation === null) return;

            const x = ((p.x - sw.lng) / width) * canvasWidth;
            const y = canvasHeight - ((p.y - sw.lat) / height) * canvasHeight;

            const normalized = elevRange > 0 ? (p.elevation - minElev) / elevRange : 0;
            const hue = (1 - normalized) * 240; // 240 = blue (low), 0 = red (high)
            ctx.fillStyle = `hsl(${hue}, 70%, 50%)`;

            // Fat dots
            ctx.beginPath();
            ctx.arc(x, y, 4, 0, Math.PI * 2);
            ctx.fill();

            // Highlight refinement points (if they were added in adaptive refinement)
            if (index >= this.samples.length - this.refinementPoints.length) {
                ctx.strokeStyle = '#f39c12';
                ctx.lineWidth = 2;
                ctx.beginPath();
                ctx.arc(x, y, 6, 0, Math.PI * 2);
                ctx.stroke();
            }
        });

        // Add hover info (stored for later use)
        this.heatmapCanvas.addEventListener('mousemove', (e) => {
            const rect = this.heatmapCanvas.getBoundingClientRect();
            const mx = e.clientX - rect.left;
            const my = e.clientY - rect.top;

            // Find closest point
            let closestPoint = null;
            let closestDist = Infinity;

            this.samples.forEach(p => {
                if (p.elevation === null) return;

                const x = ((p.x - sw.lng) / width) * canvasWidth;
                const y = canvasHeight - ((p.y - sw.lat) / height) * canvasHeight;

                const dist = Math.sqrt((mx - x) ** 2 + (my - y) ** 2);
                if (dist < 8 && dist < closestDist) {
                    closestPoint = p;
                    closestDist = dist;
                }
            });

            if (closestPoint) {
                this.heatmapCanvas.title = `Elevation: ${closestPoint.elevation.toFixed(1)}m`;
                this.heatmapCanvas.style.cursor = 'pointer';
            } else {
                this.heatmapCanvas.title = '';
                this.heatmapCanvas.style.cursor = 'default';
            }
        });

        // Update stats
        const statsDiv = document.getElementById('elevation-stats');
        statsDiv.innerHTML = `
            <strong>Elevation Range:</strong> ${minElev.toFixed(1)}m - ${maxElev.toFixed(1)}m<br>
            <strong>Total Points:</strong> ${this.samples.length}<br>
            <strong>Refinement Points:</strong> ${this.refinementPoints.length}
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
