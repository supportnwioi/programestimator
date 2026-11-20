// Track finder: two NWIOI tiers per credential.
// Tier I · Core Program: fixed package tuition (99 CEUs + supervision + SAR).
//   Prior education doesn't change it; it changes how much additional
//   coursework the student may still need, priced at the planning rate.
// Tier II · À La Carte: individual courses, supervision and SAR, shown as one
//   total with a quantities-only breakdown (no unit prices sent to the browser).
// Separate from the detailed engine (src/engine.js).
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './store.js';
import { usableLink } from './links.js';

export const DEFAULT_CATALOG = JSON.parse(fs.readFileSync(path.join(ROOT, 'config/tracks.json'), 'utf8'));

const money = (n) => '$' + Math.round(n).toLocaleString('en-US');
const money2 = (n) => '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const cents = (n) => Math.round(n * 100) / 100;
const req = (ruleset, k) => ruleset.requirements.find((r) => r.key === k);

export function benchmarks(ruleset) {
  const core = req(ruleset, 'core'), training = req(ruleset, 'training'), sup = req(ruleset, 'supervision');
  return {
    core: core.totalHours,
    skills: training.totalHours,
    education: core.totalHours + training.totalHours,
    supervision: sup.totalHours,
    minMonths: sup.minMonths,
    semesterCreditClockHours: ruleset.creditRules.academicSemesterCreditClockHours,
    nonAasectCeMultiplier: ruleset.creditRules.nonAasectCeMultiplier,
    trainingLabel: training.longLabel,
    coreLabel: 'Core Knowledge Areas (CKAs)',
  };
}

// Checks each credential's Core Program against its AASECT ruleset.
export function validateCatalog(catalog, rulesetsByPath) {
  const errors = [];
  for (const [cred, tiers] of Object.entries(catalog.credentials || {})) {
    const r = rulesetsByPath[cred];
    if (!r) { errors.push(`${cred}: no active ruleset`); continue; }
    const b = benchmarks(r);
    const c = tiers.core;
    if (!c) { errors.push(`${cred}: missing core`); continue; }
    if (!(c.tuition > 0)) errors.push(`${cred}: Core tuition missing`);
    if (!(c.ceus > 0 && c.ceus <= b.education)) errors.push(`${cred}: Core CEUs must be between 1 and ${b.education}`);
    if (c.includesSar !== true) errors.push(`${cred}: Core must include SAR`);
    const m = c.curriculumMapping;
    if (m) {
      if (m.core + m.skills !== c.ceus) errors.push(`${cred}: curriculum mapping ${m.core} + ${m.skills} ≠ ${c.ceus} CEUs`);
      if (m.core > b.core) errors.push(`${cred}: mapped core knowledge ${m.core} exceeds ${b.core}`);
      if (m.skills > b.skills) errors.push(`${cred}: mapped skills training ${m.skills} exceeds ${b.skills}`);
    }
    const s = c.supervision || {};
    if (s.individualHours + s.groupHours !== b.supervision) errors.push(`${cred}: supervision package is ${s.individualHours + s.groupHours} hours; target is ${b.supervision}`);
    if (s.groupSessions * s.groupSessionHours !== s.groupHours) errors.push(`${cred}: ${s.groupSessions} × ${s.groupSessionHours}-hour group sessions ≠ ${s.groupHours} group hours`);
    if (s.individualHours < req(r, 'supervision').individualMin) errors.push(`${cred}: individual supervision below the AASECT minimum of ${req(r, 'supervision').individualMin}`);
    if (c.minMonths !== b.minMonths) errors.push(`${cred}: minimum supervision period ${c.minMonths} months; AASECT requires ${b.minMonths}`);
    for (const st of [c.status, tiers.alaCarte?.ceuRate?.status, tiers.alaCarte?.sar?.status, tiers.alaCarte?.supervision?.status].filter(Boolean)) {
      if (!['draft', 'approved'].includes(st)) errors.push(`${cred}: status must be "draft" or "approved" (found "${st}")`);
    }
  }
  const pif = catalog.payInFull;
  if (pif && !(pif.rate >= 0 && pif.rate < 0.5)) errors.push('payInFull.rate must be between 0 and 0.5');
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
const answered = (a) => a.state !== 'unanswered';
const qty = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) || Number(v) < 0 ? null : Math.round(Number(v)));
const dollars = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) || Number(v) < 0 ? null : Math.round(Number(v) * 100) / 100);

function planText(plans, preview) {
  return (plans || []).filter((p) => visible(p.status, preview) && p.monthly > 0 && p.months > 0 && p.total > 0)
    .map((p) => ({ text: `${money(p.monthly)}/month for ${p.months} months (${money(p.total)} total)`, draft: p.status !== 'approved' }));
}

/**
 * What prior education may cover alongside Core, and what may still be needed.
 * With a confirmed curriculum mapping, each category is calculated on its own and
 * prior hours that overlap NWIOI's curriculum count once. Without one, the gap is
 * education benchmark − Core CEUs (e.g. 150 − 99 = 51): a rough planning estimate.
 */
export function priorCoverage(b, core, ck, sk, total = { state: 'unanswered' }) {
  const mapping = core.curriculumMapping || null;
  const gap = b.education - core.ceus;
  const base = { nwioiCeus: core.ceus, mappingKnown: Boolean(mapping), gapBeforePrior: gap, rough: !mapping, basis: 'categories' };
  // One self-reported total (no category split): hours that may count overall, and
  // the arithmetic gap beyond Core. Always a rough planning estimate.
  if (!(ck.state === 'hours' && sk.state === 'hours') && total.state === 'hours') {
    const counted = Math.min(gap, total.hours);
    return { ...base, basis: 'total', rough: true, state: 'known', covered: total.hours, reported: total.hours, counted, overlap: total.hours - counted, remaining: gap - counted, remainingCore: null, remainingSkills: null };
  }
  if (ck.state !== 'hours' || sk.state !== 'hours') {
    if (total.state === 'unsure' && ck.state !== 'hours' && sk.state !== 'hours') return { ...base, basis: 'total', state: 'unresolved', knownCore: null, knownSkills: null, unsure: true };
    return { ...base, state: 'unresolved', knownCore: ck.state === 'hours' ? ck.hours : null, knownSkills: sk.state === 'hours' ? sk.hours : null, unsure: [ck, sk].some((a) => a.state === 'unsure') };
  }
  const reported = ck.hours + sk.hours;
  if (mapping) {
    const coreGap = Math.max(0, b.core - mapping.core - ck.hours);
    const skillsGap = Math.max(0, b.skills - mapping.skills - sk.hours);
    const counted = (b.core - mapping.core - coreGap) + (b.skills - mapping.skills - skillsGap);
    return { ...base, state: 'known', covered: reported, reported, counted, overlap: reported - counted, remaining: coreGap + skillsGap, remainingCore: coreGap, remainingSkills: skillsGap };
  }
  const counted = Math.min(gap, reported);
  return { ...base, state: 'known', covered: reported, reported, counted, overlap: reported - counted, remaining: gap - counted, remainingCore: null, remainingSkills: null };
}

/**
 * input: { core, skills, supervision: number|'unsure'|null; sar: 'yes'|'no'|'unsure'|null;
 *          supervisionWhere: 'nwioi'|'outside'|'help'|null;
 *          additional: { nwioiCeus, outsideCost } (null = default);
 *          alaCarte: { coreCeus, skillsCeus, sar, individualHours, groupSessions } (null = suggestion) }
 * links: { booking, contact } raw URLs from settings
 */
export function trackEstimate(catalog, ruleset, input, { preview = false, links = {} } = {}) {
  const cred = ruleset.path;
  const tiers = catalog.credentials[cred];
  const names = catalog.tierNames;
  const b = benchmarks(ruleset);
  const ck = parseHours(input.core, b.core);
  const sk = parseHours(input.skills, b.skills);
  const tot = parseHours(input.total, b.education);
  const sup = parseHours(input.supervision, b.supervision);
  const sar = ['yes', 'no', 'unsure'].includes(input.sar) ? input.sar : null;
  const where = ['nwioi', 'outside', 'help'].includes(input.supervisionWhere) ? input.supervisionWhere : null;
  const booking = usableLink(links.booking, preview);
  const library = usableLink(catalog.library?.url, preview);
  const pifCfg = catalog.payInFull || {};
  const planRate = catalog.planningRate || {};
  const planRateVisible = planRate.perCeu > 0 && visible(planRate.status, preview);

  // ---- Tier I · Core Program (fixed tuition, SAR included)
  const c = tiers.core;
  const cVisible = visible(c.status, preview);
  let corePrice = { amount: null, confirmText: 'Confirm Core tuition with admissions' };
  if (cVisible) {
    corePrice = { amount: c.tuition, display: money(c.tuition), label: 'Standard NWIOI tuition', fixed: true, draft: c.status !== 'approved' };
    if (pifCfg.rate > 0 && visible(pifCfg.status, preview) && (pifCfg.tiers || []).includes('core')) {
      const due = cents(c.tuition * (1 - pifCfg.rate));
      corePrice.payInFull = { amount: due, display: money2(due), savings: money2(cents(c.tuition - due)), percent: Math.round(pifCfg.rate * 100), draft: pifCfg.status !== 'approved' };
    }
  }
  const enrollLink = cVisible ? usableLink(c.links?.enroll, preview) : null;
  const core = {
    key: 'core', name: names.core, price: corePrice,
    paymentPlans: cVisible ? planText(c.paymentPlans, preview) : [],
    lead: c.lead,
    included: [
      `${c.ceus} CEUs of NWIOI coursework`,
      `Supervision: ${c.supervision.description} (over at least ${c.minMonths} months)`,
      'SAR included',
      ...c.highlights,
    ],
    cta: { label: 'Review my prior training', link: booking },
    secondary: { label: 'Explore the NWIOI course library', link: library },
    enroll: enrollLink,
    extraLinks: [['Meet your supervisors', c.links?.supervisors], ['See a sample training weekend', c.links?.sampleWeekend]]
      .map(([label, u]) => ({ label, link: usableLink(u, preview) })).filter((x) => x.link),
  };

  // ---- Prior training: what may be covered, what NWIOI includes, what may still be needed
  const cov = priorCoverage(b, c, ck, sk, tot);
  const dayHours = catalog.trainingDay?.hours || 8;
  const prior = { ...cov, planningRate: planRateVisible ? money(planRate.perCeu) : null, libraryNote: catalog.library?.note || null,
    days: cov.state === 'known' && cov.covered >= dayHours ? Math.round(cov.covered / dayHours) : 0, dayHours };
  if (cov.state === 'known') {
    const nwioiCeus = Math.min(qty(input.additional?.nwioiCeus) ?? cov.remaining, cov.remaining);
    const outsideCeus = cov.remaining - nwioiCeus;
    const outsideCost = outsideCeus > 0 ? dollars(input.additional?.outsideCost) : null;
    const additionalNwioi = planRateVisible ? nwioiCeus * planRate.perCeu : null;
    // What prior training may save in additional coursework, at the planning rate.
    prior.priorSavings = planRateVisible && cov.counted > 0 ? { amount: cov.counted * planRate.perCeu, display: money(cov.counted * planRate.perCeu) } : null;
    prior.nwioiAdditionalCeus = nwioiCeus;
    prior.outsideCeus = outsideCeus;
    prior.outsideCost = outsideCost;
    prior.additional = additionalNwioi !== null ? { amount: additionalNwioi, display: money(additionalNwioi) } : null;
    const combinedKnown = cVisible && additionalNwioi !== null && (outsideCeus === 0 || outsideCost !== null);
    prior.combined = cVisible && additionalNwioi !== null
      ? { amount: c.tuition + additionalNwioi + (outsideCost || 0), display: money(c.tuition + additionalNwioi + (outsideCost || 0)), complete: combinedKnown }
      : null;
  }

  // ---- Tier II · À La Carte (one total; quantities only leave the server)
  const m = tiers.alaCarte;
  const rate = m.ceuRate.amount;
  const rateVis = visible(m.ceuRate.status, preview), sarVis = visible(m.sar.status, preview), supVis = visible(m.supervision.status, preview);
  const sarOffered = sar !== 'yes';
  const remainingSup = sup.state === 'hours' ? Math.max(0, b.supervision - sup.hours) : null;
  const pkg = c.supervision;
  const suggestion = {
    coreCeus: ck.state === 'hours' ? b.core - ck.hours : null,
    skillsCeus: sk.state === 'hours' ? b.skills - sk.hours : null,
    sar: sar === 'no',
    individualHours: where === 'outside' ? 0 : remainingSup === null ? null : Math.round(remainingSup * pkg.individualHours / b.supervision),
    groupSessions: null,
  };
  if (suggestion.individualHours !== null && remainingSup !== null) suggestion.groupSessions = where === 'outside' ? 0 : Math.ceil((remainingSup - suggestion.individualHours) / m.supervision.groupSessionHours);
  const sel = {
    coreCeus: qty(input.alaCarte?.coreCeus) ?? suggestion.coreCeus,
    skillsCeus: qty(input.alaCarte?.skillsCeus) ?? suggestion.skillsCeus,
    // SAR is included only when the visitor ticks it; answering "No" only highlights the offer.
    sar: sarOffered && input.alaCarte?.sar === true,
    individualHours: where === 'outside' ? 0 : qty(input.alaCarte?.individualHours) ?? suggestion.individualHours,
    groupSessions: where === 'outside' ? 0 : qty(input.alaCarte?.groupSessions) ?? suggestion.groupSessions,
  };
  if (sel.coreCeus !== null) sel.coreCeus = Math.min(sel.coreCeus, b.core);
  if (sel.skillsCeus !== null) sel.skillsCeus = Math.min(sel.skillsCeus, b.skills);
  const lines = [];
  const missing = [];
  for (const [key, label, n] of [['coreCeus', 'Core Knowledge CEUs', sel.coreCeus], ['skillsCeus', `${b.trainingLabel} CEUs`, sel.skillsCeus]]) {
    if (n === null) missing.push(key);
    else if (!rateVis) missing.push('ceuRate');
    else if (n > 0) lines.push({ label: `${n} ${label}`, amount: n * rate, group: 'education' });
  }
  if (sel.sar) { if (sarVis) lines.push({ label: 'SAR (Sexuality Attitude Reassessment)', amount: m.sar.price, group: 'sar' }); else missing.push('sarPrice'); }
  // Supervision is an optional addition: only counted once the visitor chooses NWIOI supervision.
  if (where === 'nwioi' || where === 'help') {
    if (sel.individualHours === null || sel.groupSessions === null) missing.push('supervisionQty');
    else if (supVis) {
      if (sel.individualHours > 0) lines.push({ label: `${sel.individualHours} hour${sel.individualHours === 1 ? '' : 's'} of individual supervision`, amount: sel.individualHours * m.supervision.individualRate, group: 'supervision' });
      if (sel.groupSessions > 0) lines.push({ label: `${sel.groupSessions} group supervision session${sel.groupSessions === 1 ? '' : 's'}, ${m.supervision.groupSessionHours} hours each`, amount: sel.groupSessions * m.supervision.groupSessionRate, group: 'supervision' });
    } else if (sel.individualHours + sel.groupSessions > 0) missing.push('supervisionRates');
  }
  const total = lines.reduce((s, l) => s + l.amount, 0);
  const parts = [lines.some((l) => l.group === 'education') && 'courses', lines.some((l) => l.group === 'supervision') && 'supervision', lines.some((l) => l.group === 'sar') && 'SAR'].filter(Boolean);
  const joined = parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}` : parts[0];
  const basedOn = joined ? `Based on the ${joined} you’d buy individually from NWIOI through ${names.alaCarte}.` : null;
  const draftAla = [rateVis && m.ceuRate.status !== 'approved', sarVis && sel.sar && m.sar.status !== 'approved', supVis && where !== 'outside' && m.supervision.status !== 'approved'].some(Boolean);
  const alaNotes = [];
  if (where === 'outside') alaNotes.push('You’ll pay your outside supervisor separately.');
  if (missing.includes('coreCeus')) alaNotes.push(ck.state === 'unsure' ? 'Core knowledge hours still need review. Choose how many core CEUs you expect to buy, or review it with admissions.' : 'Choose how many core knowledge CEUs you expect to buy.');
  if (missing.includes('skillsCeus')) alaNotes.push(sk.state === 'unsure' ? `${b.trainingLabel} hours still need review. Choose how many you expect to buy, or review it with admissions.` : `Choose how many ${b.trainingLabel.toLowerCase()} CEUs you expect to buy.`);
  if (missing.includes('supervisionQty')) alaNotes.push(sup.state === 'unsure' ? 'Your supervision hours still need review. Choose the supervision you’d buy, or review it with admissions.' : 'Choose how much supervision you’d buy from NWIOI.');
  if (missing.includes('supervisionRates')) alaNotes.push('Confirm supervision rates for this credential with admissions.');
  if (missing.includes('ceuRate') || missing.includes('sarPrice')) alaNotes.push('Confirm À La Carte pricing with admissions.');
  const alaComplete = !missing.length;
  // Coursework still needed if bought through À La Carte (no package CEUs): each
  // category's gap after prior coursework, kept separate. Planning estimate.
  let coursework;
  if (ck.state === 'hours' && sk.state === 'hours') {
    const rc = b.core - ck.hours, rs = b.skills - sk.hours, rem = rc + rs;
    coursework = { state: 'known', remaining: rem, remainingCore: rc, remainingSkills: rs,
      cost: rateVis ? { amount: rem * rate, display: money(rem * rate), draft: m.ceuRate.status !== 'approved' } : null };
  } else {
    coursework = { state: 'unresolved', remainingCore: ck.state === 'hours' ? b.core - ck.hours : null, remainingSkills: sk.state === 'hours' ? b.skills - sk.hours : null, unsure: [ck, sk].some((a) => a.state === 'unsure') };
  }
  const selectedEdu = (sel.coreCeus ?? 0) + (sel.skillsCeus ?? 0);
  const fewerThanNeeded = coursework.state === 'known' && selectedEdu < coursework.remaining;
  const alaCarte = {
    key: 'alaCarte', name: names.alaCarte,
    price: lines.length || alaComplete
      ? { amount: total, display: money(total), label: 'Estimated cost with NWIOI', fixed: false, draft: draftAla, complete: alaComplete }
      : { amount: null, label: 'Estimated cost with NWIOI', confirmText: missing.includes('ceuRate') ? 'Confirm À La Carte pricing with admissions' : 'Choose what you’d buy to see your estimate' },
    coursework, fewerThanNeeded,
    items: lines.map((l) => l.label), basedOn, notes: alaNotes, selection: sel, suggestion, outsideSupervision: where === 'outside',
    sarOffer: sarOffered ? (sar === 'no' ? 'Add SAR' : 'Add SAR if needed') : null,
    units: { groupSessionHours: m.supervision.groupSessionHours, trainingLabel: b.trainingLabel },
    included: ['The individual courses you choose', where === 'outside' ? 'Supervision with your outside supervisor (paid separately)' : 'NWIOI supervision hours and group sessions as you need them', 'SAR if you need one'],
    cta: { label: 'Explore the NWIOI course library', link: usableLink(m.links?.courses, preview) || library },
    secondary: { label: 'Book a free admissions call', link: booking },
  };

  // ---- Package savings: only when buying the same components and quantities separately.
  // Core = 99 CEUs + the supervision package + SAR. Group hours must divide evenly into
  // À La Carte sessions to be the same quantity; otherwise no savings figure is shown.
  let savings = null;
  const sameGroupSessions = pkg.groupHours / m.supervision.groupSessionHours;
  if (cVisible && rateVis && sarVis && supVis && Number.isInteger(sameGroupSessions)) {
    const separately = c.ceus * rate + pkg.individualHours * m.supervision.individualRate + sameGroupSessions * m.supervision.groupSessionRate + m.sar.price;
    if (separately > c.tuition) {
      savings = {
        amount: separately - c.tuition, display: money(separately - c.tuition), separately: money(separately),
        items: [`${c.ceus} CEUs`, `${pkg.individualHours} hours of individual supervision`, `${sameGroupSessions} group supervision sessions, ${m.supervision.groupSessionHours} hours each (${pkg.groupHours} group hours)`, 'SAR'],
      };
    }
  }

  // ---- Recommendation: only once the answers support one.
  const ready = where === 'outside' || (where !== null && ((answered(ck) && answered(sk)) || answered(tot)) && answered(sup));
  const reasons = [];
  const priorSupShare = sup.state === 'hours' ? sup.hours / b.supervision : 0;
  const fullSupervisionNeeded = where !== 'outside' && !(priorSupShare >= catalog.recommendation.modularWhenPriorSupervisionShareAtLeast);
  let recommended = null;
  if (ready) {
    if (!fullSupervisionNeeded) {
      recommended = 'alaCarte';
      reasons.push(where === 'outside' ? 'You plan to do your supervision with an outside supervisor. Core includes NWIOI supervision, so choosing just the courses you need may fit better.'
        : `You’ve already completed about ${sup.hours} of the ${b.supervision} supervision hours, so you may not need Core’s full supervision package.`);
      reasons.push('À La Carte lets you choose individual courses, supervision or SAR.');
    } else {
      recommended = 'core';
      reasons.push(`Core includes ${c.ceus} CEUs, your full supervision package, and SAR at a fixed tuition.`);
      if (cov.state === 'known') reasons.push(cov.remaining === 0 ? 'Your prior training may already cover the rest of the education requirement.' : `Your prior training may cover about ${cov.counted} hours, leaving about ${cov.remaining} CEUs to complete through NWIOI or another institute.`);
      reasons.push('Admissions will review your prior training to confirm which topics and live hours count.');
    }
  }
  const notes = [];
  if (!ready) notes.push('Answer the questions to see which tier fits you best. Until then, here’s the Core Program for this credential.');
  if (sar === 'yes') notes.push('You said you’ve completed a SAR. SAR is included in Core either way, and Core tuition stays the same.');
  if (where === 'help' && ready) notes.push('Not sure where to do your supervision? We’ve assumed NWIOI for now. Admissions can help you decide.');

  const sch = catalog.scholarship;
  const scholarship = sch && visible(sch.status, preview)
    ? { title: sch.title, copy: sch.copy, application: usableLink(sch.applicationUrl, preview), equity: booking }
    : null;

  return {
    credential: cred, pathName: ruleset.pathName, rulesetVersion: ruleset.version, benchmarks: b,
    recommended, startingPoint: recommended ?? 'core', ready, reasons, notes, preview, tierNames: names,
    tracks: { core, alaCarte }, prior, savings,
    examples: { core: catalog.coreKnowledgeExample, skills: tiers.skillsExample },
    scholarship, booking, library, contact: usableLink(links.contact, preview),
  };
}
