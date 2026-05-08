// Calculation tests. Runs in Node and in the browser (tests.html).
// Each test is a small function. We collect pass/fail and print a summary.

import {
  gradeBandFor,
  totalWeight,
  lockedInContribution,
  currentPerformance,
  remainingWeight,
  requiredScoreFor,
  predictedFinal,
  finalMark,
  projectedFinal,
  currentWAM,
  predictedWAM,
  requiredAverageForWAM,
  isSubjectComplete,
  directFinalMark,
  isPassFailSubject,
  subjectWAMMark,
  round,
} from './calculator.js';

import {
  extractCoursePlanId,
  getKnownCoursePlan,
  parsePayload,
  applyCoursePlan,
  parsePastedText,
  parseAnyImport,
  isTermStrictlyBefore,
  markPastTermsAsCompleted,
} from './course-planner-import.js';

import { defaultState, allSubjects, guessCurrentTerm } from './storage.js';

const results = [];
function approx(a, b, eps = 1e-6) {
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;
  return Math.abs(a - b) < eps;
}
function test(name, fn) {
  try {
    fn();
    results.push({ name, ok: true });
  } catch (e) {
    results.push({ name, ok: false, error: e.message || String(e) });
  }
}
function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'assertion failed');
}
function assertEq(a, b, msg) {
  if (a !== b) throw new Error(`${msg || 'not equal'}: ${a} vs ${b}`);
}
function assertApprox(a, b, msg) {
  if (!approx(a, b)) throw new Error(`${msg || 'not approx'}: ${a} vs ${b}`);
}

// --- Grade bands ---
test('gradeBandFor: 80 -> H1', () => assertEq(gradeBandFor(80).key, 'H1'));
test('gradeBandFor: 100 -> H1', () => assertEq(gradeBandFor(100).key, 'H1'));
test('gradeBandFor: 79.99 -> H2A', () => assertEq(gradeBandFor(79.99).key, 'H2A'));
test('gradeBandFor: 75 -> H2A', () => assertEq(gradeBandFor(75).key, 'H2A'));
test('gradeBandFor: 74.99 -> H2B', () => assertEq(gradeBandFor(74.99).key, 'H2B'));
test('gradeBandFor: 70 -> H2B', () => assertEq(gradeBandFor(70).key, 'H2B'));
test('gradeBandFor: 65 -> H3', () => assertEq(gradeBandFor(65).key, 'H3'));
test('gradeBandFor: 50 -> Pass', () => assertEq(gradeBandFor(50).key, 'P'));
test('gradeBandFor: 49.99 -> Fail', () => assertEq(gradeBandFor(49.99).key, 'N'));
test('gradeBandFor: 0 -> Fail', () => assertEq(gradeBandFor(0).key, 'N'));
test('gradeBandFor: null -> null', () => assertEq(gradeBandFor(null), null));

// --- Weight totals ---
test('totalWeight sums', () => {
  assertEq(totalWeight([{ weight: 20 }, { weight: 30 }, { weight: 50 }]), 100);
});
test('totalWeight handles empty', () => assertEq(totalWeight([]), 0));
test('totalWeight tolerates strings', () => {
  assertEq(totalWeight([{ weight: '10' }, { weight: '20' }]), 30);
});

// --- Locked-in contribution & current performance ---
test('lockedInContribution: nothing done', () => {
  assertEq(lockedInContribution([{ weight: 50 }, { weight: 50 }]), 0);
});
test('lockedInContribution: half done at 80', () => {
  // 80 * 50 / 100 = 40
  assertApprox(lockedInContribution([{ weight: 50, score: 80 }, { weight: 50 }]), 40);
});
test('lockedInContribution: all done', () => {
  // 80*30/100 + 70*70/100 = 24 + 49 = 73
  const a = [{ weight: 30, score: 80 }, { weight: 70, score: 70 }];
  assertApprox(lockedInContribution(a), 73);
});
test('currentPerformance: weighted avg', () => {
  // (80*30 + 70*70) / (30+70) = (2400+4900)/100 = 73
  const a = [{ weight: 30, score: 80 }, { weight: 70, score: 70 }];
  assertApprox(currentPerformance(a), 73);
});
test('currentPerformance: nothing done -> null', () => {
  assertEq(currentPerformance([{ weight: 50 }, { weight: 50 }]), null);
});

// --- Required score ---
test('requiredScoreFor: typical', () => {
  // locked: 80*40/100 = 32. remaining 60. for 70: required = (70-32)*100/60 = 63.333..
  const a = [{ weight: 40, score: 80 }, { weight: 60 }];
  const r = requiredScoreFor(a, 70);
  assert(r.achievable, 'should be achievable');
  assertApprox(r.required, (70 - 32) * 100 / 60);
});
test('requiredScoreFor: treats unentered weight as remaining', () => {
  const a = [{ weight: 40, score: 80 }];
  const r = requiredScoreFor(a, 70);
  assert(r.achievable, 'should be achievable');
  assertApprox(r.required, (70 - 32) * 100 / 60);
});
test('requiredScoreFor: already reached', () => {
  // locked 90 with 90% weight done. for 50: required negative -> alreadyReached
  const a = [{ weight: 90, score: 100 }, { weight: 10 }];
  const r = requiredScoreFor(a, 50);
  assert(r.alreadyReached, 'should be already reached');
  assertEq(r.required, 0);
});
test('requiredScoreFor: impossible', () => {
  // locked 0 with 80 weight at 0. remaining 20. target 80. required = 80*100/20 = 400
  const a = [{ weight: 80, score: 0 }, { weight: 20 }];
  const r = requiredScoreFor(a, 80);
  assert(r.impossible, 'should be impossible');
  assert(r.required > 100, 'required > 100');
});
test('requiredScoreFor: nothing remaining, target met', () => {
  const a = [{ weight: 50, score: 80 }, { weight: 50, score: 60 }];
  const r = requiredScoreFor(a, 65);
  assert(r.alreadyReached, 'final 70 >= 65');
});
test('requiredScoreFor: nothing remaining, target missed', () => {
  const a = [{ weight: 50, score: 60 }, { weight: 50, score: 60 }];
  const r = requiredScoreFor(a, 80);
  assertEq(r.achievable, null);
  assert(r.noRemaining, 'no remaining');
});

// --- Predicted / projected final ---
test('predictedFinal: with predictions', () => {
  // 50% at 80 actual + 50% predicted at 70 -> 40 + 35 = 75
  const a = [{ weight: 50, score: 80 }, { weight: 50, predicted: 70 }];
  const r = predictedFinal(a);
  assertApprox(r.mark, 75);
  assertEq(r.coveredWeight, 100);
});
test('predictedFinal: with assumedScore fallback', () => {
  // 50 actual at 80, 30 predicted at 60, 20 unknown but assume 70:
  // 40 + 18 + 14 = 72
  const a = [{ weight: 50, score: 80 }, { weight: 30, predicted: 60 }, { weight: 20 }];
  const r = predictedFinal(a, 70);
  assertApprox(r.mark, 72);
});
test('finalMark: requires all scores', () => {
  const a = [{ weight: 50, score: 80 }, { weight: 50 }];
  assertEq(finalMark(a), null);
});
test('finalMark: complete', () => {
  const a = [{ weight: 30, score: 80 }, { weight: 70, score: 60 }];
  assertApprox(finalMark(a), 66); // 24 + 42
});
test('finalMark: requires weights to total 100', () => {
  const a = [{ weight: 40, score: 80 }];
  assertEq(finalMark(a), null);
});

test('projectedFinal: extrapolates current performance', () => {
  // 40% at 80 actual. remaining 60. project at current 80 -> 80
  const subj = { assessments: [{ weight: 40, score: 80 }, { weight: 60 }] };
  assertApprox(projectedFinal(subj), 80);
});
test('projectedFinal: treats unentered weight as remaining', () => {
  const subj = { assessments: [{ weight: 40, score: 80 }] };
  assertApprox(projectedFinal(subj), 80);
});
test('projectedFinal: can use predictions when no actual marks exist', () => {
  const subj = { assessments: [{ weight: 60, predicted: 70 }] };
  assertApprox(projectedFinal(subj), 70);
});
test('projectedFinal: predictions override projection', () => {
  // 40% at 80 actual, 30% predicted at 60. remaining 30 -> at current 80
  // = 32 + 18 + 24 = 74
  const subj = { assessments: [{ weight: 40, score: 80 }, { weight: 30, predicted: 60 }, { weight: 30 }] };
  assertApprox(projectedFinal(subj), 74);
});
test('projectedFinal: nothing known returns null', () => {
  assertEq(projectedFinal({ assessments: [{ weight: 100 }] }), null);
});

// --- WAM ---
test('currentWAM: only completed', () => {
  const subjects = [
    { completed: true, assessments: [{ weight: 100, score: 80 }] },
    { completed: true, assessments: [{ weight: 100, score: 70 }] },
    { completed: false, assessments: [{ weight: 50, score: 90 }, { weight: 50 }] },
  ];
  assertApprox(currentWAM(subjects), 75);
});
test('currentWAM: completed flag with partial scores uses projection', () => {
  // Subject flagged complete but with only one assessment scored. Projection
  // extrapolates current performance, so projected = 80, contributing to WAM.
  const subjects = [
    { completed: true, assessments: [{ weight: 100, score: 90 }] }, // 90
    { completed: true, assessments: [{ weight: 50, score: 80 }, { weight: 50 }] }, // proj 80
  ];
  assertApprox(currentWAM(subjects), 85);
});
test('currentWAM: none complete', () => {
  // Single 50-weight assessment scored isn't a complete subject (other 50% blank).
  const s = [{ completed: false, assessments: [{ weight: 50, score: 90 }, { weight: 50 }] }];
  assertEq(currentWAM(s), null);
});
test('currentWAM: direct final mark counts without assessments', () => {
  const subjects = [
    { finalScore: 82, assessments: [] },
    { finalScore: 78, assessments: [] },
  ];
  assertApprox(currentWAM(subjects), 80);
});
test('currentWAM: pass/fail subjects are excluded from WAM', () => {
  const subjects = [
    { finalScore: 80, assessments: [] },
    { gradingMode: 'passFail', passFailStatus: 'passed', assessments: [] },
  ];
  assertApprox(currentWAM(subjects), 80);
});
test('predictedWAM: includes projections', () => {
  const subjects = [
    { completed: true, assessments: [{ weight: 100, score: 80 }] }, // 80
    { assessments: [{ weight: 50, score: 70 }, { weight: 50, predicted: 70 }] }, // 70
  ];
  assertApprox(predictedWAM(subjects), 75);
});
test('subjectWAMMark: pass/fail returns null', () => {
  assertEq(subjectWAMMark({ gradingMode: 'passFail', passFailStatus: 'passed', assessments: [] }), null);
});

test('requiredAverageForWAM: typical', () => {
  // 2 completed at 70 each, 2 remaining, target 75 -> required 80
  const r = requiredAverageForWAM([70, 70], 2, 75);
  assert(r.achievable, 'achievable');
  assertApprox(r.required, 80);
});
test('requiredAverageForWAM: impossible', () => {
  // 1 completed at 50, 1 remaining, target 90 -> required 130
  const r = requiredAverageForWAM([50], 1, 90);
  assert(r.impossible, 'impossible');
});
test('requiredAverageForWAM: alreadyReached', () => {
  // Two 85s done, 2 remaining, target 30 -> even scoring 0 keeps WAM above 30.
  // (30*4 - 170) / 2 = -25 -> alreadyReached
  const r = requiredAverageForWAM([85, 85], 2, 30);
  assert(r.alreadyReached, 'already reached');
});

test('requiredAverageForWAM: high marks still need to maintain', () => {
  // Two 85s done, 2 remaining, target 80 -> need 75 average. Not "already reached".
  const r = requiredAverageForWAM([85, 85], 2, 80);
  assert(r.achievable && !r.alreadyReached, 'achievable, not already reached');
  assertApprox(r.required, 75);
});

test('isSubjectComplete: by flag', () => {
  assert(isSubjectComplete({ completed: true, assessments: [] }));
});
test('isSubjectComplete: by direct final mark', () => {
  assert(isSubjectComplete({ finalScore: 79, assessments: [] }));
});
test('isSubjectComplete: by pass/fail outcome', () => {
  assert(isSubjectComplete({ gradingMode: 'passFail', passFailStatus: 'passed', assessments: [] }));
});
test('isSubjectComplete: by all scores known', () => {
  assert(isSubjectComplete({ assessments: [{ weight: 100, score: 80 }] }));
});
test('isSubjectComplete: scored partial weights are still incomplete', () => {
  assert(!isSubjectComplete({ assessments: [{ weight: 40, score: 80 }] }));
});
test('isSubjectComplete: missing score -> incomplete', () => {
  assert(!isSubjectComplete({ assessments: [{ weight: 50, score: 80 }, { weight: 50 }] }));
});

test('round: 2 places', () => assertEq(round(73.123456, 2), 73.12));
test('round: 0 places', () => assertEq(round(73.6, 0), 74));
test('directFinalMark: clamps and ignores pass/fail', () => {
  assertEq(directFinalMark({ finalScore: 120 }), 100);
  assertEq(directFinalMark({ gradingMode: 'passFail', finalScore: 80 }), null);
});
test('isPassFailSubject: detects pass/fail subjects', () => {
  assert(isPassFailSubject({ gradingMode: 'passFail' }));
});

// --- Validation: weights must sum to 100 ---
test('totalWeight validation case', () => {
  const a = [{ weight: 30 }, { weight: 30 }, { weight: 30 }];
  assert(totalWeight(a) !== 100, 'should not be 100');
});

// --- Edge: zero-weight assessment ignored ---
test('zero-weight assessment ignored in total', () => {
  assertEq(totalWeight([{ weight: 50, score: 80 }, { weight: 0, score: 100 }, { weight: 50, score: 60 }]), 100);
});

// --- Weighted WAM (UoM "official" mode) ---
test('currentWAM: simple averages all subjects equally', () => {
  const subjects = [
    { completed: true, points: 12.5, level: 1, assessments: [{ weight: 100, score: 60 }] },
    { completed: true, points: 12.5, level: 3, assessments: [{ weight: 100, score: 90 }] },
  ];
  // Simple: (60 + 90) / 2 = 75
  assertApprox(currentWAM(subjects, 'simple'), 75);
});

test('currentWAM: official mode doubles level-2+ subjects', () => {
  // Level-1 12.5pt subject: weight = 12.5
  // Level-3 12.5pt subject: weight = 12.5 × 2 = 25
  // (60×12.5 + 90×25) / (12.5 + 25) = (750 + 2250) / 37.5 = 80
  const subjects = [
    { completed: true, points: 12.5, level: 1, assessments: [{ weight: 100, score: 60 }] },
    { completed: true, points: 12.5, level: 3, assessments: [{ weight: 100, score: 90 }] },
  ];
  assertApprox(currentWAM(subjects, 'official'), 80);
});

test('currentWAM: official respects custom credit points', () => {
  // 25-point level-1 + 12.5-point level-1 → just points-weighted
  // (70×25 + 80×12.5) / 37.5 = (1750 + 1000) / 37.5 = 73.333...
  const subjects = [
    { completed: true, points: 25,   level: 1, assessments: [{ weight: 100, score: 70 }] },
    { completed: true, points: 12.5, level: 1, assessments: [{ weight: 100, score: 80 }] },
  ];
  assertApprox(currentWAM(subjects, 'official'), (70*25 + 80*12.5) / 37.5);
});

test('predictedWAM: simple vs official agree when all subjects share level/points', () => {
  const subjects = [
    { points: 12.5, level: 1, assessments: [{ weight: 100, score: 60 }] },
    { points: 12.5, level: 1, assessments: [{ weight: 100, score: 80 }] },
  ];
  assertApprox(predictedWAM(subjects, 'simple'), 70);
  assertApprox(predictedWAM(subjects, 'official'), 70);
});

// --- Course Planner import ---
test('extractCoursePlanId: full URL', () => {
  const id = extractCoursePlanId('https://course-planner.unimelb.edu.au/B-SCI/2025/plan/68a8884a78faaf004f8d17b7');
  assertEq(id, '68a8884a78faaf004f8d17b7');
});
test('extractCoursePlanId: bare hex', () => {
  assertEq(extractCoursePlanId('847dcf8c06db4b0587b5feb47c39e2da'), '847dcf8c06db4b0587b5feb47c39e2da');
});
test('extractCoursePlanId: garbage returns empty', () => {
  assertEq(extractCoursePlanId('not a url'), '');
});

test('getKnownCoursePlan: matches the curated Data Science plan', () => {
  const plan = getKnownCoursePlan('https://course-planner.unimelb.edu.au/B-SCI/2025/plan/847dcf8c06db4b0587b5feb47c39e2da');
  assert(plan, 'should find the plan');
  assertEq(plan.subjects.length, 24);
});
test('getKnownCoursePlan: unknown id returns null', () => {
  const plan = getKnownCoursePlan('https://course-planner.unimelb.edu.au/B-SCI/2025/plan/68a8884a78faaf004f8d17b7');
  assertEq(plan, null);
});

test('parsePayload: plain JSON', () => {
  const p = parsePayload(JSON.stringify({
    startYear: 2025, startSemester: 1,
    subjects: [{ year: 2025, term: 'sem1', code: 'COMP10001', name: 'FoC' }],
  }));
  assert(p, 'parsed');
  assertEq(p.subjects.length, 1);
  assertEq(p.subjects[0].code, 'COMP10001');
});
test('parsePayload: base64 JSON', () => {
  const json = JSON.stringify({ subjects: [{ year: 2025, term: 'sem1', code: 'A', name: 'A' }] });
  const b64 = (typeof Buffer !== 'undefined') ? Buffer.from(json).toString('base64') : btoa(json);
  const p = parsePayload(b64);
  assert(p, 'parsed from base64');
  assertEq(p.subjects[0].code, 'A');
});
test('parsePayload: garbage returns null', () => {
  assertEq(parsePayload('not json'), null);
  assertEq(parsePayload(''), null);
});
test('parsePayload: SCIE10005 is auto-tagged pass/fail', () => {
  const p = parsePayload(JSON.stringify({
    subjects: [{ year: 2025, term: 'sem2', code: 'SCIE10005', name: 'TSTW' }],
  }));
  assertEq(p.subjects[0].gradingMode, 'passFail');
});

test('applyCoursePlan: imports the curated plan into a fresh state', () => {
  const state = defaultState();
  const plan = getKnownCoursePlan('847dcf8c06db4b0587b5feb47c39e2da');
  applyCoursePlan(state, plan);
  const flat = allSubjects(state);
  assertEq(flat.length, 24);
  assertEq(state.coursePlan.major, 'Data Science');
  assertEq(state.setup.startYear, 2025);
  assertEq(state.setup.startSemester, 2);
});

test('applyCoursePlan: preserves pass/fail flag from registry', () => {
  const state = defaultState();
  const plan = getKnownCoursePlan('847dcf8c06db4b0587b5feb47c39e2da');
  applyCoursePlan(state, plan);
  const tstw = allSubjects(state).find(x => x.subject.code === 'SCIE10005');
  assert(tstw, 'TSTW imported');
  assertEq(tstw.subject.gradingMode, 'passFail');
});

test('applyCoursePlan: replace=false appends without clearing', () => {
  const state = defaultState();
  state.years = { '2024': { sem1: { subjects: [{ id: 'x', name: 'Existing', assessments: [] }] } } };
  state.setup = { completed: true, startYear: 2024, startSemester: 1 };
  const plan = getKnownCoursePlan('847dcf8c06db4b0587b5feb47c39e2da');
  applyCoursePlan(state, plan, { replace: false });
  // 1 existing + 24 imported = 25
  assertEq(allSubjects(state).length, 25);
});

// --- Term comparison + auto-completion ---
test('isTermStrictlyBefore: across years', () => {
  assert(isTermStrictlyBefore(2024, 'sem2', 2025, 'sem1'));
  assert(!isTermStrictlyBefore(2025, 'sem1', 2024, 'sem2'));
});
test('isTermStrictlyBefore: same year, term order', () => {
  assert(isTermStrictlyBefore(2025, 'summer', 2025, 'sem1'));
  assert(isTermStrictlyBefore(2025, 'sem1', 2025, 'winter'));
  assert(isTermStrictlyBefore(2025, 'winter', 2025, 'sem2'));
  assert(!isTermStrictlyBefore(2025, 'sem2', 2025, 'sem1'));
  assert(!isTermStrictlyBefore(2025, 'sem1', 2025, 'sem1'));
});

test('markPastTermsAsCompleted: flags subjects in earlier terms only', () => {
  const state = defaultState();
  state.setup = { completed: true, startYear: 2024, startSemester: 1, currentYear: 2026, currentTerm: 'sem1' };
  state.years = {
    '2025': { sem2: { subjects: [{ id: 'a', completed: false, assessments: [] }] } },
    '2026': {
      summer: { subjects: [{ id: 'b', completed: false, assessments: [] }] },
      sem1:   { subjects: [{ id: 'c', completed: false, assessments: [] }] },
      sem2:   { subjects: [{ id: 'd', completed: false, assessments: [] }] },
    },
  };
  markPastTermsAsCompleted(state);
  assertEq(state.years['2025'].sem2.subjects[0].completed, true);
  assertEq(state.years['2026'].summer.subjects[0].completed, true);
  assertEq(state.years['2026'].sem1.subjects[0].completed, false);  // current term — not past
  assertEq(state.years['2026'].sem2.subjects[0].completed, false);  // future
});

test('guessCurrentTerm: maps months sensibly', () => {
  assertEq(guessCurrentTerm(new Date('2026-01-15')), 'summer');
  assertEq(guessCurrentTerm(new Date('2026-03-15')), 'sem1');
  assertEq(guessCurrentTerm(new Date('2026-06-20')), 'winter');
  assertEq(guessCurrentTerm(new Date('2026-09-15')), 'sem2');
  assertEq(guessCurrentTerm(new Date('2026-12-15')), 'summer');
});

// --- Pasted Course Planner page parser ---
// Header lines (Semester 1/2, Summer Term, Winter Term) MUST keep their trailing
// space — that's the signal we use to distinguish them from "also-offered-in"
// listings inside a subject block. Don't reformat this fixture.
const PASTED_PLAN_FIXTURE = [
  'University of Melbourne Logo',
  'My Course Planner',
  'yalsihli',
  '',
  'Bachelor of Science Data Science',
  '',
  '100%',
  'Planned',
  '2025',
  '  ',
  'Semester 2 ',
  'COMPULSORY',
  'SCIE10005 | Level 1 | 12.5 points',
  '',
  "Today's Science, Tomorrow's World",
  '',
  'Semester 2',
  '  ',
  'Semester 1',
  '  ',
  'DISCIPLINE',
  'COMP10001 | Level 1 | 12.5 points',
  '',
  'Foundations of Computing',
  '',
  'Semester 1',
  '  ',
  'Semester 2',
  '  ',
  'DISCIPLINE',
  'MAST10006 | Level 1 | 12.5 points',
  '',
  'Calculus 2',
  '',
  'Semester 2',
  '  ',
  '2026',
  '  ',
  'Summer Term ',
  'DISCIPLINE',
  'MAST10007 | Level 1 | 12.5 points',
  '',
  'Linear Algebra',
  '',
  'Summer Term',
  '  ',
  'Semester 1 ',
  'DISCIPLINE',
  'MAST20006 | Level 2 | 12.5 points',
  '',
  'Probability for Statistics',
  '',
  'Semester 2',
  '  ',
  'Semester 1',
  '  ',
  '    ',
  'search',
  'ADD A SUBJECT',
  'Semester 2 ',
  'DISCIPLINE',
  'MAST20005 | Level 2 | 12.5 points',
  '',
  'Statistics',
  '',
  'Semester 2',
  '  ',
  '2027',
  '  ',
  'Semester 1 ',
  'DATA SCIENCE, MAJOR',
  'MAST30025 | Level 3 | 12.5 points',
  '',
  'Linear Statistical Models',
  '',
  'Semester 1',
  '',
  'BREADTH',
  'MUSI20149 | Level 2 | 12.5 points',
  '',
  'Music Psychology',
  '',
  'Summer Term',
  '  ',
  'Semester 1',
  '  ',
  'Winter Term ',
  '    ',
  'search',
  'ADD A SUBJECT',
  '    ',
  'search',
  'ADD A SUBJECT',
  'Semester 2 ',
  'DATA SCIENCE, MAJOR',
  'MAST30027 | Level 3 | 12.5 points',
  '',
  'Modern Applied Statistics',
  '',
  'Semester 2',
  '  ',
].join('\n');

test('parsePastedText: extracts subjects from a real Course Planner paste', () => {
  const plan = parsePastedText(PASTED_PLAN_FIXTURE);
  assert(plan, 'plan parsed');
  // Counts: 2025 sem2 (3) + 2026 summer (1) + 2026 sem1 (1) + 2026 sem2 (1) +
  //         2027 sem1 (2: MAST30025, MUSI20149) + 2027 sem2 (1) = 9
  assertEq(plan.subjects.length, 9);
});

test('parsePastedText: assigns the right (year, term) to each subject', () => {
  const plan = parsePastedText(PASTED_PLAN_FIXTURE);
  const lookup = Object.fromEntries(plan.subjects.map(s => [s.code, s]));
  assertEq(lookup.SCIE10005.year, 2025);
  assertEq(lookup.SCIE10005.term, 'sem2');
  assertEq(lookup.MAST10007.year, 2026);
  assertEq(lookup.MAST10007.term, 'summer');
  assertEq(lookup.MAST20006.term, 'sem1');     // 2026 sem1
  assertEq(lookup.MAST20005.year, 2026);
  assertEq(lookup.MAST20005.term, 'sem2');
  assertEq(lookup.MAST30025.year, 2027);
  assertEq(lookup.MAST30025.term, 'sem1');
  assertEq(lookup.MUSI20149.term, 'sem1');     // ALSO 2027 sem1, NOT winter (offering listings)
  assertEq(lookup.MAST30027.term, 'sem2');     // 2027 sem2 (after empty Winter Term)
});

test('parsePastedText: pulls level/points/category metadata', () => {
  const plan = parsePastedText(PASTED_PLAN_FIXTURE);
  const lookup = Object.fromEntries(plan.subjects.map(s => [s.code, s]));
  assertEq(lookup.SCIE10005.level, 1);
  assertEq(lookup.SCIE10005.points, 12.5);
  assertEq(lookup.SCIE10005.category, 'Compulsory');
  assertEq(lookup.MAST30025.level, 3);
  assertEq(lookup.MAST30025.category, 'Data Science, Major');
});

test('parsePastedText: tags SCIE10005 as pass/fail', () => {
  const plan = parsePastedText(PASTED_PLAN_FIXTURE);
  const tstw = plan.subjects.find(s => s.code === 'SCIE10005');
  assertEq(tstw.gradingMode, 'passFail');
});

test('parsePastedText: pulls course name and major from the title line', () => {
  const plan = parsePastedText(PASTED_PLAN_FIXTURE);
  assertEq(plan.courseName, 'Bachelor of Science');
  assertEq(plan.major, 'Data Science');
});

test('parsePastedText: detects start year/semester from earliest subject', () => {
  const plan = parsePastedText(PASTED_PLAN_FIXTURE);
  assertEq(plan.startYear, 2025);
  assertEq(plan.startSemester, 2);
});

test('parsePastedText: garbage returns null', () => {
  assertEq(parsePastedText('this is not a course plan'), null);
  assertEq(parsePastedText(''), null);
});

test('parseAnyImport: dispatches JSON over text', () => {
  const json = JSON.stringify({ subjects: [{ year: 2025, term: 'sem1', code: 'TEST10001', name: 'X' }] });
  assertEq(parseAnyImport(json).subjects[0].code, 'TEST10001');
});
test('parseAnyImport: falls back to text parser', () => {
  const plan = parseAnyImport(PASTED_PLAN_FIXTURE);
  assert(plan && plan.subjects.length === 9);
});

test('applyCoursePlan + currentTerm: imported past subjects auto-complete', () => {
  const state = defaultState();
  state.setup.currentYear = 2027;
  state.setup.currentTerm = 'sem2';
  state.setup.startYear = 2025;
  state.setup.startSemester = 2;
  const plan = parsePastedText(PASTED_PLAN_FIXTURE);
  applyCoursePlan(state, plan, { replace: true });
  // Anything before 2027 sem2 should be marked completed.
  const all = allSubjects(state);
  const past = all.filter(({ subject, year, term }) => isTermStrictlyBefore(year, term, 2027, 'sem2'));
  for (const { subject } of past) {
    assert(subject.completed, `expected past subject ${subject.code} to be completed`);
  }
});

export function runTests() {
  return results;
}

export function summarize(results) {
  const passed = results.filter(r => r.ok).length;
  const failed = results.length - passed;
  return { total: results.length, passed, failed, results };
}
