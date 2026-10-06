import { Languages } from 'lucide-react';
import { setLocale } from './locale.js';
import { useLocale } from './useLocale.js';
import './language.css';

export default function LanguageSwitcher() {
  const locale = useLocale();
  return <label className="language-switcher" title={locale === 'fr' ? 'Langue du site' : 'Site language'}>
    <Languages size={14} aria-hidden />
    <select aria-label={locale === 'fr' ? 'Langue du site' : 'Site language'} value={locale} onChange={event => setLocale(event.target.value)}>
      <option value="en" lang="en">EN · English</option>
      <option value="fr" lang="fr">FR · Français</option>
    </select>
  </label>;
}
