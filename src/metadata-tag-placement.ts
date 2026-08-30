/** Geometry primitives used by the metadata tag popover.
 *
 * Keeping placement independent of the DOM makes the edge/clamp/flip rules
 * deterministic and prevents browser Range quirks from leaking into layout.
 */
export interface MetadataTagRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width?: number;
  height?: number;
}

export interface MetadataTagPopoverPlacementInput {
  selection: MetadataTagRect;
  popover: Pick<MetadataTagRect, 'width' | 'height'>;
  viewport: { width: number; height: number };
  gutter?: number;
  gap?: number;
}

export interface MetadataTagPopoverPlacement {
  x: number;
  y: number;
  above: boolean;
}

const finiteOr = (value: number | undefined, fallback: number): number => Number.isFinite(value) ? value! : fallback;
const clamp = (value: number, min: number, max: number): number => Math.min(Math.max(value, min), max);

/** Place the popover so its right edge follows the terminal selected line. */
export function metadataTagPopoverPlacement(input: MetadataTagPopoverPlacementInput): MetadataTagPopoverPlacement {
  const gutter = Math.max(0, finiteOr(input.gutter, 8));
  const gap = Math.max(0, finiteOr(input.gap, 8));
  const viewportWidth = Math.max(0, finiteOr(input.viewport.width, 0));
  const viewportHeight = Math.max(0, finiteOr(input.viewport.height, 0));
  const width = Math.max(0, finiteOr(input.popover.width, 0));
  const height = Math.max(0, finiteOr(input.popover.height, 0));
  const minX = gutter;
  const maxX = Math.max(minX, viewportWidth - gutter - width);
  const x = clamp(finiteOr(input.selection.right, input.selection.left) - width, minX, maxX);
  const below = finiteOr(input.selection.bottom, input.selection.top) + gap;
  const above = finiteOr(input.selection.top, input.selection.bottom) - height - gap;
  const maxY = Math.max(gutter, viewportHeight - gutter - height);
  // Prefer below; only flip when below would leave the viewport and a full
  // popover fits above the selected line.
  const shouldFlip = below + height > viewportHeight - gutter && above >= gutter;
  const y = clamp(shouldFlip ? above : below, gutter, maxY);
  return { x, y, above: shouldFlip };
}
