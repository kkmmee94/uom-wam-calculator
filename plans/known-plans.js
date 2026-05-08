// Curated registry of known UoM Course Planner share links.
// Add a new plan by appending an entry below — no code changes needed.
//
// To add your plan: open Course Planner, copy the share-link plan ID from the
// URL (.../plan/<this-bit>), and fill in the subjects array. The shape
// matches what the bookmarklet exports, so you can paste a captured JSON here.

export const KNOWN_PLANS = {
  // Bachelor of Science (Data Science) — Sem 2 2025 entry
  '847dcf8c06db4b0587b5feb47c39e2da': {
    id: '847dcf8c06db4b0587b5feb47c39e2da',
    title: 'Data Science',
    courseName: 'Bachelor of Science',
    major: 'Data Science',
    startYear: 2025,
    startSemester: 2,
    degreeSubjectCount: 24,
    subjects: [
      { year: 2025, term: 'sem2', category: 'Compulsory', code: 'SCIE10005', level: 1, points: 12.5, name: "Today's Science, Tomorrow's World", gradingMode: 'passFail' },
      { year: 2025, term: 'sem2', category: 'Discipline',  code: 'MAST10006', level: 1, points: 12.5, name: 'Calculus 2' },
      { year: 2025, term: 'sem2', category: 'Discipline',  code: 'MAST10010', level: 1, points: 12.5, name: 'Data Analysis' },
      { year: 2025, term: 'sem2', category: 'Discipline',  code: 'COMP10001', level: 1, points: 12.5, name: 'Foundations of Computing' },

      { year: 2026, term: 'summer', category: 'Discipline', code: 'MAST10007', level: 1, points: 12.5, name: 'Linear Algebra' },
      { year: 2026, term: 'summer', category: 'Breadth',    code: 'ECON10004', level: 1, points: 12.5, name: 'Introductory Microeconomics' },

      { year: 2026, term: 'sem1', category: 'Discipline', code: 'MAST20004', level: 2, points: 12.5, name: 'Probability' },
      { year: 2026, term: 'sem1', category: 'Discipline', code: 'MAST20026', level: 2, points: 12.5, name: 'Real Analysis' },
      { year: 2026, term: 'sem1', category: 'Discipline', code: 'COMP10002', level: 1, points: 12.5, name: 'Foundations of Algorithms' },
      { year: 2026, term: 'sem1', category: 'Breadth',    code: 'ECOM20001', level: 2, points: 12.5, name: 'Econometrics 1' },

      { year: 2026, term: 'sem2', category: 'Discipline', code: 'MAST20005', level: 2, points: 12.5, name: 'Statistics' },
      { year: 2026, term: 'sem2', category: 'Discipline', code: 'COMP20008', level: 2, points: 12.5, name: 'Elements of Data Processing' },
      { year: 2026, term: 'sem2', category: 'Discipline', code: 'SWEN20003', level: 2, points: 12.5, name: 'Object Oriented Software Development' },
      { year: 2026, term: 'sem2', category: 'Discipline', code: 'INFO20003', level: 2, points: 12.5, name: 'Database Systems' },

      { year: 2027, term: 'sem1', category: 'Data Science Major', code: 'MAST30025', level: 3, points: 12.5, name: 'Linear Statistical Models' },
      { year: 2027, term: 'sem1', category: 'Data Science Major', code: 'COMP30027', level: 3, points: 12.5, name: 'Machine Learning' },
      { year: 2027, term: 'sem1', category: 'Discipline',         code: 'COMP20007', level: 2, points: 12.5, name: 'Design of Algorithms' },

      { year: 2027, term: 'sem2', category: 'Data Science Major', code: 'MAST30027', level: 3, points: 12.5, name: 'Modern Applied Statistics' },
      { year: 2027, term: 'sem2', category: 'Data Science Major', code: 'MAST30034', level: 3, points: 12.5, name: 'Applied Data Science' },
      { year: 2027, term: 'sem2', category: 'Discipline',         code: 'MAST30001', level: 3, points: 12.5, name: 'Stochastic Modelling' },
      { year: 2027, term: 'sem2', category: 'Breadth',            code: 'ECOM30004', level: 3, points: 12.5, name: 'Time Series Analysis and Forecasting' },

      { year: 2028, term: 'sem1', category: 'Discipline', code: 'COMP30024', level: 3, points: 12.5, name: 'Artificial Intelligence' },
      { year: 2028, term: 'sem1', category: 'Discipline', code: 'COMP30023', level: 3, points: 12.5, name: 'Computer Systems' },
      { year: 2028, term: 'sem1', category: 'Breadth',    code: 'CMCE10002', level: 1, points: 12.5, name: 'Foundations of Business Analytics' },
    ],
  },
};

// Subjects published as pass/fail-only by UoM. The bookmarklet doesn't expose
// the grading scheme directly, so we tag known codes here.
export const PASS_FAIL_SUBJECT_CODES = new Set([
  'SCIE10005', // Today's Science, Tomorrow's World
  'UNIB20021', // Talking Teaching
]);
