// Extracts stable, comparable text from an official AASECT requirements page so
// NWIOI can detect when the published requirements change.
import crypto from 'node:crypto';

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”', ndash: '–', mdash: '—' };

function decodeEntities(s) {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, name) => ENTITIES[name.toLowerCase()] ?? m);
}

export function extractRequirementsText(html) {
  const main = html.match(/<main[\s\S]*?<\/main>/i)?.[0] ?? html.match(/<body[\s\S]*<\/body>/i)?.[0] ?? html;
  let s = main
    .replace(/<(script|style|nav|header|footer|noscript)[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(br|\/p|\/li|\/h\d|\/div|\/tr)[^>]*>/gi, '\n')
    .replace(/<li[^>]*>/gi, '\n- ')
    .replace(/<[^>]+>/g, '');
  s = decodeEntities(s);
  const lines = s.split('\n').map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
  // Keep only the requirements body: from the page title to the end of the content.
  const start = lines.findIndex((l) => /^AASECT Requirements for/i.test(l));
  return (start >= 0 ? lines.slice(start) : lines).join('\n');
}

export function findRequirementsVersion(text) {
  return text.match(/Requirements version:?\s*([0-9]{4}\.[A-Z]\.[0-9]+)/i)?.[1] ?? null;
}

export function hashText(text) {
  return 'sha256:' + crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

// Minimal line diff (LCS) so an admin can see what changed on the published page.
export function lineDiff(oldText, newText, maxLines = 200) {
  const a = oldText.split('\n');
  const b = newText.split('\n');
  const n = a.length, m = b.length;
  if (n * m > 4_000_000) return [{ op: 'note', text: 'Pages too large to diff line by line.' }];
  const dp = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--)
    dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out = [];
  let i = 0, j = 0;
  while ((i < n || j < m) && out.length < maxLines) {
    if (i < n && j < m && a[i] === b[j]) { i++; j++; continue; }
    if (j < m && (i === n || dp[i][j + 1] >= dp[i + 1][j])) out.push({ op: 'added', text: b[j++] });
    else out.push({ op: 'removed', text: a[i++] });
  }
  return out;
}
