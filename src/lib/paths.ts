/**
 * Canonical WISE path conventions — single source of truth.
 * These strings also appear in scripts/lib/hud-wrapper-template.txt and
 * scripts/plugin-setup.mjs; keep them in sync (enforced by paths-consistency.test.ts).
 */
export const WISE_PLUGIN_MARKETPLACE_SLUG = "wise";
export const WISE_PLUGIN_PACKAGE_NAME = "wise";
export const WISE_PLUGIN_CACHE_REL = `plugins/cache/${WISE_PLUGIN_MARKETPLACE_SLUG}/${WISE_PLUGIN_PACKAGE_NAME}`;
export const WISE_PLUGIN_MARKETPLACE_REL = `plugins/marketplaces/${WISE_PLUGIN_MARKETPLACE_SLUG}`;
export const WISE_HUD_DIST_REL = "dist/hud/index.js";
export const WISE_HUD_WRAPPER_REL = "hud/wise-hud.mjs";
export const WISE_HUD_WRAPPER_LIB_REL = "hud/lib/config-dir.mjs";
export const WISE_CONFIG_FILE_REL = ".wise-config.json";
