# Isolines

Two applications built on contour-line terrain rendering:

1. **Contour Map Creator** (`index.html`) — generate topographic contour maps from real elevation data
2. **⚔ Hold the High Ground** (`game.html`) — a terrain-driven fortress defense game on procedurally generated fractal terrain

---

# ⚔ Hold the High Ground (Game)

Open `game.html` in a browser. No build step, no server — Three.js is vendored in `libs/`.

A **low-poly 3D fortress-defense RTS**. Every map is a fractal landform generated from
scratch with the diamond-square algorithm. Two worldgen modes (chosen in the menu):

- **Forced valley** *(default)* — a high plateau split by a **ravine** that opens into a
  sheltered box canyon: a guaranteed natural fortress roughly a football field across. Your
  keep sits in the canyon; the ravine narrows to a neck a dozen metres wide, and your first
  act is to **wall off the opening**.
- **Fractal + erosion** — no forced valley. A random diamond-square heightmap is **weathered**
  by hydraulic (droplet) erosion, then **depression-filled** so water drains and pits soften.
  The keep drops into the lowest sheltered basin the weathering leaves behind. There is no
  ready-made fortress — you pick your ground and wall a full perimeter. Every seed plays
  differently.

Nearly every worldgen and balance number is exposed under **⚙ Advanced parameters** in the
menu (see [Settings & tuning](#settings--tuning)).

## The loop

1. **Build** — draw fortifications freehand; there is no visible grid. The engine blends
   your line into the terrain (ridge snapping, smoothing) and **snaps new walls onto
   existing masonry**, Tiny-Glade style, so everything joins seamlessly. Walls render as
   continuous extruded 3D curtains with battlements; breaches show as rubble gaps.
2. **Siege** — waves pour up the ravine (and, later, across the plateau and down the
   ramps). A Dijkstra flow field prices walls by strength *and elevation*, so armies
   converge on your weakest, lowest point — exactly like real besiegers.
3. **Grow** — each level the settlement spreads: down the valley, up the ramps, onto the
   plateau. New houses land *outside* your walls, so the palisade around a canyon mouth
   must become a citadel, then a walled city.

## Terrain is the weapon

- **Cliffs are free walls**: impassable to everyone; sealing the neck protects the whole canyon
- Walls remember their elevation — melee attackers strike **uphill walls for less**
- Towers gain range from height: cliff tops and ramparts are prime artillery ground
- Enemy catapults and trebuchets also benefit from high ground — deny them the hills
- Slopes slow attackers; moats slow them drastically

## RTS camera & controls

WASD pans, Q/E or middle-drag rotates, mouse wheel zooms. Click to draw walls
(Enter/double-click builds, right-click undoes), click to place towers, oil cauldrons,
stakes, moats; click walls to upgrade, repair, or demolish.

## Defenses

| Defense | Notes |
|---|---|
| Palisade → Stone → Fortified walls | Upgradable in place (whole connected runs) |
| Gates | Weaker, attract rams — but a gated enclosure earns +25% trade income |
| Watchtower → Archer Tower → Ballista | On ground or **on walls** for the height bonus; ballistae prioritize siege engines |
| Oil cauldrons | Mounted on wall sections; scald attackers at the foot of the wall |
| Stakes | Wound and slow the first attackers through |
| Moats | Dug cell by cell; attackers wade at ⅓ speed |
| Repair / Demolish | Fix damaged runs, or reclaim 30% of cost |

## The enemy: Bronze Age → Medieval

- **Bronze Age (levels 1–3):** raiders, spearmen, slingers, war chieftains — raiding parties up the ravine
- **Iron Age (levels 4–6):** swordsmen, archers, shieldbearers, battering rams
- **Medieval (levels 7+):** knights, crossbowmen, sappers with demolition charges, catapults, siege towers that deploy troops over your walls, trebuchets, and the enemy warlord

Waves escalate tower-defense style within each level. Difficulty settings (Easy/Normal/Hard) scale enemy strength.

## Settings & tuning

Every worldgen and balance constant lives in `game/config.js` as `Fortress.CONFIG`, and the
menu's **⚙ Advanced parameters** panel edits them live (Apply & regenerate previews, Reset to
defaults reverts). Defaults reproduce the classic game exactly. Grouped controls cover:

- **World generation** — terrain mode, fractal octaves/roughness, relief (m), base height, fine detail.
- **Erosion** *(fractal)* — droplet count & lifetime, inertia, sediment capacity, erode/deposit
  rates, evaporation, gravity, brush radius.
- **Filling & weathering** *(fractal)* — priority-flood drain slope, fill strength, smoothing passes/blend.
- **Organic mesh surface** — seeded point count, Lloyd relaxation rounds, cliff densification
  count/slope/budget, boundary hull spacing.
- **Economy** — starting gold, keep/house HP, civilians per house, income formula, gate bonus,
  level grants, houses per level.
- **Difficulty & enemies** — per-difficulty multipliers, HP/damage growth per level, global
  enemy HP/damage/count multipliers, tower damage multiplier, uphill melee falloff.
- **Field defenses** — oil, stakes, moat, and sapper numbers.
- **Siege pathing weights** — flow-field costs for moats, walls, gates and towers.

Tweaks apply when you generate land (🎲 New land / Apply) or **Begin the Defense**. You can
also poke `Fortress.CONFIG` directly from the dev console.

## Engine architecture

```
game.html            - Game page and UI shell
libs/three.min.js    - Three.js r128 (vendored)
libs/d3-delaunay.min.js - Delaunay/Voronoi for the organic terrain mesh (vendored)
game/core.js         - Grid constants, seeded PRNG, supercover raster, binary heap
game/config.js       - Central tunable config (worldgen + balance) and the settings UI schema
game/terrain.js      - Diamond-square fractal; forced box-canyon carving OR eroded/filled
                       fractal landform; cliff masking
game/pathfinding.js  - Dijkstra flow field; soft (HP+elevation weighted) walls, hard cliffs
game/walls.js        - Wall drawing with terrain blending & organic snapping, tiers, gates,
                       towers, traps, enclosure detection (cliffs count as walls)
game/units.js        - Attacker types across three eras, projectiles
game/waves.js        - Wave composition and era progression
game/engine.js       - Game state machine, economy, combat resolution, input tools
game/render3d.js     - Low-poly 3D renderer: organic terrain surface (Lloyd-relaxed
                       point set + Delaunay triangulation, densified along cliffs),
                       extruded wall curtains, instanced units, RTS camera, shadows
game/ui.js           - DOM wiring, camera controls, raycast picking, HP-bar overlay
```

The visible terrain has no rectangular lattice: a seeded point cloud is evened out
with Lloyd relaxation (centroidal Voronoi, two rounds by default), extra points are seeded
along steep ground so cliff faces stay crisp, and the set is Delaunay-triangulated
into irregular flat-shaded facets. All four knobs — seed-point count, relaxation rounds,
densification count and slope threshold — are configurable in the settings panel. The simulation runs on an invisible 1 m grid
underneath purely as a navigation/enclosure acceleration structure; the presentation
never shows it. Enclosure
detection flood-fills from the map border with the same movement rules attackers use
(cliffs and walls both block), so a house is "protected" exactly when no attacker can
walk to it.

---

# Contour Map Creator

A web-based application for generating topographic contour maps from elevation data using intelligent sampling and advanced algorithms.

## Features

- **Interactive Map Selection**: Right-click and drag to define any rectangular area on the map
- **Intelligent Elevation Sampling**: Multi-stage sampling strategy for optimal data collection
- **Adaptive Refinement**: Automatically adds sample points in areas with high elevation variation
- **CONREC Contouring**: Industry-standard algorithm for generating smooth contour lines
- **Line Simplification**: Interactive Visvalingam's algorithm to reduce complexity while preserving shape
- **SVG Export**: Export high-quality vector graphics suitable for printing or further editing

## How It Works

### 1. Area Selection

- **Right-click and drag** on the map to select a rectangular area
- The selection box appears with a dashed blue border
- Selected coordinates are displayed in the control panel
- You can reselect by right-clicking and dragging again

### 2. Intelligent Sampling Strategy

The application uses a sophisticated three-stage sampling approach:

#### Stage 1: Edge Sampling
- Distributes `N` samples along the edges of the selected rectangle
- Samples are arranged as `X × Y = N` where `X/horizontal_length ≈ Y/vertical_length`
- This ensures edge samples have similar spacing regardless of the aspect ratio
- Provides accurate boundary definition for the contour map

#### Stage 2: Interior Sampling (Poisson-Disc)
- Generates evenly distributed points within the selected area
- Uses Poisson-disc sampling algorithm to ensure minimum distance between points
- Avoids clustering and maintains good spatial coverage
- Default: 100 interior samples (configurable)

#### Stage 3: Adaptive Refinement
- Analyzes elevation differences between all neighboring sample points
- Calculates the 95th percentile of elevation differences
- Adds additional sample points midway between any pair with elevation diff ≥ 95th percentile
- Ensures adequate sampling in areas with rapid elevation changes (cliffs, valleys, etc.)

### 3. Elevation Data

- Elevation data is fetched from the **Open-Elevation API**
- Free service, no API key required
- Uses SRTM (Shuttle Radar Topography Mission) data
- Global coverage with ~30m resolution
- Processes in batches of 200 points to avoid rate limiting

### 4. Grid Interpolation

- Creates a regular grid (default: 50×50) covering the selected area
- Uses **Inverse Distance Weighting (IDW)** interpolation
- Each grid point's elevation is calculated from nearby sample points
- Weighting: `weight = 1/distance²`
- Produces smooth elevation surface from scattered samples

### 5. Contour Generation (CONREC Algorithm)

The CONREC (Contour Reconstruction) algorithm:

- Classic algorithm by Paul Bourke
- Processes each grid cell independently
- Identifies where contour lines intersect cell edges
- Uses marching squares approach with linear interpolation
- Generates line segments that are then connected into polylines
- Handles all topological cases correctly

**User Controls:**
- **Contour Interval**: Vertical distance between contour lines (default: 10m)
- Smaller intervals = more detailed contours
- Larger intervals = simpler, less cluttered map

### 6. Line Simplification (Visvalingam's Algorithm)

Visvalingam's algorithm progressively simplifies polylines:

- Calculates "effective area" for each point (area of triangle formed with neighbors)
- Removes points with smallest areas first
- **Avoids creating intersections** during simplification
- Preserves overall shape while reducing vertex count

**User Controls:**
- **Simplification Slider**: 0% (original) to 100% (maximum simplification)
- Real-time preview of simplified contours
- Helps reduce file size for export
- Maintains visual quality while removing unnecessary detail

### 7. Visualization

- Contour lines are color-coded by elevation
- Color gradient: Blue (low elevation) → Red (high elevation)
- Uses HSL color space for smooth gradients
- Overlaid on Esri World Imagery basemap
- Semi-transparent lines (70% opacity) for better visibility

### 8. SVG Export

Exports contours as Scalable Vector Graphics:

- Fixed width of 1000px, height preserves aspect ratio
- All contour lines with original colors
- Each path includes `data-elevation` attribute
- Clean, editable format
- Suitable for printing, GIS software, or graphic design tools

## Technical Architecture

### Files

```
index.html          - Main HTML structure and UI
app.js             - Main application logic and orchestration
poisson-disc.js    - Poisson-disc sampling implementation
conrec.js          - CONREC contouring algorithm
visvalingam.js     - Visvalingam's line simplification
README.md          - This documentation file
```

### Dependencies

**External:**
- [Leaflet 1.9.4](https://leafletjs.com/) - Interactive mapping library
- [Esri World Imagery](https://www.arcgis.com/) - Satellite basemap tiles
- [Open-Elevation API](https://open-elevation.com/) - Free elevation data service

**No jQuery, no cookies, no tracking.**

### Browser Compatibility

- Modern browsers with ES6+ support required
- Chrome 80+, Firefox 75+, Safari 13+, Edge 80+
- Requires JavaScript enabled
- Works on desktop and tablet (right-click may vary on touch devices)

## Usage Guide

### Quick Start

1. **Open** `index.html` in a web browser
2. **Navigate** to your area of interest on the map
3. **Right-click and drag** to select a rectangular area
4. **Adjust parameters** in the control panel:
   - Total Edge Samples: 20-500 (default: 100)
   - Interior Samples: 20-1000 (default: 100)
   - Contour Interval: 1-100 meters (default: 10)
5. **Click "Generate Contours"** and wait for processing
6. **Adjust simplification** slider if desired
7. **Click "Export SVG"** to download your map

### Tips for Best Results

**Area Selection:**
- Start with small areas (~1-5 km²) to test
- Very large areas may exceed API rate limits
- Square or near-square selections work best

**Sampling:**
- More samples = more detail but slower processing
- Mountainous terrain: use 200+ total samples
- Flat terrain: 100 samples usually sufficient
- Increase interior samples for complex topography

**Contour Interval:**
- Mountainous: 10-50m intervals
- Hilly terrain: 5-20m intervals
- Flat areas: 1-5m intervals
- Match interval to expected elevation range

**Simplification:**
- Start at 0% to see full detail
- Gradually increase until acceptable
- 30-50% typically provides good balance
- Use higher values (70%+) for overview maps

## Algorithms Explained

### Poisson-Disc Sampling

**Purpose**: Generate evenly spaced random points

**Process**:
1. Start with random point in center region
2. Generate candidates around each active point
3. Accept candidates that maintain minimum distance from all others
4. Use spatial grid for efficient neighbor queries
5. Continue until target count reached

**Advantages**:
- Better coverage than pure random sampling
- Avoids clustering
- More efficient than dart-throwing methods
- Blue noise properties

### CONREC Algorithm

**Purpose**: Extract contour lines from gridded data

**Process**:
1. For each grid cell, determine corner elevations
2. Calculate which edges the contour level crosses
3. Use lookup table for topological cases
4. Linearly interpolate exact crossing points
5. Generate line segments
6. Connect segments into continuous polylines

**Advantages**:
- Proven, robust algorithm
- Handles all cases correctly
- Efficient for regular grids
- No artifacts at cell boundaries

### Inverse Distance Weighting (IDW)

**Purpose**: Interpolate elevation at grid points from scattered samples

**Formula**: `elevation = Σ(weight_i × elevation_i) / Σ(weight_i)`

Where: `weight_i = 1 / distance_i²`

**Advantages**:
- Simple and intuitive
- Exact at sample points
- Smooth interpolation
- Fast computation

### Visvalingam's Algorithm

**Purpose**: Simplify polylines while preserving shape

**Process**:
1. Calculate effective area for each point (triangle area with neighbors)
2. Sort points by area
3. Remove points with smallest areas first
4. Before removing, check if it would create intersections
5. Skip removal if intersections would occur
6. Continue until threshold reached

**Advantages**:
- Shape-preserving
- Avoids self-intersections
- Better than Douglas-Peucker for closed curves
- Visually pleasing results

## Configuration Options

### Sampling Parameters

**Total Edge Samples (N)**
- Range: 20-500
- Default: 100
- Controls boundary accuracy
- Higher = better edge definition

**Interior Samples (Poisson-disc)**
- Range: 20-1000
- Default: 100
- Controls interior coverage
- Higher = more accurate interpolation

### Contour Parameters

**Contour Interval (meters)**
- Range: 1-100
- Default: 10
- Vertical spacing between lines
- Should match terrain scale

### Simplification

**Simplification Percentage**
- Range: 0-100%
- Default: 0% (no simplification)
- Controls detail vs. file size
- Interactive real-time preview

## API Usage

### Open-Elevation API

**Endpoint**: `https://api.open-elevation.com/api/v1/lookup`

**Request**:
```json
{
  "locations": [
    {"latitude": 40.7128, "longitude": -74.0060},
    {"latitude": 40.7129, "longitude": -74.0061}
  ]
}
```

**Response**:
```json
{
  "results": [
    {"latitude": 40.7128, "longitude": -74.0060, "elevation": 10},
    {"latitude": 40.7129, "longitude": -74.0061, "elevation": 11}
  ]
}
```

**Limits**:
- Free to use, no API key
- Reasonable rate limiting
- Batch requests recommended (200 points max per request)

## Performance Considerations

**Processing Time** (approximate):
- 200 samples: 5-10 seconds
- 500 samples: 15-30 seconds
- 1000+ samples: 30-60 seconds

**Bottlenecks**:
1. Elevation API requests (network)
2. IDW interpolation (O(n×m) where n=samples, m=grid points)
3. CONREC contouring (O(grid cells × contour levels))
4. Rendering many contour lines (browser dependent)

**Optimization Tips**:
- Keep sample counts reasonable (<500 for interactive use)
- Larger contour intervals = fewer lines = faster rendering
- Use simplification to reduce rendering complexity
- Consider smaller areas for better performance

## Troubleshooting

**"No area selected" error**
- Ensure you right-click (not left-click) and drag
- Selection box should appear while dragging
- Try selecting a smaller area

**"Failed to fetch elevation data" error**
- Check internet connection
- Try a smaller area (fewer samples)
- Wait a moment and try again (rate limiting)
- Some areas may not have coverage

**Contours look wrong or missing**
- Increase sample count for complex terrain
- Reduce contour interval to see more lines
- Check if area is over water (may return sea level)
- Try different area

**Export not working**
- Ensure contours are generated first
- Check browser allows downloads
- Try different browser if issues persist

**Slow performance**
- Reduce number of samples
- Increase contour interval
- Use smaller area
- Apply simplification before export

## Future Enhancements

Possible improvements for future versions:

- [ ] Alternative elevation APIs (USGS, Mapbox, etc.)
- [ ] Label contour lines with elevations
- [ ] Multiple export formats (GeoJSON, KML, DXF)
- [ ] Custom color schemes
- [ ] Save/load project state
- [ ] Batch processing multiple areas
- [ ] 3D visualization option
- [ ] Hillshade rendering
- [ ] Profile/cross-section tool

## License

This project is provided as-is for educational and personal use.

### Third-Party Components:

- **Leaflet**: BSD-2-Clause License
- **CONREC Algorithm**: Public domain (Paul Bourke)
- **Visvalingam's Algorithm**: Public domain
- **Open-Elevation**: Public domain (SRTM data)

## Credits

**Algorithms**:
- CONREC: Paul Bourke
- Visvalingam-Whyatt: M. Visvalingam and J. D. Whyatt
- Poisson-Disc: Robert Bridson

**Data Sources**:
- Elevation: Open-Elevation API / SRTM
- Basemap: Esri World Imagery

**Mapping Library**:
- Leaflet.js

## Contributing

To contribute improvements:

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## Contact & Support

For issues, questions, or suggestions, please open an issue on the project repository.

---

**Version**: 1.0.0
**Last Updated**: 2025-11-25
