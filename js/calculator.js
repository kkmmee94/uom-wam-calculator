// WAM and grade calculations for University of Melbourne students.
// Pure functions; no DOM or storage access. Easy to test.

export const GRADE_BANDS = [
  { key: 'H1',   label: 'H1',   min: 80, max: 100, color: '#16a34a', description: 'First Class Honours' },
  { key: 'H2A',  label: 'H2A',  min: 75, max: 79.999, color: '#22c55e', description: 'Second Class Honours A' },
  { key: 'H2B',  label: 'H2B',  min: 70, max: 74.999, color: '#84cc16', description: 'Second Class Honours B' },
  { key: 'H3',   label: 'H3',   min: 65, max: 69.999, color: '#eab308', description: 'Third Class Honours' },
  { key: 'P',    label: 'Pass', min: 50, max: 64.999, color: '#f97316', description: 'Pass' },
  { key: 'N',    label: 'Fail', min: 0,  max: 49.999, color: '#dc2626', description: 'Fail' },
];

// Lowest-mark thresholds students typically aim for.
export const TARGET_THRESHOLDS = [
  { key: 'P',   label: 'Pass', min: 50 },
  { key: 'H3',  label: 'H3',   min: 65 },
  { key: 'H2B', label: 'H2B',  min: 70 },
  { key: 'H2A', label: 'H2A',  min: 75 },
  { key: 'H1',  label: 'H1',   min: 80 },
];

export function gradeBandFor(mark) {
  if (mark == null || Number.isNaN(mark)) return null;
  if (mark >= 80) return GRADE_BANDS[0];
  if (mark >= 75) return GRADE_BANDS[1];
  if (mark >= 70) return GRADE_BANDS[2];
  if (mark >= 65) return GRADE_BANDS[3];
  if (mark >= 50) return GRADE_BANDS[4];
  return GRADE_BANDS[5];
}

// Round half away from zero, to N decimal places.
export function round(value, places = 2) {
  if (value == null || Number.isNaN(value)) return value;
  const factor = Math.pow(10, places);
  return Math.round(value * factor) / factor;
}

// Sum of weights — useful for the 100% validation.
export function totalWeight(assessments) {
  return assessments.reduce((sum, a) => sum + (Number(a.weight) || 0), 0);
}

function actualWeight(assessments) {
  return assessments.reduce((sum, a) => {
    return sum + (hasActualScore(a) ? Number(a.weight) || 0 : 0);
  }, 0);
}

function weightsAddTo100(assessments) {
  return Math.abs(totalWeight(assessments) - 100) < 0.01;
}

// True if the assessment has a known actual score.
export function hasActualScore(a) {
  return a.score !== null && a.score !== undefined && a.score !== '' && !Number.isNaN(Number(a.score));
}

// True if the user has entered a predicted score for what-if mode.
export function hasPredictedScore(a) {
  return a.predicted !== null && a.predicted !== undefined && a.predicted !== '' && !Number.isNaN(Number(a.predicted));
}

export function isPassFailSubject(subject) {
  return subject?.gradingMode === 'passFail';
}

export function directFinalMark(subject) {
  if (!subject || isPassFailSubject(subject)) return null;
  if (subject.finalScore === null || subject.finalScore === undefined || subject.finalScore === '') return null;
  const n = Number(subject.finalScore);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(100, n));
}

export function isPassFailComplete(subject) {
  if (!isPassFailSubject(subject)) return false;
  return subject.passFailStatus === 'passed' || subject.passFailStatus === 'failed' || subject.completed === true;
}

// "Locked-in" contribution to the final mark from completed assessments.
// Returned as a number out of 100, e.g. 18.5 means 18.5/100 of the final.
export function lockedInContribution(assessments) {
  let contribution = 0;
  for (const a of assessments) {
    if (hasActualScore(a)) {
      contribution += (Number(a.score) * Number(a.weight)) / 100;
    }
  }
  return contribution;
}

// Average performance on completed assessments alone — i.e. how the student
// is "currently scoring" on what they've done. Out of 100.
// Returns null if nothing is complete.
export function currentPerformance(assessments) {
  let weighted = 0;
  let weight = 0;
  for (const a of assessments) {
    if (hasActualScore(a)) {
      weighted += Number(a.score) * Number(a.weight);
      weight += Number(a.weight);
    }
  }
  if (weight === 0) return null;
  return weighted / weight;
}

// Sum of weight of assessments that are still unknown (no actual score).
export function remainingWeight(assessments) {
  return Math.max(0, 100 - actualWeight(assessments));
}

// Score (0-100) needed on average across all remaining assessments to hit `target` final mark.
// Returns:
//   { achievable: true,  required: <number 0-100> }   normal case
//   { achievable: true,  required: 0, alreadyReached: true } target already locked in
//   { achievable: false, required: <number > 100>, impossible: true } would need > 100
//   { achievable: null,  noRemaining: true }   nothing remaining and target not reached
export function requiredScoreFor(assessments, target) {
  const locked = lockedInContribution(assessments);
  const remaining = remainingWeight(assessments);

  if (remaining === 0) {
    if (locked >= target) return { achievable: true, required: 0, alreadyReached: true };
    return { achievable: null, noRemaining: true };
  }

  // locked + required * remaining / 100 = target   =>   required = (target - locked) * 100 / remaining
  const required = ((target - locked) * 100) / remaining;

  if (required <= 0) return { achievable: true, required: 0, alreadyReached: true };
  if (required > 100) return { achievable: false, required, impossible: true };
  return { achievable: true, required };
}

// Predicted final mark out of 100, treating unknown assessments as either:
// 1) the user's predicted score if set, or
// 2) `assumedScore` (default null = skip them; only counts what's known + predicted).
// If assumedScore is provided, applies to remaining unknown assessments without a prediction.
export function predictedFinal(assessments, assumedScore = null) {
  let total = 0;
  let coveredWeight = 0;
  for (const a of assessments) {
    const w = Number(a.weight) || 0;
    if (hasActualScore(a)) {
      total += (Number(a.score) * w) / 100;
      coveredWeight += w;
    } else if (hasPredictedScore(a)) {
      total += (Number(a.predicted) * w) / 100;
      coveredWeight += w;
    } else if (assumedScore != null) {
      total += (Number(assumedScore) * w) / 100;
      coveredWeight += w;
    }
  }
  if (assumedScore != null && coveredWeight < 100) {
    total += (Number(assumedScore) * (100 - coveredWeight)) / 100;
    coveredWeight = 100;
  }
  return { mark: total, coveredWeight };
}

// Final mark when every assessment has an actual score. Null otherwise.
export function finalMark(assessments) {
  if (assessments.length === 0) return null;
  if (!weightsAddTo100(assessments)) return null;
  for (const a of assessments) {
    if (!hasActualScore(a)) return null;
  }
  let total = 0;
  for (const a of assessments) {
    total += (Number(a.score) * Number(a.weight)) / 100;
  }
  return total;
}

// True if the subject is "complete" for WAM purposes — either flagged complete
// by the user, or every assessment has a real score.
export function isSubjectComplete(subject) {
  if (isPassFailComplete(subject)) return true;
  if (directFinalMark(subject) != null) return true;
  if (subject.completed) return true;
  if (!subject.assessments || subject.assessments.length === 0) return false;
  return weightsAddTo100(subject.assessments) && subject.assessments.every(hasActualScore);
}

// Final or best-effort mark for a subject. Used for WAM rollup.
//   actual:    finalMark when complete
//   predicted: predictedFinal using actual + predicted entries (no assumption)
export function subjectMark(subject) {
  if (isPassFailSubject(subject)) return null;
  const direct = directFinalMark(subject);
  if (direct != null) return { mark: direct, kind: 'actual' };
  const fm = finalMark(subject.assessments || []);
  if (fm != null) return { mark: fm, kind: 'actual' };
  const pf = predictedFinal(subject.assessments || []);
  if (pf.coveredWeight > 0) {
    // Scale up if not all weight is covered? No — predicted final is best treated as
    // "what would the final be if remaining assessments contribute zero". That's
    // misleading. Better to project: assume remaining assessments score the same as
    // current performance.
    return null;
  }
  return null;
}

// Predicted final assuming remaining unknowns continue at current performance.
// This is the "best-guess" final mark used for WAM prediction.
// Returns null if no information at all.
export function projectedFinal(subject) {
  if (isPassFailSubject(subject)) return null;
  const direct = directFinalMark(subject);
  if (direct != null) return direct;

  const assessments = subject.assessments || [];
  if (assessments.length === 0) return null;
  if (totalWeight(assessments) === 0) return null;

  let total = 0;
  let coveredWeight = 0;
  let actualWeighted = 0;
  let actualW = 0;
  let knownWeighted = 0;
  let knownW = 0;
  for (const a of assessments) {
    const w = Number(a.weight) || 0;
    if (hasActualScore(a)) {
      const score = Number(a.score);
      total += (score * w) / 100;
      coveredWeight += w;
      actualWeighted += score * w;
      actualW += w;
      knownWeighted += score * w;
      knownW += w;
    } else if (hasPredictedScore(a)) {
      const predicted = Number(a.predicted);
      total += (predicted * w) / 100;
      coveredWeight += w;
      knownWeighted += predicted * w;
      knownW += w;
    }
  }

  const uncoveredW = Math.max(0, 100 - coveredWeight);
  if (uncoveredW <= 0) {
    return total; // already covers everything
  }
  const basis = actualW > 0
    ? actualWeighted / actualW
    : (knownW > 0 ? knownWeighted / knownW : null);
  if (basis == null) return null;
  total += (basis * uncoveredW) / 100;
  return total;
}

export function subjectWAMMark(subject, opts = {}) {
  if (!subject || isPassFailSubject(subject)) return null;

  const direct = directFinalMark(subject);
  if (direct != null) return direct;

  const fm = finalMark(subject.assessments || []);
  if (fm != null) return fm;

  if (opts.includeProjected) {
    const pj = projectedFinal(subject);
    if (pj != null) return pj;
  }

  return null;
}

// Compute current WAM (from completed subjects). Uses finalMark when every
// assessment is scored; otherwise — if the user explicitly flagged the subject
// as complete — falls back to the projected mark so it still counts.
export function currentWAM(subjects) {
  const marks = [];
  for (const s of subjects) {
    if (!isSubjectComplete(s)) continue;
    const mark = subjectWAMMark(s, { includeProjected: true });
    if (mark != null) marks.push(mark);
  }
  if (marks.length === 0) return null;
  return marks.reduce((a, b) => a + b, 0) / marks.length;
}

// Compute predicted WAM including in-progress subjects with projected/predicted finals.
export function predictedWAM(subjects) {
  const marks = [];
  for (const s of subjects) {
    const mark = subjectWAMMark(s, { includeProjected: true });
    if (mark != null) marks.push(mark);
  }
  if (marks.length === 0) return null;
  return marks.reduce((a, b) => a + b, 0) / marks.length;
}

// Average mark needed across `remainingCount` future subjects to reach `targetWAM`,
// given existing `completedMarks` already locked in.
//   completedMarks: array of final marks already counted toward WAM
//   remainingCount: number of future subjects to bring the WAM up
// Returns same shape as requiredScoreFor.
export function requiredAverageForWAM(completedMarks, remainingCount, targetWAM) {
  if (remainingCount <= 0) {
    if (completedMarks.length === 0) return { achievable: null, noRemaining: true };
    const wam = completedMarks.reduce((a, b) => a + b, 0) / completedMarks.length;
    if (wam >= targetWAM) return { achievable: true, required: 0, alreadyReached: true };
    return { achievable: null, noRemaining: true };
  }
  const lockedSum = completedMarks.reduce((a, b) => a + b, 0);
  const totalCount = completedMarks.length + remainingCount;
  // (lockedSum + required * remainingCount) / totalCount = targetWAM
  const required = (targetWAM * totalCount - lockedSum) / remainingCount;
  if (required <= 0) return { achievable: true, required: 0, alreadyReached: true };
  if (required > 100) return { achievable: false, required, impossible: true };
  return { achievable: true, required };
}
