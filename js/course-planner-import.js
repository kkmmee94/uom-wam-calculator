// Course Planner import. Three input paths, in priority order:
//   1) URL (link to course-planner.unimelb.edu.au) — looks up curated registry.
//   2) Bookmarklet payload — the user clicks our bookmarklet on the live
//      Course Planner page; it extracts the plan from their session and opens
//      our app with the data in a URL fragment.
//   3) Pasted JSON — anything matching the same shape.

import { getTerm, newSubject } from './storage.js';
import { KNOWN_PLANS, PASS_FAIL_SUBJECT_CODES } from '../plans/known-plans.js';

export const SCHEMA_VERSION = 1;

// UoM Course Planner study-period names → our internal term keys.
export const STUDY_PERIOD_TO_TERM = {
  'Summer Term': 'summer',
  'Semester 1':  'sem1',
  'Winter Term': 'winter',
  'Semester 2':  'sem2',
};

// Plan IDs in real share-links: lowercase hex, 20–40 chars.
const PLAN_ID_RE = /\/plan\/([a-f0-9]{20,40})/i;
const RAW_ID_RE  = /^([a-f0-9]{20,40})$/i;

export function extractCoursePlanId(input) {
  const text = String(input || '').trim();
  const match = text.match(PLAN_ID_RE) || text.match(RAW_ID_RE);
  return match ? match[1].toLowerCase() : '';
}

export function getKnownCoursePlan(input) {
  const id = extractCoursePlanId(input);
  return id ? KNOWN_PLANS[id] || null : null;
}

// Parse a payload (from bookmarklet or pasted JSON). Accepts plain JSON or
// base64-encoded JSON. Returns null on failure.
export function parsePayload(text) {
  if (!text) return null;
  const tryJson = (s) => {
    try { return JSON.parse(s); } catch { return null; }
  };
  let obj = tryJson(text);
  if (!obj) {
    // Try base64 (with or without padding)
    try { obj = tryJson(atob(text.trim())); } catch {}
  }
  if (!obj || typeof obj !== 'object') return null;
  if (!Array.isArray(obj.subjects)) return null;
  return normalizePlan(obj);
}

// Smart-paste: try JSON first, then fall back to free-form pasted text
// (e.g. ⌘A/⌘C from a UoM Course Planner page).
export function parseAnyImport(text) {
  if (!text || typeof text !== 'string') return null;
  return parsePayload(text) || parsePastedText(text);
}

// Parse ⌘A/⌘C output of the UoM Course Planner SPA. Heuristics:
//   - Year markers are bare 4-digit lines (e.g. "2025").
//   - A term *header* is a line equal to "Semester 1/2", "Summer Term", or
//     "Winter Term" with a trailing whitespace, OR the next term line after a
//     year marker / "ADD A SUBJECT" placeholder. Term names without trailing
//     whitespace inside a subject block are the subject's "also available in"
//     listings — we ignore those.
//   - A subject's metadata line is "<CODE> | Level <n> | <points> points".
//   - The category (DISCIPLINE / BREADTH / COMPULSORY / DATA SCIENCE, MAJOR /
//     etc.) sits on its own uppercase line just above the metadata line.
//   - The subject's display name is the first non-blank, non-pattern line
//     after the metadata line.
const TERM_NAME_TO_KEY = {
  'Semester 1': 'sem1',
  'Semester 2': 'sem2',
  'Summer Term': 'summer',
  'Winter Term': 'winter',
};
const SUBJECT_META_RE = /^([A-Z]{4}\d{5})\s*\|\s*Level\s*(\d+)\s*\|\s*([\d.]+)\s*points\s*$/i;
const YEAR_LINE_RE = /^(20\d{2})$/;
const ADD_PLACEHOLDER_RE = /^(?:add a subject|search)$/i;
const CATEGORY_LINE_RE = /^[A-Z][A-Z, &/-]{1,60}$/;
const PASS_FAIL_TEXT_RE = /\b(?:pass\/?fail|p\/?np|ungraded)\b/i;

export function parsePastedText(text) {
  if (!text) return null;
  const rawLines = text.split(/\r?\n/);

  let year = null;
  let term = null;
  let needTerm = true;          // next term line should be a header
  let pendingSubject = null;
  let pendingCategory = null;
  const subjects = [];

  function isTermLine(raw) {
    const t = raw.replace(/\s+$/, ''); // rtrim only
    return Object.prototype.hasOwnProperty.call(TERM_NAME_TO_KEY, t);
  }
  function termHasTrailingSpace(raw) {
    return /\s+$/.test(raw) && !raw.endsWith('\n');
  }

  for (let i = 0; i < rawLines.length; i++) {
    const raw = rawLines[i];
    const trimmed = raw.trim();
    if (!trimmed) continue;

    if (YEAR_LINE_RE.test(trimmed)) {
      year = parseInt(trimmed, 10);
      needTerm = true;
      pendingSubject = null;
      pendingCategory = null;
      continue;
    }

    if (ADD_PLACEHOLDER_RE.test(trimmed)) {
      needTerm = true;
      pendingSubject = null;
      pendingCategory = null;
      continue;
    }

    if (isTermLine(raw)) {
      const trailing = termHasTrailingSpace(raw);
      if (trailing || needTerm) {
        term = TERM_NAME_TO_KEY[trimmed];
        needTerm = false;
      }
      // otherwise it's an "also-offered-in" listing inside a subject block — ignore.
      pendingSubject = null;
      continue;
    }

    const subjMatch = trimmed.match(SUBJECT_META_RE);
    if (subjMatch) {
      pendingSubject = {
        code: subjMatch[1].toUpperCase(),
        level: parseInt(subjMatch[2], 10),
        points: parseFloat(subjMatch[3]),
        category: pendingCategory || '',
      };
      pendingCategory = null;
      continue;
    }

    if (CATEGORY_LINE_RE.test(trimmed) && trimmed !== trimmed.toLowerCase()) {
      pendingCategory = trimmed;
      continue;
    }

    if (pendingSubject && !pendingSubject.name) {
      pendingSubject.name = trimmed;
      const isPF = PASS_FAIL_SUBJECT_CODES.has(pendingSubject.code) ||
                   PASS_FAIL_TEXT_RE.test(trimmed) ||
                   PASS_FAIL_TEXT_RE.test(pendingSubject.category || '');
      if (year != null && term != null) {
        subjects.push({
          year, term,
          code: pendingSubject.code,
          name: pendingSubject.name,
          level: pendingSubject.level,
          points: pendingSubject.points,
          category: titleCaseCategory(pendingSubject.category || ''),
          gradingMode: isPF ? 'passFail' : 'graded',
        });
      }
      pendingSubject = null;
    }
  }

  if (subjects.length === 0) return null;

  // Pull a plan title out of the early header lines, if we can.
  let title = 'Pasted plan';
  let courseName = '';
  let major = '';
  for (let i = 0; i < Math.min(30, rawLines.length); i++) {
    const t = rawLines[i].trim();
    if (!t) continue;
    if (/^(Bachelor|Master|Diploma|Doctor|Graduate)\b/i.test(t)) {
      const m = t.match(/^(Bachelor of [A-Za-z]+|Master of [A-Za-z]+|Doctor of [A-Za-z]+|(?:Graduate )?Diploma (?:of|in) [A-Za-z]+)\s*(.*)$/i);
      if (m) {
        courseName = m[1];
        major = (m[2] || '').trim();
        title = major || courseName;
      } else {
        title = t;
      }
      break;
    }
  }

  // Earliest year/term across all subjects gives a sensible startYear/startSemester.
  const TERM_ORDER = { summer: 0, sem1: 1, winter: 2, sem2: 3 };
  const sorted = subjects.slice().sort((a, b) => a.year - b.year || TERM_ORDER[a.term] - TERM_ORDER[b.term]);
  const startYear = sorted[0].year;
  const startTerm = sorted[0].term;
  const startSemester = (startTerm === 'sem1' || startTerm === 'summer') ? 1 : 2;

  return {
    title,
    courseName,
    major,
    startYear,
    startSemester,
    degreeSubjectCount: subjects.length,
    subjects,
  };
}

function titleCaseCategory(s) {
  if (!s) return '';
  return s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

// "Past" comparison for auto-completion of imported subjects.
const _TERM_ORDER = { summer: 0, sem1: 1, winter: 2, sem2: 3 };
export function isTermStrictlyBefore(year1, term1, year2, term2) {
  if (year1 !== year2) return year1 < year2;
  return _TERM_ORDER[term1] < _TERM_ORDER[term2];
}

// Mark every subject in a term strictly before (currentYear, currentTerm) as
// completed. Idempotent. Doesn't touch subjects in/after the current term.
export function markPastTermsAsCompleted(state) {
  const cy = state?.setup?.currentYear;
  const ct = state?.setup?.currentTerm;
  if (!cy || !ct) return 0;
  let count = 0;
  for (const yk of Object.keys(state.years || {})) {
    const year = state.years[yk];
    for (const tk of Object.keys(year || {})) {
      if (!isTermStrictlyBefore(Number(yk), tk, cy, ct)) continue;
      const subjects = (year[tk] || {}).subjects || [];
      for (const subj of subjects) {
        if (!subj.completed) {
          subj.completed = true;
          count++;
        }
      }
    }
  }
  return count;
}

// Read import payload from `#import=<base64>` in window.location, if present.
// Returns the plan or null. Clears the fragment after reading.
export function consumeImportFragment() {
  const hash = window.location.hash || '';
  const m = hash.match(/[#&]import=([^&]+)/);
  if (!m) return null;
  const plan = parsePayload(decodeURIComponent(m[1]));
  // Strip the fragment so a refresh doesn't re-import.
  if (plan) {
    history.replaceState(null, '', window.location.pathname + window.location.search);
  }
  return plan;
}

// Best-effort normalization. Fills in defaults so every subject has the fields
// our app expects.
function normalizePlan(raw) {
  const subjects = raw.subjects.map(s => {
    const code = String(s.code || s.subjectCode || '').toUpperCase();
    const isPassFail = s.gradingMode === 'passFail' || PASS_FAIL_SUBJECT_CODES.has(code);
    return {
      year: Number(s.year) || raw.startYear || new Date().getFullYear(),
      term: STUDY_PERIOD_TO_TERM[s.studyPeriod] || s.term || 'sem1',
      code,
      name: s.name || s.subjectName || code || 'Subject',
      level: s.level ?? null,
      points: Number(s.points || 12.5),
      category: s.category || '',
      gradingMode: isPassFail ? 'passFail' : 'graded',
    };
  });
  return {
    id: raw.id || null,
    title: raw.title || raw.major || 'Imported plan',
    courseName: raw.courseName || '',
    major: raw.major || '',
    startYear: Number(raw.startYear) || subjects[0]?.year || new Date().getFullYear(),
    startSemester: Number(raw.startSemester) || 1,
    degreeSubjectCount: Number(raw.degreeSubjectCount) || subjects.length,
    subjects,
  };
}

export function applyCoursePlan(state, plan, opts = {}) {
  if (!plan || !Array.isArray(plan.subjects)) {
    throw new Error('Invalid course plan');
  }
  const norm = normalizePlan(plan);

  if (opts.replace !== false) {
    state.years = {};
  }
  state.setup = {
    ...(state.setup || {}),
    completed: true,
    startYear: norm.startYear,
    startSemester: norm.startSemester,
  };
  if (norm.subjects.length > 0) {
    const lastYear = Math.max(...norm.subjects.map(s => s.year));
    state.lookaheadYears = Math.max(1, lastYear - norm.startYear + 1);
  }
  state.degreeSubjectCount = norm.degreeSubjectCount;
  state.coursePlan = {
    id: norm.id,
    title: norm.title,
    courseName: norm.courseName,
    major: norm.major,
    sourceUrl: norm.id ? `https://course-planner.unimelb.edu.au/plan/${norm.id}` : null,
    importedAt: new Date().toISOString(),
  };

  for (const item of norm.subjects) {
    const subj = newSubject(item.name);
    subj.code = item.code || '';
    subj.category = item.category || '';
    subj.level = item.level ?? null;
    subj.points = item.points ?? 12.5;
    subj.gradingMode = item.gradingMode || 'graded';
    subj.assessments = [];
    getTerm(state, item.year, item.term).subjects.push(subj);
  }

  // If the user has set "where am I now?" during setup, every subject in a
  // strictly-past term is automatically flagged completed (no scores yet — the
  // user fills those in when they're ready).
  markPastTermsAsCompleted(state);

  return state;
}

// Bookmarklet — runs in Course Planner's origin to extract the plan from
// the user's logged-in session and open our app with the payload in a URL
// fragment. Pass the absolute return URL of our app.
//
// Strategy: find the React Redux store by walking the React fiber tree under
// the Course Planner SPA root. The store is exposed via the <Provider> fiber.
// Falls back to common globals (`window.store`, `window.__store__`).
export function buildBookmarklet(returnUrl) {
  const code = `(function(){
    try {
      var STUDY_PERIOD_TO_TERM = ${JSON.stringify(STUDY_PERIOD_TO_TERM)};
      var KNOWN_PASS_FAIL = ${JSON.stringify([...PASS_FAIL_SUBJECT_CODES])};
      function findStore() {
        if (window.store && window.store.getState) return window.store;
        if (window.__store__ && window.__store__.getState) return window.__store__;
        var root = document.getElementById('root') || document.body;
        var key = Object.keys(root || {}).find(function(k){ return k.indexOf('__reactContainer') === 0 || k.indexOf('__reactInternalInstance') === 0; });
        if (!key) return null;
        var fiber = root[key].stateNode ? root[key].stateNode.current : root[key].return || root[key];
        var seen = 0;
        while (fiber && seen < 1000) {
          seen++;
          if (fiber.stateNode && fiber.stateNode.store && fiber.stateNode.store.getState) return fiber.stateNode.store;
          if (fiber.memoizedProps && fiber.memoizedProps.store && fiber.memoizedProps.store.getState) return fiber.memoizedProps.store;
          fiber = fiber.child || fiber.sibling || (fiber.return && fiber.return.sibling);
        }
        return null;
      }
      var store = findStore();
      if (!store) {
        alert('Could not find your Course Planner state. Make sure you are signed in and viewing your plan, then try again.');
        return;
      }
      var s = store.getState() || {};
      var plan = (s.enrollment && s.enrollment.plan) || s.plan || null;
      if (!plan) {
        alert('No plan loaded. Open your plan in Course Planner first, then click this bookmarklet.');
        return;
      }
      var subjects = [];
      var periods = plan.studyPeriods || plan.periods || [];
      for (var i = 0; i < periods.length; i++) {
        var p = periods[i] || {};
        var term = STUDY_PERIOD_TO_TERM[p.studyPeriod] || STUDY_PERIOD_TO_TERM[p.name] || 'sem1';
        var year = Number(p.year || p.calendarYear || plan.year) || new Date().getFullYear();
        var slots = p.slots || p.subjects || [];
        for (var j = 0; j < slots.length; j++) {
          var slot = slots[j];
          if (!slot) continue;
          var inner = slot.subject || slot;
          var code = String(inner.code || inner.subjectCode || '').toUpperCase();
          if (!code) continue;
          var isPF = inner.gradingMode === 'passFail' || KNOWN_PASS_FAIL.indexOf(code) >= 0;
          subjects.push({
            year: year, term: term,
            code: code,
            name: inner.name || inner.subjectName || code,
            level: inner.level || inner.levelOfStudy || null,
            points: Number(inner.points || inner.creditPoints || 12.5),
            gradingMode: isPF ? 'passFail' : 'graded',
            category: inner.category || (slot.componentName) || ''
          });
        }
      }
      if (subjects.length === 0) {
        alert('Could not read any subjects from your plan. Try refreshing the Course Planner page first.');
        return;
      }
      var startYear = Number(plan.year) || subjects[0].year;
      var startSemester = plan.isMidyearEntry ? 2 : 1;
      var payload = {
        v: ${SCHEMA_VERSION},
        id: plan.id || null,
        title: (plan.template && plan.template.name) || plan.name || 'My plan',
        courseName: (plan.course && plan.course.name) || '',
        major: (plan.template && plan.template.streamName) || '',
        startYear: startYear,
        startSemester: startSemester,
        degreeSubjectCount: subjects.length,
        subjects: subjects
      };
      var encoded = btoa(unescape(encodeURIComponent(JSON.stringify(payload))));
      var target = ${JSON.stringify(returnUrl)} + '#import=' + encoded;
      window.open(target, '_blank');
    } catch (e) {
      alert('Bookmarklet error: ' + (e && e.message ? e.message : e));
    }
  })();`;
  // Minify whitespace and wrap as javascript: URL.
  const minified = code.replace(/\s+/g, ' ').replace(/\s*([{}();,:])\s*/g, '$1').trim();
  return 'javascript:' + encodeURIComponent(minified);
}
