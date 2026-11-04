import { test } from "node:test";
import assert from "node:assert/strict";
import {
  AVATAR_RADIUS,
  CENTER,
  FLOOR_RADIUS,
  FRAME_WIDTH,
  RING_RADIUS,
  VIEW_BOX_SIZE,
  computePositions,
  positionFor,
  toWorld,
} from "../src/graphLayout.js";

const NODES = [
  { id: "u00", distance: 0 },
  ...["u01", "u02", "u03"].map((id) => ({ id, distance: 1 })),
  ...["u04", "u05", "u06", "u07", "u08", "u09"].map((id) => ({ id, distance: 2 })),
];

test("every node in the demo network has a fixed position", () => {
  const positions = computePositions(NODES);
  assert.equal(positions.size, 10);
  assert.deepEqual(positions.get("u00"), CENTER);
});

test("nodes sit on the ring matching their distance", () => {
  for (const node of NODES.filter((item) => item.distance > 0)) {
    const { x, y } = positionFor(node.id, node.distance);
    const radius = Math.hypot(x - CENTER.x, y - CENTER.y);
    assert.ok(Math.abs(radius - RING_RADIUS[node.distance]) < 0.2, `${node.id} radius ${radius}`);
  }
});

test("positions stay inside the view box with room for node and label", () => {
  for (const position of computePositions(NODES).values()) {
    assert.ok(position.x >= 50 && position.x <= VIEW_BOX_SIZE - 50);
    assert.ok(position.y >= 50 && position.y <= VIEW_BOX_SIZE - 70);
  }
});

test("second-ring groups sit next to their first connecting friend", () => {
  const angleOf = (id, distance) => {
    const { x, y } = positionFor(id, distance);
    return (Math.atan2(y - CENTER.y, x - CENTER.x) * 180) / Math.PI;
  };
  const groups = { u01: ["u04", "u05"], u02: ["u06", "u08"], u03: ["u07", "u09"] };
  for (const [parent, children] of Object.entries(groups)) {
    for (const child of children) {
      const raw = Math.abs(angleOf(child, 2) - angleOf(parent, 1)) % 360;
      const gap = Math.min(raw, 360 - raw);
      assert.ok(gap <= 30, `${child} is ${gap} degrees from ${parent}`);
    }
  }
});

test("nobody stands directly behind or in front of the centre in the 3D view", () => {
  for (const node of NODES.filter((item) => item.distance > 0)) {
    const { x } = positionFor(node.id, node.distance);
    assert.ok(Math.abs(x - CENTER.x) >= 35, `${node.id} is aligned with the centre (x=${x})`);
  }
});

test("the outer ring and its avatars fit on the 3D floor", () => {
  const outerAvatar = AVATAR_RADIUS[2] + FRAME_WIDTH[2];
  assert.ok(toWorld(RING_RADIUS[2]) + outerAvatar < FLOOR_RADIUS);
});

test("unknown people are not placed", () => {
  assert.equal(positionFor("u10", 2), null);
  assert.equal(computePositions([{ id: "u99", distance: 1 }]).size, 0);
});
