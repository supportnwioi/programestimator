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

// Main server (public): real links (test values); only the Educator Comprehensive offer is approved.
// Second server (preview): shipped defaults (draft catalog, placeholder links) with NWIOI_PREVIEW=1.
const LINKS = { schedulingUrl: 'https://calendar.nwioi-test.org/admissions', contactUrl: 'mailto:admissions@nwioi-test.org' };
const ENROLL_EDU = 'https://nwioi-test.org/enroll/educator';
const DATA2 = fs.mkdtempSync(path.join(os.tmpdir(), 'nwioi-e2e-preview-'));
const PORT2 = PORT + 1;
const BASE2 = `http://localhost:${PORT2}`;
fs.writeFileSync(path.join(DATA, 'settings.json'), JSON.stringify(LINKS));
const catalog = JSON.parse(fs.readFileSync(path.join(ROOT, 'config/tracks.json'), 'utf8'));
Object.assign(catalog.credentials.sexuality_educator.comprehensive, { status: 'approved', links: { enroll: ENROLL_EDU, supervisors: '', sampleWeekend: '' }, paymentPlans: [{ label: '12 months', monthly: 625, months: 12, total: 7500, status: 'approved' }] });
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
async function choose(page, cred) { await page.check(`input[name="path"][value="${cred}"]`); await page.waitForSelector('[data-testid="rec-name"]'); }
async function answerFinder(page, { education, supervision, sar, where }) {
  for (const [k, v] of [['education', education], ['supervision', supervision]]) {
    if (v === undefined) continue;
    if (v === 'unsure') await page.click(`[data-unsure="${k}"]`);
    else if (v === 0) await page.click(`[data-zero="${k}"]`);
    else await page.fill(`#${k}-num`, String(v));
  }
  if (sar) await page.check(`input[name="sar"][value="${sar}"]`);
  if (where) await page.check(`input[name="where"][value="${where}"]`);
}
async function settled(page) {
  // Wait until the result reflects the latest answers.
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(200);
  await page.waitForLoadState('networkidle');
}

test('Track finder: first screen, booking, no clinical/email/upload questions; detailed estimator is internal', async () => {
  const page = await newPage(BASE);
  assert.equal(await text(page, 'h1'), 'Find the right NWIOI track for you');
  assert.equal(await page.textContent('[data-testid="header-book"]'), 'Book a free admissions call');
  assert.equal(await page.getAttribute('[data-testid="header-book"]', 'href'), LINKS.schedulingUrl);
  const creds = await page.$$eval('input[name="path"]', (els) => els.map((e) => e.parentElement.textContent.trim()));
  assert.deepEqual(creds, ['Sex Therapist', 'Sexuality Counselor', 'Sexuality Educator', 'I’m still deciding']);
  for (const c of ['sex_therapist', 'sexuality_counselor', 'sexuality_educator']) {
    await choose(page, c);
    const main = await page.textContent('main');
    assert.doesNotMatch(main.replace(/clinical sexology/gi, ''), /clinical hours|client-contact|client contact|caseload|transcript|email/i);
    assert.equal(await page.locator('input[type=file], input[type=email], button[type=submit]').count(), 0);
    assert.match(main, /Where would you like to do your supervision\?/);
  }
  // Internal detailed estimator requires admin sign-in.
  const res = await fetch(`${BASE}/detailed`, { redirect: 'manual' });
  assert.equal(res.status, 302);
  assert.match(res.headers.get('location'), /\/admin\?next=\/detailed/);
  await page.close();
});

test('Track finder (preview): Therapist Comprehensive → Core at ~51 CEUs; fixed prices never drop', async () => {
  const page = await newPage(BASE2);
  await choose(page, 'sex_therapist');
  await answerFinder(page, { education: 0, supervision: 0, sar: 'no', where: 'nwioi' });
  await settled(page);
  assert.equal(await text(page, '[data-testid="rec-name"]'), 'Tier I · Comprehensive');
  assert.equal(await text(page, '[data-testid="rec-price"]'), '$8,500');
  assert.match(await text(page, '.quick-price'), /Draft tuition · preview only/);
  assert.match(await text(page, '[data-testid="primary-cta"]'), /Explore enrollment/);
  for (const [edu, rec] of [[50, 'Tier I · Comprehensive'], [51, 'Tier II · Core'], [120, 'Tier II · Core']]) {
    await page.fill('#education-num', String(edu));
    await settled(page);
    assert.equal(await text(page, '[data-testid="rec-name"]'), rec, `education ${edu}`);
    assert.equal(await text(page, '[data-testid="price-comprehensive"]'), '$8,500', 'Comprehensive stays fixed');
  }
  assert.equal(await text(page, '[data-testid="rec-price"]'), '$8,000', 'draft Core $7,350 + $650 SAR');
  assert.match(await text(page, '[data-testid="reasons"]'), /Core may be your fit/);
  assert.equal(await text(page, '[data-testid="primary-cta"]'), 'Review my prior training');
  assert.match(await text(page, '.quick-price'), /We’ll look at what you’ve already completed, see how it fits the Core curriculum, and confirm your tuition before you decide\./);
  // Core SAR is optional when needed.
  await page.uncheck('[data-core-sar]');
  await settled(page);
  assert.equal(await text(page, '[data-testid="rec-price"]'), '$7,350');
  await shot(page, '10-finder-therapist-core');
  await page.close();
});

test('Track finder (preview): switching credentials changes the supervision package and tuition', async () => {
  const page = await newPage(BASE2);
  const expect = {
    sex_therapist: ['$8,500', '50', /26 individual hours and 24 group hours in twelve two-hour sessions/],
    sexuality_counselor: ['$7,950', '30', /15 individual hours and 15 group hours in five three-hour sessions with three supervisees/],
    sexuality_educator: ['$7,250', '25', /Five individual hours with your primary supervisor and 20 group hours in ten two-hour sessions/],
  };
  for (const [cred, [price, max, pkg]] of Object.entries(expect)) {
    await choose(page, cred);
    await answerFinder(page, { education: 0, supervision: 0, sar: 'no', where: 'nwioi' });
    await settled(page);
    assert.equal(await text(page, '[data-testid="price-comprehensive"]'), price, cred);
    assert.equal(await page.getAttribute('#supervision-range', 'max'), max);
    assert.match(await text(page, '[data-track="comprehensive"]'), pkg);
  }
  // Educator leads with program design; Counselor/Educator have no Core yet.
  assert.match(await text(page, '.quick-price'), /Design and deliver a sexuality education program with feedback from an AASECT Certified Sexuality Educator Supervisor\./);
  assert.match(await text(page, '#compare'), /hasn’t defined a Core track for the Sexuality Educator credential/);
  assert.match(await text(page, '#compare-h'), /Compare tracks for the Sexuality Educator credential/);
  await page.close();
});

test('Track finder (preview): Modular quote, outside supervision excluded, unknowns stay open', async () => {
  const page = await newPage(BASE2);
  await choose(page, 'sex_therapist');
  await answerFinder(page, { education: 70, supervision: 0, sar: 'no', where: 'outside' });
  await settled(page);
  assert.equal(await text(page, '[data-testid="rec-name"]'), 'Tier III · Modular');
  assert.equal(await text(page, '[data-testid="rec-price"]'), '$3,450', '80 CEUs × $35 + $650 SAR');
  assert.match(await text(page, '.quick-price'), /Your estimated cost with NWIOI/);
  assert.match(await text(page, '[data-track="modular"]'), /pay your supervisor separately/);
  assert.equal(await page.locator('#mod-ind').count(), 0, 'no supervision lines when supervising outside');
  assert.equal(await page.inputValue('#mod-ceus'), '80');
  // Adjust the CEUs they expect to buy: all 150 + SAR = $5,900.
  await page.fill('#mod-ceus', '150');
  await settled(page);
  assert.equal(await text(page, '[data-testid="price-modular"]'), '$5,900');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'mod-ceus', 'focus stays while typing');
  assert.equal(await text(page, '[data-testid="primary-cta"]'), 'Explore courses');
  assert.match(await text(page, '[data-testid="secondary-cta"]'), /Help me choose what I need/);
  await shot(page, '11-finder-modular-outside');

  // Unknown education leaves the CEU quantity open (never silently 0).
  await page.click('[data-unsure="education"]');
  await settled(page);
  assert.equal(await page.inputValue('#mod-ceus'), '');
  assert.match(await text(page, '[data-track="modular"]'), /weren’t sure about your education hours/);
  assert.match(await text(page, '[data-testid="price-modular"]'), /\$650 so far|Choose/);
  // Unanswered supervision is distinct from zero.
  await page.click('[data-unsure="supervision"]');
  await page.click('[data-unsure="supervision"]');
  assert.match(await text(page, '[data-q="supervision"] .q-status'), /Not answered yet/);
  await page.click('[data-zero="supervision"]');
  assert.match(await text(page, '[data-q="supervision"] .q-status'), /0 hours/);
  // NWIOI supervision bought separately is priced per individual hour and per group session.
  await page.check('input[name="where"][value="nwioi"]');
  await page.fill('#supervision-num', '20');
  await page.fill('#education-num', '120');
  await settled(page);
  assert.equal(await text(page, '[data-testid="rec-name"]'), 'Tier III · Modular');
  assert.match(await text(page, '[data-track="modular"]'), /individual supervision hours × \$195/);
  assert.match(await text(page, '[data-track="modular"]'), /group sessions \(3 hours each\) × \$200/);
  await page.close();
});

test('Track finder: keyboard-only use', async () => {
  const page = await newPage(BASE2);
  await page.focus('input[name="path"][value="sex_therapist"]');
  await page.keyboard.press('Space');
  await page.waitForSelector('#education-range');
  await page.focus('#education-range');
  for (let i = 0; i < 51; i++) await page.keyboard.press('ArrowRight');
  await page.focus('[data-zero="supervision"]');
  await page.keyboard.press('Enter');
  await page.focus('input[name="sar"][value="yes"]');
  await page.keyboard.press('ArrowRight'); // moves to "No"
  await page.focus('input[name="where"][value="nwioi"]');
  await page.keyboard.press('Space');
  await settled(page);
  assert.equal(await page.inputValue('#education-num'), '51');
  assert.equal(await page.isChecked('input[name="sar"][value="no"]'), true);
  assert.equal(await text(page, '[data-testid="rec-name"]'), 'Tier II · Core');
  assert.equal(await text(page, '[data-testid="rec-price"]'), '$8,000');
  await page.close();
});

test('Track finder: still deciding → talk through my options', async () => {
  const page = await newPage(BASE);
  await page.check('input[name="path"][value="deciding"]');
  assert.equal(await page.locator('#education-range').count(), 0);
  assert.equal(await text(page, '[data-testid="primary-cta"]'), 'Talk through my options');
  assert.equal(await page.getAttribute('[data-testid="primary-cta"]', 'href'), LINKS.schedulingUrl);
  await page.close();
});

test('Track finder (public): only approved offers show tuition; drafts go to admissions', async () => {
  const page = await newPage(BASE);
  await choose(page, 'sex_therapist');
  await answerFinder(page, { education: 51, supervision: 0, sar: 'no', where: 'nwioi' });
  await settled(page);
  assert.equal(await text(page, '[data-testid="rec-name"]'), 'Tier II · Core');
  assert.equal(await text(page, '[data-testid="rec-price"]'), 'Confirm Core tuition with admissions');
  assert.equal(await text(page, '[data-testid="price-comprehensive"]'), 'Confirm tuition with admissions');
  const main = await page.textContent('main');
  assert.ok(!/\$\d/.test(main), 'no draft dollar figures publicly');
  assert.doesNotMatch(main, /Draft|preview/i);
  assert.equal(await page.getAttribute('[data-testid="primary-cta"]', 'href'), LINKS.schedulingUrl);
  // Approved Educator Comprehensive shows tuition, a payment plan, and the real enrollment link.
  await choose(page, 'sexuality_educator');
  await answerFinder(page, { education: 0, supervision: 0, sar: 'no', where: 'nwioi' });
  await settled(page);
  assert.equal(await text(page, '[data-testid="rec-name"]'), 'Tier I · Comprehensive');
  assert.equal(await text(page, '[data-testid="rec-price"]'), '$7,250');
  assert.match(await text(page, '.quick-price'), /NWIOI tuition · fixed package price/);
  assert.match(await text(page, '.quick-price'), /or \$625\/month for 12 months \(\$7,500 total\)/);
  assert.equal(await text(page, '[data-testid="primary-cta"]'), 'Explore enrollment');
  assert.equal(await page.getAttribute('[data-testid="primary-cta"]', 'href'), ENROLL_EDU);
  await shot(page, '12-finder-public-educator');
  await page.close();
});

test('Track finder: mobile layout', async () => {
  const page = await browser.newPage({ ...devices['iPhone 13'] });
  page.on('pageerror', (e) => { throw e; });
  await page.goto(BASE2);
  await choose(page, 'sexuality_counselor');
  await answerFinder(page, { education: 40, supervision: 0, sar: 'unsure', where: 'help' });
  await settled(page);
  await page.waitForSelector('#price-bar:not([hidden])');
  assert.equal(await page.evaluate(() => getComputedStyle(document.getElementById('price-bar')).position), 'fixed');
  assert.match(await text(page, '#price-bar'), /Tier I · Comprehensive\$7,950/);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth), 0, 'no horizontal scroll');
  assert.match(await text(page, '.quick-price'), /We’ve assumed NWIOI for now/);
  await shot(page, '13-finder-mobile');
  await page.close();
});
