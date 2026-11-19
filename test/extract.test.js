import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { offlineExtract, toEntries, Extraction } from '../src/extract.js';
import { evaluate } from '../src/engine.js';

const ST = JSON.parse(fs.readFileSync(new URL('../config/rulesets/sex_therapist.2026.T.1.json', import.meta.url)));
const sample = (f) => fs.readFileSync(new URL(`../samples/${f}`, import.meta.url), 'utf8');

test('AI-shaped output: topic hours only kept when explicit; follow-up generated otherwise', () => {
  // Shape the Claude structured output would return (validated with the same schema).
  const aiOutput = Extraction.parse({
    document_type: 'syllabus', summary: 'Graduate course on sexual health.',
    items: [{
      kind: 'course', title: 'HSX 620 Sexual Health', course_code: 'HSX 620', provider: 'PNU', date: 'Fall 2024', credit_type: 'academic',
      total_amount: 3, total_unit: 'semester_credits', delivery: 'synchronous', evidence: '3 semester credits',
      supervision_individual_hours: null, supervision_group_hours: null, supervisor_name: null, supervisor_aasect_certified_with_contract: 'unsure', sar_hours: null, sar_aasect_approved: 'unsure',
      topics: [
        { requirement: 'core', area: 'G', topic: 'Anatomy', hours: 9, hours_explicit: true, evidence: 'Week 2 (9 hours)', sexuality_specific: true, couples_counseling: false },
        { requirement: 'core', area: 'L', topic: 'Substance use', hours: 7.5, hours_explicit: false, evidence: 'Week 4', sexuality_specific: true, couples_counseling: false },
        { requirement: 'core', area: 'ZZ', topic: 'Mystery', hours: null, hours_explicit: false, evidence: '', sexuality_specific: true, couples_counseling: false },
      ],
    }],
  });
  const [e] = toEntries(aiOutput, { docId: 'd1', name: 'syllabus.pdf' }, ST, { type: 'ai', model: 'claude-opus-5-5' });
  assert.equal(e.source.type, 'document');
  assert.equal(e.source.fileName, 'syllabus.pdf');
  assert.equal(e.allocations[0].hours, 9);
  assert.equal(e.allocations[0].basis, 'stated');
  assert.equal(e.allocations[1].hours, null, 'inferred hours are discarded');
  assert.equal(e.allocations[1].basis, 'needs_answer');
  assert.match(e.allocations[1].followUp, /About how many hours of instruction in this course were spent on “Substance use”\?/);
  assert.equal(e.allocations[2].area, null, 'unknown area letters are not trusted');
  assert.equal(e.totalAmount, 3, 'course total kept separately from topic hours');
});

test('offline extractor: syllabus with an unstated topic', () => {
  const x = offlineExtract(sample('syllabus-HSX620.txt'), 'syllabus-HSX620.txt', ST);
  const [e] = toEntries(x, { docId: 'd', name: 'syllabus-HSX620.txt' }, ST, { type: 'offline-demo' });
  assert.equal(x.document_type, 'syllabus');
  assert.equal(e.creditType, 'academic');
  assert.equal(e.totalAmount, 3);
  assert.equal(e.delivery, 'synchronous');
  const L = e.allocations.find((a) => a.area === 'L');
  assert.equal(L.basis, 'needs_answer');
  // Unanswered follow-ups are left out of the calculation.
  const r = evaluate(ST, { entries: [{ ...e, allocations: e.allocations.map((a) => (a.basis === 'needs_answer' ? { ...a, basis: 'unsure' } : a)) }] }).requirements.core;
  assert.equal(r.areas.find((a) => a.key === 'L').counted, 0);
  assert.equal(r.areas.find((a) => a.key === 'G').counted, 9);
});

test('offline extractor: transcript, CE certificate, SAR, supervision log', () => {
  const t = toEntries(offlineExtract(sample('transcript-northwest-university.txt'), 't', ST), { docId: 't', name: 't' }, ST, { type: 'offline-demo' });
  assert.deepEqual(t.map((e) => e.courseCode), ['HSX 610', 'CMHC 540', 'HSX 615']);
  const ce = toEntries(offlineExtract(sample('ce-certificate-sensate-focus.txt'), 'c', ST), { docId: 'c', name: 'c' }, ST, { type: 'offline-demo' })[0];
  assert.equal(ce.creditType, 'aasect_ce');
  assert.deepEqual(ce.allocations.map((a) => [a.requirement, a.area, a.hours]), [['training', 'A', 4], ['training', 'C', 2]]);
  const sar = toEntries(offlineExtract(sample('sar-certificate.txt'), 's', ST), { docId: 's', name: 's' }, ST, { type: 'offline-demo' })[0];
  assert.deepEqual([sar.kind, sar.hours, sar.aasectApproved], ['sar', 15, 'yes']);
  const sup = toEntries(offlineExtract(sample('supervision-log.txt'), 'l', ST), { docId: 'l', name: 'l' }, ST, { type: 'offline-demo' })[0];
  assert.deepEqual([sup.individualHours, sup.groupHours, sup.qualifies], [12, 8, 'yes']);
});
