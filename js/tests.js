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
  round,
} from './calculator.js';

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

test('projectedFinal: extrapolates current performance', () => {
  // 40% at 80 actual. remaining 60. project at current 80 -> 80
  const subj = { assessments: [{ weight: 40, score: 80 }, { weight: 60 }] };
  assertApprox(projectedFinal(subj), 80);
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
test('predictedWAM: includes projections', () => {
  const subjects = [
    { completed: true, assessments: [{ weight: 100, score: 80 }] }, // 80
    { assessments: [{ weight: 50, score: 70 }, { weight: 50, predicted: 70 }] }, // 70
  ];
  assertApprox(predictedWAM(subjects), 75);
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
test('isSubjectComplete: by all scores known', () => {
  assert(isSubjectComplete({ assessments: [{ weight: 100, score: 80 }] }));
});
test('isSubjectComplete: missing score -> incomplete', () => {
  assert(!isSubjectComplete({ assessments: [{ weight: 50, score: 80 }, { weight: 50 }] }));
});

test('round: 2 places', () => assertEq(round(73.123456, 2), 73.12));
test('round: 0 places', () => assertEq(round(73.6, 0), 74));

// --- Validation: weights must sum to 100 ---
test('totalWeight validation case', () => {
  const a = [{ weight: 30 }, { weight: 30 }, { weight: 30 }];
  assert(totalWeight(a) !== 100, 'should not be 100');
});

// --- Edge: zero-weight assessment ignored ---
test('zero-weight assessment ignored in total', () => {
  assertEq(totalWeight([{ weight: 50, score: 80 }, { weight: 0, score: 100 }, { weight: 50, score: 60 }]), 100);
});

export function runTests() {
  return results;
}

export function summarize(results) {
  const passed = results.filter(r => r.ok).length;
  const failed = results.length - passed;
  return { total: results.length, passed, failed, results };
}
