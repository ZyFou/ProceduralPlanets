import { afterEach, describe, expect, it, vi } from 'vitest';
import { detectLocale, formatDate, formatNumber, getLocale, LANGUAGE_STORAGE_KEY, setLocale, subscribeLocale, translate } from '../src/i18n/locale.js';
import { translateExternalMessage } from '../src/i18n/externalMessages.js';
import { searchSettings } from '../src/components/settingsSearch.js';
import { AU, formatDistance, formatSpeed } from '../src/exploration/world.js';

afterEach(() => setLocale('en'));

describe('site language', () => {
  it('prefers a saved language over browser language, ignoring unsupported values', () => {
    expect(detectLocale({ getItem: key => key === LANGUAGE_STORAGE_KEY ? 'en' : null }, ['fr-FR'])).toBe('en');
    expect(detectLocale({ getItem: () => 'de' }, ['de-DE', 'fr-CA', 'en'])).toBe('fr');
    expect(detectLocale(null, ['de-DE'])).toBe('en');
  });
  it('detects French when storage is blocked', () => {
    expect(detectLocale({ getItem: () => { throw new Error('Blocked'); } }, ['fr-CA'])).toBe('fr');
  });
  it('updates subscribers once per change and rejects unsupported languages', () => {
    const listener = vi.fn(); const unsubscribe = subscribeLocale(listener);
    setLocale('fr'); setLocale('fr'); setLocale('de');
    expect(getLocale()).toBe('fr'); expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe(); setLocale('en'); expect(listener).toHaveBeenCalledTimes(1);
  });
  it('interpolates whole messages without translating user names or replacing their placeholders', () => {
    setLocale('fr');
    expect(translate('Saved as {0}. You are now editing the copy.', { 0: 'Star {0} <world>' })).toBe('Enregistré sous Star {0} <world>. Vous modifiez désormais la copie.');
    expect(translate('An unknown message')).toBe('An unknown message');
    expect(translate('constructor')).toBe('constructor');
    expect(translate(undefined)).toBeUndefined();
    expect(translate('Save', {}, 'en')).toBe('Save');
  });
  it('formats numbers, dates and astronomical units with the selected locale', () => {
    setLocale('fr');
    expect(formatNumber(1234.5)).toMatch(/1\s234,5/);
    expect(formatDate('2026-07-23T12:00:00Z', { month: 'long', timeZone: 'UTC' })).toBe('juillet');
    expect(formatDistance(AU, 'fr-FR')).toBe('1,000 UA');
    expect(formatSpeed(.001, 'fr-FR')).toBe('1,0 m/s');
    expect(formatDistance(AU)).toBe('1.000 AU');
  });
  it('translates server validation, engine progress and graph diagnostics at the UI boundary', () => {
    setLocale('fr');
    expect(translateExternalMessage('Enter a valid email address.')).toBe('Saisissez une adresse e-mail valide.');
    expect(translateExternalMessage('Building face 3/6')).toBe('Création de la face 3/6');
    expect(translateExternalMessage('Connect the Height input.')).toBe('Connectez l’entrée Hauteur.');
    setLocale('en'); expect(translateExternalMessage('Building face 3/6')).toBe('Building face 3/6');
  });
});

describe('localized settings search', () => {
  it('finds French settings with and without accents, retaining English and parameter keys', () => {
    setLocale('fr');
    for (const query of ['niveau de la mer', 'sea level', 'seaLevel']) {
      expect(searchSettings(query)[0].settingId).toBe('terrain.seaLevel');
    }
    expect(searchSettings('densite atmosphère')[0].settingId).toBe('style.atmoStrength');
    expect(searchSettings('nuages').some(item => item.panelId === 'clouds')).toBe(true);
    expect(searchSettings('suréchantillonnage')[0].settingId).toBe('perf.upscaler');
    expect(searchSettings('spatial')[0].settingId).toBe('perf.upscaler');
    expect(searchSettings('niveau de la mer')[0].label).toBe('Niveau de la mer');
  });
  it('returns fresh translations after switching, while keeping category filtering', () => {
    setLocale('fr'); expect(searchSettings('sea level')[0].label).toBe('Niveau de la mer');
    expect(searchSettings('nuages', id => id === 'terrain')).toEqual([]);
    setLocale('en'); expect(searchSettings('sea level')[0].label).toBe('Sea level');
  });
});
