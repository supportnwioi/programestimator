// Track finder: recommends an NWIOI tier for a credential and prices it.
// Comprehensive and Core are fixed package prices: prior work never changes
// them. Modular is calculated from what the visitor plans to buy. This is
// separate from the detailed engine (src/engine.js), whose itemized retail
// calculation must never be shown as package tuition.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './store.js';
import { usableLink } from './links.js';

export const DEFAULT_CATALOG = JSON.parse(fs.readFileSync(path.join(ROOT, 'config/tracks.json'), 'utf8'));

const money = (n) => '$' + Math.round(n).toLocaleString('en-US');
const MODULAR_ROUND_TO = 50;
const req = (ruleset, k) => ruleset.requirements.find((r) => r.key === k);

export function benchmarks(ruleset) {
  const core = req(ruleset, 'core'), training = req(ruleset, 'training'), sup = req(ruleset, 'supervision');
  return {
    education: core.totalHours + training.totalHours,
    supervision: sup.totalHours,
    minMonths: sup.minMonths,
    semesterCreditClockHours: ruleset.creditRules.academicSemesterCreditClockHours,
    nonAasectCeMultiplier: ruleset.creditRules.nonAasectCeMultiplier,
    trainingLabel: training.longLabel,
  };
}

// Checks that each credential's curriculum and supervision match its AASECT ruleset.
export function validateCatalog(catalog, rulesetsByPath) {
  const errors = [];
  for (const [cred, tiers] of Object.entries(catalog.credentials || {})) {
    const r = rulesetsByPath[cred];
    if (!r) { errors.push(`${cred}: no active ruleset`); continue; }
    const b = benchmarks(r);
    const c = tiers.comprehensive;
    if (!c) { errors.push(`${cred}: missing comprehensive`); continue; }
    const sum = (c.curriculum || []).reduce((s, x) => s + (Number(x.ceus) || 0), 0);
    if (sum !== b.education) errors.push(`${cred}: Comprehensive curriculum is ${sum} CEUs; the ${r.pathName} benchmark is ${b.education}`);
    const coreItem = (c.curriculum || []).find((x) => x.requirement === 'core');
    if (!coreItem || coreItem.ceus !== req(r, 'core').totalHours) errors.push(`${cred}: core knowledge CEUs must equal ${req(r, 'core').totalHours}`);
    const tr = (c.curriculum || []).find((x) => x.requirement === 'training');
    if (!tr || tr.name.toLowerCase() !== b.trainingLabel.toLowerCase()) errors.push(`${cred}: skills training must be "${b.trainingLabel}" (found "${tr?.name}")`);
    if (tr && tr.ceus !== req(r, 'training').totalHours) errors.push(`${cred}: skills training CEUs must equal ${req(r, 'training').totalHours}`);
    const s = c.supervision || {};
    if (s.individualHours + s.groupHours !== b.supervision) errors.push(`${cred}: supervision package is ${s.individualHours + s.groupHours} hours; target is ${b.supervision}`);
    if (s.groupSessions * s.groupSessionHours !== s.groupHours) errors.push(`${cred}: ${s.groupSessions} × ${s.groupSessionHours}-hour group sessions ≠ ${s.groupHours} group hours`);
    if (s.individualHours < req(r, 'supervision').individualMin) errors.push(`${cred}: individual supervision below the AASECT minimum of ${req(r, 'supervision').individualMin}`);
    if (c.minMonths !== b.minMonths) errors.push(`${cred}: minimum supervision period ${c.minMonths} months; AASECT requires ${b.minMonths}`);
    if (!(c.tuition > 0)) errors.push(`${cred}: Comprehensive tuition missing`);
    const core = tiers.core || {};
    if (core.defined) {
      if (core.ceus + core.fitCeus !== b.education) errors.push(`${cred}: Core ${core.ceus} CEUs + ${core.fitCeus} prior CEUs ≠ ${b.education}`);
      if (core.supervisionHours !== b.supervision) errors.push(`${cred}: Core supervision ${core.supervisionHours} ≠ target ${b.supervision}`);
      if (!(core.tuition > 0)) errors.push(`${cred}: Core tuition missing`);
    }
    for (const st of [c.status, core.status, tiers.modular?.ceuRate?.status, tiers.modular?.sar?.status, tiers.modular?.supervision?.status].filter(Boolean)) {
      if (!['draft', 'approved'].includes(st)) errors.push(`${cred}: status must be "draft" or "approved" (found "${st}")`);
    }
  }
  return errors;
}

const visible = (status, preview) => status === 'approved' || (preview && status === 'draft');

// unanswered (null) / unsure / hours are three distinct states.
function parseHours(v, max) {
  if (v === 'unsure') return { state: 'unsure' };
  if (v === null || v === undefined || v === '') return { state: 'unanswered' };
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return { state: 'unanswered' };
  return { state: 'hours', hours: Math.min(Math.round(n), max) };
}
const qty = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) || Number(v) < 0 ? null : Math.round(Number(v)));

function planText(plans, preview) {
  return (plans || []).filter((p) => visible(p.status, preview) && p.monthly > 0 && p.months > 0 && p.total > 0)
    .map((p) => ({ text: `${money(p.monthly)}/month for ${p.months} months (${money(p.total)} total)`, draft: p.status !== 'approved' }));
}

/**
 * input: { education, supervision: number|'unsure'|null; sar: 'yes'|'no'|'unsure'|null;
 *          supervisionWhere: 'nwioi'|'outside'|'help'|null;
 *          coreSar: boolean|null; modular: { ceus, sar, individualHours, groupSessions } (null = use suggestion) }
 * links: { booking, contact } raw URLs from settings
 */
export function trackEstimate(catalog, ruleset, input, { preview = false, links = {} } = {}) {
  const cred = ruleset.path;
  const tiers = catalog.credentials[cred];
  const names = catalog.tierNames;
  const b = benchmarks(ruleset);
  const edu = parseHours(input.education, b.education);
  const sup = parseHours(input.supervision, b.supervision);
  const sar = ['yes', 'no', 'unsure'].includes(input.sar) ? input.sar : null;
  const where = ['nwioi', 'outside', 'help'].includes(input.supervisionWhere) ? input.supervisionWhere : null;
  const booking = usableLink(links.booking, preview);
  const sarNeeded = sar !== 'yes';

  // ---- Comprehensive (fixed)
  const c = tiers.comprehensive;
  const cVisible = visible(c.status, preview);
  const comprehensive = {
    key: 'comprehensive', name: names.comprehensive, available: true,
    price: cVisible ? { amount: c.tuition, display: money(c.tuition), label: 'NWIOI tuition', fixed: true, draft: c.status !== 'approved' } : { amount: null, confirmText: 'Confirm tuition with admissions' },
    paymentPlans: cVisible ? planText(c.paymentPlans, preview) : [],
    lead: c.lead,
    included: [
      ...c.curriculum.map((x) => `${x.ceus} CEUs · ${x.name}`),
      `Supervision: ${c.supervision.description} (over at least ${c.minMonths} months)`,
      ...(c.includesSar ? ['SAR included'] : []),
      ...c.highlights.filter((h) => !/SAR included/i.test(h)),
    ],
    cta: { label: 'Explore enrollment', link: usableLink(c.links?.enroll, preview) && cVisible ? usableLink(c.links.enroll, preview) : booking, viaAdmissions: !(usableLink(c.links?.enroll, preview) && cVisible) },
    extraLinks: [['Meet your supervisors', c.links?.supervisors], ['See a sample training weekend', c.links?.sampleWeekend]]
      .map(([label, u]) => ({ label, link: usableLink(u, preview) })).filter((x) => x.link),
  };

  // ---- Core (fixed; only where NWIOI has defined it)
  const k = tiers.core || {};
  let core = null;
  if (k.defined) {
    const kVisible = visible(k.status, preview);
    const coreSar = sarNeeded && (input.coreSar ?? true);
    const amount = k.tuition + (coreSar ? k.sarAddOn : 0);
    core = {
      key: 'core', name: names.core, available: true,
      price: kVisible ? { amount, display: money(amount), label: 'NWIOI tuition', fixed: true, draft: k.status !== 'approved', sarIncluded: coreSar, sarOffered: sarNeeded } : { amount: null, confirmText: 'Confirm Core tuition with admissions' },
      paymentPlans: kVisible ? planText(k.paymentPlans, preview) : [],
      included: [`${k.ceus} CEUs of NWIOI coursework`, `Supervision: ${k.supervision.description}`, `Your prior education may cover the remaining ${k.fitCeus} CEUs (admissions verifies content and live-hour coverage)`, sarNeeded ? 'SAR available as an add-on' : 'You said you’ve completed a SAR (admissions will confirm it)'],
      cta: { label: 'Review my prior training', link: booking, viaAdmissions: true },
      note: 'We’ll look at what you’ve already completed, see how it fits the Core curriculum, and confirm your tuition before you decide.',
    };
  }

  // ---- Modular (calculated from what they plan to buy)
  const m = tiers.modular;
  const rateVis = visible(m.ceuRate.status, preview), sarVis = visible(m.sar.status, preview), supVis = visible(m.supervision.status, preview);
  const remainingSup = sup.state === 'hours' ? Math.max(0, b.supervision - sup.hours) : null;
  const pkg = c.supervision;
  const suggestion = {
    ceus: edu.state === 'hours' ? Math.max(0, b.education - edu.hours) : null,
    sar: sarNeeded,
    individualHours: where === 'outside' ? 0 : remainingSup === null ? null : Math.round(remainingSup * pkg.individualHours / b.supervision),
    groupSessions: null,
  };
  if (suggestion.individualHours !== null && remainingSup !== null) suggestion.groupSessions = where === 'outside' ? 0 : Math.ceil((remainingSup - suggestion.individualHours) / m.supervision.groupSessionHours);
  const sel = {
    ceus: qty(input.modular?.ceus) ?? suggestion.ceus,
    sar: typeof input.modular?.sar === 'boolean' ? input.modular.sar : suggestion.sar,
    individualHours: where === 'outside' ? 0 : qty(input.modular?.individualHours) ?? suggestion.individualHours,
    groupSessions: where === 'outside' ? 0 : qty(input.modular?.groupSessions) ?? suggestion.groupSessions,
  };
  if (sel.ceus !== null) sel.ceus = Math.min(sel.ceus, b.education);
  const lines = [];
  const missing = [];
  if (sel.ceus === null) missing.push('ceus');
  else if (rateVis) lines.push({ label: `${sel.ceus} CEUs`, amount: sel.ceus * m.ceuRate.amount });
  else missing.push('ceuRate');
  if (sel.sar) { if (sarVis) lines.push({ label: 'SAR', amount: m.sar.price }); else missing.push('sarPrice'); }
  if (where !== 'outside') {
    if (sel.individualHours === null || sel.groupSessions === null) missing.push('supervisionQty');
    else if (supVis) {
      if (sel.individualHours > 0) lines.push({ label: `${sel.individualHours} individual supervision hour${sel.individualHours === 1 ? '' : 's'}`, amount: sel.individualHours * m.supervision.individualRate });
      if (sel.groupSessions > 0) lines.push({ label: `${sel.groupSessions} group supervision session${sel.groupSessions === 1 ? '' : 's'} (${m.supervision.groupSessionHours} hours each)`, amount: sel.groupSessions * m.supervision.groupSessionRate });
    } else if (sel.individualHours + sel.groupSessions > 0) missing.push('supervisionRates');
  }
  // Shown rounded to the nearest $50, as one total: per-unit rates and per-line
  // amounts are never sent to the browser, so the rates can't be read off the quote.
  const total = Math.round(lines.reduce((s, l) => s + l.amount, 0) / MODULAR_ROUND_TO) * MODULAR_ROUND_TO;
  const draftModular = [rateVis && m.ceuRate.status !== 'approved', sarVis && sel.sar && m.sar.status !== 'approved', supVis && where !== 'outside' && m.supervision.status !== 'approved'].some(Boolean);
  const modularLabel = where === 'outside' ? 'Your estimated cost with NWIOI' : 'NWIOI estimate';
  const modularNotes = [];
  if (where === 'outside') modularNotes.push('Supervision with an outside supervisor isn’t included. You’ll pay your supervisor separately.');
  if (missing.includes('ceus')) modularNotes.push(edu.state === 'unsure' ? 'You weren’t sure about your education hours. Choose how many CEUs you expect to buy, or review it with admissions.' : 'Choose how many CEUs you expect to buy.');
  if (missing.includes('supervisionQty')) modularNotes.push(sup.state === 'unsure' ? 'You weren’t sure about your supervision hours. Choose the supervision you’d buy, or review it with admissions.' : 'Choose how much supervision you’d buy from NWIOI.');
  if (missing.includes('supervisionRates')) modularNotes.push('Confirm supervision rates for this credential with admissions.');
  if (missing.includes('ceuRate') || missing.includes('sarPrice')) modularNotes.push('Confirm Modular pricing with admissions.');
  const modularComplete = !missing.length;
  const modular = {
    key: 'modular', name: names.modular, available: true,
    price: lines.length || modularComplete
      ? { amount: total, display: money(total), label: modularLabel, fixed: false, draft: draftModular, complete: modularComplete }
      : { amount: null, label: modularLabel, confirmText: missing.includes('ceuRate') ? 'Confirm Modular pricing with admissions' : 'Choose what you’d buy to see your estimate' },
    items: lines.map((l) => l.label), notes: modularNotes, selection: sel, suggestion, outsideSupervision: where === 'outside',
    units: { groupSessionHours: m.supervision.groupSessionHours },
    included: ['Individual CEU courses you choose', where === 'outside' ? 'Supervision with your outside supervisor (paid separately)' : 'Supervision hours and group sessions as you need them', 'SAR as an add-on if you need one'],
    cta: { label: 'Explore courses', link: usableLink(m.links?.courses, preview) || booking, viaAdmissions: !usableLink(m.links?.courses, preview) },
    secondary: { label: 'Help me choose what I need', link: booking },
  };

  // ---- Recommendation (sliders change the recommendation and the Modular quote, never fixed tuition)
  const reasons = [];
  const priorSupShare = sup.state === 'hours' ? sup.hours / b.supervision : 0;
  const fullSupervisionNeeded = where !== 'outside' && !(priorSupShare >= catalog.recommendation.modularWhenPriorSupervisionShareAtLeast);
  const coreFit = Boolean(core) && fullSupervisionNeeded && edu.state === 'hours' && edu.hours >= k.fitCeus;
  let recommended;
  if (!fullSupervisionNeeded) {
    recommended = 'modular';
    reasons.push(where === 'outside' ? 'You plan to do your supervision with an outside supervisor, so you only need NWIOI coursework and add-ons.'
      : `You’ve already completed about ${sup.hours} of the ${b.supervision} supervision hours, so you don’t need a full supervision package.`);
    reasons.push('Modular lets you buy only the CEUs and supervision you still need.');
  } else if (coreFit) {
    recommended = 'core';
    reasons.push(`Core may be your fit. You’ve completed about ${edu.hours} hours of education that may apply, and Core’s ${k.ceus} CEUs assume your prior education covers about ${k.fitCeus}.`);
    reasons.push('You still need the full supervision package, which Core includes.');
    reasons.push('Admissions will verify how your prior work covers the required content and live hours.');
  } else {
    const compAmount = c.tuition;
    const modularCheaper = modularComplete && supVis && rateVis && total < compAmount;
    if (modularCheaper) {
      recommended = 'modular';
      reasons.push(`Based on your answers, buying only what you still need may cost less than the full Comprehensive package.`);
      reasons.push('You can adjust the quantities below to match what you expect to buy.');
    } else {
      recommended = 'comprehensive';
      reasons.push('You’d like NWIOI education and supervision in one program.');
      reasons.push(edu.state === 'hours' && edu.hours === 0 ? `You’re starting from scratch, and the full curriculum covers the ${b.education}-hour education benchmark.` : edu.state === 'hours' ? `With about ${edu.hours} hours of education so far, the full curriculum gives you a structured path to the ${b.education}-hour benchmark.` : 'The full curriculum covers the education benchmark, so you don’t need to sort out which prior courses count before you start.');
      reasons.push('Tuition is a fixed package price. Prior coursework doesn’t change it.');
    }
  }
  const unknown = [edu, sup].filter((x) => x.state !== 'hours').length;
  const notes = [];
  if (edu.state === 'unsure' || sup.state === 'unsure') notes.push('You weren’t sure about some of your hours, so this recommendation is a starting point. Admissions can help you sort out what counts.');
  else if (unknown) notes.push('Answer the questions above to refine this recommendation.');
  if (sar === 'yes') notes.push('You said you’ve completed a SAR. Admissions will confirm whether it meets the requirement.');
  if (where === 'help') notes.push('Not sure where to do your supervision? We’ve assumed NWIOI for now. Admissions can help you decide.');

  return {
    credential: cred, pathName: ruleset.pathName, rulesetVersion: ruleset.version, benchmarks: b,
    recommended, reasons, notes, coreFit, preview, tierNames: names,
    tracks: { comprehensive, core, modular },
    coreNotDefinedNote: core ? null : `NWIOI hasn’t defined a Core track for the ${ruleset.pathName} credential yet. If you’ve completed some training, admissions can review it and help you choose between Comprehensive and Modular.`,
    booking, contact: usableLink(links.contact, preview),
  };
}
