// Link safety: placeholder destinations are never shown to the public.
const PLACEHOLDER_HOST = /(^|\.)(example\.(com|org|net)|localhost)$/i;

export function isPlaceholderUrl(u) {
  if (!u || typeof u !== 'string') return true;
  try {
    const url = new URL(u.trim());
    if (url.protocol === 'mailto:') {
      const domain = decodeURIComponent(url.pathname).split('@')[1]?.toLowerCase() || '';
      return !domain || PLACEHOLDER_HOST.test(domain);
    }
    if (!/^https?:$/.test(url.protocol)) return true;
    return PLACEHOLDER_HOST.test(url.hostname);
  } catch {
    return true;
  }
}

// { url, placeholder } for a usable link, a labeled placeholder in preview, or null.
export function usableLink(u, preview) {
  if (!isPlaceholderUrl(u)) return { url: u.trim(), placeholder: false };
  if (preview && u) return { url: u.trim(), placeholder: true };
  return null;
}
