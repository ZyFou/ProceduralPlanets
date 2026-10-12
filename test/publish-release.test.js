import { describe, it, expect, vi } from 'vitest';
import { releaseChannel, publishIfMissing } from '../scripts/publish-release.mjs';

const release = (version, extra = {}) => ({
  version, runtimeVersion: version, lockVersion: version, lockRootVersion: version,
  tag: `v${version}`, prerelease: false, ...extra,
});
const publication = {
  name: 'procedural-planets', version: '0.6.0', registry: 'https://registry.npmjs.org',
  channel: 'latest', provenance: true,
};
const missing = { status: 1, stdout: JSON.stringify({ error: { code: 'E404' } }), stderr: '' };

describe('release publication', () => {
  it('publishes stable releases to latest and prerelease versions to next', () => {
    expect(releaseChannel(release('0.6.0'))).toBe('latest');
    expect(releaseChannel(release('0.6.0-beta.1', { prerelease: true }))).toBe('next');
    expect(releaseChannel(release('0.6.0-rc.1'))).toBe('next');
  });

  it('rejects mismatched tags and versions before publishing', () => {
    for (const field of ['version', 'runtimeVersion', 'lockVersion', 'lockRootVersion', 'tag']) {
      expect(() => releaseChannel(release('0.6.0', { [field]: '0.7.0' }))).toThrow();
    }
    expect(() => releaseChannel(release('0.6.0', { prerelease: true }))).toThrow(/prerelease version/);
  });

  it('skips an existing version without changing dist-tags on reruns', () => {
    const run = vi.fn(() => ({ status: 0, stdout: '"0.6.0"' }));
    expect(publishIfMissing(publication, run)).toBe('already published');
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('publishes missing versions to the requested registry and channel', () => {
    const run = vi.fn().mockReturnValueOnce(missing).mockReturnValueOnce({ status: 0 });
    expect(publishIfMissing({ ...publication, channel: 'next' }, run)).toBe('published');
    expect(run.mock.calls[1][0]).toEqual([
      'publish', '--ignore-scripts', '--registry=https://registry.npmjs.org',
      '--tag', 'next', '--access', 'public', '--provenance',
    ]);
  });

  it('uses GitHub authentication without npm provenance for the scoped package', () => {
    const run = vi.fn().mockReturnValueOnce(missing).mockReturnValueOnce({ status: 0 });
    publishIfMissing({ ...publication, name: '@zyfou/procedural-planets', registry: 'https://npm.pkg.github.com', provenance: false }, run);
    expect(run.mock.calls[0][0]).toContain('@zyfou/procedural-planets@0.6.0');
    expect(run.mock.calls[1][0]).toContain('--registry=https://npm.pkg.github.com');
    expect(run.mock.calls[1][0]).not.toContain('--provenance');
  });

  it.each(['E401', 'E403', 'E500', 'ENOTFOUND'])('does not publish after a %s lookup failure', (code) => {
    const run = vi.fn(() => ({ status: 1, stdout: JSON.stringify({ error: { code } }) }));
    expect(() => publishIfMissing(publication, run)).toThrow(/Registry lookup failed/);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('reports a failed publication so the workflow can be retried', () => {
    const run = vi.fn().mockReturnValueOnce(missing).mockReturnValueOnce({ status: 1, stderr: 'ENEEDAUTH' });
    expect(() => publishIfMissing(publication, run)).toThrow(/ENEEDAUTH/);
  });
});
