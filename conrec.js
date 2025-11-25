/**
 * CONREC Contouring Algorithm
 * Based on Paul Bourke's implementation
 * Generates contour lines from gridded elevation data
 */

class Conrec {
    constructor() {
        // Contour line segments
        this.contours = {};
    }

    /**
     * Generate contour lines
     * @param {Array} d - 2D array of elevation data [x][y]
     * @param {Array} x - X coordinates
     * @param {Array} y - Y coordinates
     * @param {Array} z - Contour levels to generate
     */
    contour(d, x, y, z) {
        this.contours = {};

        // Initialize contour arrays for each level
        z.forEach(level => {
            this.contours[level] = [];
        });

        const nc = z.length;
        const ilb = 0;
        const iub = x.length - 1;
        const jlb = 0;
        const jub = y.length - 1;

        // Look-up tables
        const im = [0, 1, 1, 0];
        const jm = [0, 0, 1, 1];
        const castab = [
            [0, 0, 8], [0, 2, 5], [7, 6, 9],
            [0, 3, 4], [1, 3, 1], [4, 3, 0],
            [9, 6, 7], [5, 2, 0], [8, 0, 0]
        ];

        // Process each grid cell
        for (let j = jub - 1; j >= jlb; j--) {
            for (let i = ilb; i <= iub - 1; i++) {
                let temp1, temp2;
                let dmin = Math.min(d[i][j], d[i][j + 1], d[i + 1][j], d[i + 1][j + 1]);
                let dmax = Math.max(d[i][j], d[i][j + 1], d[i + 1][j], d[i + 1][j + 1]);

                if (dmax < z[0] || dmin > z[nc - 1]) {
                    continue;
                }

                for (let k = 0; k < nc; k++) {
                    const h = z[k];

                    if (h < dmin || h > dmax) {
                        continue;
                    }

                    let m1, m2, m3, case_value;

                    for (m1 = 4, m2 = 0, m3 = 0; m3 < 4; m3++) {
                        const idx1 = im[m3];
                        const idx2 = jm[m3];

                        if (d[i + idx1][j + idx2] > h) {
                            m2 += m1;
                        }
                        m1 /= 2;
                    }

                    if (m2 === 0 || m2 === 15) {
                        continue;
                    }

                    const sh = [
                        d[i][j],
                        d[i + 1][j],
                        d[i + 1][j + 1],
                        d[i][j + 1]
                    ];
                    const xh = [x[i], x[i + 1], x[i + 1], x[i]];
                    const yh = [y[j], y[j], y[j + 1], y[j + 1]];

                    for (m1 = 0; m1 < 4; m1++) {
                        const m2 = (m1 + 1) % 4;
                        const m3 = (m1 + 2) % 4;

                        case_value = castab[m2][m1];

                        if (case_value === 0) {
                            continue;
                        }

                        let x1, y1, x2, y2;

                        switch (case_value) {
                            case 1:
                                x1 = xh[m1];
                                y1 = yh[m1];
                                x2 = xh[m2];
                                y2 = yh[m2];
                                break;
                            case 2:
                                x1 = xh[m2];
                                y1 = yh[m2];
                                x2 = xh[m1];
                                y2 = yh[m1];
                                break;
                            case 3:
                                x1 = xh[m3];
                                y1 = yh[m3];
                                x2 = xh[m1];
                                y2 = yh[m1];
                                break;
                            case 4:
                                x1 = xh[m1];
                                y1 = yh[m1];
                                x2 = xh[m3];
                                y2 = yh[m3];
                                break;
                            case 5:
                                x1 = xh[m1];
                                y1 = yh[m1];
                                x2 = this.interpolate(xh[m2], xh[m3], sh[m2], sh[m3], h);
                                y2 = this.interpolate(yh[m2], yh[m3], sh[m2], sh[m3], h);
                                break;
                            case 6:
                                x1 = this.interpolate(xh[m1], xh[m2], sh[m1], sh[m2], h);
                                y1 = this.interpolate(yh[m1], yh[m2], sh[m1], sh[m2], h);
                                x2 = xh[m3];
                                y2 = yh[m3];
                                break;
                            case 7:
                                x1 = this.interpolate(xh[m1], xh[m2], sh[m1], sh[m2], h);
                                y1 = this.interpolate(yh[m1], yh[m2], sh[m1], sh[m2], h);
                                x2 = this.interpolate(xh[m2], xh[m3], sh[m2], sh[m3], h);
                                y2 = this.interpolate(yh[m2], yh[m3], sh[m2], sh[m3], h);
                                break;
                            case 8:
                                x1 = this.interpolate(xh[m2], xh[m3], sh[m2], sh[m3], h);
                                y1 = this.interpolate(yh[m2], yh[m3], sh[m2], sh[m3], h);
                                x2 = this.interpolate(xh[m1], xh[m2], sh[m1], sh[m2], h);
                                y2 = this.interpolate(yh[m1], yh[m2], sh[m1], sh[m2], h);
                                break;
                            case 9:
                                x1 = this.interpolate(xh[m1], xh[m2], sh[m1], sh[m2], h);
                                y1 = this.interpolate(yh[m1], yh[m2], sh[m1], sh[m2], h);
                                x2 = xh[m1];
                                y2 = yh[m1];
                                break;
                            default:
                                continue;
                        }

                        this.contours[h].push({x1, y1, x2, y2});
                    }
                }
            }
        }

        return this.contours;
    }

    interpolate(x1, x2, z1, z2, z) {
        if (Math.abs(z2 - z1) < 1e-10) {
            return (x1 + x2) / 2;
        }
        return x1 + (z - z1) * (x2 - x1) / (z2 - z1);
    }

    /**
     * Connect contour segments into polylines
     */
    connectSegments(segments, tolerance = 0.0001) {
        if (segments.length === 0) return [];

        const lines = [];
        const used = new Set();

        for (let i = 0; i < segments.length; i++) {
            if (used.has(i)) continue;

            const line = [
                {x: segments[i].x1, y: segments[i].y1},
                {x: segments[i].x2, y: segments[i].y2}
            ];
            used.add(i);

            let extended = true;
            while (extended) {
                extended = false;

                for (let j = 0; j < segments.length; j++) {
                    if (used.has(j)) continue;

                    const seg = segments[j];
                    const start = line[0];
                    const end = line[line.length - 1];

                    // Check if segment connects to end
                    if (this.pointsEqual(end, {x: seg.x1, y: seg.y1}, tolerance)) {
                        line.push({x: seg.x2, y: seg.y2});
                        used.add(j);
                        extended = true;
                    } else if (this.pointsEqual(end, {x: seg.x2, y: seg.y2}, tolerance)) {
                        line.push({x: seg.x1, y: seg.y1});
                        used.add(j);
                        extended = true;
                    }
                    // Check if segment connects to start
                    else if (this.pointsEqual(start, {x: seg.x2, y: seg.y2}, tolerance)) {
                        line.unshift({x: seg.x1, y: seg.y1});
                        used.add(j);
                        extended = true;
                    } else if (this.pointsEqual(start, {x: seg.x1, y: seg.y1}, tolerance)) {
                        line.unshift({x: seg.x2, y: seg.y2});
                        used.add(j);
                        extended = true;
                    }

                    if (extended) break;
                }
            }

            lines.push(line);
        }

        return lines;
    }

    pointsEqual(p1, p2, tolerance) {
        return Math.abs(p1.x - p2.x) < tolerance && Math.abs(p1.y - p2.y) < tolerance;
    }
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = Conrec;
}
