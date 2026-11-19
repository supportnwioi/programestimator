// Duplicate detection shared by the browser (review screen) and the server
// (estimate calculation), so the same coursework or hours are counted once.

const STOP = new Set(['the', 'and', 'of', 'in', 'to', 'a', 'an', 'for', 'on', 'with', 'course', 'class', 'seminar', 'workshop', 'training', 'intro', 'introduction', 'i', 'ii', 'part']);

export function courseCode(text = '') {
  const m = String(text).toUpperCase().match(/\b([A-Z]{2,5})[\s-]?(\d{3,4}[A-Z]?)\b/);
  return m ? `${m[1]}${m[2]}` : null;
}

export function titleTokens(text = '') {
  return new Set(String(text).toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/)
    .filter((t) => t && !STOP.has(t) && !/^\d+$/.test(t)));
}

function jaccard(a, b) {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter);
}

function entryHours(e) {
  if (e.kind === 'supervision') return (Number(e.individualHours) || 0) + (Number(e.groupHours) || 0);
  if (e.kind === 'sar') return Number(e.hours) || 0;
  const alloc = (e.allocations || []).reduce((s, a) => s + (Number(a.hours) || 0), 0);
  return Number(e.totalAmount) || alloc;
}

export function similarity(a, b) {
  if (a.kind !== b.kind || a.id === b.id) return 0;
  if (a.kind === 'course') {
    // Entries counted toward entirely different requirements are not the same coursework.
    const reqs = (e) => new Set((e.allocations || []).map((x) => x.requirement).filter((r) => r && r !== 'none'));
    const ra = reqs(a), rb = reqs(b);
    if (ra.size && rb.size && ![...ra].some((r) => rb.has(r))) return 0;
  }
  const ca = courseCode(`${a.courseCode || ''} ${a.title || ''}`);
  const cb = courseCode(`${b.courseCode || ''} ${b.title || ''}`);
  if (ca && cb && ca === cb) return 1;
  let score = jaccard(titleTokens(a.title), titleTokens(b.title));
  const pa = (a.provider || '').toLowerCase().trim();
  const pb = (b.provider || '').toLowerCase().trim();
  if (pa && pb) score += pa === pb || pa.includes(pb) || pb.includes(pa) ? 0.15 : -0.1;
  const ha = entryHours(a), hb = entryHours(b);
  if (ha && hb && Math.abs(ha - hb) < 0.01) score += 0.1;
  if (a.kind === 'supervision' && (a.supervisorName || '').toLowerCase() === (b.supervisorName || '').toLowerCase() && a.supervisorName) score += 0.5;
  return Math.min(1, score);
}

// Richer entries win: more allocated detail, then documents over manual entries.
function priority(e) {
  const detail = e.kind === 'course' ? (e.allocations || []).filter((x) => x.area && Number(x.hours) > 0).length : 1;
  return detail * 10 + (e.source?.type === 'document' ? 1 : 0);
}

export const DUPLICATE_THRESHOLD = 0.6;

// Returns [{ keepId, dropId, score }] for likely duplicates the student has not
// marked as different. A student choice (entry.duplicate.keep === true) wins.
export function findDuplicates(entries) {
  const pairs = [];
  const live = entries.filter((e) => !e.removed);
  for (let i = 0; i < live.length; i++) {
    for (let j = i + 1; j < live.length; j++) {
      const a = live[i], b = live[j];
      const score = similarity(a, b);
      if (score < DUPLICATE_THRESHOLD) continue;
      const notDup = (a.notDuplicateOf || []).includes(b.id) || (b.notDuplicateOf || []).includes(a.id);
      if (notDup) continue;
      let keep = priority(a) >= priority(b) ? a : b;
      if (a.preferOver?.includes(b.id)) keep = a;
      else if (b.preferOver?.includes(a.id)) keep = b;
      const drop = keep === a ? b : a;
      pairs.push({ keepId: keep.id, dropId: drop.id, score: Math.round(score * 100) / 100 });
    }
  }
  return pairs;
}

export function duplicateDropIds(entries) {
  return new Set(findDuplicates(entries).map((p) => p.dropId));
}
