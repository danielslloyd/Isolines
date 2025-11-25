/**
 * Visvalingam's Algorithm for line simplification
 * Progressively removes points with the least perceptible change
 * Avoids creating intersections during simplification
 */

class Visvalingam {
    /**
     * Simplify a polyline using Visvalingam's algorithm
     * @param {Array} points - Array of {x, y} points
     * @param {Number} threshold - Area threshold (percentage 0-1)
     * @returns {Array} Simplified points
     */
    static simplify(points, threshold = 0) {
        if (points.length <= 2) return points;

        // Calculate effective areas for all points
        const effectiveAreas = this.calculateEffectiveAreas(points);

        // Find max area for normalization
        const maxArea = Math.max(...effectiveAreas.filter(a => a !== Infinity));

        // Determine minimum area threshold
        const minArea = threshold * maxArea;

        // Build heap of points by area
        const heap = [];
        for (let i = 1; i < points.length - 1; i++) {
            heap.push({
                index: i,
                area: effectiveAreas[i],
                removed: false
            });
        }

        // Sort by area (min heap)
        heap.sort((a, b) => a.area - b.area);

        // Mark points for removal
        const keep = new Array(points.length).fill(true);
        let removeCount = 0;

        for (let i = 0; i < heap.length; i++) {
            const point = heap[i];

            if (point.area >= minArea) {
                break;
            }

            // Check if removing this point would create an intersection
            if (!this.wouldCreateIntersection(points, keep, point.index)) {
                keep[point.index] = false;
                removeCount++;
            }
        }

        // Build simplified line
        const simplified = [];
        for (let i = 0; i < points.length; i++) {
            if (keep[i]) {
                simplified.push(points[i]);
            }
        }

        return simplified;
    }

    /**
     * Calculate effective area for each point
     */
    static calculateEffectiveAreas(points) {
        const areas = new Array(points.length).fill(Infinity);

        for (let i = 1; i < points.length - 1; i++) {
            areas[i] = this.triangleArea(
                points[i - 1],
                points[i],
                points[i + 1]
            );
        }

        return areas;
    }

    /**
     * Calculate area of triangle formed by three points
     */
    static triangleArea(p1, p2, p3) {
        return Math.abs(
            (p2.x - p1.x) * (p3.y - p1.y) -
            (p3.x - p1.x) * (p2.y - p1.y)
        ) / 2;
    }

    /**
     * Check if removing a point would create an intersection
     */
    static wouldCreateIntersection(points, keep, removeIndex) {
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

    /**
     * Check if two line segments intersect
     */
    static segmentsIntersect(seg1, seg2) {
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

    /**
     * Calculate direction of point p3 relative to line p1-p2
     */
    static direction(p1, p2, p3) {
        return (p3.x - p1.x) * (p2.y - p1.y) - (p2.x - p1.x) * (p3.y - p1.y);
    }

    /**
     * Check if point p2 is on segment p1-p3
     */
    static onSegment(p1, p2, p3) {
        return p2.x >= Math.min(p1.x, p3.x) && p2.x <= Math.max(p1.x, p3.x) &&
               p2.y >= Math.min(p1.y, p3.y) && p2.y <= Math.max(p1.y, p3.y);
    }

    /**
     * Simplify multiple polylines
     */
    static simplifyLines(lines, threshold) {
        return lines.map(line => this.simplify(line, threshold));
    }
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = Visvalingam;
}
