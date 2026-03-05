import assert from 'node:assert/strict'
import test from 'node:test'
import { buildRunwayPolygon, polygonWidthMeters } from './geometry.js'

test('buildRunwayPolygon returns closed polygon with expected width', () => {
  const polygon = buildRunwayPolygon(-93.2218, 44.8272, -93.2192, 44.8272, 100)

  assert.equal(polygon.length, 5)
  assert.deepEqual(polygon[0], polygon[4])

  const widthMeters = polygonWidthMeters(polygon)
  const expectedWidthMeters = 100 * 0.3048
  assert.ok(Math.abs(widthMeters - expectedWidthMeters) < 2)
})
