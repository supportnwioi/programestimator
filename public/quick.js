// One-page quick estimator. Inputs: certification path, education hours,
// supervision hours, SAR. The range is calculated server-side as answers change.
const $main = document.getElementById('quick');
const $bar = document.getElementById('price-bar');
const $headerBook = document.getElementById('header-book');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let config = null;
// education/supervision: null = not answered yet, 'unsure', or a number of hours (0 is a real answer).
const state = { path: null, education: null, supervision: null, sar: null };
let result = null;
let loading = false;

const pathCfg = () => config.paths.find((p) => p.path === state.path);
const deciding = () => state.path === 'deciding';

function load() {
  try { Object.assign(state, JSON.parse(sessionStorage.getItem('nwioi-quick')) || {}); } catch { /* storage unavailable */ }
}
function save() {
  try { sessionStorage.setItem('nwioi-quick', JSON.stringify(state)); } catch { /* storage unavailable */ }
}

// ------------------------------------------------------------------ links
function linkHtml(link, label, cls = '', testid = '') {
  const t = testid ? ` data-testid="${testid}"` : '';
  if (!link) return `<span class="${cls} disabled" aria-disabled="true"${t}>${esc(label)} <span class="small">(link coming soon)</span></span>`;
  return `<a class="${cls}" href="${esc(link.url)}" target="_blank" rel="noopener"${t}>${esc(label)}</a>${link.placeholder ? ' <span class="chip warn">Placeholder link · admin preview</span>' : ''}`;
}
const bookingLink = () => config.links.scheduling;
const enrollmentLink = () => (state.path && config.links.enrollment?.[state.path]) || null;

// ------------------------------------------------------------------ rendering
function render() {
  $headerBook.innerHTML = linkHtml(bookingLink(), 'Book an admissions call', 'btn small-btn', 'header-book');
  const p = state.path && !deciding() ? pathCfg() : null;
  $main.innerHTML = `
  <section class="intro">
    <h1>What might your NWIOI training cost?</h1>
    <p>Already completed some coursework, continuing education, or supervision? Tell us roughly how much you’ve done to see how it could affect your NWIOI cost.</p>
    ${config.preview ? '<p class="notice warn small">You’re signed in as an NWIOI admin. You’ll see sample pricing and placeholder links that students don’t see.</p>' : ''}
  </section>
  <div class="quick-grid">
    <div class="quick-inputs">
      <section class="card" aria-labelledby="path-legend">
        <fieldset class="path-picker">
          <legend id="path-legend">Which certification are you working toward?</legend>
          <div class="seg seg-wide">
            ${config.paths.filter((x) => x.enabled).map((x) => `<label><input type="radio" name="path" value="${x.path}" ${state.path === x.path ? 'checked' : ''}> ${esc(x.pathName)}</label>`).join('')}
            <label><input type="radio" name="path" value="deciding" ${deciding() ? 'checked' : ''}> I’m still deciding</label>
          </div>
        </fieldset>
      </section>
      ${p ? questions(p) : deciding() ? `<section class="card"><p>Not sure which path fits yet? That’s a great conversation to have with admissions. We’ll talk through your goals and background and what each path involves.</p></section>` : ''}
    </div>
    <aside class="quick-price card" aria-labelledby="price-h">
      ${priceCard(p)}
    </aside>
  </div>`;
  renderBar(p);
  $main.setAttribute('aria-busy', 'false');
}

function hoursQuestion(key, title, hint, max, benchmarkLabel) {
  const v = state[key];
  const answered = v !== null && v !== undefined;
  const unsure = v === 'unsure';
  const n = typeof v === 'number' ? v : 0;
  const status = !answered ? 'Not answered yet' : unsure ? 'You’re not sure' : `${n} hour${n === 1 ? '' : 's'}`;
  return `
  <fieldset class="hours-q ${answered ? '' : 'unanswered'} ${unsure ? 'is-unsure' : ''}" data-q="${key}">
    <legend id="${key}-legend">${esc(title)}</legend>
    <p class="small muted" id="${key}-hint">${hint}</p>
    <div class="slider-row">
      <input type="range" min="0" max="${max}" step="1" value="${unsure ? 0 : n}" id="${key}-range" data-range="${key}"
        aria-labelledby="${key}-legend" aria-describedby="${key}-hint ${key}-status" aria-valuetext="${esc(status)}" ${unsure ? 'disabled' : ''}>
      <span class="num"><input type="number" inputmode="numeric" min="0" max="${max}" step="1" id="${key}-num" data-num="${key}"
        value="${answered && !unsure ? n : ''}" placeholder="—" aria-label="${esc(title)} (hours)" ${unsure ? 'disabled' : ''}> <span aria-hidden="true">hours</span></span>
    </div>
    <div class="scale small muted" aria-hidden="true"><span>0</span><span>${max} · ${esc(benchmarkLabel)}</span></div>
    <div class="between q-foot">
      <span class="q-status small" id="${key}-status" aria-live="polite"><strong>${esc(status)}</strong></span>
      <span class="row">
        <button type="button" class="chip-btn" data-zero="${key}" aria-pressed="${answered && !unsure && n === 0}">None yet</button>
        <button type="button" class="chip-btn" data-unsure="${key}" aria-pressed="${unsure}">I’m not sure</button>
      </span>
    </div>
  </fieldset>`;
}

function questions(p) {
  const q = p.quick;
  return `
  <section class="card">
    ${hoursQuestion('education', 'How many hours of relevant education have you completed?',
      `Include relevant graduate coursework, training, and continuing education. The ${esc(p.pathName)} path calls for about ${q.education} hours (${q.educationParts.core} ${esc(q.educationLabels.core.toLowerCase())} + ${q.educationParts.training} ${esc(q.educationLabels.training.toLowerCase())}).`,
      q.education, 'education benchmark')}
    <details class="credits">
      <summary>My coursework is listed in credits</summary>
      <p class="small">AASECT counts a college or university semester credit as ${q.semesterCreditClockHours} clock hours (a 3-credit semester course = ${3 * q.semesterCreditClockHours} hours). Continuing education from bodies other than AASECT counts at ${q.nonAasectCeMultiplier === 0.5 ? 'half' : `${q.nonAasectCeMultiplier}×`} value. Quarter credits don’t have a published conversion, so admissions will review those with you.</p>
      <div class="row">
        <label class="small" for="credits-in" style="margin:0">Semester credits</label>
        <input type="number" id="credits-in" min="0" step="0.5" inputmode="decimal" style="max-width:110px">
        <span class="small" id="credits-out" aria-live="polite"></span>
        <button type="button" data-add-credits>Add to my education hours</button>
      </div>
      <p class="small muted">Count each course once. If a course is already in your hours above, don’t add its credits too.</p>
    </details>
  </section>
  <section class="card">
    ${hoursQuestion('supervision', 'How many hours of supervision have you completed toward this certification?',
      `Supervision with an ${esc(p.terms.supervisorTitle)}. The standard benchmark for this path is ${q.supervision} hours. Admissions will review any individual exceptions with you.`,
      q.supervision, 'supervision benchmark')}
  </section>
  <section class="card">
    <fieldset>
      <legend>Have you completed a general Sexual Attitude Reassessment (SAR)?</legend>
      <div class="seg">${[['yes', 'Yes'], ['no', 'No'], ['unsure', 'Not sure']].map(([k, l]) => `<label><input type="radio" name="sar" value="${k}" ${state.sar === k ? 'checked' : ''}> ${l}</label>`).join('')}</div>
      ${state.sar === 'yes' ? '<p class="small muted" style="margin-top:8px">Thanks, we’ll take your word for it for now. NWIOI can confirm whether your SAR meets the requirement.</p>' : ''}
    </fieldset>
  </section>`;
}

function ctas() {
  if (deciding()) {
    return `<div class="cta">${linkHtml(bookingLink(), 'Talk through your options', 'btn primary big', 'primary-cta')}</div>`;
  }
  const enroll = enrollmentLink();
  if (result?.startingFromScratch && enroll) {
    return `<div class="cta">${linkHtml(enroll, 'Explore enrollment options', 'btn primary big', 'primary-cta')}
      ${linkHtml(bookingLink(), 'Book an admissions call', 'btn', 'secondary-cta')}</div>`;
  }
  return `<div class="cta">${linkHtml(bookingLink(), 'Book an admissions call', 'btn primary big', 'primary-cta')}
    <p class="small">We’ll review what you’ve already done and help you plan what’s left.</p>
    ${linkHtml(config.links.contact, 'Ask admissions a question', 'small', 'ask')}</div>`;
}

function priceCard(p) {
  let body;
  if (!state.path) body = '<p class="muted">Choose your certification path to see an estimate.</p>';
  else if (deciding()) body = '<p>We’ll help you compare paths and plan your training.</p>';
  else if (!result || result.status === 'incomplete') {
    const missing = ['education', 'supervision'].filter((k) => state[k] === null || state[k] === undefined).length;
    body = `<p class="muted" data-testid="price-status">Answer the ${missing === 1 ? 'remaining hours question' : 'two hours questions'} to see your range. Choose “None yet” or “I’m not sure” if that fits best.</p>`;
  } else if (result.status === 'personalized') {
    const why = result.reason === 'at_maximum'
      ? 'It sounds like you may have already done much of this training. Admissions will review what counts and what’s left.'
      : 'We’ll review what you’ve already done and confirm your price.';
    body = `<p class="range personal" data-testid="range">Get a personalized estimate</p><p class="small">${why}</p>`;
  } else {
    body = `<p class="range ${loading ? 'is-loading' : ''}" data-testid="range">${esc(result.range.display)}</p>
      <p class="small">This is a ballpark for NWIOI training based on your answers. We’ll review what may count and confirm your price before you enroll.</p>
      ${result.preview ? '<p><span class="chip warn">Admin preview · sample pricing. Students see “Get a personalized estimate” until pricing is confirmed.</span></p>' : ''}
      ${result.notes.length ? `<ul class="small notes">${result.notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>` : ''}`;
  }
  return `<h2 id="price-h" class="price-label">Estimated cost with NWIOI</h2>
    <div aria-live="polite" aria-atomic="true">${body}</div>
    ${ctas()}
    ${p ? `<details class="small how"><summary>How this estimate works</summary>
      <p>We use the published AASECT ${esc(p.pathName)} requirements (version ${esc(p.version)}) as the benchmark. We treat the hours you enter as hours that <em>may</em> count. The range runs from most of them counting to about half of them counting, because some prior work may not match every required area or live-training requirement. More hours never raises the estimate. Supervision uses the standard ${p.quick.supervision}-hour benchmark.</p></details>` : ''}`;
}

function renderBar(p) {
  const show = Boolean(p && result && result.status !== 'incomplete');
  $bar.hidden = !show;
  $bar.setAttribute('aria-hidden', String(!show));
  if (!show) { $bar.innerHTML = ''; return; }
  const text = result.status === 'priced' ? result.range.display : 'Get a personalized estimate';
  $bar.innerHTML = `<div><span class="small muted">Estimated cost with NWIOI</span><strong>${esc(text)}</strong></div>${linkHtml(bookingLink(), 'Book a call', 'btn primary')}`;
}

// Update only the price card + bar (keeps focus on the slider while dragging).
function renderPrice() {
  const p = state.path && !deciding() ? pathCfg() : null;
  const aside = $main.querySelector('.quick-price');
  if (aside) aside.innerHTML = priceCard(p);
  renderBar(p);
}

function syncQuestion(key) {
  const fs = $main.querySelector(`[data-q="${key}"]`);
  if (!fs) return;
  const v = state[key];
  const answered = v !== null && v !== undefined, unsure = v === 'unsure';
  const n = typeof v === 'number' ? v : 0;
  const status = !answered ? 'Not answered yet' : unsure ? 'You’re not sure' : `${n} hour${n === 1 ? '' : 's'}`;
  fs.classList.toggle('unanswered', !answered);
  fs.classList.toggle('is-unsure', unsure);
  const range = fs.querySelector('[data-range]'), num = fs.querySelector('[data-num]');
  range.disabled = unsure; num.disabled = unsure;
  if (document.activeElement !== range) range.value = unsure ? 0 : n;
  if (document.activeElement !== num) num.value = answered && !unsure ? n : '';
  range.setAttribute('aria-valuetext', status);
  fs.querySelector('.q-status strong').textContent = status;
  fs.querySelector('[data-zero]').setAttribute('aria-pressed', String(answered && !unsure && n === 0));
  fs.querySelector('[data-unsure]').setAttribute('aria-pressed', String(unsure));
}

// ------------------------------------------------------------------ estimate
let timer = null, controller = null, seq = 0;
function requestEstimate(immediate = false) {
  save();
  clearTimeout(timer);
  if (!state.path || deciding()) { result = null; renderPrice(); return; }
  loading = true;
  timer = setTimeout(async () => {
    controller?.abort();
    controller = new AbortController();
    const mine = ++seq;
    try {
      const res = await fetch('/api/quick-estimate', {
        method: 'POST', headers: { 'content-type': 'application/json' }, signal: controller.signal,
        body: JSON.stringify({ path: state.path, education: state.education, supervision: state.supervision, sar: state.sar }),
      });
      const body = await res.json();
      if (mine !== seq) return;
      if (!res.ok) throw new Error(body.error || 'Estimate unavailable');
      result = body;
    } catch (err) {
      if (err.name === 'AbortError') return;
      result = { status: 'personalized', reason: 'error', notes: [] };
    }
    loading = false;
    renderPrice();
  }, immediate ? 0 : 120);
}

function setHours(key, value) {
  const max = pathCfg().quick[key];
  if (value === 'unsure' || value === null) state[key] = value;
  else state[key] = Math.max(0, Math.min(max, Math.round(Number(value))));
  syncQuestion(key);
  requestEstimate();
}

// ------------------------------------------------------------------ events
$main.addEventListener('input', (ev) => {
  const t = ev.target;
  if (t.dataset.range) setHours(t.dataset.range, t.value);
  else if (t.dataset.num) {
    if (t.value === '') return; // clearing the box doesn't reset an answer until blur
    setHours(t.dataset.num, t.value);
  } else if (t.id === 'credits-in') {
    const c = Number(t.value), q = pathCfg().quick;
    $main.querySelector('#credits-out').textContent = c > 0 ? `= ${c * q.semesterCreditClockHours} hours` : '';
  }
});

$main.addEventListener('change', (ev) => {
  const t = ev.target;
  if (t.name === 'path') {
    state.path = t.value;
    // Keep answers, clamped to the new path's benchmarks.
    if (!deciding()) for (const k of ['education', 'supervision']) if (typeof state[k] === 'number') state[k] = Math.min(state[k], pathCfg().quick[k]);
    result = null;
    render();
    requestEstimate(true);
  } else if (t.name === 'sar') {
    state.sar = t.value;
    const fs = t.closest('fieldset');
    render();
    fs && $main.querySelector(`input[name="sar"][value="${t.value}"]`)?.focus();
    requestEstimate(true);
  } else if (t.dataset.num && t.value === '') {
    // An emptied number box means "not answered".
    setHours(t.dataset.num, null);
  }
});

$main.addEventListener('click', (ev) => {
  const t = ev.target.closest('button');
  if (!t) return;
  if (t.dataset.zero) setHours(t.dataset.zero, 0);
  else if (t.dataset.unsure) setHours(t.dataset.unsure, state[t.dataset.unsure] === 'unsure' ? null : 'unsure');
  else if ('addCredits' in t.dataset) {
    const c = Number($main.querySelector('#credits-in').value);
    if (!(c > 0)) return;
    const q = pathCfg().quick;
    const current = typeof state.education === 'number' ? state.education : 0;
    setHours('education', current + c * q.semesterCreditClockHours);
    $main.querySelector('#credits-in').value = '';
    $main.querySelector('#credits-out').textContent = `Added ${c * q.semesterCreditClockHours} hours.`;
  }
});

// ------------------------------------------------------------------ boot
(async () => {
  try {
    const res = await fetch('/api/config');
    config = await res.json();
    load();
    if (state.path && state.path !== 'deciding' && !config.paths.some((x) => x.path === state.path && x.enabled)) state.path = null;
    render();
    if (state.path) requestEstimate(true);
  } catch (err) {
    $main.innerHTML = `<div class="card"><p>The estimator could not load. Please try again later.</p></div>`;
  }
})();
