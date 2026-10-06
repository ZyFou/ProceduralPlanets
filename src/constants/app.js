// Single source of truth for the studio's name, version and links.
import { version } from '../../package.json';

// The studio's version is X.Y.Z: X (release) and Y (package) come from the
// npm package, Z counts site releases — bump SITE_REVISION for a site-only
// change, never package.json.
const SITE_REVISION = 8;
export const APP_VERSION = `${version.split('.').slice(0, 2).join('.')}.${SITE_REVISION}`;
export const APP_NAME = 'Procedural Planets';
export const GITHUB_REPO_URL = 'https://github.com/ZyFou/ProceduralPlanets';
export const AUTHOR_NAME = 'ZyFod';
export const AUTHOR_PORTFOLIO_URL = 'https://zyfod.dev';
export const AUTHOR_EMAIL = 'zyfodexe@gmail.com';
export const PROCEDURAL_TERRAINS_URL = 'https://procedural-terrains.com';
