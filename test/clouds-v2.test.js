import { describe, it, expect } from 'vitest';
import { Planet, normalizeParam, DEFAULT_PARAMS } from '../src/lib/index.js';
import { applyCloudV2Uniforms, createCloudV2Uniforms } from '../src/engine/cloudsV2.js';

describe('Clouds V2 model', () => {
  it('accepts only the known cloud models', () => {
    expect(normalizeParam('cloudModel', 'v2')).toEqual({ ok: true, value: 'v2' });
    expect(normalizeParam('cloudModel', 'classic')).toEqual({ ok: true, value: 'classic' });
    expect(normalizeParam('cloudModel', 'v3')).toMatchObject({ ok: false, reason: 'invalid' });
    expect(DEFAULT_PARAMS.cloudModel).toBe('classic');
  });

  it('drives the shared uniforms and the frame options', () => {
    const planet = new Planet({ preset: 'terran', cloudModel: 'v2' });
    const frame = planet._prepareFrame({ impostor: true });
    expect(frame.cloudModel).toBe('v2');
    const u = planet.uniforms;
    expect(u.uCloudModel.value).toBe(1);
    expect(u.uV2WeatherFreq.value).toBeGreaterThan(0);
    expect(u.uV2NoiseFreq.value).toBeGreaterThan(u.uV2WeatherFreq.value);
    planet.set('cloudModel', 'classic');
    expect(planet._prepareFrame({ impostor: true }).cloudModel).toBe('classic');
    expect(u.uCloudModel.value).toBe(0);
    planet.dispose();
  });

  it('keeps the cloud model across planet presets', () => {
    const planet = new Planet({ preset: 'terran', cloudModel: 'v2' });
    planet.applyPreset('desert');
    expect(planet.get('cloudModel')).toBe('v2');
    planet.dispose();
  });

  it('scales formations with the shell and the cell / billow sliders', () => {
    const u = createCloudV2Uniforms();
    const p = { ...DEFAULT_PARAMS, cloudModel: 'v2' };
    applyCloudV2Uniforms(u, p, 18, 0);
    const weather = u.uV2WeatherFreq.value, noise = u.uV2NoiseFreq.value;
    applyCloudV2Uniforms(u, { ...p, cloudCellSize: 2 }, 18, 0);
    expect(u.uV2WeatherFreq.value).toBeCloseTo(weather / 2, 10);
    expect(u.uV2NoiseFreq.value).toBeCloseTo(noise, 10);
    applyCloudV2Uniforms(u, p, 36, 0);
    expect(u.uV2NoiseFreq.value).toBeCloseTo(noise / 2, 10);
    // thicker shell, same optical depth per column
    expect(u.uV2Sigma.value * 36).toBeCloseTo(createSigma(p, 18) * 18, 6);
  });
});

function createSigma(p, thick) {
  const u = createCloudV2Uniforms();
  applyCloudV2Uniforms(u, p, thick, 0);
  return u.uV2Sigma.value;
}
