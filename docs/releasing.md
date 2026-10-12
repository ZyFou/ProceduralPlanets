# Publishing a release

Publishing a GitHub release triggers `.github/workflows/publish-github-package.yml`.
It checks the release tag and all package versions, runs the documentation check,
tests and library build, then publishes to both registries:

- npmjs: `procedural-planets`
- GitHub Packages: `@zyfou/procedural-planets`, linked to this repository

## One-time npm setup

In the npm package's **Settings → Trusted Publisher**, authorize GitHub Actions:

- Organization or user: `ZyFou`
- Repository: `ProceduralPlanets`
- Workflow filename: `publish-github-package.yml`
- Environment: leave empty
- Permission: allow direct publishing (`npm publish`)

This uses npm's OIDC trusted publishing. No `NPM_TOKEN` secret is required.
GitHub Packages uses the repository's automatic `GITHUB_TOKEN`.

## Publish a version

1. Update `package.json`, both root version entries in `package-lock.json`, and
   `VERSION` in `src/lib/index.js` to the new version. Commit and merge those changes.
2. Create a GitHub release with the matching tag, for example `v0.6.0`, from the
   commit containing that version and this workflow.
3. Click **Publish release**. Drafts and tag pushes alone do not publish packages.
4. Check the **Publish release packages** run in GitHub Actions.

Stable versions publish to `latest`. Prerelease versions such as `0.6.0-beta.1`
publish to `next`. A GitHub prerelease must use a prerelease version, so it cannot
consume the version number intended for the stable release.

Both registries run independently. If one fails, fix the reported problem and
rerun its failed job. Versions already present are skipped without changing
dist-tags. You can also use **Run workflow** and supply the existing release tag.
The tagged commit must contain this workflow and its release script; the initial
`v0.5.0` tag predates the release automation and is already published manually.

See [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/) for the
registry-side setup and authentication requirements.
