// Persists app state in localStorage. Single key, full JSON blob.
// Schema is small enough that migration is just versioning + best-effort fill.

const STORAGE_KEY = 'uom-wam-calculator/v1';
const SCHEMA_VERSION = 1;

// Standard UoM load: Sem 1/2 = 4 subjects (overload to 5 by petition);
// Summer/Winter = 2 subjects.
export const TERMS = [
  { key: 'summer', label: 'Summer Term', maxSubjects: 2, recommendedMax: 2, overloadMax: 2, season: 'summer' },
  { key: 'sem1',   label: 'Semester 1',  maxSubjects: 5, recommendedMax: 4, overloadMax: 5, season: 'autumn' },
  { key: 'winter', label: 'Winter',      maxSubjects: 2, recommendedMax: 2, overloadMax: 2, season: 'winter' },
  { key: 'sem2',   label: 'Semester 2',  maxSubjects: 5, recommendedMax: 4, overloadMax: 5, season: 'spring' },
];

export function termInfo(termKey) {
  return TERMS.find(t => t.key === termKey);
}

// Default empty state (post-setup).
export function defaultState() {
  return {
    schemaVersion: SCHEMA_VERSION,
    setup: {
      completed: false,
      startYear: null,
      startSemester: null,
      currentYear: null,
      currentTerm: null,
    },
    years: {}, // map of "2024" -> { sem1: { subjects: [] }, winter: {...}, ... }
    coursePlan: null,
    targetWAM: null,
    settings: {
      showWhatIf: true,
      theme: 'auto', // 'light' | 'dark' | 'auto'
      wamMode: 'simple', // 'simple' | 'official'
    },
  };
}

// Heuristic: roughly which UoM term is "current" given today's date.
// Sem 1: Mar-May, Winter: Jun-Jul, Sem 2: Aug-Oct, Summer: Nov-Feb.
export function guessCurrentTerm(now = new Date()) {
  const m = now.getMonth(); // 0 = Jan
  if (m === 11 || m <= 1) return 'summer';
  if (m >= 2 && m <= 4) return 'sem1';
  if (m >= 5 && m <= 6) return 'winter';
  return 'sem2';
}

export function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultState();
    const parsed = JSON.parse(raw);
    return migrate(parsed);
  } catch (e) {
    console.warn('Failed to load state, using defaults', e);
    return defaultState();
  }
}

export function saveState(state) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (e) {
    console.error('Failed to save state', e);
  }
}

export function clearState() {
  localStorage.removeItem(STORAGE_KEY);
}

function migrate(state) {
  // Best-effort migration. For v1 we just fill missing keys.
  const def = defaultState();
  return {
    ...def,
    ...state,
    setup: { ...def.setup, ...(state.setup || {}) },
    years: state.years || {},
    coursePlan: state.coursePlan || null,
    settings: { ...def.settings, ...(state.settings || {}) },
  };
}

// Build the ordered list of (year, term) chunks for a student's degree, starting
// from their start year/semester. Generates `lookaheadYears` of timeline.
export function buildTimeline(startYear, startSemester, lookaheadYears = 6) {
  const chunks = [];
  if (!startYear) return chunks;
  // My Course Planner treats Summer Term as the first teaching period of the calendar year.
  for (let i = 0; i < lookaheadYears; i++) {
    const year = startYear + i;
    if (i > 0) chunks.push({ year, term: 'summer' });
    const includeSem1 = !(i === 0 && startSemester === 2);
    if (includeSem1) {
      chunks.push({ year, term: 'sem1' });
      chunks.push({ year, term: 'winter' });
    }
    chunks.push({ year, term: 'sem2' });
  }
  return chunks;
}

// Get/set helpers for the year/term tree, creating nodes as needed.
export function getTerm(state, year, termKey) {
  const yk = String(year);
  if (!state.years[yk]) state.years[yk] = {};
  if (!state.years[yk][termKey]) state.years[yk][termKey] = { subjects: [] };
  return state.years[yk][termKey];
}

// Flatten all subjects across the timeline into a single list, with metadata.
export function allSubjects(state) {
  const out = [];
  for (const yk of Object.keys(state.years || {})) {
    const year = state.years[yk] || {};
    for (const tk of Object.keys(year)) {
      const term = year[tk] || {};
      for (const s of (term.subjects || [])) {
        out.push({ subject: s, year: Number(yk), term: tk });
      }
    }
  }
  return out;
}

// Crypto-strength uuid-ish id, fallback to time+rand for older browsers.
export function newId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 9);
}

export function newSubject(name = 'New subject') {
  return {
    id: newId(),
    name,
    code: '',
    category: '',
    level: null,
    points: 12.5,
    gradingMode: 'graded',
    finalScore: null,
    passFailStatus: null,
    completed: false,
    assessments: [],
    notes: '',
  };
}

export function newAssessment(name = 'Assessment') {
  return {
    id: newId(),
    name,
    weight: null, // empty placeholder; user fills in
    score: null,
    predicted: null,
    dueDate: null,
  };
}

export function exportJSON(state) {
  return JSON.stringify(state, null, 2);
}

// Import a previously exported JSON blob. Throws on invalid input.
export function importJSON(text) {
  const parsed = JSON.parse(text);
  if (typeof parsed !== 'object' || parsed === null) throw new Error('Invalid file');
  if (!parsed.setup || !parsed.years) throw new Error('Missing setup or years');
  return migrate(parsed);
}
