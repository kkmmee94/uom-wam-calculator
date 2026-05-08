// Main app entry. Renders the UI from state, handles events, and persists.

import {
  loadState, saveState, clearState,
  TERMS, termInfo, getTerm, allSubjects,
  newSubject, newAssessment, buildTimeline,
  exportJSON, importJSON,
} from './storage.js';

import {
  GRADE_BANDS, TARGET_THRESHOLDS, gradeBandFor,
  totalWeight, lockedInContribution, currentPerformance, remainingWeight,
  requiredScoreFor, predictedFinal, finalMark, projectedFinal,
  isSubjectComplete, currentWAM, predictedWAM, requiredAverageForWAM,
  subjectWAMMark, directFinalMark, isPassFailSubject,
  hasActualScore, hasPredictedScore, round,
} from './calculator.js';

import {
  applyCoursePlan, getKnownCoursePlan, parsePayload,
  consumeImportFragment, buildBookmarklet, extractCoursePlanId,
} from './course-planner-import.js';

// === State + persistence ===
let state = loadState();

function persist() { saveState(state); }
function update(fn) {
  fn(state);
  persist();
  render();
}

// === Helpers ===
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

function fmtMark(m, places = 2) {
  if (m == null || Number.isNaN(m)) return '—';
  return round(m, places).toFixed(places).replace(/\.00$/, '');
}

function gradePill(mark, opts = {}) {
  if (mark == null) {
    return `<span class="pill pill-incomplete">${opts.emptyLabel || '—'}</span>`;
  }
  const band = gradeBandFor(mark);
  const cls = {
    H1: 'pill-h1', H2A: 'pill-h2a', H2B: 'pill-h2b',
    H3: 'pill-h3', P: 'pill-pass', N: 'pill-fail',
  }[band.key] || '';
  const label = opts.kind === 'predicted' ? `Pred. ${band.label}` : band.label;
  return `<span class="pill ${cls}" title="${band.description} (${band.min}+)">${label}</span>`;
}

function passFailPill(status) {
  if (status === 'passed') return '<span class="pill pill-h1">Passed</span>';
  if (status === 'failed') return '<span class="pill pill-fail">Failed</span>';
  return '<span class="pill pill-incomplete">Pass/Fail</span>';
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

function toNullableNumber(value, min = 0, max = 100) {
  if (value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.min(max, Math.max(min, n));
}

function toast(msg, kind = '') {
  const root = $('#toasts');
  const el = document.createElement('div');
  el.className = 'toast' + (kind ? ' ' + kind : '');
  el.textContent = msg;
  root.appendChild(el);
  setTimeout(() => el.remove(), 3500);
}

// === Setup flow ===
function renderSetup() {
  const section = $('#setup-section');
  const wam = $('#wam-section');
  const timeline = $('#timeline-section');
  const sectionHead = $('#timeline-section .section-head');
  if (state.setup.completed) {
    section.hidden = true;
    section.innerHTML = '';
    wam.hidden = false;
    timeline.hidden = false;
    if (sectionHead) sectionHead.hidden = false;
    return;
  }
  // First-time prompt — hide everything else.
  section.hidden = false;
  wam.hidden = true;
  timeline.hidden = true;

  const currentYear = new Date().getFullYear();
  const yearOptions = [];
  for (let y = currentYear + 1; y >= currentYear - 8; y--) {
    yearOptions.push(`<option value="${y}"${y === currentYear ? ' selected' : ''}>${y}</option>`);
  }

  section.innerHTML = `
    <div class="setup-banner" role="region" aria-labelledby="setup-h">
      <h2 id="setup-h">Welcome — let's set up your timeline</h2>
      <p>Tell us when you started at the University of Melbourne so we can lay out your semesters. You can change this later.</p>
      <form class="setup-form" id="setup-form">
        <label class="field">
          <span>Start year</span>
          <select name="startYear">${yearOptions.join('')}</select>
        </label>
        <label class="field">
          <span>Started in</span>
          <select name="startSemester">
            <option value="1">Semester 1</option>
            <option value="2">Semester 2</option>
          </select>
        </label>
        <div class="full" style="display: flex; gap: 8px; flex-wrap: wrap; margin-top: 6px;">
          <button class="btn" type="submit" id="setup-submit">Get started</button>
          <button class="btn btn-secondary" type="button" id="setup-planner-import">Import Course Planner link</button>
          <button class="btn btn-secondary" type="button" id="setup-import">Import existing data</button>
        </div>
      </form>
    </div>
  `;

  const setupForm = $('#setup-form');
  const completeSetup = (form) => {
    const fd = new FormData(form);
    update((s) => {
      s.setup = {
        completed: true,
        startYear: Number(fd.get('startYear')),
        startSemester: Number(fd.get('startSemester')),
      };
    });
  };

  setupForm.addEventListener('submit', (e) => {
    e.preventDefault();
    completeSetup(e.currentTarget);
  });
  $('#setup-submit').addEventListener('click', (e) => {
    e.preventDefault();
    completeSetup(setupForm);
  });
  $('#setup-import').addEventListener('click', () => $('#import-file').click());
  $('#setup-planner-import').addEventListener('click', openCoursePlannerImport);
}

// === WAM dashboard ===
function renderWAMSection() {
  const section = $('#wam-section');
  const subjects = allSubjects(state).map(x => x.subject);
  const wamMode = state.settings?.wamMode === 'official' ? 'official' : 'simple';
  const cur = currentWAM(subjects, wamMode);
  const pred = predictedWAM(subjects, wamMode);

  const completeCount = subjects.filter(isSubjectComplete).length;
  const inProgressCount = subjects.filter(s => !isSubjectComplete(s) && (s.assessments || []).length > 0).length;

  const curBand = cur != null ? gradeBandFor(cur) : null;
  const predBand = pred != null ? gradeBandFor(pred) : null;

  // WAM target planning: how many subjects remain in your degree?
  // Derive a simple estimate: degrees are typically 24 subjects (full 3-year UoM).
  // Use whichever the user told us, or default 24.
  const totalDegree = state.degreeSubjectCount || 24;
  const completedMarks = subjects.filter(isSubjectComplete)
    .map(s => subjectWAMMark(s, { includeProjected: true }))
    .filter(x => x != null);
  const remainingDegreeSubjects = Math.max(0, totalDegree - completedMarks.length);
  const passFailCount = subjects.filter(isPassFailSubject).length;

  const coursePlanHtml = state.coursePlan ? `
    <div class="course-card">
      <div>
        <span class="wam-card-title">Course plan</span>
        <strong>${escapeHtml(state.coursePlan.courseName || 'Imported course')}</strong>
        <span>${escapeHtml(state.coursePlan.major || state.coursePlan.title || '')}</span>
      </div>
      <div class="course-card-meta">
        <span><b>${subjects.length}</b> subjects</span>
        ${passFailCount ? `<span><b>${passFailCount}</b> pass/fail</span>` : ''}
      </div>
    </div>
  ` : '';

  const target = state.targetWAM ?? '';
  let targetOut = '';
  let targetClass = '';
  if (target !== '' && target != null && !Number.isNaN(Number(target))) {
    const t = Number(target);
    const r = requiredAverageForWAM(completedMarks, remainingDegreeSubjects, t);
    if (r.alreadyReached) {
      targetClass = 'ok';
      targetOut = `You've already met your target — even averaging 0 on the remaining ${remainingDegreeSubjects} subjects keeps you above ${t} WAM.`;
    } else if (r.impossible) {
      targetClass = 'danger';
      targetOut = `Reaching ${t} WAM is no longer possible — you'd need to average ${fmtMark(r.required)} across the remaining ${remainingDegreeSubjects} subjects.`;
    } else if (r.noRemaining) {
      targetClass = 'warn';
      targetOut = `No remaining subjects to lift your WAM. Adjust the degree subject count or your target.`;
    } else {
      targetClass = 'warn';
      const gradeBand = gradeBandFor(r.required);
      targetOut = `You need to average <b>${fmtMark(r.required)}</b> (${gradeBand.label}) across the remaining <b>${remainingDegreeSubjects}</b> subjects.`;
    }
  } else {
    targetOut = 'Enter a target WAM to see what average you need across remaining subjects.';
  }

  const wamModeToggle = `
    <div class="wam-mode-toggle">
      <button type="button" class="${wamMode === 'simple' ? 'is-active' : ''}" data-wam-mode="simple" title="Simple average — every subject counts equally.">Simple</button>
      <button type="button" class="${wamMode === 'official' ? 'is-active' : ''}" data-wam-mode="official" title="UoM transcript WAM — weighted by points × level (level-2+ subjects count double).">Official</button>
    </div>
  `;

  section.innerHTML = `
    ${coursePlanHtml}
    <div class="wam-card" id="wam-current">
      <div class="wam-card-header">
        <span class="wam-card-title">Current WAM ${wamModeToggle}</span>
        ${curBand ? gradePill(cur) : '<span class="pill pill-incomplete">No marks yet</span>'}
      </div>
      <div class="wam-value">
        ${cur == null
          ? '<span class="empty">No completed subjects yet</span>'
          : `${fmtMark(cur)}<span class="unit">/ 100</span>`}
      </div>
      <div class="wam-meta">
        <span><b>${completeCount}</b> completed</span>
        <span><b>${inProgressCount}</b> in progress</span>
      </div>
    </div>

    <div class="wam-card" id="wam-predicted">
      <div class="wam-card-header">
        <span class="wam-card-title">Predicted WAM</span>
        ${predBand ? gradePill(pred, { kind: 'predicted' }) : '<span class="pill pill-incomplete">—</span>'}
      </div>
      <div class="wam-value">
        ${pred == null
          ? '<span class="empty">Add scores to see a prediction</span>'
          : `${fmtMark(pred)}<span class="unit">/ 100</span>`}
      </div>
      <div class="wam-meta">
        <span>Includes in-progress subjects projected from current performance and predictions.</span>
      </div>
    </div>

    <div class="wam-target">
      <div class="wam-target-row">
        <label for="target-wam">Target WAM</label>
        <input id="target-wam" type="number" min="0" max="100" step="0.1" inputmode="decimal" value="${target}" placeholder="—" />
        <div class="spacer"></div>
        <label class="field" style="flex-direction: row; align-items: center; gap: 6px;">
          <span style="font-size:13px; color: var(--text-soft); font-weight: 500;">Subjects in degree</span>
          <input id="degree-count" type="number" min="1" max="40" step="1" inputmode="numeric" value="${totalDegree}" style="width: 70px; padding: 7px 9px; border: 1px solid var(--border-strong); border-radius: 8px; background: var(--bg-elev); color: var(--text); font: inherit;" />
        </label>
      </div>
      <div class="wam-target-out ${targetClass}">${targetOut}</div>
    </div>
  `;

  $$('.wam-mode-toggle button').forEach(btn => {
    btn.addEventListener('click', () => {
      const mode = btn.dataset.wamMode === 'official' ? 'official' : 'simple';
      state.settings = state.settings || {};
      state.settings.wamMode = mode;
      persist();
      renderWAMSection();
    });
  });

  $('#target-wam').addEventListener('input', (e) => {
    const v = e.target.value;
    state.targetWAM = toNullableNumber(v);
    persist();
  });
  $('#target-wam').addEventListener('change', () => {
    renderWAMSection();
  });
  $('#degree-count').addEventListener('input', (e) => {
    const v = Math.max(1, Math.min(40, Number(e.target.value) || 24));
    state.degreeSubjectCount = v;
    persist();
  });
  $('#degree-count').addEventListener('change', () => {
    renderWAMSection();
  });
}

// === Timeline (years/terms/subjects) ===
function renderTimeline() {
  const root = $('#timeline');
  if (!state.setup.startYear) {
    root.innerHTML = '';
    return;
  }
  // Compute a timeline that covers max(default lookahead, any year already used + 1).
  const usedYears = Object.keys(state.years || {}).map(Number).filter(y => !Number.isNaN(y));
  const lookaheadFromState = usedYears.length
    ? Math.max(1, Math.max(...usedYears) - state.setup.startYear + 1)
    : 0;
  const lookahead = Math.max(state.lookaheadYears || 4, lookaheadFromState);
  state.lookaheadYears = lookahead;

  const timeline = buildTimeline(state.setup.startYear, state.setup.startSemester, lookahead);

  // Group by year, preserving term order.
  const byYear = new Map();
  for (const c of timeline) {
    if (!byYear.has(c.year)) byYear.set(c.year, []);
    byYear.get(c.year).push(c.term);
  }

  const html = [];
  const years = Array.from(byYear.keys());
  const lastVisibleYear = years[years.length - 1];
  for (const [year, terms] of byYear.entries()) {
    // Year-level summary
    const yearSubjects = [];
    for (const tk of terms) {
      const term = state.years?.[year]?.[tk];
      if (term && term.subjects) yearSubjects.push(...term.subjects);
    }
    const completedCount = yearSubjects.filter(isSubjectComplete).length;
    const totalCount = yearSubjects.length;

    const termCards = terms.map(tk => renderTermCard(year, tk)).join('');
    html.push(`
      <div class="year-block">
        <div class="year-head">
          <h3>${year}</h3>
          <div class="year-actions">
            <span class="year-summary">${completedCount}/${totalCount} subjects complete</span>
            ${year === lastVisibleYear && (state.lookaheadYears || 4) > 1
              ? `<button class="btn-link remove-year-btn" data-year="${year}" type="button">Remove year</button>`
              : ''}
          </div>
        </div>
        <div class="terms-grid">${termCards}</div>
      </div>
    `);
  }
  root.innerHTML = html.join('');

  // Wire up subject and add-subject clicks.
  $$('.subject-row').forEach(el => {
    el.addEventListener('click', () => {
      const year = Number(el.dataset.year);
      const term = el.dataset.term;
      const id = el.dataset.id;
      openSubjectEditor(year, term, id);
    });
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        el.click();
      }
    });
  });
  $$('.add-subject-btn').forEach(el => {
    el.addEventListener('click', () => {
      const year = Number(el.dataset.year);
      const term = el.dataset.term;
      const t = termInfo(term);
      update((s) => {
        const t2 = getTerm(s, year, term);
        if (t2.subjects.length >= t.maxSubjects) return;
        const subj = newSubject(`Subject ${t2.subjects.length + 1}`);
        t2.subjects.push(subj);
        // Open editor straight away
        setTimeout(() => openSubjectEditor(year, term, subj.id), 0);
      });
    });
  });
  $$('.remove-year-btn').forEach(el => {
    el.addEventListener('click', () => {
      const year = Number(el.dataset.year);
      const yearHasSubjects = Object.values(state.years?.[year] || {})
        .some(term => (term.subjects || []).length > 0);
      if (yearHasSubjects && !confirm(`Remove ${year} and all subjects in it? This cannot be undone.`)) return;
      if (state.years) delete state.years[year];
      state.lookaheadYears = Math.max(1, (state.lookaheadYears || 4) - 1);
      persist();
      renderTimeline();
      renderWAMSection();
    });
  });
}

function renderTermCard(year, termKey) {
  const t = termInfo(termKey);
  const term = state.years?.[year]?.[termKey] || { subjects: [] };
  const subjects = term.subjects || [];

  // Term-level stats
  const finals = [];
  let inProgress = 0;
  for (const s of subjects) {
    const fm = finalMark(s.assessments || []);
    if (fm != null) finals.push(fm);
    else if ((s.assessments || []).some(hasActualScore) || (s.assessments || []).some(hasPredictedScore)) inProgress++;
  }
  const proj = subjects
    .map(s => subjectWAMMark(s, { includeProjected: true }))
    .filter(x => x != null);
  const avg = proj.length ? proj.reduce((a, b) => a + b, 0) / proj.length : null;

  const subjectRows = subjects.map(s => renderSubjectRow(year, termKey, s)).join('');

  const canAdd = subjects.length < t.maxSubjects;
  const recommended = t.recommendedMax ?? t.maxSubjects;
  const overload = subjects.length > recommended;
  return `
    <div class="term-card${overload ? ' is-overload' : ''}">
      <div class="term-head">
        <h4>${t.label} <span class="term-tag${overload ? ' tag-overload' : ''}">${subjects.length}/${t.maxSubjects}</span></h4>
        ${avg != null ? gradePill(avg, { kind: subjects.every(isSubjectComplete) ? 'actual' : 'predicted' }) : ''}
      </div>
      ${avg != null
        ? `<div class="term-summary"><span>Avg <b>${fmtMark(avg)}</b></span></div>`
        : ''}
      ${overload
        ? `<div class="overload-warn" title="Standard load is ${recommended}. Overload normally requires faculty approval.">⚠️ Over standard load (${subjects.length} > ${recommended})</div>`
        : ''}
      <div class="subject-list">
        ${subjects.length === 0
          ? `<div class="hint" style="padding: 4px 2px;">No subjects yet.</div>`
          : subjectRows}
        ${canAdd
          ? `<button class="add-subject-btn" data-year="${year}" data-term="${termKey}" type="button">+ Add subject</button>`
          : ''}
      </div>
    </div>
  `;
}

function renderSubjectRow(year, termKey, subj) {
  const assessments = subj.assessments || [];
  const total = totalWeight(assessments);
  const direct = directFinalMark(subj);
  const fm = finalMark(assessments);
  const proj = projectedFinal(subj);
  const complete = isSubjectComplete(subj);
  const isPassFail = isPassFailSubject(subj);

  // At-risk: a Pass is mathematically out of reach, or projection is below 50.
  let atRisk = false;
  const passNeeded = requiredScoreFor(assessments, 50);
  if (!isPassFail && direct == null && passNeeded.impossible) atRisk = true;
  if (!isPassFail && proj != null && proj < 50) atRisk = true;

  // Mark display
  let markHtml = '';
  let pillHtml = '';
  if (isPassFail) {
    markHtml = `<span class="mark-num">${subj.passFailStatus === 'failed' ? 'Fail' : (subj.passFailStatus === 'passed' ? 'Pass' : '—')}</span>`;
    pillHtml = passFailPill(subj.passFailStatus);
  } else if (direct != null) {
    markHtml = `<span class="mark-num">${fmtMark(direct)}</span>`;
    pillHtml = gradePill(direct);
  } else if (fm != null) {
    markHtml = `<span class="mark-num">${fmtMark(fm)}</span>`;
    pillHtml = gradePill(fm);
  } else if (proj != null) {
    markHtml = `<span class="mark-num">${fmtMark(proj)}</span>`;
    pillHtml = gradePill(proj, { kind: 'predicted' });
  } else {
    markHtml = `<span class="mark-num empty">—</span>`;
    pillHtml = `<span class="pill pill-incomplete">No data</span>`;
  }

  const cls = ['subject-row'];
  if (complete) cls.push('subject-completed');
  if (atRisk) cls.push('subject-at-risk');

  const detail = [];
  if (subj.code) detail.push(escapeHtml(subj.code));
  if (subj.category) detail.push(escapeHtml(subj.category));
  if (subj.level) detail.push(`Level ${subj.level}`);
  if (isPassFail) detail.push('Pass/Fail');
  else if (direct != null) detail.push('final mark entered');
  else if (assessments.length) detail.push(`${assessments.length} assessment${assessments.length === 1 ? '' : 's'}`);
  if (!isPassFail && direct == null && total !== 100 && assessments.length > 0) detail.push(`weights: ${total}%`);

  return `
    <div class="${cls.join(' ')}" data-year="${year}" data-term="${termKey}" data-id="${subj.id}" tabindex="0" role="button" aria-label="Edit ${escapeHtml(subj.name)}">
      <div class="subject-info">
        <div class="subject-name">${escapeHtml(subj.name) || 'Untitled subject'}</div>
        <div class="subject-detail">${detail.join(' · ') || ' '}</div>
      </div>
      <div class="subject-mark">
        ${markHtml}
        ${pillHtml}
      </div>
    </div>
  `;
}

// === Subject editor modal ===
let modalSubjectRef = null; // { year, term, id }

function openSubjectEditor(year, term, id) {
  modalSubjectRef = { year, term, id };
  renderModal();
  document.body.style.overflow = 'hidden';
}

function closeModal() {
  modalSubjectRef = null;
  $('#modal-root').hidden = true;
  $('#modal-root').innerHTML = '';
  document.body.style.overflow = '';
}

function openCoursePlannerImport(prefill = null) {
  modalSubjectRef = null;
  const root = $('#modal-root');
  document.body.style.overflow = 'hidden';
  root.hidden = false;

  const returnUrl = location.origin + location.pathname;
  const bookmarklet = buildBookmarklet(returnUrl);
  const initialUrl = prefill?.url ? escapeHtml(prefill.url) : '';
  const initialJson = prefill?.json ? escapeHtml(prefill.json) : '';
  const initialError = prefill?.error || '';

  root.innerHTML = `
    <div class="modal modal-narrow" role="dialog" aria-modal="true" aria-labelledby="planner-import-title">
      <div class="modal-head">
        <h3 id="planner-import-title">Import from Course Planner</h3>
        <button class="btn-icon" id="planner-import-close" aria-label="Close">×</button>
      </div>
      <div class="modal-body">
        <p class="hint">Pull your subjects directly from the University of Melbourne Course Planner. Three ways to do it:</p>

        <details class="import-step" open>
          <summary><strong>1. Use the bookmarklet</strong> <span class="step-tag">recommended</span></summary>
          <div class="step-body">
            <p class="hint">Drag this button to your bookmarks bar, then open your plan on Course Planner and click the bookmarklet:</p>
            <p>
              <a class="btn btn-secondary bookmarklet" id="planner-bookmarklet" href="${bookmarklet}" draggable="true" onclick="event.preventDefault(); alert('Drag this button to your bookmarks bar — clicking it from this page does nothing.');">📌 Send to WAM Calculator</a>
            </p>
            <ol class="hint-list">
              <li>Drag the button above onto your bookmarks bar (or right-click → Bookmark this link).</li>
              <li>Open your plan on <a href="https://course-planner.unimelb.edu.au/" target="_blank" rel="noopener">Course Planner</a> while signed in to your UoM account.</li>
              <li>Click the bookmark — your plan opens here automatically.</li>
            </ol>
          </div>
        </details>

        <details class="import-step">
          <summary><strong>2. Paste a share link</strong></summary>
          <div class="step-body">
            <p class="hint">If your plan link matches one we've curated, we'll import it directly. Otherwise we can't fetch the data — Course Planner needs your login session, so use the bookmarklet above.</p>
            <label class="field">
              <span>Course Planner link</span>
              <input id="planner-import-url" type="url" inputmode="url" placeholder="https://course-planner.unimelb.edu.au/B-SCI/2025/plan/..." autocomplete="off" value="${initialUrl}" />
            </label>
            <button class="btn btn-secondary btn-sm" id="planner-import-link-btn" type="button">Try this link</button>
          </div>
        </details>

        <details class="import-step">
          <summary><strong>3. Paste exported JSON</strong></summary>
          <div class="step-body">
            <p class="hint">If you already saved a plan from another browser or shared it with a friend, paste it here.</p>
            <label class="field">
              <span>JSON payload</span>
              <textarea id="planner-import-json" rows="5" placeholder='{"subjects":[…]}'>${initialJson}</textarea>
            </label>
            <button class="btn btn-secondary btn-sm" id="planner-import-json-btn" type="button">Import JSON</button>
          </div>
        </details>

        <label class="check-row">
          <input id="planner-import-replace" type="checkbox" checked />
          <span>Replace my current timeline</span>
        </label>
        <div id="planner-import-error" class="weight-warn warn ${initialError ? '' : 'is-hidden'}">${escapeHtml(initialError)}</div>
      </div>
      <div class="modal-foot">
        <button class="btn btn-secondary" id="planner-import-cancel" type="button">Close</button>
      </div>
    </div>
  `;

  const errorEl = $('#planner-import-error');
  const showError = (msg) => {
    errorEl.textContent = msg;
    errorEl.classList.remove('is-hidden');
  };
  const tryApply = (plan) => {
    const replace = $('#planner-import-replace').checked;
    if (replace && allSubjects(state).length > 0 && !confirm('Replace your current timeline with this course plan? Your current data will be cleared.')) return;
    try {
      applyCoursePlan(state, plan, { replace });
    } catch (e) {
      showError('Could not apply this plan: ' + e.message);
      return;
    }
    persist();
    closeModal();
    render();
    toast(`Imported ${plan.subjects.length} subjects from Course Planner`, 'success');
  };

  $('#planner-import-close').addEventListener('click', closeModal);
  $('#planner-import-cancel').addEventListener('click', closeModal);
  root.addEventListener('click', (e) => { if (e.target === root) closeModal(); });

  $('#planner-import-link-btn').addEventListener('click', () => {
    const url = $('#planner-import-url').value;
    const id = extractCoursePlanId(url);
    if (!id) {
      showError("That doesn't look like a Course Planner share link. It should look like https://course-planner.unimelb.edu.au/.../plan/<id>.");
      return;
    }
    const plan = getKnownCoursePlan(url);
    if (!plan) {
      showError(`That plan (${id.slice(0, 8)}…) isn't in our curated list. Course Planner requires your UoM login to fetch the data, so use the bookmarklet above instead.`);
      return;
    }
    tryApply(plan);
  });

  $('#planner-import-json-btn').addEventListener('click', () => {
    const text = $('#planner-import-json').value;
    const plan = parsePayload(text);
    if (!plan) {
      showError("Couldn't read that JSON. Make sure it has a `subjects` array.");
      return;
    }
    tryApply(plan);
  });
}

function getModalSubject() {
  if (!modalSubjectRef) return null;
  const { year, term, id } = modalSubjectRef;
  const t = state.years?.[year]?.[term];
  if (!t) return null;
  return t.subjects.find(s => s.id === id) || null;
}

function renderModal() {
  const root = $('#modal-root');
  if (!modalSubjectRef) {
    root.hidden = true;
    root.innerHTML = '';
    return;
  }
  const subj = getModalSubject();
  if (!subj) {
    closeModal();
    return;
  }
  const { year, term } = modalSubjectRef;
  const tInfo = termInfo(term);

  const assessments = subj.assessments || [];
  const isPassFail = isPassFailSubject(subj);
  const direct = directFinalMark(subj);
  const useDirectMark = direct != null;
  const showAssessmentTools = !isPassFail && !useDirectMark;
  const total = totalWeight(assessments);
  const assessmentFinal = finalMark(assessments);
  const fm = direct ?? assessmentFinal;
  const proj = isPassFail ? null : projectedFinal(subj);
  const cur = showAssessmentTools ? currentPerformance(assessments) : null;
  const lockedWeight = showAssessmentTools
    ? assessments.reduce((s, a) => s + (hasActualScore(a) ? Number(a.weight) || 0 : 0), 0)
    : 0;
  const locked = showAssessmentTools ? lockedInContribution(assessments) : 0;

  // Required scores for each band
  const requiredCells = showAssessmentTools ? TARGET_THRESHOLDS.map(thr => {
    const r = requiredScoreFor(assessments, thr.min);
    let cls = '', body = '', helper = '';
    if (r.alreadyReached) {
      cls = 'ok';
      body = '<span class="num">Already</span>';
      helper = `Already reached ${thr.label} (${thr.min}+).`;
    } else if (r.impossible) {
      cls = 'danger';
      body = `<span class="num">${fmtMark(r.required)}</span>`;
      helper = `Out of reach — would need &gt;100.`;
    } else if (r.noRemaining) {
      cls = 'danger';
      body = '<span class="num">—</span>';
      helper = `No remaining assessments.`;
    } else {
      const reqBand = gradeBandFor(r.required);
      if (r.required >= 90) cls = 'warn';
      else if (r.required >= 75) cls = '';
      else cls = 'ok';
      body = `<span class="num">${fmtMark(r.required, 1)}</span>`;
      helper = `Avg across remaining ${remainingWeight(assessments)}% of weight (≈ ${reqBand.label})`;
    }
    return `
      <div class="required-cell ${cls}">
        <div class="target"><span>${thr.label}</span><span>${thr.min}+</span></div>
        ${body}
        <div class="helper">${helper}</div>
      </div>
    `;
  }).join('') : '';

  // Assessments table (desktop) + stack (mobile)
  const rowsHtml = assessments.map((a, i) => `
    <tr data-aid="${a.id}">
      <td><input type="text" data-field="name" value="${escapeHtml(a.name)}" placeholder="e.g. Assignment ${i + 1}" /></td>
      <td class="col-num"><input type="number" class="input-num" data-field="weight" value="${a.weight ?? ''}" min="0" max="100" step="0.1" inputmode="decimal" placeholder="—" /></td>
      <td class="col-num"><input type="number" class="input-num" data-field="score" value="${a.score ?? ''}" min="0" max="100" step="0.1" inputmode="decimal" placeholder="—" /></td>
      <td class="col-num"><input type="number" class="input-num" data-field="predicted" value="${a.predicted ?? ''}" min="0" max="100" step="0.1" inputmode="decimal" placeholder="—" /></td>
      <td class="col-actions"><button class="btn-icon btn-del" type="button" aria-label="Delete assessment">×</button></td>
    </tr>
  `).join('');

  const stackHtml = assessments.map((a, i) => `
    <div class="assessment-card" data-aid="${a.id}">
      <div class="field-with-label full">
        <label>Assessment name</label>
        <input type="text" data-field="name" value="${escapeHtml(a.name)}" placeholder="e.g. Assignment ${i + 1}" />
      </div>
      <div class="row">
        <div class="field-with-label">
          <label>Weight (%)</label>
          <input type="number" class="input-num" data-field="weight" value="${a.weight ?? ''}" min="0" max="100" step="0.1" inputmode="decimal" placeholder="—" />
        </div>
        <div class="field-with-label">
          <label>Actual score</label>
          <input type="number" class="input-num" data-field="score" value="${a.score ?? ''}" min="0" max="100" step="0.1" inputmode="decimal" placeholder="—" />
        </div>
        <div class="field-with-label full">
          <label>Predicted score (what-if)</label>
          <input type="number" class="input-num" data-field="predicted" value="${a.predicted ?? ''}" min="0" max="100" step="0.1" inputmode="decimal" placeholder="—" />
        </div>
      </div>
      <div class="delete-row">
        <button class="btn btn-secondary btn-sm btn-del" type="button">Remove</button>
      </div>
    </div>
  `).join('');

  // Weight validation message
  let weightMsg = '';
  if (!showAssessmentTools || assessments.length === 0) {
    weightMsg = '';
  } else if (total === 100) {
    weightMsg = `<div class="weight-warn ok">Weights total <b>100%</b>.</div>`;
  } else {
    weightMsg = `<div class="weight-warn warn">Weights total <b>${fmtMark(total, 1)}%</b> — these should add to 100%.</div>`;
  }

  // At-risk warning if any required score is impossible
  const passReq = requiredScoreFor(assessments, 50);
  let atRiskMsg = '';
  if (showAssessmentTools && passReq.impossible) {
    atRiskMsg = `<div class="weight-warn warn">⚠️ A passing mark is no longer mathematically possible.</div>`;
  }

  // Display strings for the 4 summary cells. We avoid showing the same number twice
  // (final-when-incomplete and projected are identical), so we instead show the
  // remaining-weight percentage as the fourth metric.
  const finalMarkDisplay = fm != null
    ? `<span>${fmtMark(fm)}</span><small>${gradeBandFor(fm).label}</small>`
    : (proj != null ? `<span>${fmtMark(proj)}</span><small>predicted ${gradeBandFor(proj).label}</small>` : '<span class="empty">—</span>');
  const curDisplay = cur != null
    ? `<span>${fmtMark(cur)}</span><small>${fmtMark(lockedWeight, 0)}% done</small>`
    : '<span class="empty">—</span>';
  const lockedDisplay = locked > 0
    ? `<span>${fmtMark(locked)}</span><small>of 100</small>`
    : '<span class="empty">—</span>';
  const remW = remainingWeight(assessments);
  const remainingDisplay = assessments.length === 0
    ? '<span class="empty">—</span>'
    : `<span>${fmtMark(remW, 0)}<small>%</small></span><small>still to score</small>`;
  const passFailOutcome = subj.passFailStatus || '';
  const summaryHtml = isPassFail ? `
    <div class="summary-cell">
      <span class="lbl">Outcome</span>
      <span class="val">${passFailOutcome ? `<span>${passFailOutcome === 'passed' ? 'Passed' : 'Failed'}</span>` : '<span class="empty">—</span>'}</span>
    </div>
    <div class="summary-cell">
      <span class="lbl">WAM</span>
      <span class="val"><span>Excluded</span><small>pass/fail</small></span>
    </div>
    <div class="summary-cell">
      <span class="lbl">Type</span>
      <span class="val"><span>Pass/Fail</span></span>
    </div>
    <div class="summary-cell">
      <span class="lbl">Points</span>
      <span class="val"><span>${fmtMark(subj.points || 12.5, 1)}</span><small>credit points</small></span>
    </div>
  ` : `
    <div class="summary-cell">
      <span class="lbl">${fm != null ? 'Final mark' : 'Projected mark'}</span>
      <span class="val">${finalMarkDisplay}</span>
    </div>
    <div class="summary-cell">
      <span class="lbl">Locked-in</span>
      <span class="val">${useDirectMark ? '<span>Direct</span><small>final mark</small>' : lockedDisplay}</span>
    </div>
    <div class="summary-cell">
      <span class="lbl">Current avg</span>
      <span class="val">${useDirectMark ? '<span>—</span>' : curDisplay}</span>
    </div>
    <div class="summary-cell">
      <span class="lbl">Remaining</span>
      <span class="val">${useDirectMark ? '<span>0<small>%</small></span><small>complete</small>' : remainingDisplay}</span>
    </div>
  `;

  root.hidden = false;
  root.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">
      <div class="modal-head">
        <h3 id="modal-title">Edit subject</h3>
        <div style="display: flex; gap: 8px; align-items: center;">
          <label class="toggle">
            <input type="checkbox" id="completed-toggle" ${subj.completed ? 'checked' : ''} />
            <span class="track"></span>
            <span>Mark as completed</span>
          </label>
          <button class="btn-icon" id="modal-close" aria-label="Close">×</button>
        </div>
      </div>

      <div class="modal-body">
        <div class="hint">${tInfo.label} ${year}</div>

        <div class="subject-meta-form">
          <label class="field">
            <span>Subject name</span>
            <input type="text" id="subj-name" value="${escapeHtml(subj.name)}" placeholder="e.g. Calculus 2" />
          </label>
          <label class="field">
            <span>Subject code (optional)</span>
            <input type="text" id="subj-code" value="${escapeHtml(subj.code)}" placeholder="e.g. MAST10006" />
          </label>
        </div>

        <div class="subject-mode-panel">
          <label class="toggle">
            <input type="checkbox" id="passfail-toggle" ${isPassFail ? 'checked' : ''} />
            <span class="track"></span>
            <span>Pass/Fail subject</span>
          </label>
          <label class="field ${isPassFail ? 'is-hidden' : ''}" id="direct-mark-field">
            <span>Final subject mark (optional)</span>
            <input type="number" id="final-score" value="${subj.finalScore ?? ''}" min="0" max="100" step="0.1" inputmode="decimal" placeholder="Enter final mark only" />
          </label>
          <div class="field ${isPassFail ? '' : 'is-hidden'}" id="passfail-status-field">
            <span>Pass/Fail outcome</span>
            <div class="status-options" role="group" aria-label="Pass/Fail outcome">
              <label><input type="radio" name="passfail-status" value="" ${passFailOutcome === '' ? 'checked' : ''} /> <span>Not entered</span></label>
              <label><input type="radio" name="passfail-status" value="passed" ${passFailOutcome === 'passed' ? 'checked' : ''} /> <span>Passed</span></label>
              <label><input type="radio" name="passfail-status" value="failed" ${passFailOutcome === 'failed' ? 'checked' : ''} /> <span>Failed</span></label>
            </div>
          </div>
        </div>

        <div class="subject-summary">
          ${summaryHtml}
        </div>

        ${showAssessmentTools ? `
          <h4 style="margin: 6px 0 0; font-size: 14px;">Assessments</h4>
          <table class="assessments-table">
            <thead>
              <tr>
                <th>Name</th>
                <th class="col-num">Weight%</th>
                <th class="col-num">Score</th>
                <th class="col-num">Predicted</th>
                <th class="col-actions"></th>
              </tr>
            </thead>
            <tbody>
              ${rowsHtml || `<tr><td colspan="5" class="assessments-empty">No assessments yet — add one below.</td></tr>`}
            </tbody>
          </table>
          <div class="assessments-stack">
            ${stackHtml || `<div class="assessments-empty">No assessments yet — add one below.</div>`}
          </div>
          <div>
            <button class="btn btn-secondary btn-sm" id="add-assessment" type="button">+ Add assessment</button>
          </div>
          ${weightMsg}
          ${atRiskMsg}

          <h4 style="margin: 6px 0 0; font-size: 14px;">What you'd need on remaining assessments</h4>
          <div class="required-grid">
            ${requiredCells}
          </div>
        ` : `
          <div class="mode-note">
            ${isPassFail
              ? 'This subject is marked pass/fail and is excluded from WAM.'
              : 'The final subject mark is being used. Clear it if you want to calculate from assessments instead.'}
          </div>
        `}

        <label class="field">
          <span>Notes (optional)</span>
          <textarea id="subj-notes" rows="3" placeholder="Anything you want to remember about this subject…">${escapeHtml(subj.notes || '')}</textarea>
        </label>
      </div>

      <div class="modal-foot">
        <button class="btn btn-danger-ghost" id="delete-subject" type="button" style="margin-right: auto;">Delete subject</button>
        <button class="btn btn-secondary" id="modal-cancel" type="button">Close</button>
      </div>
    </div>
  `;

  // Wire up — modal-level
  $('#modal-close').addEventListener('click', closeModal);
  $('#modal-cancel').addEventListener('click', closeModal);

  // Subject-level edits
  const debounceSave = debounce(() => { persist(); renderTimeline(); renderWAMSection(); }, 300);
  $('#subj-name').addEventListener('input', (e) => { subj.name = e.target.value; debounceSave(); });
  $('#subj-code').addEventListener('input', (e) => { subj.code = e.target.value; debounceSave(); });
  $('#subj-notes').addEventListener('input', (e) => { subj.notes = e.target.value; debounceSave(); });

  const finalScoreInput = $('#final-score');
  if (finalScoreInput) {
    finalScoreInput.addEventListener('input', (e) => {
      subj.finalScore = toNullableNumber(e.target.value);
      if (subj.finalScore != null) subj.completed = true;
      persist();
      renderTimeline();
      renderWAMSection();
    });
    finalScoreInput.addEventListener('change', () => {
      if (subj.finalScore == null && (!subj.assessments || subj.assessments.length === 0)) {
        subj.completed = false;
      }
      persist();
      renderModal();
      renderTimeline();
      renderWAMSection();
    });
  }

  const passFailToggle = $('#passfail-toggle');
  if (passFailToggle) {
    passFailToggle.addEventListener('change', (e) => {
      subj.gradingMode = e.target.checked ? 'passFail' : 'graded';
      if (subj.gradingMode === 'passFail') {
        subj.finalScore = null;
        subj.completed = subj.passFailStatus === 'passed' || subj.passFailStatus === 'failed';
      } else {
        subj.passFailStatus = null;
      }
      persist();
      renderModal();
      renderTimeline();
      renderWAMSection();
    });
  }

  $$('input[name="passfail-status"]').forEach(input => {
    input.addEventListener('change', (e) => {
      if (!e.target.checked) return;
      subj.passFailStatus = e.target.value || null;
      subj.completed = subj.passFailStatus === 'passed' || subj.passFailStatus === 'failed';
      persist();
      renderModal();
      renderTimeline();
      renderWAMSection();
    });
  });

  $('#completed-toggle').addEventListener('change', (e) => {
    subj.completed = e.target.checked;
    persist();
    renderModal(); // re-render to reflect badge changes
    renderTimeline();
    renderWAMSection();
  });

  const addAssessment = $('#add-assessment');
  if (addAssessment) {
    addAssessment.addEventListener('click', () => {
      subj.assessments = subj.assessments || [];
      subj.assessments.push(newAssessment(`Assessment ${subj.assessments.length + 1}`));
      persist();
      renderModal();
      renderTimeline();
      renderWAMSection();
    });
  }

  $('#delete-subject').addEventListener('click', () => {
    if (!confirm(`Delete "${subj.name}"? This cannot be undone.`)) return;
    update((s) => {
      const term = s.years?.[modalSubjectRef.year]?.[modalSubjectRef.term];
      if (!term) return;
      term.subjects = term.subjects.filter(x => x.id !== subj.id);
    });
    closeModal();
  });

  // Assessment row edits — wire both table and stack views.
  const wireAssessmentNode = (node) => {
    const aid = node.dataset.aid;
    const a = subj.assessments.find(x => x.id === aid);
    if (!a) return;

    node.querySelectorAll('input').forEach(inp => {
      inp.addEventListener('input', () => {
        const f = inp.dataset.field;
        if (f === 'name') a.name = inp.value;
        else {
          const v = inp.value;
          a[f] = toNullableNumber(v);
        }
        debounceSave();
      });
      inp.addEventListener('change', () => {
        persist();
        renderModal();
        renderTimeline();
        renderWAMSection();
      });
    });

    node.querySelectorAll('.btn-del').forEach(btn => {
      btn.addEventListener('click', () => {
        subj.assessments = subj.assessments.filter(x => x.id !== aid);
        persist();
        renderModal();
        renderTimeline();
        renderWAMSection();
      });
    });
  };
  $$('.assessments-table tr[data-aid]').forEach(wireAssessmentNode);
  $$('.assessments-stack .assessment-card[data-aid]').forEach(wireAssessmentNode);
}

function debounce(fn, ms) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

// === Header actions ===
function wireHeader() {
  $('#btn-planner-import').addEventListener('click', openCoursePlannerImport);

  $('#btn-export').addEventListener('click', () => {
    const data = exportJSON(state);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `uom-wam-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast('Exported your data', 'success');
  });

  $('#btn-import').addEventListener('click', () => $('#import-file').click());
  $('#import-file').addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-import of same file
    if (!file) return;
    try {
      const text = await file.text();
      const next = importJSON(text);
      state = next;
      persist();
      render();
      toast('Imported your data', 'success');
    } catch (err) {
      toast('Import failed: ' + err.message, 'error');
    }
  });

  $('#btn-reset').addEventListener('click', () => {
    if (!confirm('Erase ALL of your data? This cannot be undone.')) return;
    clearState();
    state = loadState();
    render();
    toast('All data cleared', 'success');
  });

  $('#btn-add-year').addEventListener('click', () => {
    state.lookaheadYears = (state.lookaheadYears || 4) + 1;
    persist();
    renderTimeline();
  });
}

// === Render entry ===
function render() {
  renderSetup();
  if (state.setup.completed) {
    renderWAMSection();
    renderTimeline();
  }
}

// Keyboard: ESC closes modal
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && modalSubjectRef) {
    closeModal();
  }
});

wireHeader();
render();
document.body.classList.add('app-ready');

// If the bookmarklet (or a shared deep-link) redirected here with an import
// payload, surface the plan in the import modal so the user can confirm.
(function handleImportFragment() {
  const incoming = consumeImportFragment();
  if (!incoming) return;
  const subjectCount = (incoming.subjects || []).length;
  // If the user has nothing yet, just apply directly. If they have data, open
  // the modal pre-populated so they can decide whether to replace.
  const hasExisting = allSubjects(state).length > 0;
  if (!hasExisting) {
    try {
      applyCoursePlan(state, incoming, { replace: true });
      persist();
      render();
      toast(`Imported ${subjectCount} subjects from Course Planner`, 'success');
    } catch (e) {
      openCoursePlannerImport({ json: JSON.stringify(incoming, null, 2), error: 'Auto-import failed: ' + e.message });
    }
    return;
  }
  // Has existing data — let the user confirm via the modal.
  openCoursePlannerImport({ json: JSON.stringify(incoming, null, 2) });
  toast(`Course Planner data ready — review and import`, 'success');
})();
