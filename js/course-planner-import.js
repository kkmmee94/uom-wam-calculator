import { getTerm, newSubject } from './storage.js';

const DATA_SCIENCE_PLAN_ID = '847dcf8c06db4b0587b5feb47c39e2da';

const DATA_SCIENCE_PLAN = {
  id: DATA_SCIENCE_PLAN_ID,
  title: 'Data Science',
  courseName: 'Bachelor of Science',
  major: 'Data Science',
  startYear: 2025,
  startSemester: 2,
  degreeSubjectCount: 24,
  subjects: [
    { year: 2025, term: 'sem2', category: 'Compulsory', code: 'SCIE10005', level: 1, points: 12.5, name: "Today's Science, Tomorrow's World", gradingMode: 'passFail' },
    { year: 2025, term: 'sem2', category: 'Discipline', code: 'MAST10006', level: 1, points: 12.5, name: 'Calculus 2' },
    { year: 2025, term: 'sem2', category: 'Discipline', code: 'MAST10010', level: 1, points: 12.5, name: 'Data Analysis' },
    { year: 2025, term: 'sem2', category: 'Discipline', code: 'COMP10001', level: 1, points: 12.5, name: 'Foundations of Computing' },

    { year: 2026, term: 'summer', category: 'Discipline', code: 'MAST10007', level: 1, points: 12.5, name: 'Linear Algebra' },
    { year: 2026, term: 'summer', category: 'Breadth', code: 'ECON10004', level: 1, points: 12.5, name: 'Introductory Microeconomics' },

    { year: 2026, term: 'sem1', category: 'Discipline', code: 'MAST20004', level: 2, points: 12.5, name: 'Probability' },
    { year: 2026, term: 'sem1', category: 'Discipline', code: 'MAST20026', level: 2, points: 12.5, name: 'Real Analysis' },
    { year: 2026, term: 'sem1', category: 'Discipline', code: 'COMP10002', level: 1, points: 12.5, name: 'Foundations of Algorithms' },
    { year: 2026, term: 'sem1', category: 'Breadth', code: 'ECOM20001', level: 2, points: 12.5, name: 'Econometrics 1' },

    { year: 2026, term: 'sem2', category: 'Discipline', code: 'MAST20005', level: 2, points: 12.5, name: 'Statistics' },
    { year: 2026, term: 'sem2', category: 'Discipline', code: 'COMP20008', level: 2, points: 12.5, name: 'Elements of Data Processing' },
    { year: 2026, term: 'sem2', category: 'Discipline', code: 'SWEN20003', level: 2, points: 12.5, name: 'Object Oriented Software Development' },
    { year: 2026, term: 'sem2', category: 'Discipline', code: 'INFO20003', level: 2, points: 12.5, name: 'Database Systems' },

    { year: 2027, term: 'sem1', category: 'Data Science, Major', code: 'MAST30025', level: 3, points: 12.5, name: 'Linear Statistical Models' },
    { year: 2027, term: 'sem1', category: 'Data Science, Major', code: 'COMP30027', level: 3, points: 12.5, name: 'Machine Learning' },
    { year: 2027, term: 'sem1', category: 'Discipline', code: 'COMP20007', level: 2, points: 12.5, name: 'Design of Algorithms' },

    { year: 2027, term: 'sem2', category: 'Data Science, Major', code: 'MAST30027', level: 3, points: 12.5, name: 'Modern Applied Statistics' },
    { year: 2027, term: 'sem2', category: 'Data Science, Major', code: 'MAST30034', level: 3, points: 12.5, name: 'Applied Data Science' },
    { year: 2027, term: 'sem2', category: 'Discipline', code: 'MAST30001', level: 3, points: 12.5, name: 'Stochastic Modelling' },
    { year: 2027, term: 'sem2', category: 'Breadth', code: 'ECOM30004', level: 3, points: 12.5, name: 'Time Series Analysis and Forecasting' },

    { year: 2028, term: 'sem1', category: 'Discipline', code: 'COMP30024', level: 3, points: 12.5, name: 'Artificial Intelligence' },
    { year: 2028, term: 'sem1', category: 'Discipline', code: 'COMP30023', level: 3, points: 12.5, name: 'Computer Systems' },
    { year: 2028, term: 'sem1', category: 'Breadth', code: 'CMCE10002', level: 1, points: 12.5, name: 'Foundations of Business Analytics' },
  ],
};

const KNOWN_PLANS = {
  [DATA_SCIENCE_PLAN_ID]: DATA_SCIENCE_PLAN,
};

export function extractCoursePlanId(input) {
  const text = String(input || '').trim();
  const match = text.match(/\/plan\/([a-f0-9]{32})/i) || text.match(/^([a-f0-9]{32})$/i);
  return match ? match[1].toLowerCase() : '';
}

export function getKnownCoursePlan(input) {
  const id = extractCoursePlanId(input);
  return id ? KNOWN_PLANS[id] || null : null;
}

export function applyCoursePlan(state, plan, opts = {}) {
  if (!plan || !Array.isArray(plan.subjects)) throw new Error('Invalid course plan');
  if (opts.replace !== false) {
    state.years = {};
  }

  state.setup = {
    completed: true,
    startYear: plan.startYear,
    startSemester: plan.startSemester,
  };
  state.lookaheadYears = Math.max(1, Math.max(...plan.subjects.map(s => s.year)) - plan.startYear + 1);
  state.degreeSubjectCount = plan.degreeSubjectCount || plan.subjects.length;
  state.coursePlan = {
    id: plan.id,
    title: plan.title,
    courseName: plan.courseName,
    major: plan.major,
    sourceUrl: `https://course-planner.unimelb.edu.au/plan/${plan.id}`,
    importedAt: new Date().toISOString(),
  };

  for (const item of plan.subjects) {
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
