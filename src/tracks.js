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
    if (!coreItem || coreItem.ceus !== b.core) errors.push(`${cred}: core knowledge CEUs must equal ${b.core}`);
    const tr = (c.curriculum || []).find((x) => x.requirement === 'training');
    if (!tr || tr.name.toLowerCase() !== b.trainingLabel.toLowerCase()) errors.push(`${cred}: skills training must be "${b.trainingLabel}" (found "${tr?.name}")`);
    if (tr && tr.ceus !== b.skills) errors.push(`${cred}: skills training CEUs must equal ${b.skills}`);
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

function planText(plans, preview) {
  return (plans || []).filter((p) => visible(p.status, preview) && p.monthly > 0 && p.months > 0 && p.total > 0)
    .map((p) => ({ text: `${money(p.monthly)}/month for ${p.months} months (${money(p.total)} total)`, draft: p.status !== 'approved' }));
}

/**
 * input: { core, skills, supervision: number|'unsure'|null; sar: 'yes'|'no'|'unsure'|null;
 *          supervisionWhere: 'nwioi'|'outside'|'help'|null; coreSar: boolean|null;
 *          modular: { coreCeus, skillsCeus, sar, individualHours, groupSessions } (null = use suggestion) }
 * links: { booking, contact } raw URLs from settings
 */
export function trackEstimate(catalog, ruleset, input, { preview = false, links = {} } = {}) {
  const cred = ruleset.path;
  const tiers = catalog.credentials[cred];
  const names = catalog.tierNames;
  const b = benchmarks(ruleset);
  const ck = parseHours(input.core, b.core);
  const sk = parseHours(input.skills, b.skills);
  const sup = parseHours(input.supervision, b.supervision);
  const sar = ['yes', 'no', 'unsure'].includes(input.sar) ? input.sar : null;
  const where = ['nwioi', 'outside', 'help'].includes(input.supervisionWhere) ? input.supervisionWhere : null;
  const booking = usableLink(links.booking, preview);
  // SAR: "No" includes it by default; unanswered or "not sure" offers it as an add-on.
  const sarOffered = sar !== 'yes';
  const sarDefault = sar === 'no';
  const pifCfg = catalog.payInFull || {};
  const pifVisible = pifCfg.rate > 0 && visible(pifCfg.status, preview);

  // Fixed package price: standard tuition plus optional add-ons; pay-in-full on the package only.
  function packagePrice(tierKey, tuition, addOns, status, confirmText) {
    if (!visible(status, preview)) return { amount: null, confirmText };
    const amount = tuition + addOns;
    const price = { amount, display: money(amount), label: 'Standard NWIOI tuition', fixed: true, draft: status !== 'approved' };
    if (pifVisible && (pifCfg.tiers || []).includes(tierKey)) {
      const pkg = cents(tuition * (1 - pifCfg.rate));
      const due = cents(pkg + (pifCfg.appliesToAddOns ? cents(addOns * (1 - pifCfg.rate)) : addOns));
      price.payInFull = { amount: due, display: money2(due), savings: money2(cents(amount - due)), percent: Math.round(pifCfg.rate * 100), draft: pifCfg.status !== 'approved' };
    }
    return price;
  }

  // ---- Comprehensive (fixed)
  const c = tiers.comprehensive;
  const cVisible = visible(c.status, preview);
  const enrollLink = cVisible ? usableLink(c.links?.enroll, preview) : null;
  const comprehensive = {
    key: 'comprehensive', name: names.comprehensive, available: true,
    price: packagePrice('comprehensive', c.tuition, 0, c.status, 'Confirm tuition with admissions'),
    paymentPlans: cVisible ? planText(c.paymentPlans, preview) : [],
    lead: c.lead,
    included: [
      ...c.curriculum.map((x) => `${x.ceus} CEUs · ${x.name}`),
      `Supervision: ${c.supervision.description} (over at least ${c.minMonths} months)`,
      ...(c.includesSar ? ['SAR included'] : []),
      ...c.highlights.filter((h) => !/SAR included/i.test(h)),
    ],
    cta: { label: 'Explore enrollment', link: enrollLink || booking, viaAdmissions: !enrollLink },
    extraLinks: [['Meet your supervisors', c.links?.supervisors], ['See a sample training weekend', c.links?.sampleWeekend]]
      .map(([label, u]) => ({ label, link: usableLink(u, preview) })).filter((x) => x.link),
  };

  // ---- Core (fixed; only where NWIOI has defined it)
  const k = tiers.core || {};
  let core = null;
  if (k.defined) {
    const kVisible = visible(k.status, preview);
    const coreSar = sarOffered && (input.coreSar ?? sarDefault);
    core = {
      key: 'core', name: names.core, available: true,
      price: { ...packagePrice('core', k.tuition, coreSar ? k.sarAddOn : 0, k.status, 'Confirm Core tuition with admissions'), sarIncluded: coreSar, sarOffered, sarAddOn: kVisible ? money(k.sarAddOn) : null },
      paymentPlans: kVisible ? planText(k.paymentPlans, preview) : [],
      included: [`${k.ceus} CEUs of NWIOI coursework`, `Supervision: ${k.supervision.description}`, `Your prior education may cover the remaining ${k.fitCeus} CEUs (admissions confirms the topics and live hours)`, sarOffered ? 'SAR available as an add-on' : 'You said you’ve completed a SAR (admissions will confirm it)'],
      cta: { label: 'Review my prior training', link: booking, viaAdmissions: true },
      note: 'We’ll review what you’ve already completed and how it fits the Core curriculum, then confirm your tuition before you decide.',
    };
  }

  // ---- Modular (calculated from what they plan to buy; each education category on its own)
  const m = tiers.modular;
  const rate = m.ceuRate.amount;
  const rateVis = visible(m.ceuRate.status, preview), sarVis = visible(m.sar.status, preview), supVis = visible(m.supervision.status, preview);
  const remainingSup = sup.state === 'hours' ? Math.max(0, b.supervision - sup.hours) : null;
  const pkg = c.supervision;
  const suggestion = {
    coreCeus: ck.state === 'hours' ? b.core - ck.hours : null,
    skillsCeus: sk.state === 'hours' ? b.skills - sk.hours : null,
    sar: sarDefault,
    individualHours: where === 'outside' ? 0 : remainingSup === null ? null : Math.round(remainingSup * pkg.individualHours / b.supervision),
    groupSessions: null,
  };
  if (suggestion.individualHours !== null && remainingSup !== null) suggestion.groupSessions = where === 'outside' ? 0 : Math.ceil((remainingSup - suggestion.individualHours) / m.supervision.groupSessionHours);
  const sel = {
    coreCeus: qty(input.modular?.coreCeus) ?? suggestion.coreCeus,
    skillsCeus: qty(input.modular?.skillsCeus) ?? suggestion.skillsCeus,
    sar: sarOffered && (typeof input.modular?.sar === 'boolean' ? input.modular.sar : suggestion.sar),
    individualHours: where === 'outside' ? 0 : qty(input.modular?.individualHours) ?? suggestion.individualHours,
    groupSessions: where === 'outside' ? 0 : qty(input.modular?.groupSessions) ?? suggestion.groupSessions,
  };
  // Extra hours in one category never close a gap in the other: each is capped separately.
  if (sel.coreCeus !== null) sel.coreCeus = Math.min(sel.coreCeus, b.core);
  if (sel.skillsCeus !== null) sel.skillsCeus = Math.min(sel.skillsCeus, b.skills);
  const lines = [];
  const missing = [];
  // Lines keep their amounts here (server side) for the total; only plain-language
  // quantities are sent to the browser.
  for (const [key, label, n] of [['coreCeus', 'Core Knowledge CEUs', sel.coreCeus], ['skillsCeus', `${b.trainingLabel} CEUs`, sel.skillsCeus]]) {
    if (n === null) missing.push(key);
    else if (!rateVis) missing.push('ceuRate');
    else if (n > 0) lines.push({ label: `${n} ${label}`, amount: n * rate, group: 'education' });
  }
  if (sel.sar) { if (sarVis) lines.push({ label: 'SAR (Sexuality Attitude Reassessment)', amount: m.sar.price, group: 'sar' }); else missing.push('sarPrice'); }
  if (where !== 'outside') {
    if (sel.individualHours === null || sel.groupSessions === null) missing.push('supervisionQty');
    else if (supVis) {
      if (sel.individualHours > 0) lines.push({ label: `${sel.individualHours} hour${sel.individualHours === 1 ? '' : 's'} of individual supervision`, amount: sel.individualHours * m.supervision.individualRate, group: 'supervision' });
      if (sel.groupSessions > 0) lines.push({ label: `${sel.groupSessions} group supervision session${sel.groupSessions === 1 ? '' : 's'}, ${m.supervision.groupSessionHours} hours each`, amount: sel.groupSessions * m.supervision.groupSessionRate, group: 'supervision' });
    } else if (sel.individualHours + sel.groupSessions > 0) missing.push('supervisionRates');
  }
  const total = lines.reduce((s, l) => s + l.amount, 0);
  // "Based on the courses, supervision and SAR you’d buy…": built from what's selected.
  const parts = [lines.some((l) => l.group === 'education') && 'courses', lines.some((l) => l.group === 'supervision') && 'supervision', lines.some((l) => l.group === 'sar') && 'SAR'].filter(Boolean);
  const joined = parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}` : parts[0];
  const basedOn = joined ? `Based on the ${joined} you’d buy individually from NWIOI through ${names.modular}.` : null;
  const draftModular = [rateVis && m.ceuRate.status !== 'approved', sarVis && sel.sar && m.sar.status !== 'approved', supVis && where !== 'outside' && m.supervision.status !== 'approved'].some(Boolean);
  const modularNotes = [];
  if (where === 'outside') modularNotes.push('You’ll pay your outside supervisor separately.');
  if (missing.includes('coreCeus')) modularNotes.push(ck.state === 'unsure' ? 'Core knowledge hours still need review. Choose how many core CEUs you expect to buy, or review it with admissions.' : 'Choose how many core knowledge CEUs you expect to buy.');
  if (missing.includes('skillsCeus')) modularNotes.push(sk.state === 'unsure' ? `${b.trainingLabel} hours still need review. Choose how many you expect to buy, or review it with admissions.` : `Choose how many ${b.trainingLabel.toLowerCase()} CEUs you expect to buy.`);
  if (missing.includes('supervisionQty')) modularNotes.push(sup.state === 'unsure' ? 'Your supervision hours still need review. Choose the supervision you’d buy, or review it with admissions.' : 'Choose how much supervision you’d buy from NWIOI.');
  if (missing.includes('supervisionRates')) modularNotes.push('Confirm supervision rates for this credential with admissions.');
  if (missing.includes('ceuRate') || missing.includes('sarPrice')) modularNotes.push('Confirm Modular pricing with admissions.');
  const modularComplete = !missing.length;
  const modular = {
    key: 'modular', name: names.modular, available: true,
    price: lines.length || modularComplete
      ? { amount: total, display: money(total), label: 'Estimated cost with NWIOI', fixed: false, draft: draftModular, complete: modularComplete }
      : { amount: null, label: 'Estimated cost with NWIOI', confirmText: missing.includes('ceuRate') ? 'Confirm Modular pricing with admissions' : 'Choose what you’d buy to see your estimate' },
    // Quantities only: no unit prices, formulas or per-line amounts leave the server.
    items: lines.map((l) => l.label), basedOn, notes: modularNotes, selection: sel, suggestion, outsideSupervision: where === 'outside',
    sarOffer: sarOffered && sarVis ? (sar === 'no' ? `Add SAR (${money(m.sar.price)})` : `Add SAR for ${money(m.sar.price)} if needed`) : sarOffered ? 'Add SAR if needed' : null,
    units: { groupSessionHours: m.supervision.groupSessionHours, trainingLabel: b.trainingLabel },
    included: ['The CEU courses you choose', where === 'outside' ? 'Supervision with your outside supervisor (paid separately)' : 'Supervision hours and group sessions as you need them', 'SAR as an add-on if you need one'],
    cta: { label: 'Explore courses', link: usableLink(m.links?.courses, preview) || booking, viaAdmissions: !usableLink(m.links?.courses, preview) },
    secondary: { label: 'Help me choose what I need', link: booking },
  };

  // ---- Recommendation: only once the answers support one.
  const ready = where === 'outside' || (where !== null && answered(ck) && answered(sk) && answered(sup));
  const reasons = [];
  const priorSupShare = sup.state === 'hours' ? sup.hours / b.supervision : 0;
  const fullSupervisionNeeded = where !== 'outside' && !(priorSupShare >= catalog.recommendation.modularWhenPriorSupervisionShareAtLeast);
  const priorEducation = ck.state === 'hours' && sk.state === 'hours' ? ck.hours + sk.hours : null;
  const coreFit = Boolean(core) && ready && fullSupervisionNeeded && priorEducation !== null && priorEducation >= k.fitCeus;
  let recommended = null;
  if (ready) {
    if (!fullSupervisionNeeded) {
      recommended = 'modular';
      reasons.push(where === 'outside' ? 'You plan to do your supervision with an outside supervisor, so you only need NWIOI coursework and add-ons.'
        : `You’ve already completed about ${sup.hours} of the ${b.supervision} supervision hours, so you don’t need a full supervision package.`);
      reasons.push('Modular lets you buy only the CEUs and supervision you still need.');
    } else if (coreFit) {
      recommended = 'core';
      reasons.push(`Core may be your fit. You’ve completed about ${priorEducation} hours of education that may apply (${ck.hours} core knowledge + ${sk.hours} skills training), and Core’s ${k.ceus} CEUs assume your prior education covers about ${k.fitCeus}.`);
      reasons.push('You still want the full NWIOI supervision package, which Core includes.');
      reasons.push('Admissions will confirm that your prior training and the Core curriculum together cover the required topics and live hours.');
    } else {
      const modularCheaper = modularComplete && supVis && rateVis && total < c.tuition;
      if (modularCheaper) {
        recommended = 'modular';
        reasons.push('Based on your answers, buying only what you still need may cost less than the full Comprehensive package.');
        reasons.push('You can adjust the quantities to match what you expect to buy.');
      } else {
        recommended = 'comprehensive';
        reasons.push('You’d like NWIOI education and supervision in one program.');
        reasons.push(priorEducation === 0 ? `You’re starting from scratch, and the full curriculum covers all ${b.core} core knowledge and ${b.skills} skills training hours.`
          : priorEducation !== null ? `With about ${priorEducation} education hours so far, the full curriculum gives you a structured path through all ${b.education} hours.`
            : 'The full curriculum covers the education requirement, so you don’t need to sort out which prior courses count before you start.');
        reasons.push('Tuition is a fixed package price. Prior coursework doesn’t change it.');
      }
    }
  }
  const notes = [];
  if (!ready) notes.push('Answer the questions to see which track fits you best. Until then, here’s the complete program for this credential.');
  else if ([ck, sk, sup].some((a) => a.state === 'unsure')) notes.push('You weren’t sure about some of your hours, so this recommendation is a starting point. Admissions can help you sort out what counts.');
  if (sar === 'yes') notes.push('You said you’ve completed a SAR. Admissions can confirm whether it meets the requirement.');
  if (where === 'help' && ready) notes.push('Not sure where to do your supervision? We’ve assumed NWIOI for now. Admissions can help you decide.');

  const sch = catalog.scholarship;
  const scholarship = sch && visible(sch.status, preview)
    ? { title: sch.title, copy: sch.copy, application: usableLink(sch.applicationUrl, preview), equity: booking }
    : null;

  return {
    credential: cred, pathName: ruleset.pathName, rulesetVersion: ruleset.version, benchmarks: b,
    recommended, startingPoint: recommended ?? 'comprehensive', ready, reasons, notes, coreFit, preview, tierNames: names,
    tracks: { comprehensive, core, modular },
    coreNotDefinedNote: core ? null : `NWIOI hasn’t defined a Core track for the ${ruleset.pathName} credential yet. If you’ve completed some training, admissions can review it and help you choose between Comprehensive and Modular.`,
    examples: { core: catalog.coreKnowledgeExample, skills: tiers.skillsExample },
    scholarship, booking, contact: usableLink(links.contact, preview),
  };
}
