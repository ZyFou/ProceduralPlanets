import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export function releaseChannel({ version, runtimeVersion, lockVersion, lockRootVersion, tag, prerelease }) {
  if (version !== runtimeVersion || version !== lockVersion || version !== lockRootVersion) {
    throw new Error('Package, runtime and lockfile versions must match');
  }
  if (tag !== `v${version}`) throw new Error('Release tag must match package.json (vX.Y.Z)');
  const hasPrerelease = version.split('+')[0].includes('-');
  if (prerelease && !hasPrerelease) {
    throw new Error('A GitHub prerelease needs a prerelease version, such as 0.6.0-beta.1');
  }
  return hasPrerelease ? 'next' : 'latest';
}

function npm(args) {
  return spawnSync('npm', args, { encoding: 'utf8' });
}

export function publishIfMissing({ name, version, registry, channel, provenance }, run = npm) {
  const lookup = run(['view', `${name}@${version}`, 'version', '--json', `--registry=${registry}`]);
  if (lookup.error) throw lookup.error;
  if (lookup.status === 0) {
    if (JSON.parse(lookup.stdout) !== version) throw new Error('Registry returned an unexpected version');
    return 'already published';
  }
  let lookupError;
  try { lookupError = JSON.parse(lookup.stdout).error; } catch { /* npm may return non-JSON network errors. */ }
  if (lookupError?.code !== 'E404') {
    throw new Error(`Registry lookup failed: ${lookup.stderr || lookup.stdout}`);
  }
  const args = ['publish', '--ignore-scripts', `--registry=${registry}`, '--tag', channel];
  if (provenance) args.push('--access', 'public', '--provenance');
  const result = run(args);
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Publication failed: ${result.stderr || result.stdout}`);
  return 'published';
}

async function main() {
  const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
  const lock = JSON.parse(fs.readFileSync('package-lock.json', 'utf8'));
  const { VERSION } = await import('../src/lib/index.js');
  const channel = releaseChannel({
    version: pkg.version, runtimeVersion: VERSION,
    lockVersion: lock.version, lockRootVersion: lock.packages[''].version,
    tag: process.env.RELEASE_TAG, prerelease: process.env.RELEASE_PRERELEASE === 'true',
  });
  if (process.argv[2] === 'validate') {
    console.log(`Validated ${pkg.version}: ${channel}`);
    return;
  }
  const target = process.argv[3];
  if (process.argv[2] !== 'publish' || !['npm', 'github'].includes(target)) {
    throw new Error('Usage: publish-release.mjs validate | publish npm | publish github');
  }
  const name = target === 'npm' ? 'procedural-planets' : '@zyfou/procedural-planets';
  const registry = target === 'npm' ? 'https://registry.npmjs.org' : 'https://npm.pkg.github.com';
  if (pkg.name !== name) throw new Error(`Expected package name ${name}`);
  const result = publishIfMissing({ name, version: pkg.version, registry, channel, provenance: target === 'npm' });
  console.log(`${name}@${pkg.version}: ${result} on ${registry}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
