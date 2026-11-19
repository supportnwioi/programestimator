// Document review: summarize uploads, extract course details and explicitly
// stated hours, and suggest where items may count. Uses Claude when an API key is
// configured; otherwise a clearly labeled offline demo extractor (keyword-based).
// Extraction output is only a suggestion: the student reviews every item and the
// rules engine (src/engine.js) does all counting.
import crypto from 'node:crypto';
import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod/v4';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';

const MODEL = process.env.NWIOI_AI_MODEL || 'claude-opus-5-5';
export const aiAvailable = () => Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);

// ---------- text extraction (used for the offline extractor and text uploads) ----------
export async function documentText(buf, mime, name) {
  const lower = name.toLowerCase();
  if (mime === 'application/pdf' || lower.endsWith('.pdf')) {
    const { default: pdfParse } = await import('pdf-parse/lib/pdf-parse.js');
    return (await pdfParse(buf)).text;
  }
  if (lower.endsWith('.docx')) {
    const mammoth = await import('mammoth');
    return (await mammoth.extractRawText({ buffer: buf })).value;
  }
  if (mime?.startsWith('text/') || /\.(txt|md|csv)$/.test(lower)) return buf.toString('utf8');
  return null;
}

// ---------- schema shared by the AI path and the offline extractor ----------
const Topic = z.object({
  requirement: z.enum(['core', 'training', 'none']).describe('core = general human sexuality knowledge (Core Knowledge Areas); training = skills training for the selected path; none = not relevant'),
  area: z.string().nullable().describe('Area/content-area letter from the provided list, or null if unclear'),
  topic: z.string().describe('Topic as named in the document'),
  hours: z.number().nullable().describe('Instructional hours for THIS topic only if the document explicitly states them; otherwise null. Never estimate.'),
  hours_explicit: z.boolean().describe('true only when the hours for this topic are written in the document'),
  evidence: z.string().describe('Short quote from the document supporting the topic/hours'),
  sexuality_specific: z.boolean().describe('Skills training that is specific to sexuality (vs general counseling/education)'),
  couples_counseling: z.boolean().describe('Topic is couples counseling / relationship therapy training'),
});
const Item = z.object({
  kind: z.enum(['course', 'supervision', 'sar']),
  title: z.string(),
  course_code: z.string().nullable(),
  provider: z.string().nullable(),
  date: z.string().nullable(),
  credit_type: z.enum(['academic', 'aasect_ce', 'non_aasect_ce', 'other', 'unsure']),
  total_amount: z.number().nullable().describe('Total credits or hours for the whole course as stated'),
  total_unit: z.enum(['semester_credits', 'quarter_credits', 'clock_hours', 'ce_hours', 'unsure']),
  delivery: z.enum(['synchronous', 'asynchronous', 'unsure']),
  topics: z.array(Topic),
  supervision_individual_hours: z.number().nullable(),
  supervision_group_hours: z.number().nullable(),
  supervisor_name: z.string().nullable(),
  supervisor_aasect_certified_with_contract: z.enum(['yes', 'no', 'unsure']),
  sar_hours: z.number().nullable(),
  sar_aasect_approved: z.enum(['yes', 'no', 'unsure']),
  evidence: z.string(),
});
const Extraction = z.object({
  document_type: z.enum(['transcript', 'syllabus', 'ce_certificate', 'sar_certificate', 'supervision_log', 'other']),
  summary: z.string().describe('2–3 sentence plain-language summary for the student'),
  items: z.array(Item),
});

function systemPrompt(ruleset) {
  const reqs = ruleset.requirements.filter((r) => r.kind === 'hours').map((r) =>
    `${r.key.toUpperCase()} — ${r.longLabel}:\n` + r.areas.map((a) => `  ${a.key}. ${a.label}`).join('\n')).join('\n\n');
  return `You review documents a prospective student uploaded to estimate progress toward ${ruleset.credential} certification.
Extract each course, CE training, supervision record or SAR in the document. For courses, list the topics it covers and map each topic to one requirement and area letter below.

${reqs}

Rules:
- Report hours for a topic ONLY when the document explicitly states them for that topic; otherwise set hours to null and hours_explicit to false. Do not split a course total across topics.
- Keep the whole-course total (credits or hours) in total_amount/total_unit, separate from topic hours.
- credit_type: academic (accredited college/university course), aasect_ce (AASECT sponsored/approved CE), non_aasect_ce (CE from another body, e.g., APA, NBCC, NASW), other, or unsure.
- Use "unsure" whenever the document does not say. Quote short evidence. Do not invent details.`;
}

async function extractWithClaude(buf, mime, name, ruleset) {
  const client = new Anthropic();
  const content = [];
  if (mime === 'application/pdf') content.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: buf.toString('base64') } });
  else if (/^image\/(png|jpeg|gif|webp)$/.test(mime)) content.push({ type: 'image', source: { type: 'base64', media_type: mime, data: buf.toString('base64') } });
  else {
    const text = await documentText(buf, mime, name);
    if (!text) throw new Error('Unsupported file type');
    content.push({ type: 'text', text: `<document name="${name}">\n${text}\n</document>` });
  }
  content.push({ type: 'text', text: `File name: ${name}. Extract the items as instructed.` });
  const response = await client.beta.messages.parse({
    model: MODEL,
    max_tokens: 16000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort: 'medium', format: betaZodOutputFormat(Extraction) },
    system: systemPrompt(ruleset),
    messages: [{ role: 'user', content }],
  });
  if (response.stop_reason === 'refusal' || !response.parsed_output) throw new Error('The document could not be reviewed automatically.');
  return { extraction: response.parsed_output, extractor: { type: 'ai', model: response.model } };
}

// ---------- offline demo extractor ----------
const KEYWORDS = {
  core: {
    A: ['ethic'], B: ['development', 'lifespan', 'life course', 'childhood', 'adolescen', 'aging'], C: ['culture', 'cultural', 'religio', 'spiritual', 'socioeconomic', 'family values'],
    D: ['orientation', 'gender identity', 'lgbt', 'queer', 'transgender', 'bisexual', 'asexual'], E: ['intimacy', 'interpersonal', 'family dynamics'],
    F: ['polyam', 'non-monogam', 'nonmonogam', 'kink', 'bdsm', 'swinging', 'diversit'], G: ['anatomy', 'physiology'],
    H: ['medical', 'illness', 'disability', 'pregnan', 'contracept', 'fertility', 'hiv', 'sti', 'infection'], I: ['sexual function', 'dysfunction', 'desire', 'arousal', 'orgasm', 'sexual pain'],
    J: ['exploitation', 'abuse', 'harassment', 'assault', 'trauma'], K: ['technology', 'social media', 'online', 'generative ai', 'pornograph'], L: ['substance', 'alcohol', 'drug use'],
    M: ['pleasure'], N: ['learning theory'], O: ['professional communication', 'personal reflection'], P: ['history'], Q: ['research', 'methods'],
  },
  training: {
    sex_therapist: { A: ['sex therapy model', 'psychotherapy', 'sensate focus', 'treatment model'], B: ['assessment', 'diagnosis', 'dsm'], C: ['couples', 'relationship system', 'relational'], D: ['medical intervention', 'pharmacolog'], E: ['consultation', 'referral', 'collaboration'], F: ['ethical decision', 'best practice'] },
    sexuality_counselor: { A: ['individual counseling', 'counseling theory'], B: ['specific population', 'youth', 'older adult'], C: ['relationship system', 'couples'], D: ['medical intervention'], E: ['ethical issues', 'ethics in'], F: ['consultation', 'referral'] },
    sexuality_educator: { A: ['general education', 'pedagogy'], B: ['curriculum', 'sexuality education method'], C: ['ethical issues', 'ethics in'], D: ['specific population'], E: ['delivery', 'small group', 'large group', 'facilitation'] },
  },
};

function matchArea(text, map) {
  const t = text.toLowerCase();
  for (const [area, words] of Object.entries(map)) if (words.some((w) => t.includes(w))) return area;
  return null;
}

const num = (s) => (s === undefined || s === null ? null : Number(s));
const HOURS_RE = /(\d+(?:\.\d+)?)\s*(?:clock\s*)?(?:hours?|hrs?)\b/i;

function offlineExtract(text, name, ruleset) {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const lowerAll = text.toLowerCase();
  const docType = /sexual attitude reassessment|\bsar\b/.test(lowerAll) ? 'sar_certificate'
    : /supervision (log|record|hours)/.test(lowerAll) ? 'supervision_log'
      : /syllabus|course schedule|weekly schedule|week \d/.test(lowerAll) ? 'syllabus'
        : /transcript/.test(lowerAll) ? 'transcript'
          : /certificate|continuing education|ce credit|ce hours/.test(lowerAll) ? 'ce_certificate' : 'other';
  const creditType = /aasect[- ](approved|sponsored|ce)/i.test(text) ? 'aasect_ce'
    : /\b(apa|nbcc|nasw|nchec|accme|ceu)\b/i.test(text) ? 'non_aasect_ce'
      : /(university|college)/i.test(text) && /(credit|semester)/i.test(text) ? 'academic' : 'unsure';
  const delivery = /\b(live|in[- ]person|synchronous|zoom|real[- ]time)\b/i.test(text) && !/asynchronous|self[- ]paced|recorded/i.test(text) ? 'synchronous'
    : /asynchronous|self[- ]paced|recorded|on[- ]demand/i.test(text) ? 'asynchronous' : 'unsure';
  const provider = lines.find((l) => /(university|college|institute|center|academy)/i.test(l) && l.length < 90) ?? null;
  const date = text.match(/\b(?:(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.? \d{1,2},? \d{4}|(?:Spring|Summer|Fall|Winter) \d{4}|\d{1,2}\/\d{1,2}\/\d{4})\b/)?.[0] ?? null;
  const items = [];
  const evidenceFor = (re) => lines.find((l) => re.test(l)) ?? '';

  if (docType === 'sar_certificate') {
    const h = text.match(/(\d+(?:\.\d+)?)\s*(?:clock\s*)?(?:hours?|hrs?)/i);
    items.push({ kind: 'sar', title: lines.find((l) => /reassessment|sar/i.test(l)) ?? 'Sexual Attitude Reassessment', course_code: null, provider, date,
      credit_type: creditType, total_amount: num(h?.[1]), total_unit: 'clock_hours', delivery, topics: [],
      supervision_individual_hours: null, supervision_group_hours: null, supervisor_name: null, supervisor_aasect_certified_with_contract: 'unsure',
      sar_hours: num(h?.[1]), sar_aasect_approved: /aasect[- ](approved|sponsored)/i.test(text) ? 'yes' : 'unsure', evidence: evidenceFor(/hours?/i) });
  } else if (docType === 'supervision_log') {
    const ind = text.match(/individual[^\d\n]*(\d+(?:\.\d+)?)/i), grp = text.match(/group[^\d\n]*(\d+(?:\.\d+)?)/i);
    const sup = text.match(/supervisor:?\s*([^\n,]+)/i)?.[1]?.trim() ?? null;
    items.push({ kind: 'supervision', title: 'Supervision record', course_code: null, provider, date, credit_type: 'other', total_amount: null, total_unit: 'unsure',
      delivery: 'unsure', topics: [], supervision_individual_hours: num(ind?.[1]), supervision_group_hours: num(grp?.[1]), supervisor_name: sup,
      supervisor_aasect_certified_with_contract: /aasect certified/i.test(text) && /contract/i.test(text) ? 'yes' : 'unsure', sar_hours: null, sar_aasect_approved: 'unsure', evidence: evidenceFor(/individual|group/i) });
  } else if (docType === 'transcript') {
    // Rows like "HSX 610  Human Sexual Anatomy and Health  3.0  A"
    for (const l of lines) {
      const m = l.match(/^([A-Z]{2,5}\s?\d{3,4}[A-Z]?)\s+(.+?)\s+(\d+(?:\.\d+)?)\s*(?:cr|credits?)?\s*(?:[A-F][+-]?|P|CR)?$/);
      if (!m) continue;
      const title = m[2].trim();
      const coreArea = matchArea(title, KEYWORDS.core);
      const trArea = matchArea(title, KEYWORDS.training[ruleset.path]);
      const topics = [];
      if (trArea && /therapy|counsel|education method|curriculum|pedagog/i.test(title)) topics.push({ requirement: 'training', area: trArea, topic: title, hours: null, hours_explicit: false, evidence: l, sexuality_specific: /sex/i.test(title), couples_counseling: /couple/i.test(title) });
      else if (coreArea || /sex/i.test(title)) topics.push({ requirement: 'core', area: coreArea, topic: title, hours: null, hours_explicit: false, evidence: l, sexuality_specific: true, couples_counseling: false });
      if (!topics.length) continue;
      items.push({ kind: 'course', title, course_code: m[1], provider, date, credit_type: 'academic', total_amount: Number(m[3]), total_unit: /quarter/i.test(text) ? 'quarter_credits' : 'semester_credits',
        delivery: 'unsure', topics, supervision_individual_hours: null, supervision_group_hours: null, supervisor_name: null,
        supervisor_aasect_certified_with_contract: 'unsure', sar_hours: null, sar_aasect_approved: 'unsure', evidence: l });
    }
  } else {
    // Syllabus or CE certificate: one course with topics from schedule lines.
    const title = lines.find((l) => /^(course( title)?|title|program|workshop)\s*[:\-]/i.test(l))?.replace(/^[^:\-]+[:\-]\s*/, '')
      ?? lines.find((l) => l.length > 8 && l.length < 100 && !/syllabus|certificate of/i.test(l)) ?? name;
    const code = title.match(/\b[A-Z]{2,5}\s?\d{3,4}\b/)?.[0] ?? text.match(/\b[A-Z]{2,5}\s?\d{3,4}\b/)?.[0] ?? null;
    const credits = text.match(/(\d+(?:\.\d+)?)\s*(?:semester\s*)?credits?\b(?!\s*hours?)/i);
    const totalH = text.match(/(?:total|awarded|earned|for|credit hours?:?)\D{0,20}(\d+(?:\.\d+)?)\s*(?:ce\s*|clock\s*|contact\s*)?(?:hours?|hrs?)/i);
    const topics = [];
    const isTraining = /therapy techniques|skills training|sex therapy training|counseling skills|education skills|intervention/i.test(text);
    for (const l of lines) {
      if (!/^(week|session|module|unit|day|topic|part)\b|^\d+[.)]|^[-•*]/i.test(l)) continue;
      const body = l.replace(/^(week|session|module|unit|day|topic|part)\s*\d*\s*[:.\-–]?\s*|^\d+[.)]\s*|^[-•*]\s*/i, '');
      const trArea = matchArea(body, KEYWORDS.training[ruleset.path]);
      const coreArea = matchArea(body, KEYWORDS.core);
      const requirement = isTraining && trArea ? 'training' : coreArea ? 'core' : trArea ? 'training' : null;
      if (!requirement) continue;
      const h = body.match(HOURS_RE);
      topics.push({ requirement, area: requirement === 'core' ? coreArea : trArea, topic: body.replace(HOURS_RE, '').replace(/[(\[]\s*[)\]]|[-–—:,]\s*$/g, '').trim(),
        hours: h ? Number(h[1]) : null, hours_explicit: Boolean(h), evidence: l, sexuality_specific: /sex/i.test(body) || !/general/i.test(body), couples_counseling: /couple/i.test(body) });
    }
    if (topics.length || docType === 'ce_certificate') {
      items.push({ kind: 'course', title: title.trim(), course_code: code, provider, date, credit_type: creditType,
        total_amount: credits && !totalH ? Number(credits[1]) : totalH ? Number(totalH[1]) : null,
        total_unit: credits && !totalH ? (/quarter/i.test(text) ? 'quarter_credits' : 'semester_credits') : totalH ? (/ce/i.test(totalH[0]) ? 'ce_hours' : 'clock_hours') : 'unsure',
        delivery, topics, supervision_individual_hours: null, supervision_group_hours: null, supervisor_name: null,
        supervisor_aasect_certified_with_contract: 'unsure', sar_hours: null, sar_aasect_approved: 'unsure', evidence: totalH?.[0] ?? credits?.[0] ?? '' });
    }
  }
  const summary = items.length
    ? `This looks like a ${docType.replace('_', ' ')}. Found ${items.length} item${items.length > 1 ? 's' : ''}: ${items.slice(0, 4).map((i) => i.title).join('; ')}${items.length > 4 ? '…' : ''}.`
    : 'No courses, supervision or SAR records were recognized in this document. You can add the details manually.';
  return { document_type: docType, summary, items };
}

// ---------- map extraction into intake entries ----------
const id = () => crypto.randomUUID().slice(0, 8);

export function toEntries(extraction, file, ruleset, extractor) {
  const hoursReqs = Object.fromEntries(ruleset.requirements.filter((r) => r.kind === 'hours').map((r) => [r.key, r]));
  const source = (item) => ({ type: 'document', docId: file.docId, fileName: file.name, documentType: extraction.document_type, excerpt: item.evidence?.slice(0, 300) ?? '', extractor: extractor.type, model: extractor.model ?? null, extractedAt: new Date().toISOString() });
  return extraction.items.map((item) => {
    if (item.kind === 'supervision') return { id: id(), kind: 'supervision', title: item.title, supervisorName: item.supervisor_name ?? '', individualHours: item.supervision_individual_hours ?? 0, groupHours: item.supervision_group_hours ?? 0, qualifies: item.supervisor_aasect_certified_with_contract, source: source(item), corrected: false };
    if (item.kind === 'sar') return { id: id(), kind: 'sar', title: item.title, provider: item.provider ?? '', date: item.date ?? '', hours: item.sar_hours ?? null, aasectApproved: item.sar_aasect_approved, source: source(item), corrected: false };
    const allocations = item.topics.filter((t) => t.requirement !== 'none').map((t) => {
      const req = hoursReqs[t.requirement];
      const area = req?.areas.some((a) => a.key === t.area) ? t.area : null;
      const explicit = t.hours_explicit && Number(t.hours) > 0;
      return {
        id: id(), requirement: t.requirement, area, topic: t.topic, suggestedBy: extractor.type, evidence: t.evidence?.slice(0, 200) ?? '',
        hours: explicit ? Number(t.hours) : null,
        basis: explicit ? 'stated' : 'needs_answer',
        followUp: explicit ? null : `About how many hours of instruction in this course were spent on “${t.topic}”?`,
        sexualitySpecific: t.sexuality_specific, couples: t.couples_counseling,
      };
    });
    return {
      id: id(), kind: 'course', title: item.title, courseCode: item.course_code ?? '', provider: item.provider ?? '', date: item.date ?? '',
      creditType: item.credit_type, totalAmount: item.total_amount, totalUnit: item.total_unit, delivery: item.delivery,
      allocations, source: source(item), corrected: false,
    };
  });
}

export async function reviewDocument(buf, mime, name, ruleset) {
  const file = { docId: id(), name };
  let result;
  if (aiAvailable()) {
    result = await extractWithClaude(buf, mime, name, ruleset);
  } else {
    const text = await documentText(buf, mime, name);
    if (!text) throw new Error('This file type needs AI review, which is not configured. Upload a PDF, Word (.docx) or text file, or enter the details manually.');
    result = { extraction: offlineExtract(text, name, ruleset), extractor: { type: 'offline-demo' } };
  }
  return { docId: file.docId, fileName: name, documentType: result.extraction.document_type, summary: result.extraction.summary, extractor: result.extractor, entries: toEntries(result.extraction, file, ruleset, result.extractor) };
}

export { offlineExtract, Extraction };
