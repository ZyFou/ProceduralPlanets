import { translate } from '../../i18n/locale.js';
import { useLocale } from '../../i18n/useLocale.js';
import { Command } from 'lucide-react';
import { getPlatformName, isMacPlatform, shortcutText } from '../../keyboardShortcuts.js';

export default function ShortcutHint({ shortcut, className = '' }) {
  useLocale();
  const platform = getPlatformName();
  const mac = isMacPlatform(platform);
  const displayKey = shortcut.displayKey ?? String(shortcut.key).toUpperCase();

  return (
    <span className={className} aria-label={shortcutText(shortcut, platform)}>
      {mac
        ? <Command className="shortcut-command-icon" size={12} strokeWidth={1.8} aria-hidden />
        : <span>Ctrl</span>}
      <span aria-hidden>+</span>
      {shortcut.shiftKey && <><span>{translate("Shift")}</span><span aria-hidden>+</span></>}
      {shortcut.altKey && <><span>{mac ? 'Option' : 'Alt'}</span><span aria-hidden>+</span></>}
      <span>{displayKey}</span>
    </span>
  );
}
