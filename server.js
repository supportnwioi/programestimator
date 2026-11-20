import express from 'express';
import multer from 'multer';
import crypto from 'node:crypto';
import path from 'node:path';
import * as store from './src/store.js';
import { runEstimate } from './src/estimate.js';
import { quickEstimate, benchmarks, isPlaceholderUrl } from './src/quickEstimate.js';
import { reviewDocument, aiAvailable } from './src/extract.js';
import { checkForChanges, createDraft, updateDraft, approveDraft, setEnabled, validateRuleset } from './src/rulesetAdmin.js';

store.init();
const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '2mb' }));
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024, files: 20 } });
const ACCEPTED = /\.(pdf|docx|txt|md|png|jpe?g|webp|gif)$/i;

// ---------------- public: configuration ----------------
function publicRuleset(r) {
  return {
    path: r.path, pathName: r.pathName, credential: r.credential, version: r.version, verifiedAt: r.verifiedAt, enabled: r.enabled && r.status === 'approved',
    sources: r.sources.map((s) => ({ title: s.title, url: s.url })), terms: r.terms, creditRules: { note: r.creditRules.note },
    requirements: r.requirements.map((q) => ({
      key: q.key, kind: q.kind, label: q.label, longLabel: q.longLabel, totalHours: q.totalHours, hours: q.hours, areaMin: q.areaMin, areaMax: q.areaMax,
      areaTerm: q.areaTerm, areaTermShort: q.areaTermShort, synchronousMin: q.synchronousMin, specificMin: q.specificMin, specificLabel: q.specificLabel,
      areas: q.areas, conditional: q.conditional, alternative: q.alternative && { question: q.alternative.question, label: q.alternative.label },
      individualMin: q.individualMin, minMonths: q.minMonths, countingNotes: q.countingNotes,
    })),
    // Hour-count questions (clinical, counseling or teaching hours) are not asked publicly.
    outside: (r.outside || []).filter((o) => o.question && o.kind !== 'hours').map((o) => ({ key: o.key, question: o.question, kind: o.kind, label: o.label })),
    quick: benchmarks(r),
  };
}

app.get('/health', (req, res) => res.json({ ok: true }));

// Placeholder links and unconfirmed prices are never shown to the public. A
// signed-in admin sees them in preview mode, clearly labeled.
function publicLinks(s, preview) {
  const link = (u) => (!isPlaceholderUrl(u) ? { url: u, placeholder: false } : preview && u ? { url: u, placeholder: true } : null);
  const enrollment = {};
  for (const [k, u] of Object.entries(s.enrollmentUrls || {})) enrollment[k] = link(u);
  return { scheduling: link(s.schedulingUrl), contact: link(s.contactUrl), enrollment };
}

app.get('/api/config', (req, res) => {
  const s = store.settings.get();
  const preview = Boolean(adminUser(req));
  const paths = ['sex_therapist', 'sexuality_counselor', 'sexuality_educator'].map((k) => store.rulesets.active(k)).filter(Boolean).map(publicRuleset);
  res.json({ paths, links: publicLinks(s, preview), pricingConfirmed: s.pricingConfirmed === true, preview, documentReview: aiAvailable() ? 'ai' : 'offline-demo' });
});

// One-page estimator: aggregate hours from sliders, priced server-side.
app.post('/api/quick-estimate', (req, res) => {
  const r = activeEnabled(req.body?.path);
  if (!r) return res.status(400).json({ error: 'This certification path is not available right now.' });
  const b = req.body || {};
  const val = (v) => (v === 'unsure' ? 'unsure' : v === null || v === undefined || v === '' ? null : Number(v));
  const result = quickEstimate(r, store.settings.get(), { education: val(b.education), supervision: val(b.supervision), sar: b.sar ?? null }, { preview: Boolean(adminUser(req)) });
  res.json(result);
});

function activeEnabled(pathKey) {
  const r = store.rulesets.active(pathKey);
  return r && r.enabled && r.status === 'approved' ? r : null;
}

// ---------------- public: document review ----------------
// Files are processed in memory and not retained unless the student later
// chooses to share them with admissions.
app.post('/api/documents', upload.single('file'), async (req, res) => {
  const r = activeEnabled(req.body.path);
  if (!r) return res.status(400).json({ error: 'Choose an available certification path first.' });
  if (!req.file || !ACCEPTED.test(req.file.originalname)) return res.status(400).json({ error: 'Upload a PDF, Word (.docx), text or image file.' });
  try {
    res.json(await reviewDocument(req.file.buffer, req.file.mimetype, req.file.originalname, r));
  } catch (err) {
    console.error('document review failed:', err.message);
    res.status(422).json({ error: err.message || 'We could not review this document. You can enter the details manually.' });
  }
});

// ---------------- public: estimate ----------------
const num = (v) => { const n = Number(v); return Number.isFinite(n) && n >= 0 && n <= 100000 ? n : null; };
const str = (v, max = 300) => (typeof v === 'string' ? v.slice(0, max) : '');
const oneOf = (v, xs, d) => (xs.includes(v) ? v : d);
const YNU = ['yes', 'no', 'unsure'];

export function sanitizeIntake(intake = {}) {
  const entries = (Array.isArray(intake.entries) ? intake.entries : []).slice(0, 500).map((e) => {
    const base = {
      id: str(e.id, 40) || crypto.randomUUID().slice(0, 8), kind: oneOf(e.kind, ['course', 'supervision', 'sar'], 'course'), title: str(e.title), removed: Boolean(e.removed),
      notDuplicateOf: Array.isArray(e.notDuplicateOf) ? e.notDuplicateOf.map((x) => str(x, 40)) : [], preferOver: Array.isArray(e.preferOver) ? e.preferOver.map((x) => str(x, 40)) : [],
      corrected: Boolean(e.corrected),
      source: e.source && typeof e.source === 'object' ? { type: oneOf(e.source.type, ['document', 'manual'], 'manual'), fileName: str(e.source.fileName), docId: str(e.source.docId, 40), documentType: str(e.source.documentType, 40), excerpt: str(e.source.excerpt, 400), extractor: str(e.source.extractor, 40), model: str(e.source.model, 80) } : { type: 'manual' },
    };
    if (base.kind === 'supervision') return { ...base, supervisorName: str(e.supervisorName), individualHours: num(e.individualHours) ?? 0, groupHours: num(e.groupHours) ?? 0, qualifies: oneOf(e.qualifies, YNU, 'unsure') };
    if (base.kind === 'sar') return { ...base, provider: str(e.provider), date: str(e.date, 40), hours: num(e.hours), aasectApproved: oneOf(e.aasectApproved, YNU, 'unsure') };
    return {
      ...base, courseCode: str(e.courseCode, 40), provider: str(e.provider), date: str(e.date, 40),
      creditType: oneOf(e.creditType, ['academic', 'aasect_ce', 'non_aasect_ce', 'other', 'unsure'], 'unsure'),
      totalAmount: num(e.totalAmount), totalUnit: oneOf(e.totalUnit, ['semester_credits', 'quarter_credits', 'clock_hours', 'ce_hours', 'unsure'], 'unsure'),
      delivery: oneOf(e.delivery, ['synchronous', 'asynchronous', 'unsure'], 'unsure'),
      allocations: (Array.isArray(e.allocations) ? e.allocations : []).slice(0, 60).map((a) => ({
        id: str(a.id, 40), requirement: oneOf(a.requirement, ['core', 'training', 'none'], 'none'), area: str(a.area, 4) || null, topic: str(a.topic),
        hours: a.basis === 'unsure' || a.basis === 'needs_answer' ? null : num(a.hours),
        basis: a.basis === 'needs_answer' ? 'unsure' : oneOf(a.basis, ['stated', 'self_reported', 'unsure', 'manual'], 'manual'),
        sexualitySpecific: a.sexualitySpecific !== false, couples: Boolean(a.couples), suggestedBy: str(a.suggestedBy, 40), evidence: str(a.evidence, 300),
      })),
    };
  });
  const answers = {};
  for (const [k, v] of Object.entries(intake.answers || {}).slice(0, 40)) answers[str(k, 40)] = typeof v === 'number' ? v : str(String(v), 40);
  return { entries, answers };
}

app.post('/api/estimate', (req, res) => {
  const r = activeEnabled(req.body?.path);
  if (!r) return res.status(400).json({ error: 'This certification path is not available right now.' });
  const intake = sanitizeIntake(req.body.intake);
  const settings = store.settings.get();
  const { calc, price, public: pub } = runEstimate(r, intake, settings);
  const id = store.newId('est');
  store.estimates.add({
    id, createdAt: new Date().toISOString(), path: r.path, rulesetId: r.id, rulesetVersion: r.version,
    pricing: { educationRatePerCeHour: settings.educationRatePerCeHour, supervisionRatePerHour: settings.supervisionRatePerHour, sarPrice: settings.sarPrice, priceRangeBuffer: settings.priceRangeBuffer, offerings: settings.offerings[r.path], settingsUpdatedAt: settings.updatedAt },
    price, calc, public: pub, entryCount: intake.entries.length,
  });
  // Unconfirmed (sample) pricing is never shown to the public as an offer.
  if (settings.pricingConfirmed !== true && !adminUser(req)) return res.json({ estimateId: id, ...pub, range: null, personalized: true });
  res.json({ estimateId: id, ...pub, preview: settings.pricingConfirmed !== true });
});

// ---------------- public: share with admissions (optional) ----------------
app.post('/api/estimates/:id/share', upload.array('documents', 20), (req, res) => {
  const est = store.estimates.get(req.params.id);
  if (!est) return res.status(404).json({ error: 'Estimate not found.' });
  let body;
  try { body = JSON.parse(req.body.payload || '{}'); } catch { return res.status(400).json({ error: 'Invalid request.' }); }
  if (body.shareEstimate !== true) return res.status(400).json({ error: 'Sharing requires your permission.' });
  const name = str(body.contact?.name, 120).trim(), email = str(body.contact?.email, 160).trim();
  if (!name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Please add your name and a valid email so admissions can find your estimate.' });
  const files = req.files || [];
  if (files.length && body.shareDocuments !== true) return res.status(400).json({ error: 'Documents were not shared because separate permission was not given.' });
  const id = store.newId('share');
  const rec = {
    id, createdAt: new Date().toISOString(), estimateId: est.id, path: est.path, rulesetVersion: est.rulesetVersion,
    contact: { name, email, phone: str(body.contact?.phone, 40) }, message: str(body.message, 2000),
    consent: { estimateAndIntake: true, documents: body.shareDocuments === true && files.length > 0, recordedAt: new Date().toISOString() },
    intake: sanitizeIntake(body.intake), documentSummaries: (Array.isArray(body.documentSummaries) ? body.documentSummaries : []).slice(0, 20).map((d) => ({ fileName: str(d.fileName), documentType: str(d.documentType, 40), summary: str(d.summary, 1000), extractor: str(d.extractor, 40) })),
    files: [],
  };
  store.shares.save(rec);
  if (rec.consent.documents) for (const f of files) if (ACCEPTED.test(f.originalname)) rec.files.push({ name: store.shares.saveFile(id, f.originalname, f.buffer), size: f.size });
  store.shares.save(rec);
  res.json({ ok: true, shareId: id, documentsShared: rec.files.length });
});

// ---------------- admin ----------------
// In production, never fall back to the published demo password.
const ADMIN_PASSWORD = process.env.NWIOI_ADMIN_PASSWORD
  || (process.env.NODE_ENV === 'production' ? crypto.randomBytes(12).toString('base64url') : 'nwioi-demo-admin');
const sessions = new Map();
const cookie = (req) => Object.fromEntries((req.headers.cookie || '').split(';').map((c) => c.trim().split('=').map(decodeURIComponent)).filter((x) => x[0]));
function adminUser(req) {
  const s = sessions.get(cookie(req).nwioi_admin);
  return s && s.expires >= Date.now() ? s.user : null;
}
function requireAdmin(req, res, next) {
  const user = adminUser(req);
  if (!user) return res.status(401).json({ error: 'Sign in required' });
  req.admin = user;
  next();
}
app.post('/api/admin/login', (req, res) => {
  const a = Buffer.from(String(req.body?.password || '')), b = Buffer.from(ADMIN_PASSWORD);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return res.status(401).json({ error: 'Incorrect password' });
  const token = crypto.randomBytes(24).toString('hex');
  sessions.set(token, { user: str(req.body.name, 60) || 'NWIOI admin', expires: Date.now() + 8 * 3600e3 });
  res.setHeader('Set-Cookie', `nwioi_admin=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800`);
  res.json({ ok: true });
});
app.post('/api/admin/logout', (req, res) => { sessions.delete(cookie(req).nwioi_admin); res.setHeader('Set-Cookie', 'nwioi_admin=; Path=/; Max-Age=0'); res.json({ ok: true }); });
app.get('/api/admin/session', requireAdmin, (req, res) => res.json({ user: req.admin }));

app.get('/api/admin/settings', requireAdmin, (req, res) => res.json(store.settings.get()));
app.put('/api/admin/settings', requireAdmin, (req, res) => {
  const cur = store.settings.get(), b = req.body || {};
  const money = (v, d) => { const n = Number(v); return Number.isFinite(n) && n >= 0 ? n : d; };
  const url = (v, d) => (typeof v === 'string' && /^(https?:\/\/|mailto:)/i.test(v.trim()) ? v.trim() : d);
  const offerings = structuredClone(cur.offerings);
  for (const k of Object.keys(offerings)) for (const r of Object.keys(offerings[k])) if (typeof b.offerings?.[k]?.[r] === 'boolean') offerings[k][r] = b.offerings[k][r];
  const next = {
    ...cur, educationRatePerCeHour: money(b.educationRatePerCeHour, cur.educationRatePerCeHour), supervisionRatePerHour: money(b.supervisionRatePerHour, cur.supervisionRatePerHour),
    sarPrice: money(b.sarPrice, cur.sarPrice), priceRangeBuffer: money(b.priceRangeBuffer, cur.priceRangeBuffer),
    schedulingUrl: url(b.schedulingUrl, cur.schedulingUrl), contactUrl: url(b.contactUrl, cur.contactUrl), offerings,
    pricingConfirmed: typeof b.pricingConfirmed === 'boolean' ? b.pricingConfirmed : cur.pricingConfirmed === true,
    enrollmentUrls: Object.fromEntries(Object.keys(store.DEFAULT_SETTINGS.enrollmentUrls).map((k) => {
      const v = b.enrollmentUrls?.[k];
      return [k, v === '' ? '' : url(v, cur.enrollmentUrls?.[k] || '')];
    })),
    updatedAt: new Date().toISOString(), updatedBy: req.admin,
  };
  store.settings.save(next);
  res.json(next);
});

app.get('/api/admin/rulesets', requireAdmin, (req, res) => {
  res.json({ active: store.rulesets.activeIds(), rulesets: store.rulesets.all().map((r) => ({ ...r, validationErrors: validateRuleset(r) })), lastCheck: store.checks.get() });
});
app.post('/api/admin/rulesets/check', requireAdmin, async (req, res) => res.json(await checkForChanges()));
const wrap = (fn) => (req, res) => { try { res.json(fn(req)); } catch (e) { res.status(400).json({ error: e.message, details: e.details }); } };
app.post('/api/admin/rulesets/:path/draft', requireAdmin, wrap((req) => createDraft(req.params.path, req.admin)));
app.put('/api/admin/rulesets/:id', requireAdmin, wrap((req) => updateDraft(req.params.id, req.body)));
app.post('/api/admin/rulesets/:id/approve', requireAdmin, wrap((req) => approveDraft(req.params.id, req.admin, req.body || {})));
app.post('/api/admin/paths/:path/enabled', requireAdmin, wrap((req) => setEnabled(req.params.path, req.body?.enabled)));

app.get('/api/admin/estimates', requireAdmin, (req, res) => res.json(store.estimates.all().reverse().slice(0, 200)));
app.get('/api/admin/shares', requireAdmin, (req, res) => res.json(store.shares.all().sort((a, b) => b.createdAt.localeCompare(a.createdAt))));
app.get('/api/admin/shares/:id/files/:name', requireAdmin, (req, res) => res.download(store.shares.filePath(req.params.id, req.params.name)));

// ---------------- static ----------------
app.use(express.static(path.join(store.ROOT, 'public'), { extensions: ['html'] }));

const PORT = Number(process.env.PORT || 3000);
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  app.listen(PORT, () => {
    console.log(`NWIOI estimator running at http://localhost:${PORT}  (admin: /admin)`);
    console.log(`Document review: ${aiAvailable() ? 'Claude (AI)' : 'offline demo extractor — set ANTHROPIC_API_KEY for AI review'}`);
    if (!process.env.NWIOI_ADMIN_PASSWORD) console.log(`Admin password: ${ADMIN_PASSWORD} (set NWIOI_ADMIN_PASSWORD to choose one)`);
  });
}
export default app;
