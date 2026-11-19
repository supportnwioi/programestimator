const $ = document.getElementById('admin');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (n) => '$' + Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 });
const PATHS = { sex_therapist: 'Sex Therapist', sexuality_counselor: 'Sexuality Counselor', sexuality_educator: 'Sexuality Educator' };
const REQS = { core: 'Core knowledge', training: 'Skills training', supervision: 'Supervision', sar: 'SAR' };
let tab = 'pricing';
let data = {};
let editing = null; // ruleset id being edited

async function api(url, opts = {}) {
  const res = await fetch(url, { ...opts, headers: { 'content-type': 'application/json', ...(opts.headers || {}) } });
  const body = await res.json().catch(() => ({}));
  if (res.status === 401) { showLogin(); throw new Error('Sign in required'); }
  if (!res.ok) { const e = new Error(body.error || `Error ${res.status}`); e.details = body.details; throw e; }
  return body;
}

function showLogin(msg = '') {
  document.getElementById('logout').hidden = true;
  $.innerHTML = `<section class="card" style="max-width:420px;margin:40px auto"><h1>Admin sign in</h1>
    <form id="login"><div class="field"><label for="nm">Your name</label><input type="text" id="nm" name="name" autocomplete="name"></div>
    <div class="field"><label for="pw">Password</label><input type="password" id="pw" name="password" autocomplete="current-password" required></div>
    <p class="small" style="color:var(--danger)">${esc(msg)}</p><button class="primary" type="submit">Sign in</button></form></section>`;
}

async function loadAll() {
  const [settings, rulesets, estimates, shares] = await Promise.all([api('/api/admin/settings'), api('/api/admin/rulesets'), api('/api/admin/estimates'), api('/api/admin/shares')]);
  data = { settings, rulesets, estimates, shares };
}

function render() {
  document.getElementById('logout').hidden = false;
  const tabs = [['pricing', 'Pricing & links'], ['rulesets', 'Requirements rulesets'], ['shares', `Shared with admissions (${data.shares.length})`], ['estimates', `Estimates (${data.estimates.length})`]];
  $.innerHTML = `<div class="tabs" role="tablist">${tabs.map(([k, l]) => `<button role="tab" aria-selected="${tab === k}" data-tab="${k}">${l}</button>`).join('')}</div>` + ({ pricing, rulesets, shares, estimates }[tab])();
}

function pricing() {
  const s = data.settings;
  return `<section class="card"><h2>Pricing and links</h2>
  <p class="small muted">These settings are private. Students only see the final price range. Each estimate records the settings used. ${s.updatedAt ? `Last updated ${esc(s.updatedAt)} by ${esc(s.updatedBy)}.` : 'Sample proof-of-concept values — confirm before launch.'}</p>
  <form id="settings">
    <div class="grid2">
      <div class="field"><label for="er">Education rate per CE hour ($)</label><input type="number" min="0" step="0.01" id="er" name="educationRatePerCeHour" value="${s.educationRatePerCeHour}"></div>
      <div class="field"><label for="sr">Supervision rate per hour ($)</label><input type="number" min="0" step="0.01" id="sr" name="supervisionRatePerHour" value="${s.supervisionRatePerHour}"></div>
      <div class="field"><label for="sp">SAR price ($)</label><input type="number" min="0" step="0.01" id="sp" name="sarPrice" value="${s.sarPrice}"></div>
      <div class="field"><label for="bf">Price range buffer (± $)</label><input type="number" min="0" step="1" id="bf" name="priceRangeBuffer" value="${s.priceRangeBuffer}"></div>
    </div>
    <div class="field"><label for="su">Admissions scheduling URL</label><input type="url" id="su" name="schedulingUrl" value="${esc(s.schedulingUrl)}"></div>
    <div class="field"><label for="cu">Admissions contact link (https:// or mailto:)</label><input type="text" id="cu" name="contactUrl" value="${esc(s.contactUrl)}"></div>
    <h3>What NWIOI provides</h3>
    <p class="small muted">Requirements NWIOI does not provide for a path are shown to students as “may need to complete outside NWIOI” and left out of the price.</p>
    <table><thead><tr><th>Path</th>${Object.values(REQS).map((l) => `<th>${l}</th>`).join('')}</tr></thead><tbody>
    ${Object.entries(PATHS).map(([p, l]) => `<tr><td>${l}</td>${Object.keys(REQS).map((r) => `<td><input type="checkbox" aria-label="${l} ${REQS[r]}" data-offer="${p}.${r}" ${s.offerings[p][r] ? 'checked' : ''}></td>`).join('')}</tr>`).join('')}
    </tbody></table>
    <div class="row" style="margin-top:14px"><button class="primary" type="submit">Save settings</button><span id="saved" class="small muted"></span></div>
  </form></section>`;
}

function rulesets() {
  const { active, rulesets: all, lastCheck } = data.rulesets;
  const byPath = (p) => all.filter((r) => r.path === p).sort((a, b) => (b.createdAt || b.approvedAt || '').localeCompare(a.createdAt || a.approvedAt || ''));
  const edit = editing && all.find((r) => r.id === editing);
  return `<section class="card"><div class="between"><h2>Requirements rulesets</h2><button class="primary" data-act="check">Check AASECT for published changes</button></div>
    <p class="small muted">Each path uses one approved ruleset, verified against the official AASECT source. When a change is detected, create a draft, update it to match the published requirements, and approve it. Only approved rulesets affect new estimates; past estimates keep the version they used.</p>
    ${lastCheck?.checkedAt ? `<p class="small">Last check: ${esc(lastCheck.checkedAt)}</p>
    ${lastCheck.results.map((c) => `<div class="notice ${c.status === 'unchanged' ? 'ok' : c.status === 'changed' ? 'warn' : 'info'} small"><strong>${esc(PATHS[c.path])}</strong> — ${c.status === 'unchanged' ? `No change (published version ${esc(c.foundVersion)})` : c.status === 'changed' ? `Published page changed${c.versionChanged ? `: version ${esc(c.storedVersion)} → ${esc(c.foundVersion)}` : ' (same version label)'}` : `Could not check: ${esc(c.error)}`} · <a href="${esc(c.url)}" target="_blank" rel="noopener">source</a>
      ${c.status === 'changed' ? `<details><summary>Show changes</summary><div class="diff">${(c.diff || []).map((d) => `<div class="${d.op}">${d.op === 'added' ? '+ ' : d.op === 'removed' ? '− ' : ''}${esc(d.text)}</div>`).join('')}</div></details><button data-act="draft" data-path="${c.path}" style="margin-top:6px">Create draft from this change</button>` : ''}</div>`).join('')}` : '<p class="small muted">No checks run yet.</p>'}
  </section>
  ${Object.entries(PATHS).map(([p, label]) => { const act = all.find((r) => r.id === active[p]); return `<section class="card"><div class="between"><h3>${label}</h3>
      <label style="font-weight:400"><input type="checkbox" data-act="enable" data-path="${p}" ${act?.enabled ? 'checked' : ''}> Available to students</label></div>
      <table><thead><tr><th>Version</th><th>Status</th><th>Verified / approved</th><th>Sources</th><th></th></tr></thead><tbody>
      ${byPath(p).map((r) => `<tr><td>${esc(r.version)}${r.id === active[p] ? ' <span class="chip ok">active</span>' : ''}</td><td>${esc(r.status)}${r.validationErrors.length ? ` <span class="chip warn" title="${esc(r.validationErrors.join('\n'))}">${r.validationErrors.length} issue(s)</span>` : ''}</td>
        <td class="small">${esc(r.verifiedAt || '—')}${r.approvedBy ? `<br>${esc(r.approvedBy)}` : ''}</td>
        <td class="small">${r.sources.map((s) => `<a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.title)}</a><br>retrieved ${esc(s.retrievedAt)}`).join('<br>')}</td>
        <td><button class="link" data-act="edit" data-id="${esc(r.id)}">${r.status === 'draft' ? 'Edit / approve' : 'View'}</button></td></tr>`).join('')}
      </tbody></table>
      ${byPath(p).some((r) => r.status === 'draft') ? '' : `<button data-act="draft" data-path="${p}" style="margin-top:8px">Create draft</button>`}</section>`; }).join('')}
  ${edit ? `<section class="card" id="editor"><h2>${edit.status === 'draft' ? 'Edit draft' : 'View'} ruleset ${esc(edit.id)}</h2>
    ${edit.reviewNotes ? `<p class="small">${esc(edit.reviewNotes)}</p>` : ''}
    <textarea class="json" id="rs-json" ${edit.status === 'draft' ? '' : 'readonly'}>${esc(JSON.stringify((({ validationErrors, ...r }) => r)(edit), null, 2))}</textarea>
    <div id="rs-msg" class="small"></div>
    ${edit.status === 'draft' ? `<div class="row" style="margin-top:10px"><button data-act="save-draft" data-id="${esc(edit.id)}">Save draft</button>
      <label style="font-weight:400"><input type="checkbox" id="verified"> I verified this draft against the official AASECT source</label>
      <button class="primary" data-act="approve" data-id="${esc(edit.id)}">Approve for new estimates</button></div>` : ''}
    <button class="link" data-act="close-edit">Close</button></section>` : ''}`;
}

function shares() {
  if (!data.shares.length) return '<section class="card"><p>No students have shared an estimate yet.</p></section>';
  return data.shares.map((s) => {
    const est = data.estimates.find((e) => e.id === s.estimateId);
    return `<section class="card"><div class="between"><h3>${esc(s.contact.name)} · <a href="mailto:${esc(s.contact.email)}">${esc(s.contact.email)}</a></h3><span class="small muted">${esc(s.createdAt)}</span></div>
      <p class="small">${esc(PATHS[s.path])} · ruleset ${esc(s.rulesetVersion)} · estimate ${esc(s.estimateId)}${est ? ` · range ${esc(est.public.range.display)}` : ''}</p>
      ${s.message ? `<p>“${esc(s.message)}”</p>` : ''}
      <p class="small">Documents shared: ${s.consent.documents ? s.files.map((f) => `<a href="/api/admin/shares/${esc(s.id)}/files/${encodeURIComponent(f.name)}">${esc(f.name)}</a>`).join(', ') : 'No (student did not give permission)'}</p>
      ${s.documentSummaries.length ? `<details><summary>Document summaries</summary><ul class="small">${s.documentSummaries.map((d) => `<li><strong>${esc(d.fileName)}</strong> (${esc(d.documentType)}, ${esc(d.extractor)}): ${esc(d.summary)}</li>`).join('')}</ul></details>` : ''}
      <details><summary>Intake (${s.intake.entries.length} entries)</summary>
      <table><thead><tr><th>Entry</th><th>Source</th><th>Counted as</th></tr></thead><tbody>
      ${s.intake.entries.map((e) => `<tr><td>${esc(e.title || e.supervisorName)}<div class="small muted">${esc(e.kind)}${e.provider ? ` · ${esc(e.provider)}` : ''}${e.creditType ? ` · ${esc(e.creditType)}` : ''}${e.totalAmount ? ` · ${esc(e.totalAmount)} ${esc(e.totalUnit)}` : ''}${e.delivery ? ` · ${esc(e.delivery)}` : ''}</div></td>
        <td class="small">${e.source.type === 'document' ? `Document: ${esc(e.source.fileName)} (${esc(e.source.extractor)})${e.corrected ? '<br><strong>corrected by student</strong>' : ''}${e.source.excerpt ? `<br>“${esc(e.source.excerpt)}”` : ''}` : 'Manual entry'}</td>
        <td class="small">${e.kind === 'course' ? (e.allocations || []).map((a) => `${esc(a.requirement)} ${esc(a.area || '?')}: ${a.hours ?? 'unsure'} h (${esc(a.basis)}${a.suggestedBy ? `, suggested by ${esc(a.suggestedBy)}` : ''})`).join('<br>') : e.kind === 'supervision' ? `${e.individualHours} ind / ${e.groupHours} grp, qualifies: ${esc(e.qualifies)}` : `${e.hours ?? '?'} h, AASECT approved: ${esc(e.aasectApproved)}`}</td></tr>`).join('')}
      </tbody></table><pre class="small">${esc(JSON.stringify(s.intake.answers, null, 2))}</pre></details></section>`;
  }).join('');
}

function estimates() {
  if (!data.estimates.length) return '<section class="card"><p>No estimates yet.</p></section>';
  return `<section class="card"><h2>Recent estimates</h2><p class="small muted">Internal view, including itemized pricing. Never shown to students.</p>
  <table><thead><tr><th>When</th><th>Path / ruleset</th><th>Itemized (private)</th><th>Amount</th><th>Range shown</th><th>Pricing used</th></tr></thead><tbody>
  ${data.estimates.map((e) => `<tr><td class="small">${esc(e.createdAt)}<br>${esc(e.id)}</td><td class="small">${esc(PATHS[e.path])}<br>${esc(e.rulesetId)}</td>
    <td class="small">${e.price.lines.map((l) => `${esc(REQS[l.key] || l.key)}: ${l.kind === 'sar' ? money(l.price) : `${l.hours} h × ${money(l.rate)}`} = ${money(l.amount)}`).join('<br>') || '—'}${e.price.outsideNwioi.length ? `<br>Outside NWIOI: ${esc(e.price.outsideNwioi.join(', '))}` : ''}</td>
    <td>${money(e.price.amount)}</td><td>${esc(e.public.range.display)}</td>
    <td class="small">Edu ${money(e.pricing.educationRatePerCeHour)}/h · Sup ${money(e.pricing.supervisionRatePerHour)}/h · SAR ${money(e.pricing.sarPrice)} · ±${money(e.pricing.priceRangeBuffer)}</td></tr>`).join('')}
  </tbody></table></section>`;
}

async function refresh() { await loadAll(); render(); }

$.addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const f = ev.target;
  if (f.id === 'login') {
    try { await api('/api/admin/login', { method: 'POST', body: JSON.stringify({ name: f.name.value, password: f.password.value }) }); await refresh(); }
    catch (e) { if (e.message !== 'Sign in required') showLogin(e.message); else showLogin('Incorrect password'); }
  } else if (f.id === 'settings') {
    const body = Object.fromEntries(['educationRatePerCeHour', 'supervisionRatePerHour', 'sarPrice', 'priceRangeBuffer', 'schedulingUrl', 'contactUrl'].map((k) => [k, f[k].value]));
    body.offerings = {};
    f.querySelectorAll('[data-offer]').forEach((c) => { const [p, r] = c.dataset.offer.split('.'); (body.offerings[p] ??= {})[r] = c.checked; });
    data.settings = await api('/api/admin/settings', { method: 'PUT', body: JSON.stringify(body) });
    render();
    document.getElementById('saved').textContent = 'Saved.';
  }
});

$.addEventListener('click', async (ev) => {
  const t = ev.target.closest('[data-tab],[data-act]');
  if (!t) return;
  if (t.dataset.tab) { tab = t.dataset.tab; render(); return; }
  const act = t.dataset.act;
  const msg = (text, ok) => { const m = document.getElementById('rs-msg'); if (m) { m.style.color = ok ? 'var(--ok)' : 'var(--danger)'; m.innerHTML = text; } };
  try {
    if (act === 'check') { t.disabled = true; t.textContent = 'Checking…'; await api('/api/admin/rulesets/check', { method: 'POST' }); await refresh(); }
    else if (act === 'draft') { const d = await api(`/api/admin/rulesets/${t.dataset.path}/draft`, { method: 'POST' }); editing = d.id; await refresh(); document.getElementById('editor')?.scrollIntoView(); }
    else if (act === 'edit') { editing = t.dataset.id; render(); document.getElementById('editor')?.scrollIntoView(); }
    else if (act === 'close-edit') { editing = null; render(); }
    else if (act === 'save-draft' || act === 'approve') {
      let body;
      try { body = JSON.parse(document.getElementById('rs-json').value); } catch (e) { msg('Invalid JSON: ' + esc(e.message)); return; }
      const saved = await api(`/api/admin/rulesets/${encodeURIComponent(t.dataset.id)}`, { method: 'PUT', body: JSON.stringify(body) });
      if (act === 'save-draft') { await loadAll(); render(); msg(saved.errors.length ? 'Saved with issues:<br>' + saved.errors.map(esc).join('<br>') : 'Draft saved. No validation issues.', !saved.errors.length); return; }
      await api(`/api/admin/rulesets/${encodeURIComponent(t.dataset.id)}/approve`, { method: 'POST', body: JSON.stringify({ verifiedAgainstSource: document.getElementById('verified').checked }) });
      editing = null; await refresh();
    }
  } catch (e) { msg(esc(e.message) + (e.details ? '<br>' + e.details.map(esc).join('<br>') : '')); if (act === 'check') await refresh(); }
});

$.addEventListener('change', async (ev) => {
  const t = ev.target;
  if (t.dataset.act !== 'enable') return;
  try { await api(`/api/admin/paths/${t.dataset.path}/enabled`, { method: 'POST', body: JSON.stringify({ enabled: t.checked }) }); await refresh(); }
  catch (e) { alert(e.message); t.checked = !t.checked; }
});

document.getElementById('logout').addEventListener('click', async () => { await fetch('/api/admin/logout', { method: 'POST' }); showLogin(); });

(async () => { try { await api('/api/admin/session'); await refresh(); } catch { /* login shown */ } })();
