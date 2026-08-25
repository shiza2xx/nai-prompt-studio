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
 * The central artist group can become wide when four anchors are pinned. These
 * perimeter slots therefore use the left and right quarters of the scene and
 * two compact rows. At the desktop minimum size this leaves a real gap around
 * the central group instead of relying on overflow clipping.
 */
const PERIMETER_SLOTS = [
  { x: 25, y: 25 }, { x: 75, y: 25 },
  { x: 25, y: 75 }, { x: 75, y: 75 },
  { x: 15.5, y: 25 }, { x: 84.5, y: 25 },
  { x: 15.5, y: 75 }, { x: 84.5, y: 75 },
  { x: 6, y: 25 }, { x: 94, y: 25 },
  { x: 6, y: 75 }
] as const;

/** Keep low weights legible while reserving the largest silhouette for the primary artist. */
export function mixCompanionScale(value: unknown): number {
  const weight = Math.max(0.1, Math.min(1, Number(value) || 1));
  return Number((0.84 + weight * 0.16).toFixed(3));
}

/** Distribute up to eleven companions on a collision-safe perimeter. */
export function mixOrbitLayout(total: number): MixOrbitLayout {
  const count = Math.min(PERIMETER_SLOTS.length, Math.max(0, Math.floor(Number(total) || 0)));
  if (!count) return { height: 420, ringCount: 0, placements: [] };
  const placements = PERIMETER_SLOTS.slice(0, count).map((slot, index): MixOrbitPlacement => ({
    index,
    row: slot.y < 50 ? 'top' : 'bottom',
    x: slot.x,
    y: slot.y
  }));
  return { height: 430, ringCount: count > 2 ? 2 : 1, placements };
}
