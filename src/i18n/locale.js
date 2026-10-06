import fr from './fr.js';

export const LANGUAGE_STORAGE_KEY = 'procedural-planets:language';
export const SUPPORTED_LOCALES = ['en', 'fr'];
const listeners = new Set();

export function detectLocale(storage, languages = []) {
  try {
    const saved = storage?.getItem(LANGUAGE_STORAGE_KEY);
    if (SUPPORTED_LOCALES.includes(saved)) return saved;
  } catch { /* The language switch still works when storage is disabled. */ }
  for (const language of languages) {
    const base = String(language).toLowerCase().split('-')[0];
    if (SUPPORTED_LOCALES.includes(base)) return base;
  }
  return 'en';
}

let locale = (() => {
  if (typeof window === 'undefined') return 'en';
  let storage;
  try { storage = window.localStorage; } catch { /* Private browsing. */ }
  return detectLocale(storage, window.navigator.languages || [window.navigator.language]);
})();

export const getLocale = () => locale;
export const getIntlLocale = () => locale === 'fr' ? 'fr-FR' : 'en-US';
export function subscribeLocale(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function updateDocument() {
  if (typeof document === 'undefined') return;
  document.documentElement.lang = locale;
  document.title = locale === 'fr' ? 'Procedural Planets — Studio de création' : 'Procedural Planets - Stylized Planet Studio';
}

export function setLocale(next, { persist = true } = {}) {
  if (!SUPPORTED_LOCALES.includes(next)) return;
  if (persist && typeof window !== 'undefined') {
    try { window.localStorage.setItem(LANGUAGE_STORAGE_KEY, next); } catch { /* Session-only preference. */ }
  }
  if (next === locale) { updateDocument(); return; }
  locale = next;
  updateDocument();
  for (const listener of listeners) listener();
}

if (typeof window !== 'undefined') {
  updateDocument();
  window.addEventListener('storage', event => {
    if (event.key === LANGUAGE_STORAGE_KEY && SUPPORTED_LOCALES.includes(event.newValue)) {
      setLocale(event.newValue, { persist: false });
    }
  });
}

/** Interpolate a whole message; never translate user project names or code. */
export function translate(message, values = {}, language = locale) {
  if (typeof message !== 'string') return message;
  const translated = language === 'fr' && Object.hasOwn(fr, message) ? fr[message] : message;
  return translated.replace(/\{(\w+)\}/g, (match, key) => (
    Object.prototype.hasOwnProperty.call(values, key) ? String(values[key]) : match
  ));
}

export function formatNumber(value, options) {
  return new Intl.NumberFormat(getIntlLocale(), options).format(value);
}
export function formatDate(value, options) {
  return new Intl.DateTimeFormat(getIntlLocale(), options).format(new Date(value));
}
