// End-to-end: drives the real UI in Chromium against a fresh server.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium, devices } = require('playwright');
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'nwioi-e2e-'));
const PORT = 3200 + Math.floor(Math.random() * 500);
const BASE = `http://localhost:${PORT}`;
const SHOTS = process.env.E2E_SCREENSHOTS;
const sample = (f) => path.join(ROOT, 'samples', f);

// Main server (public): real links (test values); only the Educator Core Program is approved.
// Second server (preview): shipped defaults (draft catalog, placeholder links) with NWIOI_PREVIEW=1.
const LINKS = { schedulingUrl: 'https://calendar.nwioi-test.org/admissions', contactUrl: 'mailto:admissions@nwioi-test.org' };
const ENROLL_EDU = 'https://nwioi-test.org/enroll/educator';
const DATA2 = fs.mkdtempSync(path.join(os.tmpdir(), 'nwioi-e2e-preview-'));
const PORT2 = PORT + 1;
const BASE2 = `http://localhost:${PORT2}`;
fs.writeFileSync(path.join(DATA, 'settings.json'), JSON.stringify(LINKS));
const catalog = JSON.parse(fs.readFileSync(path.join(ROOT, 'config/tracks.json'), 'utf8'));
Object.assign(catalog.credentials.sexuality_educator.core, { status: 'approved', links: { enroll: ENROLL_EDU, supervisors: '', sampleWeekend: '' } });
fs.writeFileSync(path.join(DATA, 'tracks.json'), JSON.stringify(catalog));

let server, server2, browser;
function startServer(port, dataDir, extra = {}) {
  const env = { ...process.env, PORT: String(port), NWIOI_DATA_DIR: dataDir, ...extra };
  delete env.NWIOI_PREVIEW;
  Object.assign(env, extra);
  delete env.ANTHROPIC_API_KEY; // offline extractor for deterministic tests
  const proc = spawn('node', ['server.js'], { cwd: ROOT, env, stdio: 'pipe' });
  return new Promise((res, rej) => { proc.stdout.on('data', (d) => String(d).includes('running') && res(proc)); proc.on('exit', rej); });
}
test.before(async () => {
  [server, server2] = await Promise.all([startServer(PORT, DATA), startServer(PORT2, DATA2, { NWIOI_PREVIEW: '1' })]);
  browser = await chromium.launch();
});
test.after(async () => { await browser?.close(); server?.kill(); server2?.kill(); });

// The detailed estimator is internal: sign in as admin first.
async function newPage(url = `${BASE}/detailed`, opts = {}) {
  const page = await browser.newPage({ viewport: { width: 1100, height: 900 }, ...opts });
  page.on('dialog', (d) => d.accept());
  page.on('pageerror', (e) => { throw e; });
  if (url.endsWith('/detailed')) await page.request.post(`${BASE}/api/admin/login`, { data: { password: 'nwioi-demo-admin', name: 'E2E' } });
  await page.goto(url);
  return page;
}
const shot = async (page, name) => SHOTS && page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: true });
const answer = (page, key, value) => page.check(`input[data-answer="${key}"][value="${value}"]`);

async function addGrid(page, reqLabel, hoursByArea, { creditType = 'aasect_ce', delivery = 'synchronous', title } = {}) {
  await page.click('button[data-action="add-grid"]');
  if (title) await page.fill('#ed-title', title);
  await page.selectOption('#ed-greq', { label: reqLabel });
  await page.selectOption('#ed-ct', creditType);
  await page.selectOption('#ed-del', delivery);
  for (const [a, h] of Object.entries(hoursByArea)) await page.fill(`[data-grid="${a}"]`, String(h));
  await page.click('#ed-form button[type=submit]');
}
async function addSupervision(page, name, ind, grp, qualifies = 'yes') {
  await page.click('button[data-action="add-supervision"]');
  await page.fill('#ed-sn', name);
  await page.fill('#ed-si', String(ind));
  await page.fill('#ed-sg', String(grp));
  await page.check(`#ed-form input[data-e="qualifies"][value="${qualifies}"]`);
  await page.click('#ed-form button[type=submit]');
}
async function upload(page, files) {
  await page.setInputFiles('#file-input', files.map(sample));
  await page.waitForFunction((n) => document.querySelectorAll('#doc-list .entry .chip.ok, #doc-list .entry .chip.warn').length >= n, files.length);
}
async function results(page) {
  await page.click('button[data-action="estimate"]');
  await page.waitForSelector('[data-testid="range"]');
  return {
    range: await page.textContent('[data-testid="range"]'),
    items: await page.$$eval('[data-testid="checklist"] > li > strong', (els) => els.map((e) => e.textContent)),
    text: await page.textContent('main'),
  };
}
const latestEstimate = () => fs.readFileSync(path.join(DATA, 'estimates.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l)).at(-1);

test('Sex Therapist — mixed upload + manual entry, follow-ups, duplicate, share without documents', async () => {
  const page = await newPage();
  await page.click('button[data-path="sex_therapist"]');
  await page.click('button[data-method="both"]');
  // Privacy link sits next to the upload option.
  const privacy = page.locator('#up-h + a[href="/privacy"]');
  assert.equal(await privacy.textContent(), 'Privacy and data retention');
  await upload(page, ['syllabus-HSX620.pdf', 'transcript-northwest-university.pdf']);
  await shot(page, '1-st-intake-uploads');

  // Same course entered manually (also on the transcript): should be flagged and counted once.
  await page.click('button[data-action="add-course"]');
  await page.fill('#ed-title', 'HSX 610 Human Sexual Anatomy');
  await page.fill('#ed-prov', 'Northwest University');
  await page.fill('#ed-amt', '3');
  await page.selectOption('[data-alloc] [data-f="area"]', 'G');
  await page.fill('[data-alloc] [data-f="hours"]', '20');
  await page.click('#ed-form button[type=submit]');

  // Remaining core hours by area (manual grid) — overall total met, but area Q left short.
  await addGrid(page, 'Core knowledge', { A: 6, C: 5, E: 5, F: 5, I: 8, M: 5, N: 4, O: 4, P: 4, Q: 1 }, { title: 'CE workshops (my totals)' });
  await addGrid(page, 'Sex therapy training', { A: 12, B: 10, C: 4, D: 6, E: 6, F: 6 }, { title: 'Sex therapy training CE' });
  await addSupervision(page, 'Dr. Jordan Lee', 20, 15);
  await answer(page, 'sarCompleted', 'no');
  await answer(page, 'hasCouplesTraining', 'yes');
  await answer(page, 'tenYearsSexTherapy', 'no');
  await answer(page, 'hasClinicalDegree', 'yes');
  await answer(page, 'hasLicense', 'yes');
  await answer(page, 'aasectMember', 'unsure');
  assert.equal(await page.locator('input[data-answer="clinicalHoursUnderContract"]').count(), 0, 'no clinical-hours question');
  await page.click('button[data-action="to-review"]');

  // Review: follow-up questions for topics without stated hours.
  const fus = await page.$$eval('.followup p strong', (els) => els.map((e) => e.textContent));
  assert.ok(fus.includes('About how many hours of instruction in this course were spent on “Substance use and sexuality”?'), fus.join('\n'));
  await page.fill('[data-fu-input]:near(:text("Substance use and sexuality"))', '3');
  await page.click('.followup:has-text("Substance use and sexuality") button[data-action="fu-save"]');
  await page.click('.followup:has-text("Human Sexual Anatomy and Health") button[data-action="fu-save"]').catch(() => {});
  // Answer anatomy (transcript) with a number and mark the others "not sure".
  await page.fill('.followup:has-text("Human Sexual Anatomy and Health") input', '10');
  await page.click('.followup:has-text("Human Sexual Anatomy and Health") button[data-action="fu-save"]');
  while (await page.locator('.followup button[data-action="fu-unsure"]').count()) await page.locator('.followup button[data-action="fu-unsure"]').first().click();
  assert.match(await page.textContent('main'), /likely duplicate/);
  assert.match(await page.textContent('main'), /Possible duplicate of/);
  assert.match(await page.textContent('main'), /Self-reported/);
  assert.match(await page.textContent('main'), /From document: syllabus-HSX620\.pdf/);
  assert.match(await page.textContent('main'), /Entered manually/);
  await shot(page, '2-st-review');

  const r = await results(page);
  await shot(page, '3-st-results');
  const est = latestEstimate();
  const core = est.calc.requirements.core;
  // Syllabus 31 stated + 3 self-reported L, transcript anatomy 10 (manual duplicate dropped), grid 47.
  assert.equal(core.areas.find((a) => a.key === 'G').counted, 19, 'G: syllabus 9 + transcript 10; manual duplicate not counted');
  assert.equal(core.areas.find((a) => a.key === 'L').counted, 3);
  assert.equal(core.counted, 91, 'overall 90 met');
  assert.equal(core.areas.find((a) => a.key === 'D').shortfall, 3, 'transcript HSX 615 hours marked not sure');
  assert.equal(core.areas.find((a) => a.key === 'Q').shortfall, 2);
  assert.ok(est.calc.duplicates.length === 1);
  assert.deepEqual(r.items, est.public.checklist.map((c) => c.text));
  assert.equal(r.items[0], 'Core knowledge — 5 hours, all in 2 Core Knowledge Areas where the minimum has not yet been met');
  assert.equal(r.items[1], 'Sex therapy training — 16 hours');
  assert.equal(r.items[2], 'Supervision — 15 hours');
  assert.equal(r.items[3], 'SAR — Appears outstanding');
  assert.match(r.text, /Also required for AASECT certification: .*300 hours of clinical treatment/s);
  assert.match(r.text, /AASECT membership/);
  // Private pricing is never shown to the student.
  for (const leak of ['$35', '$185', '35/', 'per hour', 'per CE hour', '$650']) assert.ok(!r.text.includes(leak), `leaked ${leak}`);
  const expected = est.price.amount;
  assert.equal(r.range, `$${Math.max(0, expected - 500).toLocaleString('en-US')}–$${(expected + 500).toLocaleString('en-US')}`);

  // Booking a call needs no sharing: link goes straight to the configured calendar.
  assert.equal(await page.getAttribute('[data-testid="schedule"]', 'href'), LINKS.schedulingUrl);
  assert.equal(await page.getAttribute('[data-testid="ask"]', 'href'), LINKS.contactUrl);
  // Schedule CTA follows the checklist and explanatory copy.
  const order = await page.evaluate(() => {
    const ck = document.querySelector('[data-testid="checklist"]'), copy = [...document.querySelectorAll('p')].find((p) => p.textContent.startsWith('NWIOI considers')), cta = document.querySelector('[data-testid="schedule"]');
    const pos = (a, b) => a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING;
    return Boolean(pos(ck, copy) && pos(copy, cta) && copy.nextElementSibling.contains(cta));
  });
  assert.ok(order, 'Schedule button sits directly after the checklist and copy');
  assert.equal(fs.existsSync(path.join(DATA, 'shares')), false, 'nothing shared just by viewing the estimate');

  // Share estimate + intake, but not documents.
  await page.check('#share-estimate');
  await page.fill('#sh-name', 'Sample Student');
  await page.fill('#sh-email', 'student@example.com');
  assert.equal(await page.isChecked('#share-docs'), false);
  await page.click('#share-form button[type=submit]');
  await page.waitForSelector('text=Shared with admissions (no documents shared)');
  const shareDir = fs.readdirSync(path.join(DATA, 'shares'));
  const rec = JSON.parse(fs.readFileSync(path.join(DATA, 'shares', shareDir[0], 'share.json')));
  assert.equal(rec.consent.documents, false);
  assert.equal(rec.files.length, 0);
  assert.equal(fs.readdirSync(path.join(DATA, 'shares', shareDir[0])).length, 1, 'only share.json, no documents stored');
  assert.ok(rec.intake.entries.some((e) => e.source.type === 'document' && e.source.fileName === 'syllabus-HSX620.pdf'));
  await page.close();
});

test('Sexuality Counselor — manual only, with "not sure" answers and a domain cap', async () => {
  const page = await newPage();
  await page.click('button[data-path="sexuality_counselor"]');
  await page.click('button[data-method="manual"]');
  assert.equal(await page.locator('#file-input').count(), 0, 'no upload needed');
  // 30 hours in area A (capped at 20), 3+ everywhere else except D, which is "not sure".
  await addGrid(page, 'Core knowledge', { A: 30, B: 5, C: 5, E: 5, F: 5, G: 5, H: 5, I: 5, J: 5, K: 5, L: 5, M: 5, N: 5, O: 5, P: 5, Q: 5 }, { delivery: 'asynchronous' });
  // A course whose topic hours are unknown.
  await page.click('button[data-action="add-course"]');
  await page.fill('#ed-title', 'Gender and Sexuality Seminar');
  await page.selectOption('[data-alloc] [data-f="area"]', 'D');
  await page.check('[data-alloc] [data-f="unsure"]');
  await page.click('#ed-form button[type=submit]');
  await addGrid(page, 'Sexuality counseling skills training', { A: 20, B: 15, C: 10, D: 5, E: 5, F: 5 }, { delivery: 'synchronous' });
  await addSupervision(page, 'Supervisor A', 5, 20);
  await addSupervision(page, 'Supervisor B', 4, 0, 'unsure');
  await answer(page, 'sarCompleted', 'unsure');
  await answer(page, 'licensedPsychotherapist', 'yes');
  await answer(page, 'hasDegreeAndExperience', 'yes');
  await answer(page, 'aasectMember', 'yes');
  assert.equal(await page.locator('[data-answer="counselingHours"], [data-answer-unsure="counselingHours"]').count(), 0, 'no counseling-hours question');
  await page.click('button[data-action="to-review"]');
  const r = await results(page);
  await shot(page, '4-sc-results');
  const est = latestEstimate();
  const core = est.calc.requirements.core;
  assert.equal(core.areas.find((a) => a.key === 'A').counted, 20, 'cap applied');
  assert.equal(core.areas.find((a) => a.key === 'A').excessOverCap, 10);
  assert.equal(core.counted, 95);
  assert.equal(core.remaining, 15, 'overall met; D short 3; 15 synchronous needed — counted once');
  assert.equal(r.items[0], 'Core knowledge — 15 hours, including 3 hours in a Core Knowledge Area where the minimum has not yet been met');
  assert.match(r.text, /At least 15 hours of these must be synchronous/);
  assert.equal(est.calc.requirements.training.remaining, 0);
  assert.equal(r.items[1], 'Sexuality counseling skills training — appears complete');
  assert.equal(r.items[2], 'Supervision — 10 hours', '5 ind + 15 counted group (cap) = 20; individual 10 short');
  assert.equal(r.items[3], 'SAR — Needs admissions review');
  assert.match(r.text, /not eligible for Sexuality Counselor certification/);
  assert.match(r.text, /Items admissions will review/);
  assert.match(r.text, /Gender and Sexuality Seminar: hours spent on/);
  assert.match(r.text, /Supervisor B: 4 hours — supervisor certification\/contract not confirmed/);
  assert.equal(est.price.lines.find((l) => l.key === 'sar'), undefined, 'SAR under review is not priced');
  await page.close();
});

test('Sexuality Educator — upload only; share documents with separate permission; $0 floor', async () => {
  const page = await newPage();
  await page.click('button[data-path="sexuality_educator"]');
  await page.click('button[data-method="upload"]');
  await upload(page, ['sar-certificate.txt', 'ce-certificate-sensate-focus.txt']);
  await answer(page, 'hasDegree', 'yes');
  await answer(page, 'aasectMember', 'yes');
  await page.click('button[data-action="to-review"]');
  assert.match(await page.textContent('main'), /Offline demo extractor/);
  let r = await results(page);
  assert.equal(r.items.at(-1), 'SAR — Appears complete');
  assert.match(r.items[0], /^Core knowledge — 90 hours/);

  // Now a nearly complete educator: only 1 supervision hour left -> lower bound floors at $0.
  await page.click('button[data-action="go"][data-step="review"]');
  await addGrid(page, 'Core knowledge', Object.fromEntries('ABCDEFGHIJKLMNOPQ'.split('').map((a) => [a, 6])));
  await addGrid(page, 'Sexuality education skills training', { A: 12, B: 12, C: 12, D: 12, E: 12 });
  await addSupervision(page, 'Educator Supervisor', 5, 19);
  r = await results(page);
  await shot(page, '5-se-results-floor');
  assert.equal(r.range, '$0–$685');
  assert.deepEqual(r.items, ['Core knowledge — appears complete', 'Sexuality education skills training — appears complete', 'Supervision — 1 hour', 'SAR — Appears complete']);

  // Share documents only with the separate checkbox.
  await page.check('#share-estimate');
  await page.fill('#sh-name', 'Educator Student');
  await page.fill('#sh-email', 'edu@example.com');
  await page.check('#share-docs');
  await page.click('#share-form button[type=submit]');
  await page.waitForSelector('text=including 2 documents');
  const dirs = fs.readdirSync(path.join(DATA, 'shares'));
  const recs = dirs.map((d) => JSON.parse(fs.readFileSync(path.join(DATA, 'shares', d, 'share.json'))));
  const rec = recs.find((x) => x.contact.email === 'edu@example.com');
  assert.equal(rec.consent.documents, true);
  assert.deepEqual(rec.files.map((f) => f.name).sort(), ['ce-certificate-sensate-focus.txt', 'sar-certificate.txt']);
  await page.close();
});

test('Admin: pricing changes affect new estimates and are recorded; settings are private', async () => {
  const anon = await fetch(`${BASE}/api/admin/settings`);
  assert.equal(anon.status, 401);
  const cfg = await (await fetch(`${BASE}/api/config`)).json();
  assert.ok(!JSON.stringify(cfg).match(/educationRate|supervisionRate|sarPrice|priceRangeBuffer/));
  const page = await newPage(`${BASE}/admin`);
  await page.fill('#pw', 'nwioi-demo-admin');
  await page.fill('#nm', 'E2E Admin');
  await page.click('#login button');
  await page.waitForSelector('#settings');
  await page.fill('#sp', '900');
  await page.fill('#bf', '250');
  await page.click('#settings button[type=submit]');
  await page.waitForSelector('text=Saved.');
  await shot(page, '6-admin-pricing');
  const body = { path: 'sex_therapist', intake: { entries: [], answers: { sarCompleted: 'no' } } };
  const anonRes = await (await fetch(`${BASE}/api/estimate`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })).json();
  assert.equal(anonRes.range, null, 'itemized retail pricing is internal only');
  const res = await (await page.request.post(`${BASE}/api/estimate`, { data: body })).json();
  const est = latestEstimate();
  assert.equal(est.pricing.sarPrice, 900);
  assert.equal(est.pricing.priceRangeBuffer, 250);
  assert.equal(est.rulesetVersion, '2026.T.1');
  const amount = 150 * 35 + 50 * 185 + 900;
  assert.equal(est.price.amount, amount);
  assert.equal(res.range.low, amount - 250);
  await page.click('button[data-tab="rulesets"]');
  await page.waitForSelector('text=Requirements rulesets');
  await shot(page, '7-admin-rulesets');
  await page.click('button[data-tab="shares"]');
  await page.waitForSelector('text=Sample Student');
  assert.match(await page.textContent('main'), /No \(student did not give permission\)/);
  await page.close();
});



// ---------------------------------------------------------------- track finder (default page)
const text = (page, sel) => page.textContent(sel);
async function choose(page, cred) { await page.check(`input[name="path"][value="${cred}"]`); if (cred !== 'deciding') await page.waitForSelector('[data-testid="rec-price"]'); }
async function hours(page, k, v) {
  if (v === undefined) return;
  if (v === 'unsure') await page.click(`[data-unsure="${k}"]`);
  else if (v === 0) await page.click(`[data-zero="${k}"]`);
  else await page.fill(`#${k}-num`, String(v));
}
async function openCategories(page) { if (!(await page.evaluate(() => document.getElementById('by-category')?.open))) await page.click('#by-category summary'); }
async function categories(page, core, skills) { await openCategories(page); await hours(page, 'core', core); await hours(page, 'skills', skills); }
async function college(page, answer, amount, unit = 'credits') {
  await page.check(`input[name="college"][value="${answer}"]`);
  if (answer === 'yes') {
    await page.check(`input[name="collegeUnit"][value="${unit}"]`);
    if (amount !== undefined) await page.fill('#college-amount', String(amount));
  }
}
// One CE total plus who approved it; several types → "Some of each".
async function ce(page, answer, { aasect, other, unsure } = {}) {
  await page.check(`input[name="ce"][value="${answer}"]`);
  const given = [['aasect', aasect], ['other', other], ['unsure', unsure]].filter(([, v]) => v !== undefined);
  if (given.length > 1) {
    await page.check('input[name="ceApproval"][value="mix"]');
    for (const [k, v] of given) await page.fill(`#ce-${k}`, String(v));
  } else if (given.length === 1) {
    await page.fill('#ce-amount', String(given[0][1]));
    await page.check(`input[name="ceApproval"][value="${given[0][0]}"]`);
  }
}
async function openBuilder(page) {
  if (await page.locator('#ala-flow').count()) return;
  await page.click('[data-testid="ala-action"]');
  await page.waitForSelector('#ala-flow');
}
async function settled(page) {
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(250);
  await page.waitForLoadState('networkidle');
}
const PLANNING = 'This is a planning estimate. We’ll review your prior training and coursework options together and confirm your NWIOI tuition before you enroll.';
const NOTE = 'This is a planning estimate. NWIOI can help you review your transcripts and CE certificates and identify what you may still need. AASECT makes the final determination about which hours count toward certification.';
const barShown = (page) => page.evaluate(() => document.getElementById('price-bar').classList.contains('is-shown'));
const squash = (t) => t.replace(/\s+/g, ' ').trim();

test('Track finder: headline, credential, then the AASECT requirements guide for that credential', async () => {
  const page = await newPage(BASE2);
  assert.equal(await text(page, 'h1'), 'Build on the training you’ve already done.');
  assert.equal(await page.locator('[data-testid="guide"]').count(), 0, 'guide appears after a credential is chosen');
  const labels = { sex_therapist: ['Sex Therapy Skills Training', 'sex therapy'], sexuality_counselor: ['Sexuality Counseling Skills Training', 'sexuality counseling'], sexuality_educator: ['Sexuality Education Skills Training', 'sexuality education'] };
  for (const [cred, [label, field]] of Object.entries(labels)) {
    await choose(page, cred);
    await settled(page);
    const g = squash(await text(page, '[data-testid="guide-table"]'));
    assert.match(g, /90 hours · Core Knowledge Areas \(CKAs\)\s*What you know about human sexuality\. At least 15 hours must be live, in person or online\./);
    assert.match(g, new RegExp(`60 hours · ${label}\\s*How you apply what you know in ${field}\\. At least 30 hours must be live, in person or online\\.`));
    assert.match(squash(await text(page, '[data-testid="sar-note"]')), /150 coursework hours.*14 hours of Sexuality Attitude Reassessment \(SAR\)/);
    assert.equal(await page.isVisible('#full-reqs ol'), false, 'details behind “See the full education requirements”');
    await page.click('#full-reqs summary');
    const full = squash(await text(page, '#full-reqs'));
    assert.match(full, /At least 3 hours in each of the 17 areas, and no more than 20 hours in any one area/);
    if (cred === 'sex_therapist') assert.match(full, /16 of the 60 hours must be couples counseling training/);
    else assert.match(full, new RegExp(`at least 30 hours must be specific to ${field}`));
    assert.equal(await page.getAttribute('[data-testid="cka-link"]', 'href'), 'https://www.aasect.org/certification/core-knowledge-areas');
    assert.match(await page.getAttribute('[data-testid="official-link"]', 'href'), /^https:\/\/www\.aasect\.org\//);
    await page.click('#full-reqs summary');
  }
  await page.close();
});

test('Track finder: college question first (AASECT degree requirements link); class hours or semester credits; credits convert at 15 hours each', async () => {
  const page = await newPage(BASE2);
  await choose(page, 'sex_therapist');
  await settled(page);
  assert.equal(squash(await text(page, '[data-testid="college-q"] legend')), 'Did you take any college or university classes that covered human sexuality?');
  assert.equal(await text(page, '[data-testid="college-help"]'), 'Think about classes you took at an accredited school, even if only part of a class covered sexuality. A rough estimate is fine.');
  assert.equal(await text(page, '[data-testid="academic-link"]'), 'AASECT degree requirements');
  assert.equal(await page.getAttribute('[data-testid="academic-link"]', 'href'), 'https://www.aasect.org/career/academic-qualifications');
  const order = await page.evaluate(() => document.querySelector('[data-testid="college-q"]').getBoundingClientRect().top < document.querySelector('[data-testid="ce-q"]').getBoundingClientRect().top);
  assert.ok(order, 'college before CE');
  await choose(page, 'sexuality_educator');
  await settled(page);
  await page.check('input[name="college"][value="yes"]');
  assert.equal(squash(await text(page, '[data-testid="college-follow"] legend')), 'How would you like to enter your coursework?');
  assert.deepEqual(await page.$$eval('input[name="collegeUnit"]', (els) => els.map((e) => e.parentElement.textContent.trim())), ['Class hours', 'Semester credits']);
  assert.equal(await page.locator('#college-amount').count(), 0, 'amount appears after choosing how to enter it');
  await college(page, 'yes', 6, 'hours');
  assert.equal(await text(page, 'label[for="college-amount"]'), 'About how many class hours covered sexuality?');
  assert.equal(await text(page, '[data-testid="hours-help"]'), 'For example, if you spent about 6 hours on sexuality topics in a longer course, enter 6.');
  assert.equal(await page.locator('[data-testid="credits-help"]').count(), 0, 'conversion example only in the credits view');
  await college(page, 'yes', 3);
  await settled(page);
  assert.equal(await text(page, 'label[for="college-amount"]'), 'About how many semester credits were for classes focused on sexuality?');
  assert.equal(await text(page, '[data-testid="credits-help"]'), 'AASECT’s example: three semester credits = 45 clock hours. If only part of a class covered sexuality, choose Class hours to estimate that portion.');
  assert.match(await text(page, '[data-testid="credits-out"]'), /= about 45 clock hours/);
  assert.match(squash(await text(page, '[data-testid="result-body"]')), /About 45 hours may count toward the 150 coursework hours:/);
  await college(page, 'yes', 20, 'hours');
  await settled(page);
  assert.match(squash(await text(page, '[data-testid="result-body"]')), /About 20 hours/);
  await page.close();
});

test('Track finder: Yes path — college plus both CE types; unsure CE pending; categories stay unassigned; one primary action', async () => {
  const page = await newPage(BASE2);
  await choose(page, 'sexuality_counselor');
  await college(page, 'yes', 6);
  await ce(page, 'yes', { aasect: 10, other: 12, unsure: 4 });
  await settled(page);
  assert.equal(await text(page, '[data-testid="result-h"]'), 'Here’s what may count toward your education requirements');
  assert.match(squash(await text(page, '[data-testid="result-body"]')), /About 106 hours may count toward the 150 coursework hours/);
  assert.match(squash(await text(page, '[data-testid="college-line"]')), /about 90 hours \(6 semester credits\)/);
  assert.match(squash(await text(page, '[data-testid="ce-line"]')), /about 16 hours \(10 AASECT-approved; 12 from another CE body, counted at half value\)/);
  assert.match(squash(await text(page, '[data-testid="pending"]')), /4 CE credits pending review/);
  assert.match(squash(await text(page, '[data-testid="unassigned-note"]')), /aren’t assigned to Core Knowledge or Sexuality Counseling Skills Training yet/);
  assert.equal(await page.locator('[data-testid="ala-coursework-cost"], [data-testid="ala-line"]').count(), 0, 'no À La Carte figure from a rough total');
  assert.match(squash(await text(page, '[data-testid="core-line"]')), /Up to 51 of your prior hours could reduce the coursework you still need: estimated 0–51 hours remaining\. Estimated cost if purchased at \$35 per hour: \$0–\$1,785\./, 'a rough 106-hour total guarantees no reduction: the full gap stays the upper end');
  assert.equal(squash(await text(page, '[data-testid="planning-note"]')), NOTE);
  assert.equal(await page.locator('.quick-result .btn.primary').count(), 1);
  assert.equal(await text(page, '.quick-result [data-testid="primary-cta"]'), 'Inquire About Training');
  // Category detail: assigned hours give the detailed estimate; the rest stays unassigned.
  await page.click('[data-open-categories]');
  await hours(page, 'core', 60);
  await hours(page, 'skills', 29);
  await page.fill('#live-core', '10');
  await settled(page);
  assert.match(squash(await text(page, '[data-testid="cat-line"]')), /Core Knowledge: 60 of 90 hours · Sexuality Counseling Skills Training: 29 of 60 hours/);
  assert.match(squash(await text(page, '[data-testid="unassigned"]')), /About 17 more hours not yet assigned to a category/);
  assert.match(squash(await text(page, '[data-testid="live-core"]')), /10 of 15 required live hours/);
  assert.match(squash(await text(page, '[data-testid="ala-line"]')), /^À La Carte only \(without Core\), based on your answers: estimated coursework still needed: about 61 hours \(30 core knowledge, 31 sexuality counseling skills training\)\. Estimated cost if purchased at \$35 per hour: \$2,135\.$/);
  assert.match(squash(await text(page, '[data-testid="core-line"]')), /^What you may still need after Core: Core’s 99 hours leave about 51 hours of the 150\. The split between Core Knowledge and skills training is still being confirmed for this credential\. Up to 51 of your prior hours could reduce the coursework you still need: estimated 0–51 hours remaining\. Estimated cost if purchased at \$35 per hour: \$0–\$1,785\./);
  assert.equal(await text(page, '[data-testid="ala-remaining"]'), '61 hours');
  assert.match(squash(await text(page, '[data-track="alaCarte"]')), /Estimated coursework still needed\s*61 hours\s*Estimated cost if purchased at \$35 per hour: \$2,135\s*Based on your answers, buying courses individually without Core/);
  assert.equal(await text(page, '[data-testid="ala-coursework-cost"]'), '$2,135');
  assert.equal(await text(page, '[data-testid="rec-price"]'), '$7,450', 'Core tuition fixed');
  await page.close();
});

test('Track finder: No path — CE can be entered with no college coursework; No to both is handled', async () => {
  const page = await newPage(BASE2);
  await choose(page, 'sex_therapist');
  await college(page, 'no');
  await ce(page, 'yes', { other: 20 });
  await settled(page);
  assert.match(squash(await text(page, '[data-testid="result-body"]')), /About 10 hours may count/);
  assert.equal(await page.locator('[data-testid="college-line"]').count(), 0);
  await ce(page, 'no');
  await settled(page);
  assert.match(squash(await text(page, '[data-testid="result-body"]')), /haven’t reported prior coursework yet/);
  assert.equal(await text(page, '.quick-result [data-testid="primary-cta"]'), 'Inquire About Training');
  assert.equal(await text(page, '[data-testid="rec-price"]'), '$8,200');
  await page.close();
});

test('Track finder: I’m not sure path — review offered directly, nothing guessed; CE unsure credits too', async () => {
  const page = await newPage(BASE2);
  await choose(page, 'sexuality_educator');
  await college(page, 'unsure');
  await settled(page);
  assert.match(squash(await text(page, '[data-testid="result-body"]')), /Not sure\? That’s common\. We can go through your transcripts and CE certificates with you/);
  assert.equal(await text(page, '.quick-result [data-testid="primary-cta"]'), 'Inquire About Training');
  assert.equal(squash(await text(page, '[data-testid="planning-note"]')), NOTE);
  await ce(page, 'yes', { unsure: 6 });
  await settled(page);
  assert.match(squash(await text(page, '[data-testid="pending"]')), /6 CE credits with an unknown approval body will be reviewed/);
  await ce(page, 'unsure');
  await settled(page);
  assert.match(squash(await text(page, '[data-testid="result-body"]')), /Not sure\?/);
  await page.close();
});

test('Track finder (preview): two compact options below the result; Core tuition fixed; comparison and builder behind links', async () => {
  const page = await newPage(BASE2);
  const expect = { sex_therapist: ['$8,200', '$7,790.00'], sexuality_counselor: ['$7,450', '$7,077.50'], sexuality_educator: ['$6,950', '$6,602.50'] };
  for (const [cred, [std, pif]] of Object.entries(expect)) {
    await choose(page, cred);
    await settled(page);
    assert.equal(await text(page, '[data-testid="rec-price"]'), std, cred);
    assert.equal(await text(page, '[data-testid="pay-full-total"]'), pif);
    await college(page, 'yes', 4);
    await settled(page);
    assert.equal(await text(page, '[data-testid="rec-price"]'), std, 'Core tuition stays with prior coursework');
  }
  assert.equal(await text(page, '[data-testid="core-key"]'), '99 CEUs, supervision, and SAR included');
  assert.match(await text(page, '[data-track="alaCarte"]'), /Choose individual courses or supervision\./);
  const order = await page.evaluate(() => document.querySelector('[data-testid="quick-result"]').getBoundingClientRect().bottom <= document.querySelector('[data-testid="options"]').getBoundingClientRect().top);
  assert.ok(order, 'options below the result');
  assert.equal(await page.isVisible('[data-testid="compare-table"]'), false);
  await page.click('#compare summary');
  assert.match(await text(page, '[data-testid="compare-table"]'), /Core Program\s*Tier I\s*À La Carte\s*Tier II/);
  assert.equal(await page.locator('#ala-flow').count(), 0);
  assert.equal(await text(page, '[data-testid="ala-action"]'), 'Build an À La Carte estimate');
  await page.click('[data-testid="scholarship"] summary');
  assert.match(await text(page, '[data-testid="scholarship"]'), /NWIOI offers up to two Equity Scholarship seats each year across our Core Programs\./);
  assert.equal(await page.getAttribute('[data-testid="scholarship-apply"]', 'href'), 'https://forms.wix.com/f/7167298250691576552');
  await page.close();
});

test('Track finder (preview): what you may still need after Core — Educator 39 + 60 mapping, ranges, pending splits', async () => {
  const page = await newPage(BASE2);
  await choose(page, 'sexuality_educator');
  await settled(page);
  // Under the Core offer, before any prior education.
  assert.match(squash(await text(page, '[data-testid="after-core"]')), /^What you may still need after Core Core covers 39 Core Knowledge and 60 Sexuality Education Skills Training hours, leaving 51 Core Knowledge hours before prior education\. Estimated cost if purchased at \$35 per hour: \$1,785\. Your prior coursework may cover some of these hours\. You can complete any remaining coursework through NWIOI or another provider whose training meets the requirements\. With Core tuition: \$8,735 estimated in total\./);
  // 20 prior Core Knowledge hours: 31–51 hours, $1,085–$1,785.
  await categories(page, 20, 0);
  await settled(page);
  const line = squash(await text(page, '[data-testid="core-line"]'));
  assert.match(line, /Up to 20 of your prior hours could reduce the coursework you still need: estimated 31–51 hours remaining \(Core Knowledge\)\. Estimated cost if purchased at \$35 per hour: \$1,085–\$1,785\. A curriculum review will confirm how much your prior coursework fills\./);
  assert.match(squash(await text(page, '[data-testid="after-core"]')), /With Core tuition: \$8,035–\$8,735 estimated in total/);
  assert.match(squash(await text(page, '[data-testid="ala-line"]')), /^À La Carte only \(without Core\), based on your answers: estimated coursework still needed: about 130 hours/);
  assert.equal(await text(page, '[data-testid="rec-price"]'), '$6,950', 'Core tuition fixed');
  assert.equal(squash(await text(page, '[data-track="core"] [data-testid="finish-note"]')), 'Your prior coursework may cover some of these hours. You can complete any remaining coursework through NWIOI or another provider whose training meets the requirements.');
  await hours(page, 'core', 60);
  await settled(page);
  assert.match(squash(await text(page, '[data-testid="core-line"]')), /estimated 0–51 hours remaining/, 'upper end stays the full gap');
  // Skills hours can't reduce the Educator gap.
  await hours(page, 'core', 0);
  await hours(page, 'skills', 40);
  await settled(page);
  assert.doesNotMatch(squash(await text(page, '[data-testid="core-line"]')), /Up to/);
  // Therapist and Counselor: split pending, "up to" from hour totals.
  for (const cred of ['sex_therapist', 'sexuality_counselor']) {
    await choose(page, cred);
    await categories(page, 15, 10);
    await settled(page);
    assert.match(squash(await text(page, '[data-testid="core-line"]')), /Core’s 99 hours leave about 51 hours of the 150\. The split between Core Knowledge and skills training is still being confirmed for this credential\. Up to 25 of your prior hours could reduce the coursework you still need: estimated 26–51 hours remaining\. Estimated cost if purchased at \$35 per hour: \$910–\$1,785\./, cred);
  }
  await page.close();
});

test('Track finder (preview): À La Carte builder — one total, quantities only, SAR and supervision optional', async () => {
  const page = await newPage(BASE2);
  await choose(page, 'sex_therapist');
  await categories(page, 15, 10);
  await settled(page);
  await openBuilder(page);
  await settled(page);
  assert.equal(await text(page, '[data-testid="price-alaCarte"]'), '$4,375');
  await page.check('input[name="where"][value="nwioi"]');
  await page.click('[data-zero="supervision"]');
  await page.check('input[name="sar"][value="no"]');
  await settled(page);
  assert.equal(await text(page, '[data-testid="price-alaCarte"]'), '$11,045', 'SAR not added until ticked');
  await page.check('input[data-ala="sar"]');
  await settled(page);
  assert.equal(await text(page, '[data-testid="price-alaCarte"]'), '$11,695');
  await page.click('[data-testid="ala-included"] summary');
  assert.deepEqual(await page.$$eval('[data-testid="ala-items"] li', (els) => els.map((e) => e.textContent)),
    ['75 Core Knowledge CEUs', '50 Sex Therapy Skills Training CEUs', 'SAR (Sexuality Attitude Reassessment)', '26 hours of individual supervision', '8 group supervision sessions, 3 hours each']);
  const flow = await text(page, '#ala-flow');
  for (const hidden of ['× $', '$195', '$200', '$650', '$2,625', '$5,070', 'subtotal']) assert.ok(!flow.includes(hidden), `shows ${hidden}`);
  await page.fill('#ala-skills', '10');
  await settled(page);
  assert.equal(await text(page, '[data-testid="ala-total-label"]'), 'Your selected items');
  await page.check('input[name="where"][value="outside"]');
  await settled(page);
  assert.match(await text(page, '[data-testid="ala-notes"]'), /You’ll pay your outside supervisor separately\./);
  await page.evaluate(() => window.scrollTo(0, 0));
  await choose(page, 'sexuality_educator');
  await settled(page);
  await page.click('#compare summary');
  assert.equal(await page.locator('[data-testid="savings"]').count(), 0, 'Educator: no savings figure');
  await page.close();
});

test('Track finder: keyboard-only use; still deciding; verified admissions destination publicly', async () => {
  const page = await newPage(BASE2);
  await page.focus('input[name="path"][value="sex_therapist"]');
  await page.keyboard.press('Space');
  await page.waitForSelector('input[name="college"]');
  await page.focus('input[name="college"][value="yes"]');
  await page.keyboard.press('Space');
  await page.waitForSelector('input[name="collegeUnit"]');
  await page.focus('input[name="collegeUnit"][value="credits"]');
  await page.keyboard.press('Space');
  await page.waitForSelector('#college-amount');
  await page.focus('#college-amount');
  await page.keyboard.type('3');
  await settled(page);
  assert.match(squash(await text(page, '[data-testid="result-body"]')), /About 45 hours/);
  await page.focus('#full-reqs summary');
  await page.keyboard.press('Enter');
  assert.equal(await page.evaluate(() => document.getElementById('full-reqs').open), true);
  await page.close();
  const pub = await newPage(BASE);
  await choose(pub, 'deciding');
  await pub.waitForSelector('[data-testid="deciding"]');
  assert.equal(await pub.getAttribute('[data-testid="primary-cta"]', 'href'), LINKS.schedulingUrl);
  await choose(pub, 'sexuality_counselor');
  await college(pub, 'yes', 2);
  await settled(pub);
  assert.equal(await pub.getAttribute('.quick-result [data-testid="primary-cta"]', 'href'), LINKS.schedulingUrl);
  assert.equal(await pub.getAttribute('[data-testid="equity"]', 'href'), LINKS.schedulingUrl);
  await pub.close();
});

test('Track finder (public): approved Core tuition and payment options show; no draft labels or placeholders', async () => {
  const page = await newPage(BASE);
  await choose(page, 'sex_therapist');
  await college(page, 'yes', 2);
  await settled(page);
  assert.equal(await text(page, '[data-testid="rec-price"]'), '$8,200');
  assert.equal(await text(page, '[data-testid="pay-full-total"]'), '$7,790.00');
  assert.match(squash(await text(page, '[data-testid="result-body"]')), /About 30 hours/, 'hours result shows publicly');
  const main = await page.textContent('main');
  assert.doesNotMatch(main, /Draft|preview|Placeholder/i);
  await choose(page, 'sexuality_educator');
  await settled(page);
  assert.equal(await text(page, '[data-testid="rec-price"]'), '$6,950');
  assert.deepEqual(await page.$$eval('[data-testid$="-total"]', (els) => els.filter((e) => e.closest('[data-testid="payments"]')).map((e) => e.textContent)), ['$6,602.50', '$6,811.00', '$6,950.00', '$6,602.50'], 'approved Educator tuition: payment options and Equity Scholarship show publicly');
  await page.click('#compare summary');
  assert.equal(await page.getAttribute('[data-testid="enroll"]', 'href'), ENROLL_EDU);
  await page.close();
});

test('Track finder (mobile): Yes, No and I’m not sure paths; CE without college; no panel needed; no horizontal scroll', async () => {
  const page = await browser.newPage({ ...devices['iPhone 13'] });
  page.on('pageerror', (e) => { throw e; });
  await page.goto(BASE2);
  await choose(page, 'sexuality_counselor');
  // Yes
  await college(page, 'yes', 3);
  await settled(page);
  assert.match(squash(await text(page, '[data-testid="result-body"]')), /About 45 hours/);
  assert.equal(await page.evaluate(() => [...document.querySelectorAll('details')].filter((d) => d.open).length), 0, 'no panel opened');
  // No college, CE only
  await college(page, 'no');
  await ce(page, 'yes', { aasect: 12 });
  await settled(page);
  assert.match(squash(await text(page, '[data-testid="result-body"]')), /About 12 hours/);
  // Not sure
  await college(page, 'unsure');
  await ce(page, 'unsure');
  await settled(page);
  assert.match(squash(await text(page, '[data-testid="result-body"]')), /Not sure\?/);
  await page.locator('.quick-result [data-testid="primary-cta"]').scrollIntoViewIfNeeded();
  for (const sel of ['.quick-result [data-testid="primary-cta"]', 'label:has(input[name="college"][value="yes"])', 'label:has(input[name="ce"][value="unsure"])']) {
    const box = await page.locator(sel).boundingBox();
    assert.ok(box.height >= 40, `${sel} tap target ${box.height}px`);
  }
  assert.ok(await page.evaluate(() => parseFloat(getComputedStyle(document.querySelector('.lede')).fontSize)) >= 16);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth), 0, 'no horizontal scroll');
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(300);
  assert.equal(await barShown(page), false);
  await page.click('[data-testid="ala-action"]');
  await page.waitForTimeout(900);
  const [headTop, barBottom] = await page.evaluate(() => [document.getElementById('ala-h').getBoundingClientRect().top, document.getElementById('price-bar').getBoundingClientRect().bottom]);
  assert.ok(headTop >= barBottom, `builder heading ${headTop} below bar ${barBottom}`);
  await shot(page, '13-finder-mobile');
  await page.close();
});

test('Track finder (preview): payoff — potential time and coursework savings side by side, updating together', async () => {
  const page = await newPage(BASE2);
  await choose(page, 'sex_therapist');
  await settled(page);
  assert.equal(await page.locator('[data-testid="savings-block"]').count(), 0, 'no savings before any hours');
  await college(page, 'yes', 20, 'hours');
  await ce(page, 'yes', { aasect: 5 });
  await settled(page);
  assert.equal(squash(await text(page, '[data-testid="savings-lead"]')), 'Your prior training could save you up to 25 hours and $875 in additional coursework.');
  assert.equal(await text(page, '[data-testid="save-hours"]'), '25 hours');
  assert.match(squash(await text(page, '[data-testid="tile-hours"]')), /About three full days of training you may not need to repeat/);
  assert.equal(await text(page, '[data-testid="save-dollars"]'), '$875');
  assert.match(squash(await text(page, '[data-testid="tile-dollars"]')), /Up to this much in coursework you may not need to buy, at \$35 per CEU/);
  assert.equal(squash(await text(page, '[data-testid="savings-sentence"]')), 'These hours haven’t been reviewed yet. If they count toward your credential and cover coursework you’d otherwise need to take, you could save up to $875 in additional course costs. Admissions will help you confirm which hours count.');
  // Side by side, directly under the heading and above the breakdown.
  const pos = await page.evaluate(() => {
    const r = (sel) => document.querySelector(sel).getBoundingClientRect();
    return { h: r('[data-testid="result-h"]').bottom, block: r('[data-testid="savings-block"]').top, a: r('[data-testid="tile-hours"]'), b: r('[data-testid="tile-dollars"]'), lines: r('[data-testid="source-lines"]').top };
  });
  assert.ok(Math.abs(pos.a.top - pos.b.top) < 2 && pos.b.left > pos.a.left, 'tiles side by side');
  assert.ok(pos.block >= pos.h && pos.block - pos.h < 60, 'right under the heading');
  assert.ok(pos.lines > pos.block, 'above the coursework breakdown');
  assert.equal(squash(await text(page, '[data-testid="planning-note"]')), NOTE);
  assert.equal(await text(page, '.quick-result [data-testid="primary-cta"]'), 'Inquire About Training');
  // Both numbers move together; Core tuition stays.
  await page.fill('#ce-amount', '10');
  await settled(page);
  assert.equal(await text(page, '[data-testid="save-hours"]'), '30 hours');
  assert.equal(await text(page, '[data-testid="save-dollars"]'), '$1,050');
  assert.match(squash(await text(page, '[data-testid="result-body"]')), /About 30 hours may count/);
  await page.check('input[name="ceApproval"][value="mix"]');
  await page.fill('#ce-aasect', '10');
  await page.fill('#ce-other', '8');
  await settled(page);
  assert.deepEqual([await text(page, '[data-testid="save-hours"]'), await text(page, '[data-testid="save-dollars"]')], ['34 hours', '$1,190'], 'other CE at half value');
  assert.equal(await text(page, '[data-testid="rec-price"]'), '$8,200');
  await college(page, 'no');
  await ce(page, 'no');
  await settled(page);
  assert.equal(await page.locator('[data-testid="savings-block"]').count(), 0, 'no savings with no hours');
  await page.close();
  // Mobile: tiles still side by side, nothing overflows.
  const m = await browser.newPage({ ...devices['iPhone 13'] });
  await m.goto(BASE2);
  await choose(m, 'sexuality_counselor');
  await college(m, 'yes', 20, 'hours');
  await ce(m, 'yes', { aasect: 5 });
  await settled(m);
  const [a, b] = await m.$$eval('.tile', (els) => els.map((e) => { const r = e.getBoundingClientRect(); return { top: r.top, left: r.left, right: r.right }; }));
  assert.ok(Math.abs(a.top - b.top) < 2 && b.right <= 390, 'side by side on mobile');
  assert.equal(await m.evaluate(() => document.documentElement.scrollWidth - window.innerWidth), 0);
  await m.close();
});

test('Track finder (public): approved $35 rate shows the dollar savings publicly', async () => {
  const page = await newPage(BASE);
  await choose(page, 'sex_therapist');
  await college(page, 'yes', 20, 'hours');
  await ce(page, 'yes', { aasect: 5 });
  await settled(page);
  assert.equal(squash(await text(page, '[data-testid="savings-lead"]')), 'Your prior training could save you up to 25 hours and $875 in additional coursework.');
  assert.equal(await text(page, '[data-testid="save-dollars"]'), '$875');
  assert.doesNotMatch(await text(page, '[data-testid="savings-block"]'), /Draft|preview/i);
  assert.equal(await text(page, '[data-testid="rec-price"]'), '$8,200');
  await page.close();
});

test('Track finder (preview): Core payment options and Equity Scholarship — totals, monthly amounts, track switching, mobile', async () => {
  const page = await newPage(BASE2);
  const want = {
    sex_therapist: { full: '$7,790.00', m12: ['$669.67', '$8,036.00', '$669.63'], m18: ['$455.56', '$8,200.00', '$455.48'], eq: ['$7,790.00', '$324.58'] },
    sexuality_counselor: { full: '$7,077.50', m12: ['$608.42', '$7,301.00', '$608.38'], m18: ['$413.89', '$7,450.00', '$413.87'], eq: ['$7,077.50', '$294.90'] },
    sexuality_educator: { full: '$6,602.50', m12: ['$567.58', '$6,811.00', '$567.62'], m18: ['$386.11', '$6,950.00', '$386.13'], eq: ['$6,602.50', '$275.10'] },
  };
  for (const [cred, w] of Object.entries(want)) {
    await choose(page, cred);
    await settled(page);
    assert.equal(await text(page, '[data-testid="pay-full-total"]'), w.full, `${cred} pay in full`);
    assert.match(squash(await text(page, '[data-testid="pay-full"]')), /Pay in full 5% off/);
    for (const k of ['m12', 'm18']) {
      const [mo, total, fin] = w[k];
      assert.equal(await text(page, `[data-testid="pay-${k}-monthly"]`), mo, `${cred} ${k} monthly`);
      assert.equal(await text(page, `[data-testid="pay-${k}-total"]`), total, `${cred} ${k} total`);
      assert.match(squash(await text(page, `[data-testid="pay-${k}"]`)), new RegExp(`final payment \\${fin}`));
    }
    assert.match(squash(await text(page, '[data-testid="pay-m12"]')), /12 monthly payments 2% off/);
    assert.match(squash(await text(page, '[data-testid="pay-m18"]')), /18 monthly payments standard tuition/);
    if (!(await page.evaluate(() => document.getElementById('equity')?.open))) await page.click('#equity summary');
    assert.equal(await text(page, '[data-testid="equity-total"]'), w.eq[0], `${cred} equity`);
    assert.equal(await text(page, '[data-testid="equity-monthly"]'), w.eq[1]);
  }
  assert.equal(squash(await text(page, '[data-testid="payment-note"]')).startsWith('Tuition and payment amounts are estimates. NWIOI will confirm your final tuition and payment schedule with you.'), true);
  assert.equal(await text(page, '[data-testid="equity"]'), 'Ask about the Equity Scholarship');
  assert.equal(await page.locator('[data-testid="equity-seats"]').count(), 0, 'no seat count without a verified admissions record');
  assert.match(await text(page, '[data-testid="scholarship"]'), /one tuition discount per enrollment/);
  // Payment options sit with Core tuition, and the Equity Scholarship sits under them.
  const pos = await page.evaluate(() => ({ core: document.querySelector('[data-track="core"]').contains(document.querySelector('[data-testid="payments"]')), eq: document.querySelector('[data-testid="pay-m18"]').getBoundingClientRect().bottom <= document.getElementById('equity').getBoundingClientRect().top }));
  assert.deepEqual(pos, { core: true, eq: true });
  // Prior education never changes tuition or payment amounts.
  await college(page, 'yes', 9);
  await ce(page, 'yes', { aasect: 20 });
  await categories(page, 60, 40);
  await settled(page);
  assert.equal(await text(page, '[data-testid="pay-m12-total"]'), '$6,811.00');
  assert.equal(await text(page, '[data-testid="rec-price"]'), '$6,950');
  await page.close();
  // Mobile: reads cleanly, nothing overflows.
  const m = await browser.newPage({ ...devices['iPhone 13'] });
  await m.goto(BASE2);
  await choose(m, 'sexuality_counselor');
  await settled(m);
  await m.locator('[data-testid="payments"]').scrollIntoViewIfNeeded();
  const boxes = await m.$$eval('.pay-opt', (els) => els.map((e) => { const r = e.getBoundingClientRect(); return [r.left, r.right]; }));
  assert.equal(boxes.length, 3);
  for (const [l, r] of boxes) assert.ok(l >= 0 && r <= 390, `payment row inside the screen ${l}-${r}`);
  assert.equal(await m.evaluate(() => document.documentElement.scrollWidth - window.innerWidth), 0);
  assert.ok(await m.evaluate(() => parseFloat(getComputedStyle(document.querySelector('.pay-amt strong')).fontSize)) >= 16);
  await shot(m, '15-payments-mobile');
  await m.close();
});

test('Track finder (preview, shipped defaults): “Inquire About Training” opens the live NWIOI inquiry page with no placeholder tag', async () => {
  const page = await newPage(BASE2);
  await choose(page, 'sex_therapist');
  await college(page, 'yes', 3);
  await settled(page);
  const cta = page.locator('.quick-result [data-testid="primary-cta"]');
  assert.equal(await cta.textContent(), 'Inquire About Training');
  assert.equal(await cta.getAttribute('href'), 'https://student.nwioi.com/inquire');
  assert.equal(await cta.getAttribute('target'), '_blank');
  assert.equal(await page.getAttribute('[data-testid="equity"]', 'href'), 'https://student.nwioi.com/inquire');
  assert.doesNotMatch(await page.textContent('[data-testid="quick-result"]'), /Placeholder link/);
  await page.close();
});

test('Track finder: CE question — one total plus who approved it; same rules (AASECT 1:1, other half, unsure pending)', async () => {
  const page = await newPage(BASE2);
  await choose(page, 'sexuality_counselor');
  assert.equal(squash(await text(page, '[data-testid="ce-q"] legend')), 'Have you earned continuing education (CE) credits from training on sexuality?');
  await page.check('input[name="ce"][value="yes"]');
  assert.equal(await text(page, 'label[for="ce-amount"]'), 'About how many CE credits did you earn?');
  await college(page, 'no');
  for (const [approval, expect] of [['aasect', /About 12 hours/], ['other', /About 6 hours/]]) {
    await page.fill('#ce-amount', '12');
    await page.check(`input[name="ceApproval"][value="${approval}"]`);
    await settled(page);
    assert.match(squash(await text(page, '[data-testid="result-body"]')), expect, approval);
  }
  await page.check('input[name="ceApproval"][value="unsure"]');
  await settled(page);
  assert.match(squash(await text(page, '[data-testid="pending"]')), /12 CE credits/);
  // Typing digits after the approval question is visible keeps their order.
  await page.fill('#ce-amount', '');
  await page.click('#ce-amount');
  await page.keyboard.type('15');
  assert.equal(await page.inputValue('#ce-amount'), '15');
  await page.check('input[name="ceApproval"][value="mix"]');
  await page.fill('#ce-aasect', '10');
  await page.fill('#ce-other', '8');
  await settled(page);
  assert.match(squash(await text(page, '[data-testid="result-body"]')), /About 14 hours/);
  assert.equal(squash(await text(page, '#by-category summary')), 'Enter hours by category, if you know them');
  await page.close();
});
