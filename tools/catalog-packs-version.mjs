import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
// The runtime component contract is the sole authority for immutable pack
// versioning. The application package version is intentionally irrelevant.
export const { COMPONENT_VERSION } = require('../electron/catalog-components.cjs');

export function resolveCatalogComponentVersion(argumentsList = process.argv) {
  const override = argumentsList.find(argument => argument.startsWith('--component-version='))?.slice('--component-version='.length);
  if (override !== undefined && override !== COMPONENT_VERSION) throw new Error(`Catalog component version must remain ${COMPONENT_VERSION} (found ${override}).`);
  return COMPONENT_VERSION;
}
