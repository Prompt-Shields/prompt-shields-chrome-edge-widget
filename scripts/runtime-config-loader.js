/**
 * Webpack loader: replaces src/config/config.js with the generated
 * single-environment runtime (see renderRuntimeConfig in webpack.config.js).
 * The raw file holds every environment's CONFIGS and must never be bundled.
 */
module.exports = function runtimeConfigLoader() {
  return this.getOptions().source;
};
