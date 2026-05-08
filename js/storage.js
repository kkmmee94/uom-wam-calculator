// Persists app state in localStorage. Single key, full JSON blob.
// Schema is small enough that migration is just versioning + best-effort fill.

const STORAGE_KEY = 'uom-wam-calculator/v1';
const SCHEMA_VERSION = 1;

export const TERMS = [
  { key: 'sem1',   label: 'Semester 1', maxSubjects: 4, season: 'autumn' },
  { key: 'winter', label: 'Winter',     maxSubjects: 2, season: 'winter' },
  { key: 'sem2',   label: 'Semester 2', maxSubjects: 4, season: 'spring' },
  { key: 'summer', label: 'Summer',     maxSubjects: 2, season: 'summer' },
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
    },
    years: {}, // map of "2024" -> { sem1: { subjects: [] }, winter: {...}, ... }
    targetWAM: null,
    settings: {
      showWhatIf: true,
    },
  };
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
    settings: { ...def.settings, ...(state.settings || {}) },
  };
}

// Build the ordered list of (year, term) chunks for a student's degree, starting
// from their start year/semester. Generates `lookaheadYears` of timeline.
export function buildTimeline(startYear, startSemester, lookaheadYears = 6) {
  const chunks = [];
  if (!startYear) return chunks;
  // If the student started in semester 2, they don't have a sem1 in their first year.
  // Order within a year is sem1 -> winter -> sem2 -> summer.
  for (let i = 0; i < lookaheadYears; i++) {
    const year = startYear + i;
    const includeSem1 = !(i === 0 && startSemester === 2);
    if (includeSem1) {
      chunks.push({ year, term: 'sem1' });
      chunks.push({ year, term: 'winter' });
    }
    chunks.push({ year, term: 'sem2' });
    chunks.push({ year, term: 'summer' });
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
    completed: false,
    assessments: [],
    notes: '',
  };
}

export function newAssessment(name = 'Assessment') {
  return {
    id: newId(),
    name,
    weight: 0,
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
