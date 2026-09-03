export interface MixOrbitPlacement {
  index: number;
  row: 'top' | 'bottom';
  /** Center coordinates as percentages of the live stage. */
  x: number;
  y: number;
  /** Testable collision box in stage pixels. */
  box: { left: number; top: number; width: number; height: number };
}

export interface MixOrbitBounds { width?: number; height?: number; companionWidth?: number; companionHeight?: number; anchorWidth?: number; anchorHeight?: number; gap?: number; }

export interface MixOrbitLayout {
  height: number;
  ringCount: number;
  density: 'regular' | 'compact' | 'micro';
  companionWidth: number;
  companionHeight: number;
  placements: MixOrbitPlacement[];
}

type OrbitBox = { left: number; top: number; width: number; height: number };
type OrbitSector = 'left' | 'right' | 'top' | 'bottom';

export interface WheelWeightAccumulator { remainder: number; }

/** Convert browser wheel units into a bounded pixel distance. */
export function normalizeWheelDelta(deltaY: unknown, deltaMode: unknown = 0): number {
  const value = Number(deltaY);
  if (!Number.isFinite(value) || value === 0) return 0;
  const mode = Number(deltaMode);
  const unit = mode === 1 ? 16 : mode === 2 ? 100 : 1;
  // A single physical gesture may report a very large delta. Limit each
  // event to one step while retaining small trackpad deltas in the accumulator.
  return Math.sign(value) * Math.min(48, Math.abs(value * unit));
}

/** Apply a single bounded 0.1 weight step after enough fine wheel input. */
export function stepWeightFromWheel(current: unknown, deltaY: unknown, deltaMode = 0, accumulator: WheelWeightAccumulator = { remainder: 0 }): number {
  accumulator.remainder += normalizeWheelDelta(deltaY, deltaMode);
  const threshold = 32;
  if (Math.abs(accumulator.remainder) < threshold) return Number(Math.max(0.1, Math.min(2, Number(current) || 1)).toFixed(1));
  const direction = accumulator.remainder < 0 ? 1 : -1;
  accumulator.remainder = 0;
  const value = Math.max(0.1, Math.min(2, Number(current) || 1));
  return Number(Math.max(0.1, Math.min(2, value + direction * 0.1)).toFixed(1));
}

/** Keep low weights legible while reserving the largest silhouette for the primary artist. */
export function mixCompanionScale(value: unknown): number {
  const weight = Math.max(0.1, Math.min(1, Number(value) || 1));
  return Number((0.84 + weight * 0.16).toFixed(3));
}

/** Return the remaining Artist Mix capacity after the requested anchors. */
export function mixCompanionCapacity(anchorCount: number): number {
  const boundedAnchorCount = Math.max(0, Math.min(12, Math.floor(Number(anchorCount) || 0)));
  return 12 - boundedAnchorCount;
}

/**
 * Pack measured companion cards into four disjoint sectors around the anchor.
 * Sector round-robin prevents the old bottom-row bias, while explicit card
 * dimensions keep the solver and rendered CSS silhouette in agreement.
 */
export function mixOrbitLayout(total: number, anchorCount = 1, bounds: MixOrbitBounds = {}): MixOrbitLayout {
  const anchors = Math.max(0, Math.min(12, Math.floor(Number(anchorCount) || 0)));
  const width = Math.max(1, Math.floor(bounds.width ?? 1100));
  const height = Math.max(1, Math.floor(bounds.height ?? 382));
  const gap = Math.max(8, Math.floor(bounds.gap ?? 14));
  const count = Math.min(mixCompanionCapacity(anchors), Math.max(0, Math.floor(Number(total) || 0)));
  const requestedWidth = Math.max(132, Math.floor(bounds.companionWidth ?? 164));
  const requestedHeight = Math.max(96, Math.floor(bounds.companionHeight ?? 198));
  if (!count) return { height, ringCount: 0, density: 'regular', companionWidth: requestedWidth, companionHeight: requestedHeight, placements: [] };

  // Provide immediate, deterministic coordinates before the first measured pass.
  if (bounds.width === undefined && bounds.height === undefined) {
    const safe = 10;
    const radiusX = Math.max(0, (width - requestedWidth - safe * 2) / 2) / width * 100;
    const radiusY = Math.max(0, (height - requestedHeight - safe * 2) / 2) / height * 100;
    const angles = Array.from({ length: count }, (_, index) => -Math.PI / 2 + index * Math.PI * 2 / count);
    const placements = angles.map((angle, index) => {
      const x = 50 + Math.cos(angle) * radiusX;
      const y = 50 + Math.sin(angle) * radiusY;
      return { index, row: y < 50 ? 'top' as const : 'bottom' as const, x: Number(x.toFixed(3)), y: Number(y.toFixed(3)), box: { left: Math.round(x / 100 * width - requestedWidth / 2), top: Math.round(y / 100 * height - requestedHeight / 2), width: requestedWidth, height: requestedHeight } };
    });
    return { height, ringCount: count > 2 ? 2 : 1, density: 'regular', companionWidth: requestedWidth, companionHeight: requestedHeight, placements };
  }

  const anchorWidth = bounds.anchorWidth === undefined ? Math.max(150, 172 * Math.min(anchors, 2)) : Math.max(150, Math.floor(bounds.anchorWidth));
  const anchorHeight = Math.max(1, Math.floor(bounds.anchorHeight ?? (anchors === 1 ? 286 : 190)));
  const safe = Math.max(10, Math.min(gap, 18));
  // A missing anchor has no collision box. This keeps malformed/legacy
  // companion-only data usable until the user chooses its first anchor.
  const anchorBox: OrbitBox | null = anchors
    ? { left: Math.round((width - anchorWidth) / 2), top: Math.round((height - anchorHeight) / 2), width: anchorWidth, height: anchorHeight }
    : null;

  const solve = (companionWidth: number, companionHeight: number): MixOrbitPlacement[] => {
    const spacing = companionWidth <= 132 ? 8 : gap;
    const sectors = new Map<OrbitSector, OrbitBox[]>([['left', []], ['right', []], ['top', []], ['bottom', []]]);
    const columns = Math.floor((width - safe * 2 + spacing) / (companionWidth + spacing));
    const rows = Math.floor((height - safe * 2 + spacing) / (companionHeight + spacing));
    if (columns < 1 || rows < 1) return [];
    // Pin the outer rows and columns to the safe inset, then distribute the
    // remaining space between them. Centering the whole grid with an outer
    // gap consumed the only top and bottom lanes in short windows.
    const xStep = columns > 1 ? (width - safe * 2 - companionWidth) / (columns - 1) : 0;
    const yStep = rows > 1 ? (height - safe * 2 - companionHeight) / (rows - 1) : 0;
    const xStart = columns > 1 ? safe : (width - companionWidth) / 2;
    const yStart = rows > 1 ? safe : (height - companionHeight) / 2;
    const intersects = (a: OrbitBox, b: OrbitBox): boolean => !(a.left + a.width <= b.left || b.left + b.width <= a.left || a.top + a.height <= b.top || b.top + b.height <= a.top);
    for (let row = 0; row < rows; row += 1) for (let column = 0; column < columns; column += 1) {
      const box = { left: Math.round(xStart + column * xStep), top: Math.round(yStart + row * yStep), width: companionWidth, height: companionHeight };
      if (anchorBox && intersects(box, anchorBox)) continue;
      const dx = box.left + box.width / 2 - width / 2;
      const dy = box.top + box.height / 2 - height / 2;
      const sector: OrbitSector = Math.abs(dx) >= Math.abs(dy) ? (dx < 0 ? 'left' : 'right') : (dy < 0 ? 'top' : 'bottom');
      sectors.get(sector)!.push(box);
    }
    for (const [sector, values] of sectors) values.sort((a, b) => {
      const ax = a.left + a.width / 2; const ay = a.top + a.height / 2;
      const bx = b.left + b.width / 2; const by = b.top + b.height / 2;
      const verticalOrder = sector === 'left' ? b.top - a.top : a.top - b.top;
      return Math.hypot(ax - width / 2, ay - height / 2) - Math.hypot(bx - width / 2, by - height / 2) || verticalOrder || a.left - b.left;
    });

    const activeOrder: OrbitSector[] = ['top', 'right', 'bottom', 'left'];
    const placements: MixOrbitPlacement[] = [];
    while (placements.length < count && activeOrder.some(sector => sectors.get(sector)!.length)) {
      for (const sector of activeOrder) {
        const box = sectors.get(sector)!.shift();
        if (!box) continue;
        const x = box.left + box.width / 2;
        const y = box.top + box.height / 2;
        placements.push({ index: placements.length, row: y < height / 2 ? 'top' : 'bottom', x: Number((x / width * 100).toFixed(3)), y: Number((y / height * 100).toFixed(3)), box });
        if (placements.length === count) break;
      }
    }
    return placements;
  };

  const regularWidth = Math.min(168, Math.max(154, requestedWidth));
  const regularHeight = Math.min(204, Math.max(190, requestedHeight));
  let companionWidth = regularWidth;
  let companionHeight = regularHeight;
  let density: 'regular' | 'compact' | 'micro' = 'regular';
  let placements = solve(companionWidth, companionHeight);
  if (placements.length < count) {
    density = 'compact';
    companionWidth = 124;
    companionHeight = 152;
    placements = solve(companionWidth, companionHeight);
  }
  if (placements.length < count) {
    density = 'micro';
    companionWidth = 88;
    companionHeight = 64;
    placements = solve(companionWidth, companionHeight);
  }
  return { height, ringCount: count > 2 ? 2 : 1, density, companionWidth, companionHeight, placements };
}
