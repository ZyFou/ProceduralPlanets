import { useSyncExternalStore } from 'react';
import { getLocale, subscribeLocale } from './locale.js';

// Components subscribe without remounting the editor, canvas or open project.
export function useLocale() {
  return useSyncExternalStore(subscribeLocale, getLocale, () => 'en');
}
