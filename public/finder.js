// Track finder, one short flow:
//   "Build on the training you've already done." → credential → one rough
//   prior-hours estimate (category breakdown optional) → result right below →
//   Core Program and À La Carte as two short rows, with the full comparison and
//   the À La Carte builder behind secondary links.
// All pricing comes from POST /api/track-estimate (server-side catalog).
const $main = document.getElementById('finder');
const $bar = document.getElementById('price-bar');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const PLANNING_COPY = 'This is a planning estimate. We’ll review your prior training and coursework options together and confirm your NWIOI tuition before you enroll.';
const STORE_KEY = 'nwioi-finder-v6';
const CKA_URL = 'https://www.aasect.org/certification/core-knowledge-areas';
const ACADEMIC_URL = 'https://www.aasect.org/career/academic-qualifications';
const PLANNING_NOTE = 'NWIOI can help you review your transcripts and CE certificates and identify what you may still need. AASECT makes the final determination about which hours count toward certification.';
const WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
const word = (n) => (n <= 10 ? WORDS[n] : String(n));

let config = null;
let result = null;
const freshAla = () => ({ coreCeus: null, skillsCeus: null, sar: null, individualHours: null, groupSessions: null });
const freshAdditional = () => ({ nwioiCeus: null, outsideCost: null });
// mode: null | 'ala' (À La Carte builder open)
const freshCollege = () => ({ answer: null, unit: 'credits', amount: null });
const freshCe = () => ({ answer: null, aasect: null, other: null, unsure: null });
const fresh = () => ({ path: null, mode: null, college: freshCollege(), ce: freshCe(), core: null, skills: null, liveCore: null, liveSkills: null, supervision: null, sar: null, where: null, additional: freshAdditional(), alaCarte: freshAla() });
let state = fresh();

const deciding = () => state.path === 'deciding';
const pathCfg = () => config.paths.find((p) => p.path === state.path);
const known = (p) => p && p.amount !== null && p.amount !== undefined;
const maxFor = (key) => pathCfg().benchmarks[key];
const hasCategories = () => state.core !== null || state.skills !== null || state.liveCore !== null || state.liveSkills !== null;
function load() {
  try {
    const s = JSON.parse(sessionStorage.getItem(STORE_KEY));
    if (s) state = { ...fresh(), ...s, college: { ...freshCollege(), ...(s.college || {}) }, ce: { ...freshCe(), ...(s.ce || {}) }, additional: { ...freshAdditional(), ...(s.additional || {}) }, alaCarte: { ...freshAla(), ...(s.alaCarte || {}) } };
  } catch { /* storage unavailable */ }
}
function save() { try { sessionStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch { /* storage unavailable */ } }

// ------------------------------------------------------------------ helpers
function linkHtml(link, label, cls = '', testid = '') {
  const t = testid ? ` data-testid="${testid}"` : '';
  if (!link) return `<span class="${cls} disabled" aria-disabled="true"${t}>${esc(label)} <span class="small">(link coming soon)</span></span>`;
  return `<a class="${cls}" href="${esc(link.url)}" target="_blank" rel="noopener"${t}>${esc(label)}</a>${link.placeholder ? ' <span class="chip warn">Placeholder link · preview</span>' : ''}`;
}
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const openState = {};
const det = (id, summary, body, testid = '', cls = 'expand') => `<details id="${id}" class="${cls}"${openState[id] ? ' open' : ''}${testid ? ` data-testid="${testid}"` : ''}><summary>${summary}</summary>${body}</details>`;
const itemList = (items, testid) => `<ul class="item-list" data-testid="${testid}">${items.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>`;
const draftChip = (on) => (on ? ' <span class="chip warn">Draft · preview only</span>' : '');

function statusText(v) {
  if (v === null || v === undefined) return 'Not answered yet';
  if (v === 'unsure') return 'You’re not sure';
  return `${v} hour${v === 1 ? '' : 's'}`;
}

function hoursQuestion(key, title, hint, max, scaleLabel) {
  const v = state[key];
  const answered = v !== null && v !== undefined, unsure = v === 'unsure';
  const n = typeof v === 'number' ? v : 0;
  return `
  <fieldset class="hours-q ${answered ? '' : 'unanswered'} ${unsure ? 'is-unsure' : ''}" data-q="${key}">
    <legend id="${key}-legend">${esc(title)}</legend>
    <p class="small muted" id="${key}-hint">${hint}</p>
    <div class="slider-row">
      <input type="range" min="0" max="${max}" step="1" value="${unsure ? 0 : n}" id="${key}-range" data-range="${key}"
        aria-labelledby="${key}-legend" aria-describedby="${key}-hint ${key}-status" aria-valuetext="${esc(statusText(v))}">
      <span class="num"><input type="number" inputmode="numeric" min="0" max="${max}" step="1" id="${key}-num" data-num="${key}"
        value="${answered && !unsure ? n : ''}" placeholder="—" aria-label="${esc(title)} (hours)"> <span aria-hidden="true">hours</span></span>
    </div>
    <div class="scale small muted" aria-hidden="true"><span>0</span><span>${max} · ${esc(scaleLabel)}</span></div>
    <div class="between q-foot">
      <span class="q-status small" id="${key}-status" aria-live="polite"><strong>${esc(statusText(v))}</strong></span>
      <span class="row">
        <button type="button" class="chip-btn" data-zero="${key}" aria-pressed="${answered && !unsure && n === 0}">None yet</button>
        <button type="button" class="chip-btn" data-unsure="${key}" aria-pressed="${unsure}">I’m not sure</button>
      </span>
    </div>
  </fieldset>`;
}

const radioGroup = (name, legend, options, value) => `
  <fieldset><legend>${esc(legend)}</legend>
    <div class="seg">${options.map(([k, l]) => `<label><input type="radio" name="${name}" value="${k}" ${value === k ? 'checked' : ''}> ${esc(l)}</label>`).join('')}</div>
  </fieldset>`;

function scholarshipBlock() {
  const s = result?.scholarship;
  if (!s) return '';
  return `<details class="scholarship" data-testid="scholarship">
    <summary>Explore scholarship and equity rates</summary>
    <p class="small"><strong>${esc(s.title)}</strong><br>${esc(s.copy)}</p>
    <p class="small muted">Scholarship awards, and whether they combine with pay-in-full savings, are subject to NWIOI review.</p>
    <div class="row">${linkHtml(s.application, 'View scholarship application', 'btn', 'scholarship-apply')} ${linkHtml(s.equity, 'Ask about equity rates', 'small', 'equity')}</div>
  </details>`;
}

// ------------------------------------------------------------------ page one: what you've already learned
const reqOf = (p, key) => p.requirements.find((r) => r.key === key);
function requirementsGuide(p) {
  const b = p.benchmarks;
  const core = reqOf(p, 'core'), tr = reqOf(p, 'training');
  const official = p.sources?.[0];
  const areaList = (q) => `<ol class="areas small" type="A">${(q.areas || []).map((a) => `<li>${esc(a.label)}</li>`).join('')}</ol>`;
  const couples = (tr.conditional || []).find((c) => c.key === 'couples');
  return `
  <section class="guide" data-testid="guide" aria-labelledby="guide-h">
    <h2 id="guide-h" class="guide-h">AASECT education requirements</h2>
    <div class="table-wrap"><table class="guide-table" data-testid="guide-table">
      <thead><tr><th scope="col">Requirement</th><th scope="col">What it means</th></tr></thead>
      <tbody>
        <tr><th scope="row"><strong>${b.core} hours</strong> · Core Knowledge Areas (CKAs)</th><td>What you know about human sexuality. At least <strong>${b.coreLiveMin} hours must be live</strong>, in person or online.</td></tr>
        <tr><th scope="row"><strong>${b.skills} hours</strong> · ${esc(b.trainingLabel)}</th><td>How you apply what you know in <strong>${esc(tr.specificLabel || p.pathName.toLowerCase().replace('sex therapist', 'sex therapy'))}</strong>. At least <strong>${b.skillsLiveMin} hours must be live</strong>, in person or online.</td></tr>
      </tbody>
    </table></div>
    <p class="small sar-note" data-testid="sar-note">Those are the <strong>${b.education} coursework hours</strong>. Separately, AASECT also requires <strong>${b.sarHours} hours of Sexuality Attitude Reassessment (SAR)</strong>, an AASECT-sponsored or approved experience.</p>
    ${det('full-reqs', 'See the full education requirements', `
      <h3 class="small-h">Core Knowledge Areas</h3>
      <p class="small">At least ${core.areaMin} hours in each of the ${core.areas?.length || 17} areas, and no more than ${core.areaMax} hours in any one area count toward the ${b.core}. At least ${b.coreLiveMin} of the ${b.core} hours must be live. Areas G, H, K and L are time sensitive. The same hour can’t count toward both Core Knowledge and skills training.</p>
      ${areaList(core)}
      <h3 class="small-h">${esc(b.trainingLabel)}</h3>
      <p class="small">At least ${tr.areaMin} hours in each content area and no more than ${tr.areaMax} in any one. At least ${b.skillsLiveMin} of the ${b.skills} hours must be live.${tr.specificMin ? ` A portion may be general ${p.path === 'sexuality_educator' ? 'education' : 'counseling'} training, but <strong>at least ${tr.specificMin} hours must be specific to ${esc(tr.specificLabel)}</strong>.` : ''}${couples ? ` If you have no documented graduate or postgraduate training in couples counseling, <strong>${couples.hours} of the ${b.skills} hours must be couples counseling training</strong>.` : ''}</p>
      ${areaList(tr)}
      <p class="small">${linkHtml({ url: CKA_URL }, 'AASECT Core Knowledge Areas', '', 'cka-link')} · ${official ? linkHtml({ url: official.url }, official.title, '', 'official-link') : ''}</p>`, 'full-reqs')}
  </section>`;
}

function degreeHint(p) {
  return p.path === 'sex_therapist'
    ? 'Think about graduate coursework. AASECT requires an advanced clinical degree for this credential.'
    : 'Include relevant undergraduate and graduate coursework. AASECT requires at least a bachelor’s degree for this credential.';
}

const ynu = (name, value) => `<div class="seg">${[['yes', 'Yes'], ['no', 'No'], ['unsure', 'I’m not sure']].map(([k, l]) => `<label><input type="radio" name="${name}" value="${k}" ${value === k ? 'checked' : ''}> ${l}</label>`).join('')}</div>`;
const numField = (id, attr, label, value, hint = '', step = '1') => `<div class="field"><label for="${id}">${label}</label>
  <input type="number" id="${id}" ${attr} min="0" step="${step}" inputmode="decimal" value="${value ?? ''}" placeholder="—">${hint ? `<span class="small muted">${hint}</span>` : ''}</div>`;

function priorQuestion(p) {
  const b = p.benchmarks;
  const c = state.college, e = state.ce;
  const creditsOut = c.unit === 'credits' && c.amount > 0 ? `<span class="small" data-testid="credits-out">= about ${Math.round(c.amount * 15)} clock hours</span>` : '';
  return `
  <fieldset class="src-q" data-testid="college-q">
    <legend class="q-legend">Did you take any relevant courses at an accredited college or university?</legend>
    <p class="small muted">${degreeHint(p)} ${linkHtml({ url: ACADEMIC_URL }, 'AASECT academic qualifications', '', 'academic-link')}</p>
    ${ynu('college', c.answer)}
    ${c.answer === 'yes' ? `<div class="follow" data-testid="college-follow">
      <fieldset><legend class="small-legend">What do you remember?</legend>
        <div class="seg">${[['credits', 'Semester credits'], ['hours', 'Class hours']].map(([k, l]) => `<label><input type="radio" name="collegeUnit" value="${k}" ${c.unit === k ? 'checked' : ''}> ${l}</label>`).join('')}</div>
      </fieldset>
      ${numField('college-amount', 'data-src="college.amount"', c.unit === 'credits' ? 'About how many semester credits?' : 'About how many class hours?', c.amount, '', c.unit === 'credits' ? '0.5' : '1')}
      ${creditsOut}
      <p class="small muted">A qualifying class hour can count as one hour toward Core Knowledge. AASECT’s example: three semester credits = 45 clock hours. If only part of a course covered relevant material, enter your estimate of that portion.</p>
    </div>` : ''}
  </fieldset>
  <fieldset class="src-q" data-testid="ce-q">
    <legend class="q-legend">Have you earned continuing education credits from sexuality-related training?</legend>
    ${ynu('ce', e.answer)}
    ${e.answer === 'yes' ? `<div class="follow" data-testid="ce-follow">
      <p class="small muted">Enter a rough number for any that apply. If you’ve earned both types, enter both.</p>
      <div class="grid3">
        ${numField('ce-aasect', 'data-src="ce.aasect"', 'AASECT-approved credits', e.aasect, 'Count hour for hour')}
        ${numField('ce-other', 'data-src="ce.other"', 'From another professional CE body', e.other, 'Count at half value')}
        ${numField('ce-unsure', 'data-src="ce.unsure"', 'Not sure who approved them', e.unsure, 'Left for review')}
      </div>
    </div>` : ''}
  </fieldset>
  ${det('by-category', 'I know my hours by category', `
    <p class="small muted">If you can separate Core Knowledge from ${esc(b.trainingLabel)}, or know your live hours, add them here for a more detailed estimate. Leave anything you’re not sure about blank.</p>
    ${hoursQuestion('core', 'Core Knowledge Areas (CKAs)', `Up to ${b.core} hours.`, b.core, 'core knowledge')}
    ${hoursQuestion('skills', b.trainingLabel, `Up to ${b.skills} hours.`, b.skills, 'skills training')}
    <div class="grid2">
      ${numField('live-core', 'data-live="liveCore"', `Live Core Knowledge hours (of ${b.coreLiveMin} required)`, state.liveCore, 'In person or online')}
      ${numField('live-skills', 'data-live="liveSkills"', `Live skills training hours (of ${b.skillsLiveMin} required)`, state.liveSkills, 'In person or online')}
    </div>`, 'by-category', 'expand categories')}`;
}

// Payoff: potential time and coursework savings, side by side, from the same hour count.
function savingsBlock(pr) {
  const sv = pr.potentialSavings;
  if (!sv) return '';
  const cap = (t) => t.charAt(0).toUpperCase() + t.slice(1);
  const daysText = pr.days > 0 ? `About ${word(pr.days)} full day${pr.days === 1 ? '' : 's'} of training you may not need to repeat` : 'Training you may not need to repeat';
  return `<div class="savings-block" data-testid="savings-block">
    <p class="savings-lead" data-testid="savings-lead">Your prior training could save you up to ${plural(sv.hours, 'hour')}${sv.display ? ` and ${esc(sv.display)}` : ''} in additional coursework.</p>
    <div class="savings-tiles">
      <div class="tile" data-testid="tile-hours"><strong data-testid="save-hours">${plural(sv.hours, 'hour')}</strong><span>${cap(daysText)}</span></div>
      ${sv.display ? `<div class="tile" data-testid="tile-dollars"><strong data-testid="save-dollars">${esc(sv.display)}</strong><span>Up to this much in coursework you may not need to buy, at ${esc(sv.rate)} per CEU${sv.draft ? ' <span class="chip warn">Draft rate · preview only</span>' : ''}</span></div>` : ''}
    </div>
    ${sv.display ? `<p class="small" data-testid="savings-sentence">These hours haven’t been reviewed yet. If they count toward your credential and cover coursework you’d otherwise need to take, you could save up to <strong>${esc(sv.display)}</strong> in additional course costs. Admissions will help you confirm which hours count.</p>` : ''}
  </div>`;
}

// ------------------------------------------------------------------ the result, right below the questions
function quickResult() {
  if (!result) return '';
  const pr = result.prior;
  const src = pr.sources;
  const core = result.tracks.core;
  const cw = result.tracks.alaCarte.coursework;
  const b = result.benchmarks;
  const trainingLower = b.trainingLabel.toLowerCase();
  const note = `<aside class="planning-note" data-testid="planning-note"><strong>This is a planning estimate.</strong> ${esc(PLANNING_NOTE)}</aside>`;
  const review = `<div class="cta">${linkHtml(core.cta.link, core.cta.label, 'btn primary big', 'primary-cta')}</div>`;
  const wrap = (body) => `<div class="quick-result" data-testid="quick-result">
    <p class="result-h" data-testid="result-h">Here’s what may count toward your education requirements</p>
    ${body}${note}${review}</div>`;
  const hasCat = pr.basis === 'categories' && pr.state === 'known';

  if (pr.state === 'unresolved' || (src && src.state === 'incomplete' && !hasCat)) {
    if (pr.unsure || src?.state === 'unsure') {
      return wrap(`<p data-testid="result-body">Not sure? That’s common. We can go through your transcripts and CE certificates with you and show what may count.</p>${src?.ce?.pending ? `<p class="small" data-testid="pending">${plural(src.ce.pending, 'CE credit')} with an unknown approval body will be reviewed with you.</p>` : ''}`);
    }
    if (src && src.state === 'incomplete') return `<div class="quick-result" data-testid="quick-result"><p class="small muted" data-testid="result-body">Add a rough number above to see what may count.</p></div>`;
    if (pr.knownCore !== null || pr.knownSkills !== null) return `<div class="quick-result" data-testid="quick-result"><p class="small muted">Add both category hours for a detailed estimate.</p></div>`;
    return '';
  }

  const covered = pr.covered;
  if (covered === 0 && !hasCat) {
    return wrap(`<p data-testid="result-body">You haven’t reported prior coursework yet, and that’s fine. Core Program includes 99 CEUs, supervision, and SAR, and we’ll help you plan the rest.</p>`);
  }
  const lines = [];
  if (src?.college?.hours) lines.push(`<li data-testid="college-line">College coursework: about ${plural(src.college.hours, 'hour')}${src.college.unit === 'credits' ? ` (${src.college.amount} semester credits)` : ''}</li>`);
  if (src?.ce?.hours) {
    const bits = [];
    if (src.ce.aasectCredits) bits.push(`${src.ce.aasectCredits} AASECT-approved`);
    if (src.ce.otherCredits) bits.push(`${src.ce.otherCredits} from another CE body, counted at half value`);
    lines.push(`<li data-testid="ce-line">Continuing education: about ${plural(src.ce.hours, 'hour')}${bits.length ? ` (${bits.join('; ')})` : ''}</li>`);
  }
  if (src?.ce?.pending) lines.push(`<li data-testid="pending">${plural(src.ce.pending, 'CE credit')} pending review (approval body not known)</li>`);
  if (pr.knownCore !== null && pr.knownCore !== undefined && !hasCat) lines.push(`<li>Core Knowledge: ${pr.knownCore} of ${b.core} hours entered</li>`);
  if (pr.knownSkills !== null && pr.knownSkills !== undefined && !hasCat) lines.push(`<li>${esc(b.trainingLabel)}: ${pr.knownSkills} of ${b.skills} hours entered</li>`);
  if (hasCat) {
    lines.push(`<li data-testid="cat-line">Core Knowledge: ${state.core} of ${b.core} hours · ${esc(b.trainingLabel)}: ${state.skills} of ${b.skills} hours</li>`);
    if (pr.unassigned > 0) lines.push(`<li data-testid="unassigned">About ${plural(pr.unassigned, 'more hour')} not yet assigned to a category</li>`);
  }
  for (const [k, label] of [['core', 'Core Knowledge'], ['skills', b.trainingLabel]]) {
    const l = pr.live?.[k];
    if (l) lines.push(`<li data-testid="live-${k}">Live ${esc(label)}: ${l.hours} of ${l.min} required live hours</li>`);
  }
  let estimate = '';
  if (hasCat) {
    const est = [];
    if (pr.remaining === 0) est.push('<li data-testid="core-line"><strong>Core Program:</strong> your prior training may cover the rest of the education requirement beyond its 99 CEUs.</li>');
    else est.push(`<li data-testid="core-line"><strong>Core Program:</strong> about ${plural(pr.remaining, 'more CEU')} beyond the 99 included${pr.mappingKnown ? ` (${pr.remainingCore} core knowledge, ${pr.remainingSkills} ${esc(trainingLower)})` : ''}${pr.additional ? `, about ${esc(pr.additional.display)} through NWIOI` : ''}.${pr.rough ? ' <span class="chip warn" data-testid="rough-chip">Rough planning estimate</span>' : ''}</li>`);
    if (cw.state === 'known') est.push(`<li data-testid="ala-line"><strong>À La Carte:</strong> about ${plural(cw.remaining, 'CEU')} remaining (${cw.remainingCore} core knowledge, ${cw.remainingSkills} ${esc(trainingLower)})${cw.cost ? `, about ${esc(cw.cost.display)} for coursework through NWIOI` : ''}.</li>`);
    estimate = `<ul class="small result-lines" data-testid="result-lines">${est.join('')}</ul>`;
  } else {
    estimate = `<p class="small" data-testid="unassigned-note">These hours aren’t assigned to Core Knowledge or ${esc(b.trainingLabel)} yet, so we can’t say which requirements they cover. <button type="button" class="link" data-open-categories>I know my hours by category</button></p>`;
  }
  const plan = hasCat && pr.remaining > 0 ? det('plan-remaining', 'Plan your remaining coursework', `
      <div class="grid2 additional">
        <div class="field"><label for="add-nwioi">CEUs you’d take with NWIOI</label>
          <input type="number" id="add-nwioi" data-add="nwioiCeus" min="0" max="${pr.remaining}" step="1" inputmode="numeric" value="${pr.nwioiAdditionalCeus}">
          <span class="small muted">${esc(pr.libraryNote || '')}</span></div>
        ${pr.outsideCeus > 0 ? `<div class="field"><label for="add-outside">Expected cost of your other ${plural(pr.outsideCeus, 'CEU')} (optional)</label>
          <input type="number" id="add-outside" data-add="outsideCost" min="0" step="1" inputmode="decimal" value="${pr.outsideCost ?? ''}" placeholder="$">
          <span class="small muted">Other providers set their own prices.</span></div>` : ''}
      </div>
      <table class="math combined-table" data-testid="combined-table"><tbody>
        <tr><td>NWIOI tuition · Core Program</td><td class="amt">${esc(core.price.display || '—')}</td></tr>
        ${pr.nwioiAdditionalCeus > 0 ? `<tr><td>Additional NWIOI coursework · ${plural(pr.nwioiAdditionalCeus, 'CEU')}</td><td class="amt" data-testid="additional-cost">${esc(pr.additional?.display || 'Confirm with admissions')}</td></tr>` : ''}
        ${pr.outsideCeus > 0 ? `<tr><td>Coursework with other institutes · ${plural(pr.outsideCeus, 'CEU')}</td><td class="amt">${pr.outsideCost !== null ? esc('$' + Math.round(pr.outsideCost).toLocaleString('en-US')) : '<span class="muted">Not included</span>'}</td></tr>` : ''}
        ${pr.combined ? `<tr class="total"><td>Estimated combined cost${pr.combined.complete ? '' : ' <span class="small muted">(without other institutes)</span>'}</td><td class="amt" data-testid="combined-cost">${esc(pr.combined.display)}</td></tr>` : ''}
      </tbody></table>
      ${pr.combined ? `<p class="planning small" data-testid="planning">${esc(PLANNING_COPY)}</p>` : ''}`, 'plan-remaining') : '';
  return `<div class="quick-result" data-testid="quick-result">
    <p class="result-h" data-testid="result-h">Here’s what may count toward your education requirements</p>
    ${savingsBlock(pr)}
    <p class="result-big" data-testid="result-body">About <strong>${plural(covered, 'hour')}</strong> may count toward the ${b.education} coursework hours:</p>
    <ul class="small result-lines" data-testid="source-lines">${lines.join('')}</ul>
    ${estimate}
    ${note}
    ${review}
    ${plan}
  </div>`;
}

// ------------------------------------------------------------------ the two options, as short rows
function optionsSection() {
  if (!state.path) return '';
  if (deciding()) {
    return `<section class="card" data-testid="deciding">
      <h2>Not sure which credential fits?</h2>
      <p>Sex therapist, sexuality counselor and sexuality educator credentials have different training and supervision requirements. In a free admissions call, we’ll talk about your background and goals, explain how each credential works, and help you choose a direction.</p>
      <div class="cta">${linkHtml(config.links.scheduling, 'Talk through my options', 'btn primary big', 'primary-cta')}</div>
    </section>`;
  }
  if (!result) return '<p class="muted" aria-live="polite">Loading tuition…</p>';
  const core = result.tracks.core, ala = result.tracks.alaCarte, cw = ala.coursework;
  const p = core.price;
  const rec = (k) => (result.recommended === k ? ' <span class="chip ok" data-testid="rec-chip">Recommended for you</span>' : '');
  const corePrice = known(p)
    ? `<span class="opt-label">Package tuition</span><strong class="row-amt" data-testid="rec-price">${esc(p.display)}</strong>
       ${p.payInFull ? `<span class="small" data-testid="rec-pif">Pay in full: ${esc(p.payInFull.display)} (save ${p.payInFull.percent}%)</span>` : ''}
       ${core.paymentPlans?.length ? `<span class="small">${core.paymentPlans.map((x) => `or ${esc(x.text)}`).join(' · ')}</span>` : ''}${draftChip(p.draft)}`
    : `<span class="opt-label">Package tuition</span><strong class="row-amt confirm" data-testid="rec-price">${esc(p.confirmText)}</strong>`;
  const alaPrice = cw.state === 'known'
    ? `<span class="opt-label">Estimated coursework cost</span><strong class="row-amt" data-testid="ala-coursework-cost">${cw.cost ? esc(cw.cost.display) : 'Ask admissions'}</strong>
       <span class="small" data-testid="ala-remaining">${plural(cw.remaining, 'CEU')} remaining · planning estimate</span>${draftChip(cw.cost?.draft)}`
    : '<span class="opt-label">Price</span><strong class="row-amt row-amt-text">Based on what you choose</strong>';
  return `<section class="card rows" data-testid="options" aria-labelledby="rows-h">
    <h2 id="rows-h" class="rows-h">Two ways to train with NWIOI</h2>
    <p class="small muted">Prior coursework may reduce the additional training you need to take or buy.</p>
    <div class="opt-row" data-track="core">
      <div class="row-main">
        <h3 id="opt-core-h" class="opt-h"><span class="opt-name">Core Program</span> <span class="tier">Tier I</span>${rec('core')}</h3>
        <p class="small" data-testid="core-key">99 CEUs, supervision, and SAR included</p>
        ${core.lead ? `<p class="small muted">${esc(core.lead)}</p>` : ''}
      </div>
      <div class="row-price">${corePrice}</div>
    </div>
    <div class="opt-row" data-track="alaCarte">
      <div class="row-main">
        <h3 id="opt-ala-h" class="opt-h"><span class="opt-name">À La Carte</span> <span class="tier">Tier II</span>${rec('alaCarte')}</h3>
        <p class="small">Choose individual courses or supervision.</p>
      </div>
      <div class="row-price">${alaPrice}</div>
    </div>
    ${scholarshipBlock()}
    <div class="row-links small">
      ${compareDetails()}
      <button type="button" class="link" data-mode="ala" data-testid="ala-action" aria-pressed="${state.mode === 'ala'}">Build an À La Carte estimate</button>
      ${linkHtml(core.secondary.link, core.secondary.label, 'small', 'library-link')}
    </div>
    <p class="small muted" data-testid="library-note">${esc(result.prior.libraryNote || '')}</p>
  </section>`;
}

function compareDetails() {
  const core = result.tracks.core, s = result.savings;
  const supervision = core.included.find((x) => x.startsWith('Supervision')) || 'Included';
  const rows = [
    ['Education', '99 CEUs of NWIOI coursework', 'The courses you choose'],
    ['Supervision', esc(supervision.replace(/^Supervision: /, '')), 'NWIOI hours and group sessions as you need them, or an outside supervisor (paid separately)'],
    ['SAR', 'Included', 'Add if you need one'],
    ['Price', `Package tuition${known(core.price) ? `: ${esc(core.price.display)}` : ''}`, 'Based on what you choose'],
    ['Pay in full', core.price.payInFull ? `Save ${core.price.payInFull.percent}%: ${esc(core.price.payInFull.display)}` : 'Ask admissions', 'Not available'],
    ['Good fit if', 'You want a complete, guided path with supervision', 'You’ve completed much of your training or have your own supervisor'],
  ];
  return det('compare', '<span id="compare-h">Compare full details</span>', `
    <div class="table-wrap"><table class="compare-table" data-testid="compare-table">
      <thead><tr><th scope="col"><span class="sr-only">Detail</span></th><th scope="col">Core Program <span class="tier">Tier I</span></th><th scope="col">À La Carte <span class="tier">Tier II</span></th></tr></thead>
      <tbody>${rows.map(([h, a, b]) => `<tr><th scope="row">${h}</th><td>${a}</td><td>${b}</td></tr>`).join('')}</tbody>
    </table></div>
    ${s ? `<p class="small savings" data-testid="savings">Core costs ${esc(s.display)} less than buying the same items separately (${esc(s.separately)}).</p>
      ${det('savings-items', 'Same items compared', itemList(s.items, 'savings-items'), 'savings-included')}` : ''}
    <p class="small muted">Core Program also includes: ${core.included.filter((x) => !/^(99 CEUs|Supervision|SAR)/.test(x)).map(esc).join(' · ')}.</p>
    ${core.extraLinks?.length ? `<p class="small">${core.extraLinks.map((x) => linkHtml(x.link, x.label, 'small')).join(' · ')}</p>` : ''}
    ${core.enroll ? `<p class="small">${linkHtml(core.enroll, 'Ready to enroll? Start your Core enrollment', 'small', 'enroll')}</p>` : ''}`, '', 'compare');
}

// ------------------------------------------------------------------ À La Carte builder (behind a link)
function alaFlow(p) {
  const b = p.benchmarks;
  return `
  <section class="card flow" id="ala-flow" aria-labelledby="ala-h">
    <h2 id="ala-h">Build your À La Carte estimate</h2>
    <p class="small">Choose individual courses, and add supervision or SAR if you need them. Your estimate updates as you go.</p>
    <div id="ala-courses">${result ? alaCourses() : ''}</div>
    <h3 class="small-h optional-h">Optional additions: supervision and SAR</h3>
    ${radioGroup('where', 'Where would you like to do your supervision?', [['nwioi', 'With NWIOI'], ['outside', 'With an outside supervisor'], ['help', 'Help me decide']], state.where)}
    ${state.where === 'outside' ? '<p class="small muted">You’ll pay your outside supervisor separately.</p>' : hoursQuestion('supervision', 'Supervision completed toward this credential', `Up to ${b.supervision} hours with an ${esc(p.terms.supervisorTitle)}.`, b.supervision, 'standard target')}
    ${radioGroup('sar', 'Have you completed a Sexuality Attitude Reassessment (SAR)?', [['yes', 'Yes'], ['no', 'No'], ['unsure', 'I’m not sure']], state.sar)}
    <div id="ala-result" class="result-box" aria-live="polite">${result ? alaResult() : ''}</div>
    <p class="small"><button type="button" class="link" data-mode="">Close the builder</button></p>
  </section>`;
}

function alaCourses() {
  const t = result.tracks.alaCarte;
  const s = t.selection, sug = t.suggestion, u = t.units, cw = t.coursework;
  const eduHint = (v) => (v !== null ? `Estimated remaining from your prior coursework: ${v}` : 'How many would you buy?');
  const num = (id, key, label, max, hint) => `<div class="field"><label for="${id}">${esc(label)}</label>
      <input type="number" id="${id}" data-ala="${key}" min="0" ${max ? `max="${max}"` : ''} step="1" inputmode="numeric" value="${s[key] ?? ''}" placeholder="Choose">
      <span class="small muted">${hint}</span></div>`;
  return `<h3 class="small-h">Coursework</h3>
    ${cw.state === 'known' ? `<p class="small" data-testid="ala-courses-estimate">You may still need about <strong>${plural(cw.remaining, 'CEU')}</strong>${cw.cost ? ` (${esc(cw.cost.display)} estimated through NWIOI)` : ''}. Planning estimate.</p>`
      : '<p class="small muted">Add your hours by category above to see what you may still need.</p>'}
    <div class="grid2">
      ${num('ala-core', 'coreCeus', 'Core Knowledge CEUs', result.benchmarks.core, eduHint(sug.coreCeus))}
      ${num('ala-skills', 'skillsCeus', `${u.trainingLabel} CEUs`, result.benchmarks.skills, eduHint(sug.skillsCeus))}
    </div>`;
}

function alaResult() {
  const t = result.tracks.alaCarte;
  const s = t.selection, u = t.units;
  const num = (id, key, label, hint) => `<div class="field"><label for="${id}">${esc(label)}</label>
      <input type="number" id="${id}" data-ala="${key}" min="0" step="1" inputmode="numeric" value="${s[key] ?? ''}" placeholder="Choose">
      <span class="small muted">${hint}</span></div>`;
  const p = t.price;
  return `
    ${t.outsideSupervision ? '' : `<div class="grid2">
      ${num('ala-ind', 'individualHours', 'Hours of individual supervision (optional)', 'One-to-one with an NWIOI supervisor')}
      ${num('ala-grp', 'groupSessions', 'Group supervision sessions (optional)', `${u.groupSessionHours} hours each`)}
    </div>`}
    ${t.sarOffer ? `<label class="small sar-offer" style="font-weight:400"><input type="checkbox" data-ala="sar" ${s.sar ? 'checked' : ''}> ${esc(t.sarOffer)} (optional)</label>` : ''}
    <div class="ala-total">
      <span class="small" data-testid="ala-total-label">${t.fewerThanNeeded ? 'Your selected items' : 'Estimated cost with NWIOI'}</span>
      <strong data-testid="price-alaCarte">${esc(known(p) ? p.display : p.confirmText)}${known(p) && p.complete === false ? ' <span class="small muted">so far</span>' : ''}</strong>
      ${p.draft ? '<span class="chip warn">Draft pricing · preview only</span>' : ''}
    </div>
    ${t.fewerThanNeeded ? `<p class="small" data-testid="fewer-note">You’ve selected fewer CEUs than the about ${t.coursework.remaining} you may still need.</p>` : ''}
    ${t.basedOn ? `<p class="small muted" data-testid="based-on">${esc(t.basedOn)}</p>` : ''}
    ${t.items.length ? det('ala-included', 'See what’s included', itemList(t.items, 'ala-items'), 'ala-included') : ''}
    ${t.notes?.length ? `<ul class="small notes" data-testid="ala-notes">${t.notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>` : ''}
    <p class="planning small">${esc(PLANNING_COPY)}</p>`;
}

function flowSection() {
  if (!state.path || deciding() || state.mode !== 'ala') return '';
  return alaFlow(pathCfg());
}

// ------------------------------------------------------------------ live estimate bar
// Hidden near the top; slides in once the option rows (which show the price) scroll away,
// and hides again only when they're back in view (no flicker on small scrolls).
let lastBarValue = null;
let rowsVisible = true;
function renderBar() {
  const active = state.path && !deciding() && result;
  $bar.classList.toggle('is-shown', Boolean(active) && !rowsVisible);
  $bar.setAttribute('aria-hidden', String(!(active && !rowsVisible)));
  if (!active) { $bar.innerHTML = ''; lastBarValue = null; return; }
  const ala = result.tracks.alaCarte, core = result.tracks.core;
  const useAla = state.mode === 'ala';
  const t = useAla ? ala : core;
  const label = useAla ? (ala.fewerThanNeeded ? 'Your selected items' : 'Estimated cost with NWIOI') : 'Package tuition';
  const value = known(t.price) ? t.price.display + (t.price.complete === false ? '+' : '') : t.price.confirmText;
  const parts = [];
  if (!useAla && core.price.payInFull) parts.push(`Pay in full: ${core.price.payInFull.display}`);
  if (!useAla && result.prior.covered > 0) parts.push(`${result.prior.covered} prior hours may count`);
  if (useAla && !known(ala.price)) parts.push('Your estimate updates as you choose');
  const sub = parts.join(' · ') || 'Planning estimate';
  const name = useAla ? 'À La Carte' : 'Core Program';
  const changed = lastBarValue !== null && lastBarValue !== name + value + sub;
  lastBarValue = name + value + sub;
  $bar.innerHTML = `<div class="wrap estimate-inner">
      <div class="estimate-text" aria-live="polite" aria-atomic="true">
        <span class="estimate-label">${esc(label)} · <strong>${esc(name)}</strong>${t.price.draft ? ' <span class="chip draft-chip">Draft</span>' : ''}</span>
        <span class="estimate-value ${known(t.price) ? '' : 'confirm-value'}" data-testid="bar-price">${esc(value)}</span>
        <span class="estimate-sub" data-testid="bar-sub">${esc(sub)}</span>
      </div>
      <span class="bar-cta">${linkHtml(config.links.scheduling, 'Book a free admissions call', 'btn bar-btn', 'bar-book')}</span>
    </div>`;
  if (changed) {
    const el = $bar.querySelector('.estimate-value');
    el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash');
  }
}

let ticking = false;
function updateBarVisibility() {
  ticking = false;
  const rows = $main.querySelector('.rows');
  let next = rowsVisible;
  if (!rows) next = true;
  else {
    const r = rows.getBoundingClientRect();
    const barH = $bar.offsetHeight || 90;
    if (rowsVisible && r.bottom < barH + 20) next = false;
    else if (!rowsVisible && r.top > barH) next = true;
  }
  if (next !== rowsVisible) { rowsVisible = next; renderBar(); }
}
function watchRows() {
  const rows = $main.querySelector('.rows');
  if (!rows) rowsVisible = true;
  else { const r = rows.getBoundingClientRect(); if (r.bottom < ($bar.offsetHeight || 90) + 20) rowsVisible = false; else if (r.top > ($bar.offsetHeight || 90)) rowsVisible = true; }
  renderBar();
}
const onScroll = () => { if (!ticking) { ticking = true; requestAnimationFrame(updateBarVisibility); } };
window.addEventListener('scroll', onScroll, { passive: true });
window.addEventListener('resize', onScroll);

// ------------------------------------------------------------------ rendering
function withFocus(fn) {
  const id = document.activeElement?.id;
  fn();
  if (id) { const el = document.getElementById(id); if (el && el !== document.activeElement) el.focus(); }
}
const lastLive = {};
function flashChanged(selector) {
  const el = $main.querySelector(selector);
  if (!el) return;
  if (lastLive[selector] !== undefined && lastLive[selector] !== el.textContent) el.classList.add('flash');
  lastLive[selector] = el.textContent;
}

function renderResult() {
  withFocus(() => {
    const q = $main.querySelector('#quick-result-wrap');
    if (q) q.innerHTML = quickResult();
    const opts = $main.querySelector('#options');
    if (opts) opts.innerHTML = optionsSection();
    const ac = $main.querySelector('#ala-courses');
    if (ac && result) ac.innerHTML = alaCourses();
    const ar = $main.querySelector('#ala-result');
    if (ar && result) ar.innerHTML = alaResult();
    for (const sel of ['[data-testid="save-hours"]', '[data-testid="save-dollars"]', '[data-testid="result-body"] strong', '[data-testid="combined-cost"]', '[data-testid="price-alaCarte"]', '[data-testid="ala-coursework-cost"]']) flashChanged(sel);
  });
  watchRows();
}

function render() {
  const p = state.path && !deciding() ? pathCfg() : null;
  $main.innerHTML = `
  <section class="intro hero">
    <h1>Build on the training you’ve already done.</h1>
    <p class="lede">Graduate coursework and continuing education you’ve already completed may count toward your AASECT credential. See what may already be covered and what you might still need.</p>
    ${config.preview ? '<p class="notice warn small">Preview mode: draft prices and placeholder links are visible and labeled. The public sees only approved offers.</p>' : ''}
  </section>
  <section class="card start">
    <div class="picker">${radioGroup('path', 'Which credential are you working toward?', [...config.paths.filter((x) => x.enabled).map((x) => [x.path, x.pathName]), ['deciding', 'I’m still deciding']], state.path)}</div>
  </section>
  ${p ? `<section class="card learned" aria-labelledby="learned-h">
    <h2 id="learned-h" class="sr-only">What you’ve already learned</h2>
    ${requirementsGuide(p)}
    <div class="prior-q" id="prior-q">${priorQuestion(p)}</div>
    <div id="quick-result-wrap" aria-live="polite">${quickResult()}</div>
  </section>` : ''}
  <div id="options">${optionsSection()}</div>
  <div id="flow">${flowSection()}</div>
  <p class="small muted footnote">NWIOI provides training. AASECT makes certification decisions.</p>`;
  $main.setAttribute('aria-busy', 'false');
  watchRows();
}

function syncQuestion(key) {
  const fs = $main.querySelector(`[data-q="${key}"]`);
  if (!fs) return;
  const v = state[key];
  const answered = v !== null && v !== undefined, unsure = v === 'unsure';
  const n = typeof v === 'number' ? v : 0;
  fs.classList.toggle('unanswered', !answered);
  fs.classList.toggle('is-unsure', unsure);
  const range = fs.querySelector('[data-range]'), num = fs.querySelector('[data-num]');
  if (document.activeElement !== range) range.value = unsure ? 0 : n;
  if (document.activeElement !== num) num.value = answered && !unsure ? n : '';
  range.setAttribute('aria-valuetext', statusText(v));
  fs.querySelector('.q-status strong').textContent = statusText(v);
  fs.querySelector('[data-zero]').setAttribute('aria-pressed', String(answered && !unsure && n === 0));
  fs.querySelector('[data-unsure]').setAttribute('aria-pressed', String(unsure));
}

// ------------------------------------------------------------------ estimate
let timer = null, controller = null, seq = 0;
function requestEstimate(immediate = false) {
  save();
  clearTimeout(timer);
  if (!state.path || deciding()) { result = null; renderResult(); return; }
  timer = setTimeout(async () => {
    controller?.abort();
    controller = new AbortController();
    const mine = ++seq;
    try {
      const res = await fetch('/api/track-estimate', {
        method: 'POST', headers: { 'content-type': 'application/json' }, signal: controller.signal,
        body: JSON.stringify({ path: state.path, college: state.college, ce: state.ce, core: state.core, skills: state.skills, liveCore: state.liveCore, liveSkills: state.liveSkills, supervision: state.supervision, sar: state.sar, supervisionWhere: state.where, additional: state.additional, alaCarte: state.alaCarte }),
      });
      const body = await res.json();
      if (mine !== seq) return;
      if (!res.ok) throw new Error(body.error || 'Unavailable');
      result = body;
      renderResult();
    } catch (err) {
      if (err.name === 'AbortError') return;
      const opts = $main.querySelector('#options');
      if (opts) opts.innerHTML = `<div class="card"><p>We couldn’t load tuition right now.</p><div class="cta">${linkHtml(config.links.scheduling, 'Book a free admissions call', 'btn primary big', 'primary-cta')}</div></div>`;
    }
  }, immediate ? 0 : 120);
}

function setHours(key, value) {
  const max = maxFor(key);
  if (value === 'unsure' || value === null) state[key] = value;
  else state[key] = Math.max(0, Math.min(max, Math.round(Number(value))));
  if (key === 'core' || key === 'skills') {
    state.additional = freshAdditional();
    state.alaCarte[key === 'core' ? 'coreCeus' : 'skillsCeus'] = null;
  }
  if (key === 'supervision') { state.alaCarte.individualHours = null; state.alaCarte.groupSessions = null; }
  syncQuestion(key);
  requestEstimate();
}

function openMode(mode) {
  state.mode = mode || null;
  save();
  const flow = $main.querySelector('#flow');
  flow.innerHTML = flowSection();
  renderResult();
  requestEstimate(true);
  const sec = flow.querySelector('.flow');
  if (sec) {
    // Land the heading just below where the estimate bar sits; focus the heading, not an
    // input (focusing an input on phones scrolls it under the bar).
    const smooth = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const top = sec.getBoundingClientRect().top + window.scrollY - (($bar.offsetHeight || 96) + 12);
    const h = sec.querySelector('h2');
    if (h) { h.setAttribute('tabindex', '-1'); h.focus({ preventScroll: true }); }
    window.scrollTo({ top: Math.max(0, top), behavior: smooth ? 'smooth' : 'auto' });
  } else {
    $main.querySelector('[data-testid="ala-action"]')?.focus();
  }
}

// ------------------------------------------------------------------ events
$main.addEventListener('input', (ev) => {
  const t = ev.target;
  if (t.dataset.range) setHours(t.dataset.range, t.value);
  else if (t.dataset.num) { if (t.value !== '') setHours(t.dataset.num, t.value); }
  else if (t.id === 'credits-in') {
    const c = Number(t.value);
    $main.querySelector('#credits-out').textContent = c > 0 ? `= ${c * pathCfg().benchmarks.semesterCreditClockHours} hours` : '';
  } else if (t.dataset.src) {
    const [grp, key] = t.dataset.src.split('.');
    state[grp][key] = t.value === '' ? null : Math.max(0, Number(t.value));
    const out = $main.querySelector('[data-testid="credits-out"]');
    if (grp === 'college' && state.college.unit === 'credits') {
      const html = state.college.amount > 0 ? `= about ${Math.round(state.college.amount * 15)} clock hours` : '';
      if (out) out.textContent = html;
      else if (html) t.closest('.field').insertAdjacentHTML('afterend', `<span class="small" data-testid="credits-out">${html}</span>`);
    }
    requestEstimate();
  } else if (t.dataset.live) {
    state[t.dataset.live] = t.value === '' ? null : Math.max(0, Math.round(Number(t.value)));
    requestEstimate();
  } else if (t.dataset.ala && t.type === 'number') {
    state.alaCarte[t.dataset.ala] = t.value === '' ? null : Math.max(0, Math.round(Number(t.value)));
    requestEstimate();
  } else if (t.dataset.add) {
    const v = t.value === '' ? null : Math.max(0, Number(t.value));
    state.additional[t.dataset.add] = t.dataset.add === 'nwioiCeus' && v !== null ? Math.round(v) : v;
    requestEstimate();
  }
});

$main.addEventListener('change', (ev) => {
  const t = ev.target;
  if (t.name === 'path') {
    const prev = state.path;
    state.path = t.value;
    if (prev !== t.value) { state.alaCarte = freshAla(); state.additional = freshAdditional(); }
    if (!deciding()) for (const k of ['core', 'skills', 'supervision']) if (typeof state[k] === 'number') state[k] = Math.min(state[k], maxFor(k));
    if (hasCategories()) openState['by-category'] = true;
    result = null;
    render();
    $main.querySelector(`input[name="path"][value="${t.value}"]`)?.focus();
    requestEstimate(true);
  } else if (t.name === 'college' || t.name === 'ce' || t.name === 'collegeUnit') {
    if (t.name === 'collegeUnit') { state.college.unit = t.value; state.college.amount = null; }
    else state[t.name].answer = t.value;
    const q = $main.querySelector('#prior-q');
    const scrollY = window.scrollY;
    withFocus(() => { q.innerHTML = priorQuestion(pathCfg()); });
    window.scrollTo(0, scrollY);
    $main.querySelector(`input[name="${t.name}"][value="${t.value}"]`)?.focus();
    requestEstimate(true);
  } else if (t.name === 'sar' || t.name === 'where') {
    state[t.name] = t.value;
    if (t.name === 'sar') state.alaCarte.sar = null;
    if (t.name === 'where') { state.alaCarte.individualHours = null; state.alaCarte.groupSessions = null; }
    const scrollY = window.scrollY;
    $main.querySelector('#flow').innerHTML = flowSection();
    window.scrollTo(0, scrollY);
    $main.querySelector(`input[name="${t.name}"][value="${t.value}"]`)?.focus();
    requestEstimate(true);
  } else if (t.dataset.num && t.value === '') setHours(t.dataset.num, null);
  else if (t.dataset.ala === 'sar') { state.alaCarte.sar = t.checked; requestEstimate(true); }
});

$main.addEventListener('toggle', (ev) => {
  if (ev.target.matches?.('details.expand, details.compare')) openState[ev.target.id] = ev.target.open;
}, true);

$main.addEventListener('click', (ev) => {
  const t = ev.target.closest('button');
  if (!t) return;
  if ('mode' in t.dataset) openMode(t.dataset.mode);
  else if ('openCategories' in t.dataset) {
    const d = $main.querySelector('#by-category');
    if (d) { d.open = true; openState['by-category'] = true; d.querySelector('input[type=number]')?.focus(); }
  } else if (t.dataset.zero) setHours(t.dataset.zero, 0);
  else if (t.dataset.unsure) setHours(t.dataset.unsure, state[t.dataset.unsure] === 'unsure' ? null : 'unsure');
  else if (t.dataset.addCredits) {
    const c = Number($main.querySelector('#credits-in').value);
    if (!(c > 0)) return;
    const key = t.dataset.addCredits;
    const add = c * pathCfg().benchmarks.semesterCreditClockHours;
    setHours(key, (typeof state[key] === 'number' ? state[key] : 0) + add);
    $main.querySelector('#credits-in').value = '';
    $main.querySelector('#credits-out').textContent = `Added ${add} hours to ${key === 'core' ? 'core knowledge' : 'skills training'}.`;
  }
});

(async () => {
  try {
    config = await (await fetch('/api/config')).json();
    load();
    if (state.path && state.path !== 'deciding' && !config.paths.some((x) => x.path === state.path && x.enabled)) state = fresh();
    if (hasCategories()) openState['by-category'] = true;
    render();
    if (state.path) requestEstimate(true);
  } catch {
    $main.innerHTML = '<div class="card"><p>The track finder could not load. Please try again later.</p></div>';
  }
})();
