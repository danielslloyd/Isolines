/**
 * Mitchell's Best-Candidate Algorithm
 * Generates well-distributed points by testing multiple candidates and keeping the best
 */

class MitchellSampling {
    constructor(bounds, candidatesPerPoint = 10) {
        this.bounds = bounds; // {minX, maxX, minY, maxY}
        this.candidatesPerPoint = candidatesPerPoint;
        this.points = [];
    }

    generate(targetCount) {
        // First point is random
        this.points.push({
            x: this.bounds.minX + Math.random() * (this.bounds.maxX - this.bounds.minX),
            y: this.bounds.minY + Math.random() * (this.bounds.maxY - this.bounds.minY)
        });

        // For each subsequent point, test multiple candidates and keep the one farthest from existing points
        while (this.points.length < targetCount) {
            let bestCandidate = null;
            let bestDistance = 0;

            for (let i = 0; i < this.candidatesPerPoint; i++) {
                const candidate = {
                    x: this.bounds.minX + Math.random() * (this.bounds.maxX - this.bounds.minX),
                    y: this.bounds.minY + Math.random() * (this.bounds.maxY - this.bounds.minY)
                };

                // Find distance to nearest existing point
                const nearestDist = this.getNearestDistance(candidate);

                if (nearestDist > bestDistance) {
                    bestDistance = nearestDist;
                    bestCandidate = candidate;
                }
            }

            if (bestCandidate) {
                this.points.push(bestCandidate);
            }
        }

        return this.points;
    }

    getNearestDistance(candidate) {
        let minDist = Infinity;

        for (const point of this.points) {
            const dx = candidate.x - point.x;
            const dy = candidate.y - point.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            minDist = Math.min(minDist, dist);
        }

        return minDist;
    }
}

/**
 * Point Relaxation using Lloyd's algorithm
 * Pushes points away from each other to improve distribution
 */
class PointRelaxation {
    static relax(points, edgePoints, bounds, iterations = 5) {
        const edgeSet = new Set(edgePoints.map(p => `${p.x},${p.y}`));

        for (let iter = 0; iter < iterations; iter++) {
            const forces = points.map(() => ({ x: 0, y: 0 }));

            // Calculate repulsive forces between all points (including edges pushing on interior)
            for (let i = 0; i < points.length; i++) {
                for (let j = i + 1; j < points.length; j++) {
                    const dx = points[j].x - points[i].x;
                    const dy = points[j].y - points[i].y;
                    const dist = Math.sqrt(dx * dx + dy * dy);

                    if (dist < 1e-10) continue;

                    // Repulsive force inversely proportional to distance
                    const force = 0.01 / (dist * dist);
                    const fx = (dx / dist) * force;
                    const fy = (dy / dist) * force;

                    // Both points feel the force, but only non-edge points will move
                    forces[i].x -= fx;
                    forces[i].y -= fy;
                    forces[j].x += fx;
                    forces[j].y += fy;
                }
            }

            // Apply forces (but not to edge points)
            for (let i = 0; i < points.length; i++) {
                const key = `${points[i].x},${points[i].y}`;
                if (!edgeSet.has(key)) {
                    points[i].x += forces[i].x;
                    points[i].y += forces[i].y;

                    // Keep within bounds
                    points[i].x = Math.max(bounds.minX, Math.min(bounds.maxX, points[i].x));
                    points[i].y = Math.max(bounds.minY, Math.min(bounds.maxY, points[i].y));
                }
            }
        }

        return points;
    }
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { MitchellSampling, PointRelaxation };
}
