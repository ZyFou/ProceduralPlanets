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

async function clickNavigation(page, target) {
  const toggle = page.locator('.lp-nav-toggle');
  if (await toggle.isVisible() && await toggle.getAttribute('aria-expanded') === 'false') await toggle.click();
  await target.click();
}

test('language persists across public pages and reload, including validation messages and mobile navigation', async ({ page }) => {
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await prepare(page);
  await page.locator('.lp-nav .language-switcher').click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'fr');
  await expect(page.locator('.lp-hero h1')).toContainText('des mondes saisissants');
  await clickNavigation(page, page.getByRole('button', { name: 'Modèles', exact: true }));
  await expect(page.getByRole('heading', { name: 'Modèles de planètes' })).toBeVisible();
  await page.getByRole('searchbox', { name: 'Rechercher des modèles' }).fill('gelé');
  await expect(page.locator('.lp-card-info strong')).toHaveText(['Monde gelé']);
  await clickNavigation(page, page.getByRole('button', { name: 'Se connecter', exact: true }));
  await page.locator('.auth-submit').click();
  await expect(page.getByText('Saisissez votre adresse e-mail ou votre nom d’utilisateur.')).toBeVisible();
  await expect(page.getByText('Vérifiez les champs indiqués.')).toBeVisible();
  await clickNavigation(page, page.getByRole('button', { name: 'Communauté', exact: true }));
  await expect(page.getByRole('heading', { name: 'Mondes de la communauté' })).toBeVisible();
  await page.getByRole('button', { name: 'Confidentialité', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Confidentialité et vie privée' })).toBeVisible();
  await expect(page.getByText('Dernière mise à jour le 23 juillet 2026')).toBeVisible();
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('lang', 'fr');
  await expect(page.locator('#pp-loader')).toHaveCount(0, { timeout: 90000 });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('.lp-nav .language-switcher')).toBeVisible();
  await page.locator('.lp-nav .language-switcher').click();
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
  await page.locator('#topbar .language-switcher').click();
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
  await page.locator('#topbar .language-switcher').click();
  await expect(page.getByRole('complementary', { name: 'Paint settings' })).toBeVisible();
  expect(await page.evaluate(() => window.__i18nEngine === window.planetStudio && window.__i18nCanvas === document.querySelector('#viewport'))).toBe(true);
  expect(await page.evaluate(() => JSON.stringify(window.planetStudio.params))).toBe(before);
  const project = await page.evaluate(async () => { const { projectStore } = await import('/src/project/ProjectStore.js'); return projectStore.get('i18n-e2e'); });
  expect(project.metadata.name).toBe('Star'); expect(project.metadata.description).toBe('Never translate my description');
  expect(errors).toEqual([]);
});

test('French applies to profile, administration and exploration', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => localStorage.setItem('procedural-planets:language', 'fr'));
  await prepare(page, { user: { id: 'admin-test', username: 'admin_test', displayName: 'Admin', role: 'admin', defaultProjectVisibility: 'private' } });
  await clickNavigation(page, page.getByTitle('Ouvrir votre profil'));
  await expect(page.getByRole('heading', { name: 'Votre profil' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Enregistrer le profil' })).toBeVisible();
  await clickNavigation(page, page.getByTitle('Ouvrir l’administration'));
  await expect(page.getByRole('heading', { name: 'Vue d’ensemble' })).toBeVisible();
  await expect(page.getByText('Le service d’administration n’a pas répondu.')).toBeVisible();
  await clickNavigation(page, page.getByRole('button', { name: 'Explorer', exact: true }));
  await expect(page.getByRole('button', { name: 'Retour au studio' })).toBeVisible();
  await page.getByRole('button', { name: 'Navigation', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Destinations' })).toBeVisible();
  await page.getByRole('button', { name: 'Retour au studio' }).click();
  await expect(page.getByRole('heading', { name: 'Vue d’ensemble' })).toBeVisible();
});

test('responsive header exposes every link and footer stays usable in both languages', async ({ page }, testInfo) => {
  test.setTimeout(180000);
  await prepare(page);
  const header = page.locator('.lp-nav');
  const toggle = page.locator('.lp-nav-toggle');
  const panel = page.locator('#landing-navigation');
  const footer = page.locator('.lp-footer');
  for (const locale of ['en', 'fr']) {
    if (await header.locator('.language-switcher').innerText() !== locale.toUpperCase()) await header.locator('.language-switcher').click();
    for (const width of [1440, 1024, 768, 390, 320]) {
      await page.setViewportSize({ width, height: 844 });
      const mobile = width < 1400;
      if (mobile) {
        await expect(toggle).toBeVisible();
        await expect(toggle).toHaveAttribute('aria-expanded', 'false');
        await expect(panel).toBeHidden();
        await toggle.click();
        await expect(toggle).toHaveAttribute('aria-expanded', 'true');
        await expect(panel.locator('.lp-nav-links button').first()).toBeFocused();
        await expect(panel).toHaveCSS('opacity', '1');
        const panelBounds = await panel.boundingBox();
        expect(panelBounds.x).toBe(0); expect(panelBounds.y).toBe(0);
        expect(panelBounds.width).toBe(width); expect(panelBounds.height).toBe(844);
        await expect(page.locator('.lp-scroll')).toHaveAttribute('inert', '');
        const accountBounds = await panel.locator('.lp-auth-register').boundingBox();
        expect(accountBounds.x + accountBounds.width).toBeGreaterThan(width - 32);
        await page.keyboard.press('Tab');
        await expect(panel.locator('.lp-nav-links button').nth(1)).toBeFocused();
      } else await expect(toggle).toBeHidden();
      await expect(panel.locator('.lp-nav-links button')).toHaveCount(4);
      for (const link of await panel.locator('.lp-nav-links button, .lp-nav-links a').all()) await expect(link).toBeVisible();
      await expect(panel.getByRole('button', { name: locale === 'fr' ? 'Se connecter' : 'Sign in', exact: true })).toBeVisible();
      await expect(panel.getByRole('button', { name: locale === 'fr' ? 'Créer un compte' : 'Create account', exact: true })).toBeVisible();
      await expect(panel.getByRole('link', { name: 'Procedural Terrains' })).toHaveAttribute('href', 'https://procedural-terrains.com');
      expect(await header.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
      expect(await panel.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
      if (mobile) {
        if (width === 390 && locale === 'fr') await page.screenshot({ path: testInfo.outputPath('navigation-fr-mobile.png') });
        await page.keyboard.press('Escape');
        await expect(panel).toBeHidden();
        await expect(toggle).toBeFocused();
        await toggle.click();
        await panel.getByRole('button', { name: locale === 'fr' ? 'Projets' : 'Projects', exact: true }).click();
        await expect(panel).toBeHidden();
        await expect(toggle).toHaveAttribute('aria-expanded', 'false');
        await toggle.click();
        await page.mouse.click(4, 500);
        await expect(panel).toBeVisible();
        await toggle.click();
        await expect(panel).toBeHidden();
      }
      await expect(footer.getByRole('link', { name: /Procedural Terrains/ })).toHaveCount(0);
      await footer.scrollIntoViewIfNeeded();
      await expect(footer.getByRole('button', { name: locale === 'fr' ? 'Confidentialité' : 'Confidentiality', exact: true })).toBeInViewport();
      expect(await footer.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
      expect(await page.locator('.lp-scroll').evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
      for (const link of await footer.locator('.lp-footer-links > *, .lp-footer-socials a').all()) {
        const bounds = await link.boundingBox();
        expect(bounds.height).toBeGreaterThanOrEqual(44);
      }
      if (width === 390 && locale === 'fr') await page.screenshot({ path: testInfo.outputPath('footer-fr-mobile.png') });
    }
  }
  await page.setViewportSize({ width: 390, height: 360 });
  await toggle.click();
  await expect(panel.getByRole('button', { name: 'Créer un compte', exact: true })).toBeVisible();
  await panel.getByRole('button', { name: 'Créer un compte', exact: true }).click();
  await expect(panel).toBeHidden();
  await expect(page.getByRole('heading', { name: 'Créer votre compte', exact: true })).toBeVisible();
});
