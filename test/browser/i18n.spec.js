import { test, expect } from '@playwright/test';

async function prepare(page, { user = null } = {}) {
  await page.route('**/api/**', route => {
    const url = new URL(route.request().url());
    let body = { user, projects: [], authenticated: !!user };
    let status = 200;
    if (url.pathname.endsWith('/auth/login')) {
      status = 400; body = { error: { code: 'VALIDATION_ERROR', message: 'Check the highlighted fields.', fields: { identifier: 'Enter your email or username.', password: 'Enter your password.' } } };
    }
    if (url.pathname.endsWith('/community/projects')) body = { projects: [], page: 1, pages: 0, total: 0 };
    if (url.pathname.endsWith('/admin/overview')) { status = 503; body = { error: { message: 'The administration service did not respond.' } }; }
    return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  });
  await page.route('**/src/engine/presets.js*', async route => {
    const response = await route.fetch();
    const body = (await response.text()).replace(/octaves:\s*\d+/, 'octaves: 3')
      .replace(/chunkRes:\s*\d+/, 'chunkRes: 16').replace(/maxDepth:\s*\d+/, 'maxDepth: 4')
      .replace(/cloudsEnabled:\s*true/, 'cloudsEnabled: false').replace(/atmoEnabled:\s*true/, 'atmoEnabled: false');
    await route.fulfill({ response, body });
  });
  await page.goto('/');
  await expect(page.locator('.lp-nav')).toBeVisible();
  await expect(page.locator('#pp-loader')).toHaveCount(0, { timeout: 90000 });
}

test('language persists across public pages and reload, including validation messages and mobile navigation', async ({ page }) => {
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await prepare(page);
  await page.locator('.lp-nav .language-switcher select').selectOption('fr');
  await expect(page.locator('html')).toHaveAttribute('lang', 'fr');
  await expect(page.locator('.lp-hero h1')).toContainText('des mondes saisissants');
  await page.getByRole('button', { name: 'Modèles', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Modèles de planètes' })).toBeVisible();
  await page.getByRole('searchbox', { name: 'Rechercher des modèles' }).fill('gelé');
  await expect(page.locator('.lp-card-info strong')).toHaveText(['Monde gelé']);
  await page.getByRole('button', { name: 'Se connecter', exact: true }).click();
  await page.locator('.auth-submit').click();
  await expect(page.getByText('Saisissez votre adresse e-mail ou votre nom d’utilisateur.')).toBeVisible();
  await expect(page.getByText('Vérifiez les champs indiqués.')).toBeVisible();
  await page.getByRole('button', { name: 'Communauté', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Mondes de la communauté' })).toBeVisible();
  await page.getByRole('button', { name: 'Confidentialité', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Confidentialité et vie privée' })).toBeVisible();
  await expect(page.getByText('Dernière mise à jour le 23 juillet 2026')).toBeVisible();
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('lang', 'fr');
  await expect(page.locator('#pp-loader')).toHaveCount(0, { timeout: 90000 });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('.lp-nav .language-switcher select')).toBeVisible();
  await page.locator('.lp-nav .language-switcher select').selectOption('en');
  await expect(page.getByRole('heading', { name: 'Confidentiality & privacy' })).toBeVisible();
  expect(errors).toEqual([]);
});

test('studio switches without replacing its canvas or editing project data; French search and paint work', async ({ page }) => {
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await prepare(page);
  await page.waitForFunction(() => window.planetStudio?.paintMode);
  await page.evaluate(async () => {
    const { projectStore } = await import('/src/project/ProjectStore.js');
    await projectStore.save({ id: 'i18n-e2e', metadata: { name: 'Star', description: 'Never translate my description', templateId: 'blank' },
      params: { mode: 'planet', radius: 200, heightScale: 40, seed: 42, octaves: 3, chunkRes: 16, maxDepth: 4, cloudsEnabled: false, atmoEnabled: false } });
  });
  await page.locator('.lp-card-main').filter({ hasText: 'Star' }).click();
  await expect(page.getByRole('button', { name: 'Paint Mode', exact: true })).toBeEnabled();
  await page.evaluate(() => { window.__i18nEngine = window.planetStudio; window.__i18nCanvas = document.querySelector('#viewport'); });
  const before = await page.evaluate(() => JSON.stringify(window.planetStudio.params));
  await page.locator('#topbar .language-switcher select').selectOption('fr');
  await page.getByRole('button', { name: 'Fichier', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Nom du projet' })).toHaveValue('Star');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Rechercher un réglage', exact: true }).click();
  await page.locator('.settings-search-input').fill('niveau de la mer');
  await expect(page.locator('.settings-search-item').first()).toContainText('Niveau de la mer');
  await page.keyboard.press('Enter');
  await expect(page.locator('[data-param="seaLevel"]')).toBeVisible();
  await page.keyboard.press('p');
  await expect(page.getByRole('complementary', { name: 'Réglages de peinture' })).toBeVisible();
  await page.locator('#topbar .language-switcher select').selectOption('en');
  await expect(page.getByRole('complementary', { name: 'Paint settings' })).toBeVisible();
  expect(await page.evaluate(() => window.__i18nEngine === window.planetStudio && window.__i18nCanvas === document.querySelector('#viewport'))).toBe(true);
  expect(await page.evaluate(() => JSON.stringify(window.planetStudio.params))).toBe(before);
  const project = await page.evaluate(async () => { const { projectStore } = await import('/src/project/ProjectStore.js'); return projectStore.get('i18n-e2e'); });
  expect(project.metadata.name).toBe('Star'); expect(project.metadata.description).toBe('Never translate my description');
  expect(errors).toEqual([]);
});

test('French applies to profile, administration and exploration', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('procedural-planets:language', 'fr'));
  await prepare(page, { user: { id: 'admin-test', username: 'admin_test', displayName: 'Admin', role: 'admin', defaultProjectVisibility: 'private' } });
  await page.getByTitle('Ouvrir votre profil').click();
  await expect(page.getByRole('heading', { name: 'Votre profil' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Enregistrer le profil' })).toBeVisible();
  await page.getByTitle('Ouvrir l’administration').click();
  await expect(page.getByRole('heading', { name: 'Vue d’ensemble' })).toBeVisible();
  await expect(page.getByText('Le service d’administration n’a pas répondu.')).toBeVisible();
  await page.getByRole('button', { name: 'Explorer', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Retour au studio' })).toBeVisible();
  await page.getByRole('button', { name: 'Navigation', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Destinations' })).toBeVisible();
  await page.getByRole('button', { name: 'Retour au studio' }).click();
  await expect(page.getByRole('heading', { name: 'Vue d’ensemble' })).toBeVisible();
});
