// Fixed positions for the relationship graph. Second-ring people are grouped by
// their first connecting friend so that each group sits next to its first-ring node.

export const VIEW_BOX_SIZE = 600;
export const CENTER = { x: 300, y: 300 };
export const RING_RADIUS = { 1: 125, 2: 225 };

// Angles in degrees on the floor; 0 points right and 90 points toward the viewer.
// The layout is rotated so nobody stands directly behind (-90) or in front of (90) the
// centre: in the tilted 3D view the centre avatar would hide whoever stands behind it.
const ANGLES = {
  u01: -45,
  u02: 60,
  u03: 195,
  u04: -70,
  u05: -20,
  u06: 35,
  u08: 80,
  u07: 170,
  u09: 220,
};

export function positionFor(personId, distance) {
  if (distance === 0) {
    return { ...CENTER };
  }
  const angle = ANGLES[personId];
  const radius = RING_RADIUS[distance];
  if (angle === undefined || radius === undefined) {
    return null;
  }
  const radians = (angle * Math.PI) / 180;
  return {
    x: round(CENTER.x + radius * Math.cos(radians)),
    y: round(CENTER.y + radius * Math.sin(radians)),
  };
}

// Layout units per world unit in the 3D scene: the outer ring lands about 4.7 units from the centre.
export const LAYOUT_UNITS_PER_WORLD_UNIT = 48;

export function toWorld(layoutUnits) {
  return layoutUnits / LAYOUT_UNITS_PER_WORLD_UNIT;
}

// 3D sizes in world units, by distance from the viewer.
export const FLOOR_RADIUS = 5.7;
export const AVATAR_RADIUS = { 0: 0.62, 1: 0.5, 2: 0.44 };
export const FRAME_WIDTH = { 0: 0.09, 1: 0.06, 2: 0.06 };

// Returns a Map of person id -> {x, y}; people without a fixed slot are omitted.
export function computePositions(nodes) {
  const positions = new Map();
  for (const node of nodes) {
    const position = positionFor(node.id, node.distance);
    if (position !== null) {
      positions.set(node.id, position);
    }
  }
  return positions;
}

function round(value) {
  return Math.round(value * 10) / 10;
}
