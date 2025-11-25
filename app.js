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

        this.init();
    }

    init() {
        this.initMap();
        this.initControls();
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
    }

    initControls() {
        // Generate button
        document.getElementById('generate-btn').addEventListener('click', () => {
            this.generateContours();
        });

        // Simplify slider
        const slider = document.getElementById('simplify-slider');
        const valueDisplay = document.getElementById('simplify-value');
        slider.addEventListener('input', (e) => {
            const value = e.target.value;
            valueDisplay.textContent = value + '%';
            this.applySimplification(value / 100);
        });

        // Export button
        document.getElementById('export-btn').addEventListener('click', () => {
            this.exportSVG();
        });
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
        const info = document.getElementById('bounds-info');
        if (this.selectedBounds) {
            const sw = this.selectedBounds.getSouthWest();
            const ne = this.selectedBounds.getNorthEast();
            info.innerHTML = `
                <strong>SW:</strong> ${sw.lat.toFixed(6)}, ${sw.lng.toFixed(6)}<br>
                <strong>NE:</strong> ${ne.lat.toFixed(6)}, ${ne.lng.toFixed(6)}
            `;
        } else {
            info.textContent = 'No area selected';
        }
    }

    async generateContours() {
        if (!this.selectedBounds) {
            this.showStatus('Please select an area first by right-click dragging on the map.', 'error');
            return;
        }

        const generateBtn = document.getElementById('generate-btn');
        generateBtn.disabled = true;
        generateBtn.textContent = 'Generating...';

        try {
            // Step 1: Generate sample points
            this.showStatus('Generating sample points...', 'info');
            await this.delay(100);

            const edgeSamples = parseInt(document.getElementById('edge-samples').value);
            const interiorSamples = parseInt(document.getElementById('interior-samples').value);

            this.samples = this.generateSamplePoints(edgeSamples, interiorSamples);

            // Step 2: Fetch elevations
            this.showStatus(`Fetching elevations for ${this.samples.length} points...`, 'info');
            await this.delay(100);

            const elevations = await this.fetchElevations(this.samples);

            // Step 3: Adaptive refinement
            this.showStatus('Performing adaptive refinement...', 'info');
            await this.delay(100);

            await this.adaptiveRefinement(elevations);

            // Step 4: Create grid
            this.showStatus('Creating elevation grid...', 'info');
            await this.delay(100);

            const grid = this.createGrid(this.samples);

            // Step 5: Generate contours
            this.showStatus('Generating contour lines...', 'info');
            await this.delay(100);

            const interval = parseFloat(document.getElementById('contour-interval').value);
            this.generateContourLines(grid, interval);

            // Step 6: Display
            this.showStatus('Rendering contours...', 'info');
            await this.delay(100);

            this.displayContours();

            // Show simplification controls
            document.getElementById('simplify-controls').classList.add('show');
            document.getElementById('simplify-slider').value = 0;
            document.getElementById('simplify-value').textContent = '0%';

            this.showStatus('Contours generated successfully!', 'success');

        } catch (error) {
            console.error('Error generating contours:', error);
            this.showStatus('Error: ' + error.message, 'error');
        } finally {
            generateBtn.disabled = false;
            generateBtn.textContent = 'Generate Contours';
        }
    }

    generateSamplePoints(edgeSamples, interiorSamples) {
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

        // Calculate edge distribution
        // X * Y = N, and X/width ≈ Y/height
        // X = sqrt(N * width / height)
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

        // Generate interior samples using Poisson-disc sampling
        const minDistance = Math.min(width, height) / Math.sqrt(interiorSamples) * 0.8;
        const poisson = new PoissonDisc(bounds, minDistance);
        const interiorPoints = poisson.generate(interiorSamples);

        interiorPoints.forEach(p => {
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
        }
    }

    createGrid(points) {
        // Create a regular grid using triangulation and interpolation
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

        // Interpolate elevation at each grid point using IDW
        for (let i = 0; i < cols; i++) {
            grid.data[i] = [];
            for (let j = 0; j < rows; j++) {
                const x = grid.x[i];
                const y = grid.y[j];
                grid.data[i][j] = this.interpolateElevation(x, y, points);
            }
        }

        return grid;
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

    showStatus(message, type = 'info') {
        const status = document.getElementById('status');
        status.textContent = message;
        status.className = 'show ' + type;
    }

    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

// Initialize app when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    new ContourMapApp();
});
