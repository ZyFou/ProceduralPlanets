import { setLocale } from './locale.js';
import { useLocale } from './useLocale.js';
import './language.css';

export default function LanguageSwitcher() {
  const locale = useLocale();
  const label = locale === 'fr' ? 'Passer en anglais' : 'Switch to French';
  return <button
    type="button"
    className="language-switcher"
    title={label}
    aria-label={label}
    onClick={() => setLocale(locale === 'fr' ? 'en' : 'fr')}
  >
    {locale.toUpperCase()}
  </button>;
}
