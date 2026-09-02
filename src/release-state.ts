/**
 * Release-aware startup decisions are kept independent from the renderer so
 * legacy settings can be evaluated deterministically in tests and at boot.
 */

export type StartupExperience = 'guide' | 'whats-new' | 'none';

const SEMVER_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

type ParsedVersion = { major: number; minor: number; patch: number; prerelease: string[] };

function parseVersion(value: unknown): ParsedVersion | null {
  if (typeof value !== 'string') return null;
  const match = SEMVER_PATTERN.exec(value);
  if (!match) return null;
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]), prerelease: match[4]?.split('.') ?? [] };
}

function comparePrerelease(left: string[], right: string[]): number {
  if (!left.length && !right.length) return 0;
  if (!left.length) return 1;
  if (!right.length) return -1;
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const a = left[index];
    const b = right[index];
    if (a === undefined) return -1;
    if (b === undefined) return 1;
    if (a === b) continue;
    const aNumeric = /^\d+$/.test(a);
    const bNumeric = /^\d+$/.test(b);
    if (aNumeric && bNumeric) return Number(a) < Number(b) ? -1 : 1;
    if (aNumeric !== bNumeric) return aNumeric ? -1 : 1;
    return a < b ? -1 : 1;
  }
  return 0;
}

export function compareReleaseVersions(left: unknown, right: unknown): number | null {
  const a = parseVersion(left);
  const b = parseVersion(right);
  if (!a || !b) return null;
  for (const key of ['major', 'minor', 'patch'] as const) {
    if (a[key] !== b[key]) return a[key] < b[key] ? -1 : 1;
  }
  return comparePrerelease(a.prerelease, b.prerelease);
}

/**
 * A profile with no usable release marker is treated as legacy. Fresh
 * profiles are handled by the Studio Guide and never auto-open What’s New.
 */
export function shouldShowWhatsNew(existingProfile: boolean, lastSeenVersion: unknown, currentVersion: string): boolean {
  if (!existingProfile) return false;
  const comparison = compareReleaseVersions(lastSeenVersion, currentVersion);
  return comparison === null || comparison < 0;
}

export function startupExperience(existingProfile: boolean, lastSeenVersion: unknown, currentVersion: string): StartupExperience {
  if (!existingProfile) return 'guide';
  return shouldShowWhatsNew(true, lastSeenVersion, currentVersion) ? 'whats-new' : 'none';
}
