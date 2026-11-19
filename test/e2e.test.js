// End-to-end: drives the real UI in Chromium against a fresh server.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'nwioi-e2e-'));
const PORT = 3200 + Math.floor(Math.random() * 500);
const BASE = `http://localhost:${PORT}`;
const SHOTS = process.env.E2E_SCREENSHOTS;
const sample = (f) => path.join(ROOT, 'samples', f);

let server, browser;
test.before(async () => {
  const env = { ...process.env, PORT: String(PORT), NWIOI_DATA_DIR: DATA };
  delete env.ANTHROPIC_API_KEY; // offline extractor for deterministic tests
  server = spawn('node', ['server.js'], { cwd: ROOT, env, stdio: 'pipe' });
  await new Promise((res, rej) => { server.stdout.on('data', (d) => String(d).includes('running') && res()); server.on('exit', rej); });
  browser = await chromium.launch();
});
test.after(async () => { await browser?.close(); server?.kill(); });

async function newPage() {
  const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
  page.on('dialog', (d) => d.accept());
  page.on('pageerror', (e) => { throw e; });
  await page.goto(BASE);
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
  await page.fill('input[data-answer="clinicalHoursUnderContract"]', '120');
  await page.press('input[data-answer="clinicalHoursUnderContract"]', 'Tab');
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
  assert.match(r.text, /300 hours of clinical treatment.*180 hours appear to remain/s);
  assert.match(r.text, /AASECT membership/);
  // Private pricing is never shown to the student.
  for (const leak of ['$35', '$185', '35/', 'per hour', 'per CE hour', '$650']) assert.ok(!r.text.includes(leak), `leaked ${leak}`);
  const expected = est.price.amount;
  assert.equal(r.range, `$${Math.max(0, expected - 500).toLocaleString('en-US')}–$${(expected + 500).toLocaleString('en-US')}`);

  // Booking a call needs no sharing: link goes straight to the configured calendar.
  assert.equal(await page.getAttribute('[data-testid="schedule"]', 'href'), 'https://example.com/nwioi-admissions-calendar');
  assert.match(await page.getAttribute('[data-testid="ask"]', 'href'), /^mailto:admissions@example.org/);
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
  await page.check('input[data-answer-unsure="counselingHours"]');
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
  await page.fill('input[data-answer="educationHours"]', '1200');
  await page.press('input[data-answer="educationHours"]', 'Tab');
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
  const page = await newPage();
  await page.goto(`${BASE}/admin`);
  await page.fill('#pw', 'nwioi-demo-admin');
  await page.fill('#nm', 'E2E Admin');
  await page.click('#login button');
  await page.waitForSelector('#settings');
  await page.fill('#sp', '900');
  await page.fill('#bf', '250');
  await page.click('#settings button[type=submit]');
  await page.waitForSelector('text=Saved.');
  await shot(page, '6-admin-pricing');
  const res = await (await fetch(`${BASE}/api/estimate`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ path: 'sex_therapist', intake: { entries: [], answers: { sarCompleted: 'no' } } }) })).json();
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
