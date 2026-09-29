export const EDITOR_SHORTCUTS = Object.freeze({
  newPlanet: Object.freeze({ key: 'n', displayKey: 'N' }),
  projects: Object.freeze({ key: 'o', displayKey: 'O', shiftKey: true }),
  save: Object.freeze({ key: 's', displayKey: 'S' }),
  saveAs: Object.freeze({ key: 's', displayKey: 'S', shiftKey: true }),
  load: Object.freeze({ key: 'o', displayKey: 'O' }),
  download: Object.freeze({ key: 'd', displayKey: 'D' }),
  randomSeed: Object.freeze({ key: 'r', displayKey: 'R' }),
  undo: Object.freeze({ key: 'z', displayKey: 'Z' }),
  redo: Object.freeze({ key: 'y', displayKey: 'Y' }),
  redoAlt: Object.freeze({ key: 'z', displayKey: 'Z', shiftKey: true }),
});

/** Text fields keep their own native undo/redo. */
export const isTextEditingTarget = (target) => !!target?.closest?.('input, textarea, select, [contenteditable="true"], .cm-editor');

export const SEARCH_SETTINGS_SHORTCUT = Object.freeze({ key: 'k', displayKey: 'K' });

export const getPlatformName = () => {
  if (typeof navigator === 'undefined') return '';
  return navigator.userAgentData?.platform || navigator.platform || navigator.userAgent || '';
};

export const isMacPlatform = (platform = getPlatformName()) => /mac|iphone|ipad|ipod/i.test(platform);

export const shortcutText = (shortcut, platform = getPlatformName()) => {
  const parts = [isMacPlatform(platform) ? 'Command' : 'Ctrl'];
  if (shortcut.shiftKey) parts.push('Shift');
  if (shortcut.altKey) parts.push(isMacPlatform(platform) ? 'Option' : 'Alt');
  parts.push(shortcut.displayKey ?? String(shortcut.key).toUpperCase());
  return parts.join(' + ');
};

export const matchesShortcut = (event, shortcut, platform = getPlatformName()) => {
  const mac = isMacPlatform(platform);
  const primaryPressed = mac ? event.metaKey : event.ctrlKey;
  const otherPrimaryPressed = mac ? event.ctrlKey : event.metaKey;

  return primaryPressed
    && !otherPrimaryPressed
    && !!event.shiftKey === !!shortcut.shiftKey
    && !!event.altKey === !!shortcut.altKey
    && String(event.key ?? '').toLowerCase() === String(shortcut.key).toLowerCase();
};
