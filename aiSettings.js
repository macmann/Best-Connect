const { init, getDatabase } = require('./db');

const AI_MODEL_OPTIONS = [
  { value: 'gpt-5', label: 'GPT5' },
  { value: 'gpt-5.1-mini', label: 'GPT5.1 mini' },
  { value: 'gpt-5.1-nano', label: 'GPT5.1nano' }
];

const DEFAULT_AI_SETTINGS = {
  model: 'gpt-5.1-mini',
  questionPrompt: `You are an HR expert. Generate a list of 5-8 thoughtful written interview questions for a candidate applying for the following position.

Return ONLY a valid JSON array of objects with fields:
- "id": a short identifier like "q1", "q2", ...
- "text": the question text

The questions should:
- Be open-ended
- Reveal experience, thinking process, and communication
- Be suitable for a written interview (text answers)`,
  screeningPrompt: `You are an HR assistant helping a recruiter evaluate candidates.

Analyze the following candidate CV text against the job description.

Return a JSON object with EXACTLY these fields and nothing else:

{
  "summary": string,                 // 3-5 sentence summary of candidate profile
  "fitScore": number,               // from 0 to 100, how well the candidate fits the JD
  "strengths": string[],            // 3-6 bullet points
  "risks": string[],                // 2-5 bullet points, gaps or concerns
  "recommendation": string          // one of: "Strong Fit", "Good Fit", "Borderline", "Not Recommended"
}

Rules:
- Output MUST be valid JSON.
- Do NOT include any markdown, backticks, or explanations.
- Do NOT include comments.
- Do NOT include trailing commas.
- If something is unclear, mention it briefly in "risks", but do not invent fake experience.`
};

const AI_SETTINGS_CACHE_MS = 60 * 1000;
let aiSettingsCache = { value: null, loadedAt: 0 };

function normalizeAiSettings(raw = {}) {
  const allowedValues = new Set(AI_MODEL_OPTIONS.map(option => option.value));
  const model = allowedValues.has(raw.model) ? raw.model : DEFAULT_AI_SETTINGS.model;
  const questionPrompt = typeof raw.questionPrompt === 'string' && raw.questionPrompt.trim()
    ? raw.questionPrompt.trim()
    : DEFAULT_AI_SETTINGS.questionPrompt;
  const screeningPrompt = typeof raw.screeningPrompt === 'string' && raw.screeningPrompt.trim()
    ? raw.screeningPrompt.trim()
    : DEFAULT_AI_SETTINGS.screeningPrompt;

  return { model, questionPrompt, screeningPrompt };
}

function getAiModelOptions() {
  return [...AI_MODEL_OPTIONS];
}

async function loadAiSettings({ force = false } = {}) {
  const now = Date.now();
  if (!force && aiSettingsCache.value && now - aiSettingsCache.loadedAt < AI_SETTINGS_CACHE_MS) {
    return aiSettingsCache.value;
  }

  await init();
  const db = getDatabase();
  const doc = await db.collection('settings').findOne({ _id: 'ai' });
  const normalized = normalizeAiSettings(doc || {});
  aiSettingsCache = { value: normalized, loadedAt: now };
  return normalized;
}

async function saveAiSettings(settings) {
  await init();
  const db = getDatabase();
  const normalized = normalizeAiSettings(settings);

  await db.collection('settings').updateOne(
    { _id: 'ai' },
    { $set: normalized },
    { upsert: true }
  );

  aiSettingsCache = { value: normalized, loadedAt: Date.now() };
  return normalized;
}

module.exports = {
  DEFAULT_AI_SETTINGS,
  getAiModelOptions,
  loadAiSettings,
  saveAiSettings
};
