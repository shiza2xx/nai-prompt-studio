export interface MixOrbitPlacement {
  index: number;
  ring: number;
  angle: number;
  radius: number;
  radiusCap: number;
}

export interface MixOrbitLayout {
  height: number;
  ringCount: number;
  placements: MixOrbitPlacement[];
}

const DISTANCE_VARIANCE = [0.96, 1.035, 0.985, 1.055, 1, 0.97] as const;
const RING_RADIUS_CAPS = [150, 190, 228] as const;
const CARD_HALF_HEIGHT_RESERVE = 150;

/** Keep low weights legible while reserving the largest silhouette for the primary artist. */
export function mixCompanionScale(value: unknown): number {
  const weight = Math.max(0.1, Math.min(1, Number(value) || 1));
  return Number((0.84 + weight * 0.16).toFixed(3));
}

/** Distribute companion cards across deterministic, slightly irregular concentric orbits. */
export function mixOrbitLayout(total: number): MixOrbitLayout {
  const count = Math.max(0, Math.floor(Number(total) || 0));
  if (!count) return { height: 560, ringCount: 0, placements: [] };

  const ringCount = Math.max(1, Math.ceil(count / 6));
  const height = 760 + (ringCount - 1) * 180;
  const heightSafeCap = Math.max(0, Math.floor(height / 2 - CARD_HALF_HEIGHT_RESERVE));
  const baseSize = Math.floor(count / ringCount);
  const remainder = count % ringCount;
  const ringSizes = Array.from({ length: ringCount }, (_, ring) => baseSize + (ring >= ringCount - remainder ? 1 : 0));
  const placements: MixOrbitPlacement[] = [];
  let index = 0;

  for (let ring = 0; ring < ringCount; ring += 1) {
    const ringSize = ringSizes[ring];
    const progress = ringCount === 1 ? 1 : ring / (ringCount - 1);
    const offset = count === 1 ? -12 : -90 + (ring % 2 === 0 ? 180 / ringSize : -180 / ringSize);

    for (let slot = 0; slot < ringSize; slot += 1) {
      const angleDegrees = offset + slot * 360 / ringSize;
      const variance = DISTANCE_VARIANCE[index % DISTANCE_VARIANCE.length];
      const radius = Number(((ringCount === 1 ? 38 : 20 + progress * 22) * variance).toFixed(3));
      const ringCap = ringCount === 1 || ring === ringCount - 1
        ? RING_RADIUS_CAPS[RING_RADIUS_CAPS.length - 1]
        : ring === 0
          ? RING_RADIUS_CAPS[0]
          : RING_RADIUS_CAPS[1];
      const radiusCap = Math.min(ringCap, heightSafeCap);
      placements.push({
        index,
        ring,
        angle: Number(angleDegrees.toFixed(3)),
        radius,
        radiusCap
      });
      index += 1;
    }
  }

  return { height, ringCount, placements };
}
