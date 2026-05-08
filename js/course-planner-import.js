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
