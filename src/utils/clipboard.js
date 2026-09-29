/**
 * Copy text, falling back to a hidden textarea + execCommand when the async
 * Clipboard API is missing or refused (non-secure origin, denied permission).
 */
export async function copyText(value) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return;
    }
  } catch { /* fall back below */ }
  const input = document.createElement('textarea');
  input.value = value;
  input.setAttribute('readonly', '');
  input.style.position = 'fixed';
  input.style.opacity = '0';
  document.body.appendChild(input);
  input.select();
  const copied = document.execCommand('copy');
  input.remove();
  if (!copied) throw new Error('Copying is not supported by this browser.');
}
