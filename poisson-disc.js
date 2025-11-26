/**
 * Poisson Disc Sampling
 * Generates evenly distributed random points within a boundary
 */

class PoissonDisc {
    constructor(bounds, minDistance, maxAttempts = 30) {
        this.bounds = bounds; // {minX, maxX, minY, maxY}
        this.minDistance = minDistance;
        this.maxAttempts = maxAttempts;
        this.cellSize = minDistance / Math.sqrt(2);

        this.width = bounds.maxX - bounds.minX;
        this.height = bounds.maxY - bounds.minY;
        this.cols = Math.ceil(this.width / this.cellSize);
        this.rows = Math.ceil(this.height / this.cellSize);

        this.grid = new Array(this.cols * this.rows).fill(null);
        this.active = [];
        this.points = [];
    }

    generate(targetCount) {
        // Start with multiple seed points for better distribution
        const seedPoints = [
            // Center
            {x: this.bounds.minX + this.width * 0.5, y: this.bounds.minY + this.height * 0.5},
            // Corners (slightly inset)
            {x: this.bounds.minX + this.width * 0.2, y: this.bounds.minY + this.height * 0.2},
            {x: this.bounds.minX + this.width * 0.8, y: this.bounds.minY + this.height * 0.2},
            {x: this.bounds.minX + this.width * 0.2, y: this.bounds.minY + this.height * 0.8},
            {x: this.bounds.minX + this.width * 0.8, y: this.bounds.minY + this.height * 0.8}
        ];

        // Add seed points
        for (const seedPoint of seedPoints) {
            if (this.isValid(seedPoint.x, seedPoint.y)) {
                this.addPoint(seedPoint);
                if (this.points.length >= targetCount) break;
            }
        }

        while (this.active.length > 0 && this.points.length < targetCount) {
            const randomIndex = Math.floor(Math.random() * this.active.length);
            const point = this.active[randomIndex];
            let found = false;

            for (let i = 0; i < this.maxAttempts; i++) {
                const angle = Math.random() * Math.PI * 2;
                const radius = this.minDistance + Math.random() * this.minDistance;
                const newX = point.x + Math.cos(angle) * radius;
                const newY = point.y + Math.sin(angle) * radius;

                if (this.isValid(newX, newY)) {
                    this.addPoint({x: newX, y: newY});
                    found = true;

                    if (this.points.length >= targetCount) {
                        break;
                    }
                }
            }

            if (!found) {
                this.active.splice(randomIndex, 1);
            }
        }

        return this.points;
    }

    isValid(x, y) {
        // Check bounds
        if (x < this.bounds.minX || x > this.bounds.maxX ||
            y < this.bounds.minY || y > this.bounds.maxY) {
            return false;
        }

        // Check grid
        const col = Math.floor((x - this.bounds.minX) / this.cellSize);
        const row = Math.floor((y - this.bounds.minY) / this.cellSize);

        // Check neighboring cells
        const startCol = Math.max(0, col - 2);
        const endCol = Math.min(this.cols - 1, col + 2);
        const startRow = Math.max(0, row - 2);
        const endRow = Math.min(this.rows - 1, row + 2);

        for (let i = startCol; i <= endCol; i++) {
            for (let j = startRow; j <= endRow; j++) {
                const neighbor = this.grid[i + j * this.cols];
                if (neighbor) {
                    const dx = x - neighbor.x;
                    const dy = y - neighbor.y;
                    const dist = Math.sqrt(dx * dx + dy * dy);
                    if (dist < this.minDistance) {
                        return false;
                    }
                }
            }
        }

        return true;
    }

    addPoint(point) {
        this.points.push(point);
        this.active.push(point);

        const col = Math.floor((point.x - this.bounds.minX) / this.cellSize);
        const row = Math.floor((point.y - this.bounds.minY) / this.cellSize);
        this.grid[col + row * this.cols] = point;
    }
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = PoissonDisc;
}
