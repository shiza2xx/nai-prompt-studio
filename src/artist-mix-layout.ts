export interface MixOrbitPlacement {
  index: number;
  row: 'top' | 'bottom';
  x: number;
  y: number;
}

export interface MixOrbitLayout {
  height: number;
  ringCount: number;
  placements: MixOrbitPlacement[];
}

/**
 * Companion slots are deliberately spaced in two rows. The outer bands keep
 * the center readable for up to four anchors, while the inner bands give
 * one or two anchors room for the full twelve-artist range.
 */
const FEW_ANCHOR_SLOTS = [
  { x: 5, y: 24 }, { x: 95, y: 24 },
  { x: 5, y: 76 }, { x: 95, y: 76 },
  { x: 16.25, y: 24 }, { x: 83.75, y: 24 },
  { x: 16.25, y: 76 }, { x: 83.75, y: 76 },
  { x: 27.5, y: 24 }, { x: 72.5, y: 24 },
  { x: 27.5, y: 76 }, { x: 72.5, y: 76 }
] as const;

const THREE_ANCHOR_SLOTS = [
  { x: 5, y: 24 }, { x: 95, y: 24 },
  { x: 5, y: 76 }, { x: 95, y: 76 },
  { x: 16.25, y: 24 }, { x: 83.75, y: 24 },
  { x: 16.25, y: 76 }, { x: 83.75, y: 76 },
  { x: 27.5, y: 24 }
] as const;

const FOUR_ANCHOR_SLOTS = [
  { x: 5, y: 24 }, { x: 95, y: 24 },
  { x: 5, y: 76 }, { x: 95, y: 76 },
  { x: 16.25, y: 24 }, { x: 83.75, y: 24 },
  { x: 16.25, y: 76 }, { x: 83.75, y: 76 }
] as const;

/** Keep low weights legible while reserving the largest silhouette for the primary artist. */
export function mixCompanionScale(value: unknown): number {
  const weight = Math.max(0.1, Math.min(1, Number(value) || 1));
  return Number((0.84 + weight * 0.16).toFixed(3));
}

/** Return the maximum companion count that fits the two-row native layout. */
export function mixCompanionCapacity(anchorCount: number): number {
  const boundedAnchorCount = Math.max(1, Math.min(4, Math.floor(Number(anchorCount) || 1)));
  return 12 - boundedAnchorCount;
}

/** Distribute companions on a collision-safe perimeter. */
export function mixOrbitLayout(total: number, anchorCount = 1): MixOrbitLayout {
  const boundedAnchorCount = Math.max(1, Math.min(4, Math.floor(Number(anchorCount) || 1)));
  const slots = boundedAnchorCount >= 4 ? FOUR_ANCHOR_SLOTS : boundedAnchorCount === 3 ? THREE_ANCHOR_SLOTS : FEW_ANCHOR_SLOTS;
  const count = Math.min(slots.length, mixCompanionCapacity(boundedAnchorCount), Math.max(0, Math.floor(Number(total) || 0)));
  if (!count) return { height: 334, ringCount: 0, placements: [] };
  const placements = slots.slice(0, count).map((slot, index): MixOrbitPlacement => ({
    index,
    row: slot.y < 50 ? 'top' : 'bottom',
    x: slot.x,
    y: slot.y
  }));
  return { height: 334, ringCount: count > 2 ? 2 : 1, placements };
}
