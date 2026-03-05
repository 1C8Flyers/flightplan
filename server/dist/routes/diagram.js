import { buildRunwayPolygon, lonLatToMercator, mercatorToLonLat, metersFromFeet, normalizeVector, perpendicularVector, projectFromHeading } from '../diagram/geometry.js';
const cacheTtlMs = 5 * 60 * 1000;
const diagramCache = new Map();
function emptyFeatureCollection() {
    return {
        type: 'FeatureCollection',
        features: []
    };
}
function normalizeHeading(heading) {
    const normalized = ((heading % 360) + 360) % 360;
    return normalized === 0 ? 360 : normalized;
}
function oppositeHeading(heading) {
    return normalizeHeading(heading + 180);
}
function runwayId(leIdent, heIdent) {
    return `${leIdent}/${heIdent}`;
}
function toRunwayGeom(runway) {
    return {
        airportIdent: runway.airportIdent,
        leIdent: runway.leIdent,
        heIdent: runway.heIdent,
        lengthFt: runway.lengthFt,
        widthFt: runway.widthFt,
        surface: runway.surface,
        lighted: runway.lighted,
        closed: runway.closed,
        leLat: runway.leLat ?? undefined,
        leLon: runway.leLon ?? undefined,
        heLat: runway.heLat ?? undefined,
        heLon: runway.heLon ?? undefined,
        leTrueHeadingDeg: runway.leHeadingDeg ?? undefined,
        heTrueHeadingDeg: runway.heHeadingDeg ?? undefined,
        leDisplacedThresholdFt: runway.leDisplacedThresholdFt ?? undefined,
        heDisplacedThresholdFt: runway.heDisplacedThresholdFt ?? undefined,
        runwayElevationFt: runway.runwayElevationFt ?? undefined
    };
}
function resolveRunwayEndpoints(runway, airport) {
    if (runway.leLat != null && runway.leLon != null && runway.heLat != null && runway.heLon != null) {
        return {
            le: { lat: runway.leLat, lon: runway.leLon },
            he: { lat: runway.heLat, lon: runway.heLon },
            fidelity: 'measured',
            headingDeg: runway.leTrueHeadingDeg ?? null
        };
    }
    const headingDeg = runway.leTrueHeadingDeg ?? (runway.heTrueHeadingDeg != null ? oppositeHeading(runway.heTrueHeadingDeg) : null);
    if (headingDeg == null || runway.lengthFt <= 0) {
        return null;
    }
    const halfLengthMeters = metersFromFeet(runway.lengthFt) / 2;
    const he = projectFromHeading(airport.lon, airport.lat, headingDeg, halfLengthMeters);
    const le = projectFromHeading(airport.lon, airport.lat, oppositeHeading(headingDeg), halfLengthMeters);
    return {
        le: { lat: le.lat, lon: le.lon },
        he: { lat: he.lat, lon: he.lon },
        fidelity: 'estimated',
        headingDeg
    };
}
function buildRunwayLabels(runway, leLon, leLat, heLon, heLat, headingDeg) {
    const leMerc = lonLatToMercator(leLon, leLat);
    const heMerc = lonLatToMercator(heLon, heLat);
    const runwayVector = normalizeVector({ x: heMerc.x - leMerc.x, y: heMerc.y - leMerc.y });
    const offsetMeters = Math.max(30, metersFromFeet(runway.widthFt) * 1.2);
    const leLabelPoint = {
        x: leMerc.x - runwayVector.x * offsetMeters,
        y: leMerc.y - runwayVector.y * offsetMeters
    };
    const heLabelPoint = {
        x: heMerc.x + runwayVector.x * offsetMeters,
        y: heMerc.y + runwayVector.y * offsetMeters
    };
    const leLonLat = mercatorToLonLat(leLabelPoint.x, leLabelPoint.y);
    const heLonLat = mercatorToLonLat(heLabelPoint.x, heLabelPoint.y);
    const leLabel = {
        type: 'Feature',
        geometry: {
            type: 'Point',
            coordinates: [leLonLat.lon, leLonLat.lat]
        },
        properties: {
            text: runway.leIdent,
            rotationDeg: headingDeg,
            end: 'LE',
            runwayId: runwayId(runway.leIdent, runway.heIdent)
        }
    };
    const heLabel = {
        type: 'Feature',
        geometry: {
            type: 'Point',
            coordinates: [heLonLat.lon, heLonLat.lat]
        },
        properties: {
            text: runway.heIdent,
            rotationDeg: oppositeHeading(headingDeg),
            end: 'HE',
            runwayId: runwayId(runway.leIdent, runway.heIdent)
        }
    };
    return [leLabel, heLabel];
}
function buildClosedRunwayOverlay(runwayPolygon, runway) {
    if (!runway.closed || runwayPolygon.length < 4) {
        return [];
    }
    return [
        {
            type: 'Feature',
            geometry: {
                type: 'LineString',
                coordinates: [runwayPolygon[0], runwayPolygon[2]]
            },
            properties: {
                kind: 'closed-x',
                runwayId: runwayId(runway.leIdent, runway.heIdent)
            }
        },
        {
            type: 'Feature',
            geometry: {
                type: 'LineString',
                coordinates: [runwayPolygon[1], runwayPolygon[3]]
            },
            properties: {
                kind: 'closed-x',
                runwayId: runwayId(runway.leIdent, runway.heIdent)
            }
        }
    ];
}
function buildDisplacedThresholdOverlay(runway, leLon, leLat, heLon, heLat) {
    const overlays = [];
    const leMerc = lonLatToMercator(leLon, leLat);
    const heMerc = lonLatToMercator(heLon, heLat);
    const runwayVector = normalizeVector({ x: heMerc.x - leMerc.x, y: heMerc.y - leMerc.y });
    const perpVector = perpendicularVector(runwayVector);
    const halfWidthMeters = Math.max(2, metersFromFeet(runway.widthFt) / 2);
    const addThreshold = (thresholdFt, start, direction, end) => {
        if (thresholdFt == null || thresholdFt <= 0) {
            return;
        }
        const point = {
            x: start.x + runwayVector.x * metersFromFeet(thresholdFt) * direction,
            y: start.y + runwayVector.y * metersFromFeet(thresholdFt) * direction
        };
        const left = mercatorToLonLat(point.x + perpVector.x * halfWidthMeters, point.y + perpVector.y * halfWidthMeters);
        const right = mercatorToLonLat(point.x - perpVector.x * halfWidthMeters, point.y - perpVector.y * halfWidthMeters);
        overlays.push({
            type: 'Feature',
            geometry: {
                type: 'LineString',
                coordinates: [[left.lon, left.lat], [right.lon, right.lat]]
            },
            properties: {
                kind: 'displaced-threshold',
                end,
                thresholdFt,
                runwayId: runwayId(runway.leIdent, runway.heIdent)
            }
        });
    };
    addThreshold(runway.leDisplacedThresholdFt, leMerc, 1, 'LE');
    addThreshold(runway.heDisplacedThresholdFt, heMerc, -1, 'HE');
    return overlays;
}
function buildSchematic(airport, runwayFeatures) {
    const apronCollection = emptyFeatureCollection();
    const taxiCollection = emptyFeatureCollection();
    if (!runwayFeatures.features.length) {
        return { apron: apronCollection, taxi: taxiCollection };
    }
    const longestRunway = [...runwayFeatures.features]
        .sort((a, b) => Number(b.properties.lengthFt ?? 0) - Number(a.properties.lengthFt ?? 0))[0];
    const runwayCoords = longestRunway.geometry.type === 'Polygon'
        ? longestRunway.geometry.coordinates[0]
        : null;
    if (!runwayCoords || runwayCoords.length < 4) {
        return { apron: apronCollection, taxi: taxiCollection };
    }
    const runwayStart = lonLatToMercator(runwayCoords[0][0], runwayCoords[0][1]);
    const runwayEnd = lonLatToMercator(runwayCoords[1][0], runwayCoords[1][1]);
    const runwayVector = normalizeVector({ x: runwayEnd.x - runwayStart.x, y: runwayEnd.y - runwayStart.y });
    const normalVector = perpendicularVector(runwayVector);
    const arpMerc = lonLatToMercator(airport.lon, airport.lat);
    const apronCenter = {
        x: arpMerc.x + normalVector.x * 180,
        y: arpMerc.y + normalVector.y * 180
    };
    const halfLength = 120;
    const halfWidth = 70;
    const apronCornersMerc = [
        {
            x: apronCenter.x + runwayVector.x * halfLength + normalVector.x * halfWidth,
            y: apronCenter.y + runwayVector.y * halfLength + normalVector.y * halfWidth
        },
        {
            x: apronCenter.x - runwayVector.x * halfLength + normalVector.x * halfWidth,
            y: apronCenter.y - runwayVector.y * halfLength + normalVector.y * halfWidth
        },
        {
            x: apronCenter.x - runwayVector.x * halfLength - normalVector.x * halfWidth,
            y: apronCenter.y - runwayVector.y * halfLength - normalVector.y * halfWidth
        },
        {
            x: apronCenter.x + runwayVector.x * halfLength - normalVector.x * halfWidth,
            y: apronCenter.y + runwayVector.y * halfLength - normalVector.y * halfWidth
        }
    ];
    const apronPolygon = [...apronCornersMerc, apronCornersMerc[0]].map((point) => {
        const lonLat = mercatorToLonLat(point.x, point.y);
        return [lonLat.lon, lonLat.lat];
    });
    apronCollection.features.push({
        type: 'Feature',
        geometry: {
            type: 'Polygon',
            coordinates: [apronPolygon]
        },
        properties: {
            kind: 'schematic-apron',
            source: 'NASR',
            fidelity: 'estimated'
        }
    });
    const runwayMidpoints = runwayFeatures.features
        .map((feature) => {
        if (feature.geometry.type !== 'Polygon') {
            return null;
        }
        const coords = feature.geometry.coordinates[0];
        if (!coords || coords.length < 4) {
            return null;
        }
        const p1 = lonLatToMercator(coords[0][0], coords[0][1]);
        const p2 = lonLatToMercator(coords[2][0], coords[2][1]);
        return {
            id: String(feature.properties.id ?? ''),
            midpoint: {
                x: (p1.x + p2.x) / 2,
                y: (p1.y + p2.y) / 2
            }
        };
    })
        .filter((value) => Boolean(value))
        .slice(0, 3);
    for (const [index, runway] of runwayMidpoints.entries()) {
        const bendPoint = {
            x: apronCenter.x + runwayVector.x * (30 + index * 15),
            y: apronCenter.y + runwayVector.y * (30 + index * 15)
        };
        const p1 = mercatorToLonLat(apronCenter.x, apronCenter.y);
        const p2 = mercatorToLonLat(bendPoint.x, bendPoint.y);
        const p3 = mercatorToLonLat(runway.midpoint.x, runway.midpoint.y);
        taxiCollection.features.push({
            type: 'Feature',
            geometry: {
                type: 'LineString',
                coordinates: [[p1.lon, p1.lat], [p2.lon, p2.lat], [p3.lon, p3.lat]]
            },
            properties: {
                kind: 'schematic-taxi',
                source: 'NASR',
                fidelity: 'estimated',
                runwayId: runway.id
            }
        });
    }
    return {
        apron: apronCollection,
        taxi: taxiCollection
    };
}
function buildDiagram(airport, runwayRecords, includeSchematic) {
    const runways = { type: 'FeatureCollection', features: [] };
    const runwayLabels = { type: 'FeatureCollection', features: [] };
    const overlays = { type: 'FeatureCollection', features: [] };
    const airportRunways = runwayRecords
        .filter((runway) => runway.airportIdent === airport.ident)
        .sort((a, b) => b.lengthFt - a.lengthFt);
    for (const runwayRecord of airportRunways) {
        const runway = toRunwayGeom(runwayRecord);
        const resolved = resolveRunwayEndpoints(runway, airport);
        if (!resolved) {
            continue;
        }
        const runwayPolygon = buildRunwayPolygon(resolved.le.lon, resolved.le.lat, resolved.he.lon, resolved.he.lat, runway.widthFt);
        if (!runwayPolygon.length) {
            continue;
        }
        const headingDeg = resolved.headingDeg ?? runway.leTrueHeadingDeg ?? 0;
        runways.features.push({
            type: 'Feature',
            geometry: {
                type: 'Polygon',
                coordinates: [runwayPolygon]
            },
            properties: {
                id: runwayId(runway.leIdent, runway.heIdent),
                surface: runway.surface,
                lengthFt: runway.lengthFt,
                widthFt: runway.widthFt,
                lighted: runway.lighted,
                closed: runway.closed,
                source: 'NASR',
                fidelity: resolved.fidelity
            }
        });
        const labels = buildRunwayLabels(runway, resolved.le.lon, resolved.le.lat, resolved.he.lon, resolved.he.lat, headingDeg);
        runwayLabels.features.push(...labels);
        overlays.features.push(...buildClosedRunwayOverlay(runwayPolygon, runway));
        overlays.features.push(...buildDisplacedThresholdOverlay(runway, resolved.le.lon, resolved.le.lat, resolved.he.lon, resolved.he.lat));
    }
    const schematic = includeSchematic ? buildSchematic(airport, runways) : {
        apron: emptyFeatureCollection(),
        taxi: emptyFeatureCollection()
    };
    return {
        airport: {
            ident: airport.ident,
            name: airport.name,
            arp: [airport.lon, airport.lat]
        },
        runways,
        runwayLabels,
        overlays,
        schematic
    };
}
export function registerDiagramRoutes(app, deps) {
    app.get('/api/airports/:ident/diagram', async (req, res) => {
        try {
            const ident = String(req.params.ident ?? '').trim().toUpperCase();
            if (!/^[A-Z0-9]{2,6}$/.test(ident)) {
                res.status(400).json({ error: 'Invalid airport ident.' });
                return;
            }
            const includeSchematic = String(req.query.schematic ?? '0') === '1';
            const cacheKey = `${ident}:${includeSchematic ? '1' : '0'}`;
            const cached = diagramCache.get(cacheKey);
            if (cached && Date.now() - cached.loadedAt < cacheTtlMs) {
                res.json(cached.data);
                return;
            }
            const [airports, runways] = await Promise.all([
                deps.fetchAirportsDataset(),
                deps.fetchRunwaysDataset()
            ]);
            const airport = airports.find((candidate) => candidate.ident === ident);
            if (!airport) {
                res.status(404).json({ error: `Airport not found: ${ident}` });
                return;
            }
            const diagram = buildDiagram(airport, runways, includeSchematic);
            diagramCache.set(cacheKey, {
                loadedAt: Date.now(),
                data: diagram
            });
            res.json(diagram);
        }
        catch (error) {
            res.status(500).json({ error: error.message });
        }
    });
}
