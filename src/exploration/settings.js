export const SETTINGS_KEY = 'procedural-planets.explore-settings.v1';
export const DEFAULT_SETTINGS = Object.freeze({ renderScale: 1, maxDepth: 9, cloudSteps: 24, cloudResolution: .5,
  clouds: true, atmosphere: true, bloom: true, fov: 65, exposure: 1, layout: 'wasd' });
export const QUALITY_PRESETS = Object.freeze({
  performance: { renderScale: .75, maxDepth: 7, cloudSteps: 12, cloudResolution: .25 },
  balanced: { renderScale: 1, maxDepth: 9, cloudSteps: 24, cloudResolution: .5 },
  quality: { renderScale: 1.5, maxDepth: 10, cloudSteps: 48, cloudResolution: .75 },
});
const bounds = { renderScale: [.5, 2], maxDepth: [6, 11], cloudSteps: [8, 96], cloudResolution: [.25, 1], fov: [30, 110], exposure: [.25, 4] };
export function normalizeSettings(value) {
  const settings = { ...DEFAULT_SETTINGS };
  if (!value || typeof value !== 'object') return settings;
  for (const [key, [min, max]] of Object.entries(bounds)) {
    if (typeof value[key] === 'number' && Number.isFinite(value[key])) settings[key] = Math.max(min, Math.min(max, value[key]));
  }
  settings.maxDepth = Math.round(settings.maxDepth); settings.cloudSteps = Math.round(settings.cloudSteps);
  for (const key of ['clouds', 'atmosphere', 'bloom']) if (typeof value[key] === 'boolean') settings[key] = value[key];
  if (['wasd', 'azerty'].includes(value.layout)) settings.layout = value.layout;
  return settings;
}
export function readSettings(storage) {
  try { return normalizeSettings(JSON.parse(storage.getItem(SETTINGS_KEY))); } catch { return { ...DEFAULT_SETTINGS }; }
}
export function writeSettings(storage, settings) {
  try { storage.setItem(SETTINGS_KEY, JSON.stringify(normalizeSettings(settings))); return true; } catch { return false; }
}
export function bodySettings(settings, intrinsic) {
  return { maxDepth: settings.maxDepth, cloudQuality: settings.cloudSteps, cloudResolution: settings.cloudResolution,
    cloudsEnabled: settings.clouds && intrinsic.cloudsEnabled, atmoEnabled: settings.atmosphere && intrinsic.atmoEnabled,
    gasAtmoStrength: settings.atmosphere ? intrinsic.gasAtmoStrength : 0,
    starBloom: settings.bloom ? intrinsic.starBloom : 0, exposure: settings.exposure };
}
