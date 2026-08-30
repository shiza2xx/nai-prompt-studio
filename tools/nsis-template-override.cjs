'use strict';
const Module = require('node:module');
const path = require('node:path');
const originalLoad = Module._load;

Module._load = function naiNsisTemplateOverride(request, parent, isMain) {
  const value = originalLoad.call(this, request, parent, isMain);
  const filename = (() => { try { return Module._resolveFilename(request, parent, isMain); } catch { return ''; } })();
  if (filename && /app-builder-lib[\\/]out[\\/]targets[\\/]nsis[\\/]nsisUtil\.js$/i.test(filename)) {
    const override = process.env.NAI_NSIS_TEMPLATES_DIR;
    if (!override || !path.isAbsolute(override)) throw new Error('NAI_NSIS_TEMPLATES_DIR must name an absolute isolated template tree.');
    value.nsisTemplatesDir = override;
  }
  return value;
};
