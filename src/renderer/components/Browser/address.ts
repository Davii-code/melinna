const BROWSER_ADDRESS_KEY = 'melinna.browser.address';

const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i;
const LOCAL_HOST = /^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(:\d+)?(\/|\?|#|$)/i;

/**
 * Transforma o que foi digitado num endereço http ou https; `null` se não der. Sem esquema, um servidor
 * local (`localhost:3000`) vira `http://` e o resto vira `https://`.
 */
export function normalizeAddress(text: string): string | null {
  const raw = text.trim();
  if (raw === '' || /\s/.test(raw)) return null;
  const candidate = HAS_SCHEME.test(raw) ? raw : `${LOCAL_HOST.test(raw) ? 'http' : 'https'}://${raw}`;
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  return url.toString();
}

export function storedBrowserAddress(
  storage: Pick<Storage, 'getItem'> | undefined = globalThis.localStorage,
): string {
  try {
    return storage?.getItem(BROWSER_ADDRESS_KEY) ?? '';
  } catch {
    // armazenamento indisponível: o campo começa vazio
    return '';
  }
}

export function storeBrowserAddress(
  address: string,
  storage: Pick<Storage, 'setItem'> | undefined = globalThis.localStorage,
): void {
  try {
    storage?.setItem(BROWSER_ADDRESS_KEY, address);
  } catch {
    // armazenamento indisponível: o endereço vale só nesta sessão
  }
}
