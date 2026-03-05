const EARTH_RADIUS_METERS = 6378137;
export function lonLatToMercator(lon, lat) {
    const x = (lon * Math.PI * EARTH_RADIUS_METERS) / 180;
    const clampedLat = Math.max(-85.05112878, Math.min(85.05112878, lat));
    const y = EARTH_RADIUS_METERS * Math.log(Math.tan(Math.PI / 4 + (clampedLat * Math.PI) / 360));
    return { x, y };
}
export function mercatorToLonLat(x, y) {
    const lon = (x * 180) / (Math.PI * EARTH_RADIUS_METERS);
    const lat = (Math.atan(Math.sinh(y / EARTH_RADIUS_METERS)) * 180) / Math.PI;
    return { lon, lat };
}
export function normalizeVector(vector) {
    const magnitude = Math.hypot(vector.x, vector.y);
    if (magnitude === 0) {
        return { x: 0, y: 0 };
    }
    return {
        x: vector.x / magnitude,
        y: vector.y / magnitude
    };
}
export function perpendicularVector(vector) {
    return {
        x: -vector.y,
        y: vector.x
    };
}
export function metersFromFeet(valueFt) {
    return valueFt * 0.3048;
}
export function projectFromHeading(originLon, originLat, headingDeg, distanceMeters) {
    const origin = lonLatToMercator(originLon, originLat);
    const headingRad = (headingDeg * Math.PI) / 180;
    const direction = {
        x: Math.sin(headingRad),
        y: Math.cos(headingRad)
    };
    const point = {
        x: origin.x + direction.x * distanceMeters,
        y: origin.y + direction.y * distanceMeters
    };
    const lonLat = mercatorToLonLat(point.x, point.y);
    return {
        lon: lonLat.lon,
        lat: lonLat.lat
    };
}
export function buildRunwayPolygon(leLon, leLat, heLon, heLat, widthFt) {
    const le = lonLatToMercator(leLon, leLat);
    const he = lonLatToMercator(heLon, heLat);
    const vector = normalizeVector({ x: he.x - le.x, y: he.y - le.y });
    if (vector.x === 0 && vector.y === 0) {
        return [];
    }
    const perpendicular = perpendicularVector(vector);
    const halfWidthMeters = Math.max(1, metersFromFeet(widthFt) / 2);
    const cornerA = { x: le.x + perpendicular.x * halfWidthMeters, y: le.y + perpendicular.y * halfWidthMeters };
    const cornerB = { x: he.x + perpendicular.x * halfWidthMeters, y: he.y + perpendicular.y * halfWidthMeters };
    const cornerC = { x: he.x - perpendicular.x * halfWidthMeters, y: he.y - perpendicular.y * halfWidthMeters };
    const cornerD = { x: le.x - perpendicular.x * halfWidthMeters, y: le.y - perpendicular.y * halfWidthMeters };
    const points = [cornerA, cornerB, cornerC, cornerD, cornerA].map((point) => {
        const lonLat = mercatorToLonLat(point.x, point.y);
        return [lonLat.lon, lonLat.lat];
    });
    return points;
}
export function polygonWidthMeters(polygon) {
    if (polygon.length < 4) {
        return 0;
    }
    const a = lonLatToMercator(polygon[0][0], polygon[0][1]);
    const d = lonLatToMercator(polygon[3][0], polygon[3][1]);
    return Math.hypot(a.x - d.x, a.y - d.y);
}
