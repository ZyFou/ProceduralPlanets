import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { PLANET_PRESETS, GAS_PRESETS, STAR_PRESETS } from '../src/lib/index.js';

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

function unionMembers(dts, name) {
  const m = dts.match(new RegExp(`export type ${name} =([^;]+);`));
  return [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]).sort();
}

describe('package', () => {
  it('generated parameter docs are up to date', () => {
    execFileSync(process.execPath, ['scripts/gen-param-docs.mjs', '--check'], { stdio: 'pipe' });
  });

  it('type declarations list exactly the shipped presets', () => {
    const dts = read('types/index.d.ts');
    expect(unionMembers(dts, 'TerrestrialPresetName')).toEqual(Object.keys(PLANET_PRESETS).sort());
    expect(unionMembers(dts, 'GasPresetName')).toEqual(Object.keys(GAS_PRESETS).sort());
    expect(unionMembers(dts, 'StarPresetName')).toEqual(Object.keys(STAR_PRESETS).sort());
  });

  it('declares every runtime export', async () => {
    const dts = read('types/index.d.ts');
    const lib = await import('../src/lib/index.js');
    for (const name of Object.keys(lib)) {
      expect(dts, name).toMatch(new RegExp(`export (declare )?(class|function|const) ${name}\\b`));
    }
  });

  it('package.json exports point at the build + types', () => {
    const pkg = JSON.parse(read('package.json'));
    expect(pkg.exports['.'].import).toBe('./dist/lib/procedural-planets.js');
    expect(pkg.exports['./export'].types).toBe('./types/export.d.ts');
    expect(pkg.peerDependencies.three).toBeDefined();
    expect(pkg.dependencies.three).toBeUndefined();
  });
});
