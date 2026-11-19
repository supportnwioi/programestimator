import { findDuplicates } from '/shared/dedupe.js';

const $app = document.getElementById('app');
const $dlg = document.getElementById('editor');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Math.random().toString(36).slice(2, 10);
const fmtH = (n) => `${Math.round(n * 10) / 10} h`;

const CREDIT_TYPES = { academic: 'Accredited college/university course', aasect_ce: 'AASECT sponsored/approved CE', non_aasect_ce: 'Other CE (APA, NBCC, NASW, etc.)', other: 'Training without credit/CE', unsure: "I'm not sure" };
const UNITS = { semester_credits: 'Semester credits', quarter_credits: 'Quarter credits', clock_hours: 'Clock hours', ce_hours: 'CE hours', unsure: "I'm not sure" };
const DELIVERY = { synchronous: 'Live (in person or live virtual)', asynchronous: 'Self-paced / recorded', unsure: "I'm not sure" };
const YNU = { yes: 'Yes', no: 'No', unsure: "I'm not sure" };
const QUESTIONS = {
  hasCouplesTraining: 'Do you have documented graduate or postgraduate training in couples counseling?',
  tenYearsSexTherapy: 'Do you have 10 or more years of post-degree experience providing sex therapy (averaging 20 hours a week)?',
  hasClinicalDegree: 'Do you have an advanced clinical degree that included psychotherapy training, plus 2 years (master’s) or 1 year (doctoral) of post-degree clinical experience?',
  hasLicense: 'Do you hold a valid license or certificate to practice psychotherapy independently?',
  clinicalHoursUnderContract: 'About how many hours of clinical treatment of clients with sexual concerns have you provided while under an AASECT supervision contract?',
  aasectMember: 'Are you a current AASECT member?',
  licensedPsychotherapist: 'Do you have a master’s or doctoral degree and hold a license in a discipline that provides psychotherapy?',
  hasDegreeAndExperience: 'Do you have a bachelor’s degree plus 3 years of professional counseling experience, or a master’s/doctoral degree plus 2 years?',
  counselingHours: 'About how many hours of professional sexuality counseling experience do you have?',
  hasDegree: 'Do you have an academic degree from an accredited college or university?',
  educationHours: 'About how many hours of professional sexuality education experience do you have?',
};
const STEPS = [['path', 'Certification path'], ['intake', 'Your background'], ['review', 'Review'], ['results', 'Estimate']];

let config = null;
let files = {}; // docId -> File (kept in memory only, for optional sharing)
let state = load() ?? fresh();

function fresh() { return { step: 'path', path: null, method: null, entries: [], answers: {}, docs: [], result: null, share: null }; }
function load() { try { return JSON.parse(sessionStorage.getItem('nwioi-estimator')); } catch { return null; } }
function save() { try { sessionStorage.setItem('nwioi-estimator', JSON.stringify(state)); } catch { /* storage unavailable */ } }
const rs = () => config.paths.find((p) => p.path === state.path);
const reqOf = (key) => rs()?.requirements.find((r) => r.key === key);
const hoursReqs = () => rs().requirements.filter((r) => r.kind === 'hours');

async function api(url, opts = {}) {
  const res = await fetch(url, opts);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`);
  return body;
}

function go(step) { state.step = step; save(); render(); window.scrollTo({ top: 0 }); }

// ---------------------------------------------------------------- rendering
function stepper() {
  const i = STEPS.findIndex(([k]) => k === state.step);
  return `<ol class="stepper" aria-label="Progress">${STEPS.map(([k, l], j) => `<li class="${j === i ? 'on' : j < i ? 'done' : ''}" ${j === i ? 'aria-current="step"' : ''}>${j + 1}. ${l}</li>`).join('')}</ol>`;
}

function render() {
  if (!config) return;
  const view = { path: viewPath, intake: viewIntake, review: viewReview, results: viewResults }[state.step] ?? viewPath;
  $app.innerHTML = stepper() + view();
}

function viewPath() {
  return `
  <section class="card">
    <h1>Estimate your NWIOI program cost</h1>
    <p>NWIOI is not a one-size-fits-all package. We consider graduate and postgraduate coursework, continuing education, supervision, and SAR you have already completed, so you can avoid paying to repeat work that counts toward your certification path.</p>
    <p class="muted">Start by choosing the AASECT certification you are working toward.</p>
  </section>
  <div class="choices" role="group" aria-label="Certification path">
    ${config.paths.map((p) => `
      <button class="choice" data-action="choose-path" data-path="${p.path}" aria-pressed="${state.path === p.path}" ${p.enabled ? '' : 'disabled'}>
        <strong>${esc(p.pathName)}</strong>
        <span>${esc(p.credential)}</span>
        <span class="meta">${p.enabled ? `Based on AASECT requirements version ${esc(p.version)} · verified ${esc(p.verifiedAt)}` : 'Temporarily unavailable while NWIOI reviews updated AASECT requirements'}</span>
      </button>`).join('')}
  </div>`;
}

function sourceChip(e) {
  if (e.source?.type === 'document') return `<span class="chip doc" title="${esc(e.source.excerpt)}">From document: ${esc(e.source.fileName)}</span>${e.corrected ? ' <span class="chip corrected">Corrected by you</span>' : ''}`;
  return '<span class="chip manual">Entered manually</span>';
}

function allocText(e, a) {
  const req = reqOf(a.requirement);
  if (!req) return `<li>Not counted toward this path${a.topic ? ` — ${esc(a.topic)}` : ''}</li>`;
  const area = a.area ? `${esc(req.areaTermShort === 'CKA' ? 'CKA' : 'Area')} ${esc(a.area)}` : '<span class="chip warn">Area not assigned</span>';
  let hours;
  if (a.basis === 'needs_answer') hours = '<span class="chip warn">Hours needed</span>';
  else if (a.basis === 'unsure' || a.hours == null) hours = '<span class="chip warn">Not sure — for admissions review</span>';
  else hours = `${fmtH(a.hours)} ${a.basis === 'stated' ? '<span class="chip ok">Stated in document</span>' : a.basis === 'self_reported' ? '<span class="chip">Self-reported</span>' : ''}`;
  return `<li>${esc(req.label)} · ${area}${a.topic ? ` — ${esc(a.topic)}` : ''}: ${hours}</li>`;
}

function entrySummary(e) {
  if (e.kind === 'supervision') return `${fmtH(Number(e.individualHours) || 0)} individual, ${fmtH(Number(e.groupHours) || 0)} group · AASECT certified supervisor under contract: ${YNU[e.qualifies]}`;
  if (e.kind === 'sar') return `${e.hours ? fmtH(e.hours) : 'Hours not given'} · AASECT sponsored/approved: ${YNU[e.aasectApproved]}`;
  const total = e.totalAmount ? `${e.totalAmount} ${UNITS[e.totalUnit]?.toLowerCase() ?? ''} total` : 'Total not given';
  return `${esc(CREDIT_TYPES[e.creditType] ?? '')} · ${esc(total)} · ${esc(DELIVERY[e.delivery] ?? '')}`;
}

function entryList(entries, { compact = false, dupes = [] } = {}) {
  if (!entries.length) return '<p class="muted small">Nothing added yet.</p>';
  const dropped = new Map(dupes.map((d) => [d.dropId, d]));
  return entries.map((e) => {
    const d = dropped.get(e.id);
    const keep = d && state.entries.find((x) => x.id === d.keepId);
    return `
    <div class="entry" data-entry="${e.id}">
      <div class="between">
        <div><span class="title">${esc(e.title || e.supervisorName || 'Untitled')}</span>${e.provider ? ` <span class="muted small">· ${esc(e.provider)}</span>` : ''}</div>
        <div class="row">${sourceChip(e)}<button class="link" data-action="edit" data-id="${e.id}">Edit</button><button class="link danger" data-action="remove" data-id="${e.id}">Remove</button></div>
      </div>
      <div class="small muted">${entrySummary(e)}</div>
      ${!compact && e.kind === 'course' ? `<ul class="alloc">${(e.allocations || []).map((a) => allocText(e, a)).join('') || '<li><span class="chip warn">No topics assigned yet</span></li>'}</ul>` : ''}
      ${d ? `<div class="notice warn small">Possible duplicate of “${esc(keep?.title || keep?.supervisorName)}” — counted once, using the other entry.
        <div class="row"><button class="link" data-action="prefer" data-id="${e.id}" data-other="${d.keepId}">Use this entry instead</button><button class="link" data-action="not-dup" data-id="${e.id}" data-other="${d.keepId}">These are different — count both</button></div></div>` : ''}
    </div>`;
  }).join('');
}

function question(key, kind) {
  const v = state.answers[key];
  if (kind === 'hours') {
    const unsure = v === 'unsure';
    return `<fieldset><legend>${esc(QUESTIONS[key] ?? key)}</legend>
      <div class="row"><input type="number" min="0" step="1" style="max-width:160px" aria-label="Hours" data-answer="${key}" value="${unsure || v == null ? '' : esc(v)}" ${unsure ? 'disabled' : ''}>
      <label class="small" style="font-weight:400"><input type="checkbox" data-answer-unsure="${key}" ${unsure ? 'checked' : ''}> I'm not sure</label></div></fieldset>`;
  }
  return `<fieldset><legend>${esc(QUESTIONS[key] ?? key)}</legend><div class="seg">${Object.entries(YNU).map(([k, l]) => `<label><input type="radio" name="q-${key}" data-answer="${key}" value="${k}" ${v === k ? 'checked' : ''}> ${l}</label>`).join('')}</div></fieldset>`;
}

function viewIntake() {
  const p = rs();
  const m = state.method;
  const courses = state.entries.filter((e) => e.kind === 'course');
  const sup = state.entries.filter((e) => e.kind === 'supervision');
  const sars = state.entries.filter((e) => e.kind === 'sar');
  const training = reqOf('training');
  const supReq = reqOf('supervision');
  const extraQs = [...(training.conditional || []).map((c) => [c.question]), ...(supReq.alternative ? [[supReq.alternative.question]] : [])];
  return `
  <section class="card">
    <div class="between"><h1>Your background</h1><button class="link" data-action="go" data-step="path">Change path (${esc(p.pathName)})</button></div>
    <p>Tell us what you have already completed toward ${esc(p.credential)} certification. You can enter it yourself, upload documents for review, or both. Everything can be entered without uploading.</p>
    <div class="choices" role="group" aria-label="How would you like to share your background?">
      ${[['manual', 'Enter everything manually', 'Type in coursework, CE, supervision and SAR.'], ['upload', 'Upload documents', 'Transcripts, syllabi and CE certificates, reviewed with AI assistance.'], ['both', 'Upload and enter manually', 'Upload what you have and fill in the rest.']]
        .map(([k, t, d]) => `<button class="choice" data-action="method" data-method="${k}" aria-pressed="${m === k}"><strong>${t}</strong><span class="small muted">${d}</span></button>`).join('')}
    </div>
  </section>
  ${!m ? '' : `
  ${m !== 'manual' ? `
  <section class="card" aria-labelledby="up-h">
    <div class="between"><h2 id="up-h">Upload documents</h2><a href="/privacy" target="_blank" rel="noopener">Privacy and data retention</a></div>
    <p class="small muted">PDF, Word (.docx), text${config.documentReview === 'ai' ? ', or images' : ''}. We extract course details and any hours the document states, and suggest where they may count. You will review everything before getting an estimate.</p>
    ${config.documentReview !== 'ai' ? '<div class="notice info small">Demo mode: AI document review is not configured on this server, so a basic offline extractor is used. Results may be less complete.</div>' : ''}
    <div class="dropzone" id="dropzone">
      <p><strong>Drop files here</strong> or</p>
      <label class="btn" style="display:inline-flex;font-weight:400">Choose files<input type="file" id="file-input" multiple accept=".pdf,.docx,.txt,.md,.png,.jpg,.jpeg,.webp" class="sr-only"></label>
    </div>
    <div id="doc-list">${state.docs.map((d) => `
      <div class="entry"><div class="between"><span class="title">${esc(d.fileName)}</span><span class="chip ${d.status === 'error' ? 'warn' : d.status === 'done' ? 'ok' : ''}">${d.status === 'reviewing' ? 'Reviewing…' : d.status === 'error' ? 'Could not review' : `${d.count} item${d.count === 1 ? '' : 's'} found`}</span></div>
      <p class="small muted">${esc(d.error || d.summary || '')}</p></div>`).join('')}</div>
  </section>` : ''}

  <section class="card" aria-labelledby="cw-h">
    <h2 id="cw-h">Coursework and continuing education</h2>
    <p class="small muted">Include graduate and postgraduate courses, CE workshops, and training programs. For each, note how many hours were spent on each topic. Total course hours and hours on a specific topic are kept separate.</p>
    ${entryList(courses, { compact: true })}
    <div class="row" style="margin-top:10px">
      <button data-action="add-course">+ Add a course or training</button>
      <button data-action="add-grid">+ Enter hours by area</button>
    </div>
  </section>

  <section class="card" aria-labelledby="sv-h">
    <h2 id="sv-h">Supervision</h2>
    <p class="small muted">Only supervision with an ${esc(p.terms.supervisorTitle)} under a signed supervision contract counts.</p>
    ${entryList(sup, { compact: true })}
    <div class="row" style="margin-top:10px"><button data-action="add-supervision">+ Add supervision hours</button>
      <label class="small" style="font-weight:400"><input type="checkbox" data-answer-flag="supervisionUnsure" ${state.answers.supervisionUnsure === 'yes' ? 'checked' : ''}> I'm not sure how many supervision hours I have</label></div>
  </section>

  <section class="card" aria-labelledby="sar-h">
    <h2 id="sar-h">Sexual Attitude Reassessment (SAR)</h2>
    ${question('sarCompleted')}
    ${state.answers.sarCompleted === 'yes' ? `${entryList(sars, { compact: true })}<button data-action="add-sar">+ Add SAR details</button>` : ''}
  </section>

  <section class="card" aria-labelledby="ab-h">
    <h2 id="ab-h">A few more questions</h2>
    <p class="small muted">These help us apply the right ${esc(p.pathName)} requirements and flag anything you may need to complete outside NWIOI.</p>
    ${extraQs.map(([k]) => question(k)).join('')}
    ${p.outside.map((o) => question(o.question, o.kind)).join('')}
  </section>

  <div class="row end"><button class="primary btn big" data-action="to-review">Review my information</button></div>`}`;
}

function followUps() {
  const items = [];
  for (const e of state.entries) for (const a of e.allocations || []) if (a.basis === 'needs_answer') items.push({ e, a });
  return items;
}

function viewReview() {
  const dupes = findDuplicates(state.entries);
  const fu = followUps();
  const unassigned = state.entries.filter((e) => e.kind === 'course' && (e.allocations || []).some((a) => a.requirement !== 'none' && !a.area));
  const group = (kind) => state.entries.filter((e) => e.kind === kind);
  return `
  <section class="card">
    <h1>Review before we calculate</h1>
    <p>Here is everything from your uploads and manual entries in one place, and where we propose to count each item. Add, edit, or remove anything that doesn't look right.</p>
    ${state.docs.filter((d) => d.status === 'done').map((d) => `<div class="notice info small"><strong>${esc(d.fileName)}</strong> <span class="chip">${esc(d.documentType.replace('_', ' '))}</span> <span class="chip">${d.extractor === 'ai' ? 'AI-assisted review' : 'Offline demo extractor'}</span><br>${esc(d.summary)}</div>`).join('')}
  </section>
  ${fu.length ? `
  <section class="card" aria-labelledby="fu-h">
    <h2 id="fu-h">Needs your input (${fu.length})</h2>
    <p class="small muted">These documents cover a relevant topic but don't say how many instructional hours were spent on it. Your answer is used provisionally and marked as self-reported. If you're not sure, admissions will review it and those hours are left out of the estimate.</p>
    ${fu.map(({ e, a }) => `
      <div class="followup" data-fu="${e.id}:${a.id}">
        <div class="small muted">${esc(e.title)} · ${esc(reqOf(a.requirement)?.label ?? '')}${a.area ? ` · ${reqOf(a.requirement)?.areaTermShort === 'CKA' ? 'CKA' : 'Area'} ${esc(a.area)}` : ''}</div>
        <p><strong>${esc(a.followUp)}</strong></p>
        <div class="row"><input type="number" min="0" step="0.5" aria-label="Hours on ${esc(a.topic)}" data-fu-input="${e.id}:${a.id}">
          <button data-action="fu-save" data-key="${e.id}:${a.id}">Save hours</button>
          <button data-action="fu-unsure" data-key="${e.id}:${a.id}">I'm not sure</button></div>
      </div>`).join('')}
  </section>` : ''}
  ${dupes.length || unassigned.length ? `<section class="card"><h2>Please check</h2>
    ${dupes.length ? `<p>${dupes.length} likely duplicate${dupes.length > 1 ? 's were' : ' was'} found across your documents and entries. Each is counted once — you can change this below.</p>` : ''}
    ${unassigned.length ? `<p>${unassigned.length} entr${unassigned.length > 1 ? 'ies have' : 'y has'} topics that aren't assigned to an area yet. Unassigned hours aren't counted until an area is chosen.</p>` : ''}
  </section>` : ''}
  <section class="card"><h2>Coursework and continuing education</h2>${entryList(group('course'), { dupes })}
    <div class="row" style="margin-top:10px"><button data-action="add-course">+ Add a course or training</button><button data-action="add-grid">+ Enter hours by area</button></div></section>
  <section class="card"><h2>Supervision</h2>${entryList(group('supervision'), { dupes })}<div class="row" style="margin-top:10px"><button data-action="add-supervision">+ Add supervision hours</button></div></section>
  <section class="card"><h2>SAR</h2>${entryList(group('sar'), { dupes })}<p class="small muted">Your answer: ${esc(YNU[state.answers.sarCompleted] ?? 'Not answered')}</p><div class="row"><button data-action="add-sar">+ Add SAR details</button></div></section>
  <div class="between"><button data-action="go" data-step="intake">Back</button><button class="primary btn big" data-action="estimate">See my estimate</button></div>`;
}

// Keep the checklist short: long lists of short areas collapse behind a toggle.
function detailList(details) {
  if (!details.length) return '';
  const li = (d) => `<li>${esc(d.text)}${d.included ? '<span class="incl">included above</span>' : ''}</li>`;
  const areas = details.filter((d) => d.area), rest = details.filter((d) => !d.area);
  const areaHtml = areas.length > 4
    ? `<li><details><summary>${areas.length} areas below the minimum <span class="incl">included above</span></summary><ul>${areas.map(li).join('')}</ul></details></li>`
    : areas.map(li).join('');
  return `<ul>${areaHtml}${rest.map(li).join('')}</ul>`;
}

function viewResults() {
  const r = state.result;
  if (!r) return '<p>No estimate yet.</p>';
  const liClass = (c) => (c.status === 'complete' || c.status === 'met' ? 'complete' : c.status === 'review' ? 'review' : '');
  const outside = r.outsideNwioi.filter((o) => o.status !== 'info');
  const info = r.outsideNwioi.filter((o) => o.status === 'info');
  const hasDocs = state.docs.some((d) => d.status === 'done' && files[d.docId]);
  const share = state.share;
  return `
  <section class="card price" aria-labelledby="price-h">
    <p class="label" id="price-h">Your estimated NWIOI program cost</p>
    <p class="range" data-testid="range">${esc(r.range.display)}</p>
    <p class="small muted">${esc(r.credential)} · preliminary range</p>
  </section>
  <section class="card" aria-labelledby="left-h">
    <h2 id="left-h">What you appear to have left</h2>
    <ul class="checklist" data-testid="checklist">
      ${r.checklist.map((c) => `<li class="${liClass(c)}"><strong>${esc(c.text)}</strong>${c.offeredByNwioi === false && c.status !== 'complete' ? ' <span class="chip warn">Outside NWIOI</span>' : ''}
        ${detailList(c.details)}</li>`).join('')}
    </ul>
    ${outside.length ? `<h3 style="margin-top:14px">You may also need to complete outside NWIOI</h3><ul class="small">${outside.map((o) => `<li>${esc(o.label)}${o.detail ? ` — ${esc(o.detail)}` : ''}${o.status === 'review' ? ' <span class="chip warn">Not confirmed</span>' : o.status === 'warning' ? ' <span class="chip warn">Please note</span>' : ''}</li>`).join('')}</ul>` : ''}
    <p style="margin-top:14px">NWIOI considers applicable coursework and training you’ve already completed so you can avoid paying to repeat it. This range gives you a ballpark based on the information you provided. During your admissions call, we’ll review what may count toward your certification path, talk through what you still need, and confirm your NWIOI price.</p>
    <div class="cta">
      <a class="btn primary big" href="${esc(config.links.schedulingUrl)}" target="_blank" rel="noopener" data-testid="schedule">Schedule an admissions call</a>
      <a href="${esc(config.links.contactUrl)}" target="_blank" rel="noopener" data-testid="ask">Ask admissions a question</a>
    </div>
  </section>

  <section class="card" aria-labelledby="share-h">
    <h2 id="share-h">Share your estimate with admissions <span class="muted small">(optional)</span></h2>
    <p class="small muted">Sharing lets your admissions call pick up where you left off. You can book a call without sharing anything.</p>
    ${share?.done ? `<div class="notice ok">Shared with admissions${share.documentsShared ? ` (including ${share.documentsShared} document${share.documentsShared > 1 ? 's' : ''})` : ' (no documents shared)'}. Thank you!</div>` : `
    <form id="share-form">
      <label style="font-weight:400"><input type="checkbox" name="shareEstimate" id="share-estimate"> Share my estimate and intake summary with NWIOI admissions</label>
      <div id="share-fields" hidden>
        <div class="grid2" style="margin-top:10px">
          <div class="field"><label for="sh-name">Name</label><input type="text" id="sh-name" name="name" autocomplete="name"></div>
          <div class="field"><label for="sh-email">Email</label><input type="email" id="sh-email" name="email" autocomplete="email"></div>
        </div>
        <div class="field"><label for="sh-msg">Anything you'd like admissions to know? <span class="muted small">(optional)</span></label><textarea id="sh-msg" name="message"></textarea></div>
        ${hasDocs ? `<label style="font-weight:400"><input type="checkbox" name="shareDocuments" id="share-docs"> Also share my uploaded documents (${state.docs.filter((d) => files[d.docId]).map((d) => esc(d.fileName)).join(', ')})</label><p class="small muted">Documents are shared only if you check this box. <a href="/privacy" target="_blank" rel="noopener">Privacy and data retention</a></p>` : state.docs.length ? '<p class="small muted">Your uploaded files are no longer available in this browser session, so only the summary can be shared.</p>' : ''}
        <p class="small" id="share-error" role="alert" style="color:var(--danger)"></p>
        <button class="primary" type="submit">Share with admissions</button>
      </div>
    </form>`}
  </section>

  ${r.reviewItems.length || r.countingNotes.length ? `<section class="card"><h2>Items admissions will review</h2>
    ${r.reviewItems.length ? `<p class="small muted">These were left out of the estimate until admissions can confirm them.</p><ul class="small">${r.reviewItems.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>` : ''}
    ${r.countingNotes.length ? `<details><summary class="small">How some of your hours were counted</summary><ul class="small">${r.countingNotes.map((t) => `<li>${esc(t)}</li>`).join('')}</ul></details>` : ''}
  </section>` : ''}
  <section class="card small muted">
    <p>Estimate based on the published AASECT ${esc(r.pathName)} requirements, version ${esc(r.rulesetVersion)} (${r.sources.map((s) => `<a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.title)}</a>`).join(', ')}). ${info.map((o) => esc(o.label)).join(' ')}. AASECT makes all certification decisions.</p>
    <div class="row"><button data-action="go" data-step="review">Edit my information</button><button data-action="restart">Start over</button></div>
  </section>`;
}

// ---------------------------------------------------------------- entry editor
const areaOptions = (req, sel) => `<option value="">Not sure / choose later</option>` + req.areas.map((a) => `<option value="${a.key}" ${a.key === sel ? 'selected' : ''}>${a.key}. ${esc(a.label)}</option>`).join('');
const reqOptions = (sel) => hoursReqs().map((r) => `<option value="${r.key}" ${r.key === sel ? 'selected' : ''}>${esc(r.label)}</option>`).join('') + `<option value="none" ${sel === 'none' ? 'selected' : ''}>Doesn't apply</option>`;
const opts = (map, sel) => Object.entries(map).map(([k, l]) => `<option value="${k}" ${k === sel ? 'selected' : ''}>${esc(l)}</option>`).join('');

function allocRow(a) {
  const req = reqOf(a.requirement) ?? hoursReqs()[0];
  const unsure = a.basis === 'unsure' || a.basis === 'needs_answer';
  const showSpecific = req.key === 'training' && req.specificMin;
  const showCouples = req.key === 'training' && (req.conditional || []).some((c) => c.key === 'couples');
  return `<div class="alloc-row" data-alloc="${a.id}">
    <div><label>Counts toward</label><select data-f="requirement">${reqOptions(a.requirement)}</select></div>
    <div><label>${esc(req.areaTerm)}</label><select data-f="area" ${a.requirement === 'none' ? 'disabled' : ''}>${areaOptions(req, a.area)}</select></div>
    <div><label>Hours on topic</label><input type="number" min="0" step="0.5" data-f="hours" value="${unsure || a.hours == null ? '' : a.hours}" ${unsure ? 'disabled' : ''}></div>
    <div><button type="button" class="link danger" data-x="remove-alloc">Remove</button></div>
    <div class="opts">
      <label><input type="text" data-f="topic" placeholder="Topic (optional)" value="${esc(a.topic)}" style="width:220px"></label>
      <label><input type="checkbox" data-f="unsure" ${unsure ? 'checked' : ''}> I'm not sure how many hours</label>
      ${showSpecific ? `<label><input type="checkbox" data-f="sexualitySpecific" ${a.sexualitySpecific !== false ? 'checked' : ''}> Specific to ${esc(req.specificLabel)}</label>` : ''}
      ${showCouples ? `<label><input type="checkbox" data-f="couples" ${a.couples ? 'checked' : ''}> Couples counseling training</label>` : ''}
      ${a.evidence ? `<span class="small muted">Document: “${esc(a.evidence)}”</span>` : ''}
    </div></div>`;
}

let draft = null;
function openEditor(entry, mode) {
  draft = structuredClone(entry);
  draft._mode = mode;
  $dlg.innerHTML = editorHtml();
  $dlg.showModal();
}

function editorHtml() {
  const e = draft;
  const title = { course: 'Course or training', grid: 'Hours by area', supervision: 'Supervision', sar: 'SAR' }[e._mode];
  let body = '';
  if (e.kind === 'course' && e._mode !== 'grid') {
    body = `
      <div class="grid2">
        <div class="field"><label for="ed-title">Course or training title</label><input type="text" id="ed-title" data-e="title" value="${esc(e.title)}" required></div>
        <div class="field"><label for="ed-prov">School or provider</label><input type="text" id="ed-prov" data-e="provider" value="${esc(e.provider)}"></div>
        <div class="field"><label for="ed-code">Course code <span class="muted small">(optional)</span></label><input type="text" id="ed-code" data-e="courseCode" value="${esc(e.courseCode)}"></div>
        <div class="field"><label for="ed-date">Date or term</label><input type="text" id="ed-date" data-e="date" value="${esc(e.date)}"></div>
        <div class="field"><label for="ed-ct">Type of credit</label><select id="ed-ct" data-e="creditType">${opts(CREDIT_TYPES, e.creditType)}</select></div>
        <div class="field"><label for="ed-del">How it was delivered</label><select id="ed-del" data-e="delivery">${opts(DELIVERY, e.delivery)}</select></div>
        <div class="field"><label for="ed-amt">Total for the whole course</label><input type="number" min="0" step="0.5" id="ed-amt" data-e="totalAmount" value="${e.totalAmount ?? ''}"></div>
        <div class="field"><label for="ed-unit">Unit</label><select id="ed-unit" data-e="totalUnit">${opts(UNITS, e.totalUnit)}</select></div>
      </div>
      <h3>Topics and hours</h3>
      <p class="small muted">How many hours of instruction were spent on each topic? This is separate from the course total. ${esc(rs().creditRules.note)}</p>
      <div id="allocs">${(e.allocations || []).map(allocRow).join('')}</div>
      <button type="button" data-x="add-alloc">+ Add a topic</button>`;
  } else if (e._mode === 'grid') {
    const req = reqOf(e._gridReq) ?? hoursReqs()[0];
    body = `
      <div class="grid2">
        <div class="field"><label for="ed-title">Name for this summary</label><input type="text" id="ed-title" data-e="title" value="${esc(e.title)}" placeholder="e.g., CE workshops 2023–2025"></div>
        <div class="field"><label for="ed-greq">Requirement</label><select id="ed-greq" data-x-change="grid-req">${hoursReqs().map((r) => `<option value="${r.key}" ${r.key === req.key ? 'selected' : ''}>${esc(r.label)}</option>`).join('')}</select></div>
        <div class="field"><label for="ed-ct">Type of credit</label><select id="ed-ct" data-e="creditType">${opts(CREDIT_TYPES, e.creditType)}</select></div>
        <div class="field"><label for="ed-del">How it was delivered</label><select id="ed-del" data-e="delivery">${opts(DELIVERY, e.delivery)}</select></div>
      </div>
      <p class="small muted">Enter the hours you have in each ${esc(req.areaTerm)}. Leave blank if none. Each area needs at least ${req.areaMin} hours; at most ${req.areaMax} hours per area count toward the ${req.totalHours}.</p>
      <div class="area-grid">${req.areas.map((a) => { const al = (e.allocations || []).find((x) => x.area === a.key && x.requirement === req.key); return `<label>${a.key}. ${esc(a.label)}<input type="number" min="0" step="0.5" data-grid="${a.key}" value="${al?.hours ?? ''}"></label>`; }).join('')}</div>`;
  } else if (e.kind === 'supervision') {
    body = `<div class="grid2">
      <div class="field"><label for="ed-sn">Supervisor name</label><input type="text" id="ed-sn" data-e="supervisorName" value="${esc(e.supervisorName)}"></div>
      <div class="field"><label for="ed-si">Individual (one-to-one) hours</label><input type="number" min="0" step="0.5" id="ed-si" data-e="individualHours" value="${e.individualHours ?? ''}"></div>
      <div class="field"><label for="ed-sg">Group hours</label><input type="number" min="0" step="0.5" id="ed-sg" data-e="groupHours" value="${e.groupHours ?? ''}"></div></div>
      <fieldset><legend>Was this with an ${esc(rs().terms.supervisorTitle)} under a signed supervision contract?</legend><div class="seg">${Object.entries(YNU).map(([k, l]) => `<label><input type="radio" name="ed-q" data-e="qualifies" value="${k}" ${e.qualifies === k ? 'checked' : ''}> ${l}</label>`).join('')}</div></fieldset>`;
  } else if (e.kind === 'sar') {
    body = `<div class="grid2">
      <div class="field"><label for="ed-title">Program name</label><input type="text" id="ed-title" data-e="title" value="${esc(e.title)}"></div>
      <div class="field"><label for="ed-prov">Provider</label><input type="text" id="ed-prov" data-e="provider" value="${esc(e.provider)}"></div>
      <div class="field"><label for="ed-date">Date</label><input type="text" id="ed-date" data-e="date" value="${esc(e.date)}"></div>
      <div class="field"><label for="ed-h">Hours attended</label><input type="number" min="0" step="0.5" id="ed-h" data-e="hours" value="${e.hours ?? ''}"></div></div>
      <fieldset><legend>Was it AASECT sponsored or approved?</legend><div class="seg">${Object.entries(YNU).map(([k, l]) => `<label><input type="radio" name="ed-sa" data-e="aasectApproved" value="${k}" ${e.aasectApproved === k ? 'checked' : ''}> ${l}</label>`).join('')}</div></fieldset>`;
  }
  return `<form method="dialog" id="ed-form">
    <h2 id="editor-title">${title}</h2>
    ${e.source?.type === 'document' ? `<div class="notice info small">From <strong>${esc(e.source.fileName)}</strong>${e.source.excerpt ? `: “${esc(e.source.excerpt)}”` : ''}. Changes you make are marked as corrected by you.</div>` : ''}
    ${body}
    <div class="row end" style="margin-top:16px"><button type="button" data-x="cancel">Cancel</button><button class="primary" type="submit">Save</button></div>
  </form>`;
}

function readEditor() {
  const f = $dlg.querySelector('#ed-form');
  f.querySelectorAll('[data-e]').forEach((el) => {
    if (el.type === 'radio') { if (el.checked) draft[el.dataset.e] = el.value; return; }
    draft[el.dataset.e] = el.type === 'number' ? (el.value === '' ? null : Number(el.value)) : el.value;
  });
  if (draft._mode === 'grid') {
    const reqKey = f.querySelector('#ed-greq').value;
    draft._gridReq = reqKey;
    const keep = (draft.allocations || []).filter((a) => a.requirement !== reqKey);
    const rows = [...f.querySelectorAll('[data-grid]')].filter((el) => el.value !== '' && Number(el.value) > 0)
      .map((el) => ({ id: uid(), requirement: reqKey, area: el.dataset.grid, hours: Number(el.value), basis: 'manual', topic: '', sexualitySpecific: true }));
    draft.allocations = [...keep, ...rows];
    draft.totalAmount = draft.allocations.reduce((s, a) => s + (a.hours || 0), 0);
    draft.totalUnit = draft.creditType === 'academic' ? 'clock_hours' : 'ce_hours';
  } else {
    f.querySelectorAll('[data-alloc]').forEach((row) => {
      const a = draft.allocations.find((x) => x.id === row.dataset.alloc);
      const get = (k) => row.querySelector(`[data-f="${k}"]`);
      a.requirement = get('requirement').value;
      a.area = get('area').value || null;
      a.topic = get('topic').value;
      const unsure = get('unsure').checked;
      const h = get('hours').value === '' ? null : Number(get('hours').value);
      if (unsure || h == null) { a.basis = a.basis === 'needs_answer' && !unsure ? 'needs_answer' : 'unsure'; a.hours = null; }
      else if (!(a.basis === 'stated' && h === a.hours)) {
        // Hours stated in a document stay "stated"; anything the student types is theirs.
        a.basis = draft.source?.type === 'document' ? 'self_reported' : 'manual';
        a.hours = h;
      }
      if (get('sexualitySpecific')) a.sexualitySpecific = get('sexualitySpecific').checked;
      if (get('couples')) a.couples = get('couples').checked;
    });
  }
}

$dlg.addEventListener('click', (ev) => {
  const x = ev.target.closest('[data-x]')?.dataset.x;
  if (!x) return;
  if (x === 'cancel') { $dlg.close(); return; }
  readEditor();
  if (x === 'add-alloc') draft.allocations.push({ id: uid(), requirement: 'core', area: null, hours: null, basis: 'manual', topic: '', sexualitySpecific: true });
  if (x === 'remove-alloc') { const id = ev.target.closest('[data-alloc]').dataset.alloc; draft.allocations = draft.allocations.filter((a) => a.id !== id); }
  $dlg.innerHTML = editorHtml();
});
$dlg.addEventListener('change', (ev) => {
  const t = ev.target;
  if (t.matches('[data-f="requirement"], [data-f="unsure"], [data-x-change="grid-req"]')) { readEditor(); if (t.dataset.xChange) draft._gridReq = t.value; $dlg.innerHTML = editorHtml(); }
});
$dlg.addEventListener('submit', (ev) => {
  ev.preventDefault();
  readEditor();
  if (draft._mode === 'grid' && !draft.title.trim()) draft.title = `My ${reqOf(draft._gridReq).label.toLowerCase()} hours by area`;
  const { _mode, ...entry } = draft;
  const idx = state.entries.findIndex((e) => e.id === entry.id);
  if (idx >= 0) {
    if (entry.source?.type === 'document' && JSON.stringify(stripMeta(state.entries[idx])) !== JSON.stringify(stripMeta(entry))) entry.corrected = true;
    state.entries[idx] = entry;
  } else state.entries.push(entry);
  if (entry.kind === 'sar' && !state.answers.sarCompleted) state.answers.sarCompleted = 'yes';
  $dlg.close();
  save();
  render();
});
const stripMeta = (e) => { const { corrected, _gridReq, ...rest } = e; return rest; };

const newCourse = () => ({ id: uid(), kind: 'course', title: '', provider: '', courseCode: '', date: '', creditType: 'academic', totalAmount: null, totalUnit: 'semester_credits', delivery: 'unsure', allocations: [{ id: uid(), requirement: 'core', area: null, hours: null, basis: 'manual', topic: '', sexualitySpecific: true }], source: { type: 'manual' } });

// ---------------------------------------------------------------- uploads
async function uploadFiles(list) {
  for (const file of list) {
    const doc = { docId: uid(), fileName: file.name, status: 'reviewing' };
    state.docs.push(doc);
    render();
    try {
      const fd = new FormData();
      fd.append('path', state.path);
      fd.append('file', file);
      const r = await api('/api/documents', { method: 'POST', body: fd });
      Object.assign(doc, { docId: r.docId, status: 'done', summary: r.summary, documentType: r.documentType, extractor: r.extractor.type, count: r.entries.length });
      files[r.docId] = file;
      for (const e of r.entries) {
        e.source.original = structuredClone({ ...e, source: undefined });
        state.entries.push(e);
        if (e.kind === 'sar' && !state.answers.sarCompleted) state.answers.sarCompleted = 'yes';
      }
    } catch (err) {
      Object.assign(doc, { status: 'error', error: `${err.message} You can add the details manually instead.` });
    }
    save();
    render();
  }
}

// ---------------------------------------------------------------- events
$app.addEventListener('click', async (ev) => {
  const el = ev.target.closest('[data-action]');
  if (!el) return;
  const a = el.dataset.action;
  const entry = (id) => state.entries.find((e) => e.id === id);
  if (a === 'choose-path') {
    if (state.path && state.path !== el.dataset.path && state.entries.length && !confirm('Changing your path will clear the information you entered. Continue?')) return;
    if (state.path !== el.dataset.path) { state = { ...fresh(), path: el.dataset.path }; files = {}; }
    go('intake');
  } else if (a === 'method') { state.method = el.dataset.method; save(); render(); }
  else if (a === 'go') go(el.dataset.step);
  else if (a === 'add-course') openEditor(newCourse(), 'course');
  else if (a === 'add-grid') openEditor({ ...newCourse(), title: '', creditType: 'aasect_ce', allocations: [], _gridReq: 'core' }, 'grid');
  else if (a === 'add-supervision') openEditor({ id: uid(), kind: 'supervision', supervisorName: '', individualHours: 0, groupHours: 0, qualifies: 'unsure', source: { type: 'manual' } }, 'supervision');
  else if (a === 'add-sar') openEditor({ id: uid(), kind: 'sar', title: 'Sexual Attitude Reassessment', provider: '', date: '', hours: 14, aasectApproved: 'unsure', source: { type: 'manual' } }, 'sar');
  else if (a === 'edit') { const e = entry(el.dataset.id); openEditor(e, e.kind === 'course' ? (e._gridReq ? 'grid' : 'course') : e.kind); }
  else if (a === 'remove') { if (confirm('Remove this entry?')) { state.entries = state.entries.filter((e) => e.id !== el.dataset.id); save(); render(); } }
  else if (a === 'prefer') { const e = entry(el.dataset.id); e.preferOver = [...(e.preferOver || []), el.dataset.other]; const o = entry(el.dataset.other); if (o.preferOver) o.preferOver = o.preferOver.filter((x) => x !== e.id); save(); render(); }
  else if (a === 'not-dup') { const e = entry(el.dataset.id); e.notDuplicateOf = [...(e.notDuplicateOf || []), el.dataset.other]; save(); render(); }
  else if (a === 'fu-save' || a === 'fu-unsure') {
    const [eid, aid] = el.dataset.key.split(':');
    const al = entry(eid).allocations.find((x) => x.id === aid);
    if (a === 'fu-unsure') { al.basis = 'unsure'; al.hours = null; }
    else {
      const v = $app.querySelector(`[data-fu-input="${el.dataset.key}"]`).value;
      if (v === '' || Number(v) < 0) return;
      al.basis = 'self_reported'; al.hours = Number(v);
    }
    save(); render();
  } else if (a === 'to-review') go('review');
  else if (a === 'estimate') {
    if (followUps().length && !confirm('Some topics still need hours. They will be treated as “I’m not sure” and left out of the estimate. Continue?')) return;
    el.disabled = true;
    try {
      const sarManual = state.answers.sarCompleted;
      state.result = await api('/api/estimate', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ path: state.path, intake: { entries: state.entries, answers: { ...state.answers, sarCompleted: sarManual } } }) });
      state.share = null;
      go('results');
    } catch (err) { alert(err.message); el.disabled = false; }
  } else if (a === 'restart') { if (confirm('Start over? Your entries will be cleared.')) { state = fresh(); files = {}; save(); render(); } }
});

$app.addEventListener('change', (ev) => {
  const t = ev.target;
  if (t.id === 'file-input') { uploadFiles([...t.files]); return; }
  if (t.id === 'share-estimate') { $app.querySelector('#share-fields').hidden = !t.checked; return; }
  if (t.dataset.answer) {
    state.answers[t.dataset.answer] = t.type === 'number' ? (t.value === '' ? undefined : Number(t.value)) : t.value;
    save();
    if (t.dataset.answer === 'sarCompleted') render();
  } else if (t.dataset.answerUnsure) {
    state.answers[t.dataset.answerUnsure] = t.checked ? 'unsure' : undefined;
    save(); render();
  } else if (t.dataset.answerFlag) {
    state.answers[t.dataset.answerFlag] = t.checked ? 'yes' : undefined;
    save();
  }
});

$app.addEventListener('submit', async (ev) => {
  if (ev.target.id !== 'share-form') return;
  ev.preventDefault();
  const f = ev.target;
  const errEl = f.querySelector('#share-error');
  const shareDocuments = f.shareDocuments?.checked === true;
  const payload = {
    shareEstimate: f.shareEstimate.checked, shareDocuments,
    contact: { name: f.name.value, email: f.email.value }, message: f.message.value,
    intake: { entries: state.entries, answers: state.answers },
    documentSummaries: state.docs.filter((d) => d.status === 'done').map((d) => ({ fileName: d.fileName, documentType: d.documentType, summary: d.summary, extractor: d.extractor })),
  };
  const fd = new FormData();
  fd.append('payload', JSON.stringify(payload));
  if (shareDocuments) for (const d of state.docs) if (files[d.docId]) fd.append('documents', files[d.docId], d.fileName);
  try {
    const r = await api(`/api/estimates/${state.result.estimateId}/share`, { method: 'POST', body: fd });
    state.share = { done: true, documentsShared: r.documentsShared };
    save(); render();
  } catch (err) { errEl.textContent = err.message; }
});

// drag and drop
$app.addEventListener('dragover', (ev) => { const dz = ev.target.closest('#dropzone'); if (dz) { ev.preventDefault(); dz.classList.add('over'); } });
$app.addEventListener('dragleave', (ev) => ev.target.closest('#dropzone')?.classList.remove('over'));
$app.addEventListener('drop', (ev) => { const dz = ev.target.closest('#dropzone'); if (!dz) return; ev.preventDefault(); dz.classList.remove('over'); uploadFiles([...ev.dataTransfer.files]); });

// ---------------------------------------------------------------- boot
(async () => {
  try {
    config = await api('/api/config');
    if (state.path && !config.paths.some((p) => p.path === state.path && p.enabled)) state = fresh();
    // Files can't survive a reload; drop in-progress uploads.
    state.docs = state.docs.filter((d) => d.status !== 'reviewing');
    render();
  } catch (err) {
    $app.innerHTML = `<div class="card"><p>The estimator could not load. Please try again later.</p><p class="small muted">${esc(err.message)}</p></div>`;
  }
})();
