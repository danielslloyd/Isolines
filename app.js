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

        // Add Esri World Imagery tile layer
        L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
            attribution: 'Leaflet | Powered by Esri | Earthstar Geographics',
            maxZoom: 18
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
        const paneSimplifySlider = document.getElementById('pane-simplify-slider');
        const paneSimplifyValue = document.getElementById('pane-simplify-value');
        paneSimplifySlider.addEventListener('input', (e) => {
            const value = e.target.value;
            paneSimplifyValue.textContent = value + '%';
            this.applySimplification(value / 100);
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
                this.startPoint = this.map.containerPointToLatLng([e.clientX, e.clientY]);

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
                const currentPoint = this.map.containerPointToLatLng([e.clientX, e.clientY]);

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

        // Generate interior samples using Poisson-disc sampling with better fill
        const minDistance = Math.min(width, height) / Math.sqrt(interiorSamples) * 0.5; // Reduced from 0.8 to 0.5 for better fill
        const poisson = new PoissonDisc(bounds, minDistance);
        const interiorPoints = poisson.generate(interiorSamples * 2); // Generate more and take the first interiorSamples

        // Take only the required number of interior points
        const selectedInterior = interiorPoints.slice(0, interiorSamples);
        selectedInterior.forEach(p => {
            points.push({ x: p.x, y: p.y, elevation: null });
        });

        return points;
    }

    async fetchElevations(points) {
        // Use Open-Elevation API (free, no API key required)
        const batchSize = 200; // Limit batch size
        const batches = [];

        for (let i = 0; i < points.length; i += batchSize) {
            batches.push(points.slice(i, i + batchSize));
        }

        for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
            const batch = batches[batchIndex];

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

                data.results.forEach((result, index) => {
                    const pointIndex = batchIndex * batchSize + index;
                    if (pointIndex < points.length) {
                        points[pointIndex].elevation = result.elevation;
                    }
                });

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

    clearContours() {
        this.contourLayer.clearLayers();
        this.originalContours = null;
        this.currentContours = null;
        this.samples = [];
        document.getElementById('simplify-controls').classList.remove('show');
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
    <g id="contours">
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

        // Set canvas size based on actual container size
        const rect = this.previewCanvas.getBoundingClientRect();
        const canvasWidth = this.previewCanvas.width = rect.width || 360;
        const aspectRatio = (ne.lat - sw.lat) / (ne.lng - sw.lng);
        const canvasHeight = this.previewCanvas.height = Math.max(250, canvasWidth * aspectRatio);

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

        // Draw interior points (approximation using Poisson-disc)
        ctx.fillStyle = '#3498db';
        const minDistance = Math.min(canvasWidth, canvasHeight) / Math.sqrt(interiorSamples) * 0.5;

        const canvasBounds = {
            minX: 10,
            maxX: canvasWidth - 10,
            minY: 10,
            maxY: canvasHeight - 10
        };

        const poisson = new PoissonDisc(canvasBounds, minDistance);
        const interiorPoints = poisson.generate(interiorSamples);

        interiorPoints.forEach(p => {
            ctx.beginPath();
            ctx.arc(p.x, p.y, 2, 0, Math.PI * 2);
            ctx.fill();
        });

        // Add legend
        ctx.font = '12px -apple-system, sans-serif';
        ctx.fillStyle = '#e74c3c';
        ctx.fillRect(10, 10, 12, 12);
        ctx.fillStyle = '#2c3e50';
        ctx.fillText('Edge samples', 28, 20);

        ctx.fillStyle = '#3498db';
        ctx.fillRect(10, 30, 12, 12);
        ctx.fillStyle = '#2c3e50';
        ctx.fillText('Interior samples', 28, 40);
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

            // Fetch elevations
            await this.fetchElevations(this.samples);

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

        // Set canvas size based on actual container size
        const rect = this.heatmapCanvas.getBoundingClientRect();
        const canvasWidth = this.heatmapCanvas.width = rect.width || 360;
        const aspectRatio = (ne.lat - sw.lat) / (ne.lng - sw.lng);
        const canvasHeight = this.heatmapCanvas.height = Math.max(300, canvasWidth * aspectRatio);

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
            // Create grid
            const grid = this.createGrid(this.samples);

            // Generate contours
            const interval = parseFloat(document.getElementById('pane-contour-interval').value);
            this.generateContourLines(grid, interval);

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

        // Calculate SVG dimensions (preserve aspect ratio)
        const width = 340;
        const aspectRatio = (ne.lat - sw.lat) / (ne.lng - sw.lng);
        const height = width * aspectRatio;

        // Create SVG
        let svg = `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
    <rect width="100%" height="100%" fill="white"/>
    <g id="contours">
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
        const preview = document.getElementById('svg-preview');
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
