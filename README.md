# UoM WAM Calculator

A student-facing web app that helps University of Melbourne students track their grades, predict their WAM, and plan toward grade-band targets (Pass / H3 / H2B / H2A / H1).

Everything is saved locally in your browser — nothing is sent to a server. Works on Mac and iPhone, and can be installed to the home screen as a Progressive Web App.

## Features

- **First-time setup** picks your start year and starting semester (Sem 1 or Sem 2) and lays out your study timeline.
- **Per-term subject management** with the correct UoM caps:
  - Semester 1: up to 4 subjects
  - Semester 2: up to 4 subjects
  - Winter: up to 2 subjects
  - Summer: up to 2 subjects
- **Per-subject assessments** with name, weight, actual score, and predicted score (what-if).
- Validates that **assessment weights sum to 100%**.
- **Required-score grid**: shows the average mark you'd need on remaining assessments to hit Pass / H3 / H2B / H2A / H1 — with a clear flag when a target is mathematically out of reach.
- **What-if controls**: enter predicted scores for any future assessment and see the projected final mark and grade band update live.
- **Current vs predicted WAM** at a glance:
  - *Current WAM* — average of completed subjects only.
  - *Predicted WAM* — current performance projected onto in-progress subjects.
- **Target WAM planning**: enter a target WAM and the app tells you the average you'd need across remaining subjects in your degree.
- **At-risk warnings**: subjects whose projected mark is below 50, or where a Pass is no longer mathematically achievable, are highlighted.
- **Mark a subject completed** to lock its mark into the WAM rollup; if you flag it complete with partial scores, the projected mark is used.
- **Export / import / reset** your data as JSON.
- **PWA**: installable to home screen, works offline.

## Running it locally

The app is plain HTML / CSS / JavaScript with **no build step**. You just need a local static server (browsers won't load ES modules from `file://`).

```bash
# Option 1 — Python (preinstalled on macOS)
python3 -m http.server 8000

# Option 2 — Node, if you have it
npx serve .

# Option 3 — anything else that serves a directory of static files.
```

Then open <http://localhost:8000>.

### Running the calculation tests

The math is covered by a 46-test suite. You can run it two ways:

- **In the browser** — open <http://localhost:8000/tests.html>. You'll see one row per test.
- **From the command line, via Apple's bundled JavaScriptCore** (no Node install needed):
  ```bash
  /System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc \
    -m js/run-tests-jsc.js
  ```
- **With Node**, if you have it:
  ```bash
  node js/run-tests-node.js
  # or
  npm test
  ```

## Deploying online

Because there's no build step, any static-file host works. Pick whichever you're comfortable with:

- **GitHub Pages** — push the repo and turn on Pages for the root.
- **Netlify** — drag the project folder into the Netlify dashboard, or `netlify deploy --dir=.`.
- **Vercel** — `vercel --prod` from the project root (no framework needed).
- **Cloudflare Pages** — connect the repo, build command empty, output directory `/`.
- **Any static host** (S3, nginx, etc.) — upload the files as-is.

The app must be served over **HTTPS** for the service worker (offline / installable PWA) to register. All the providers above do this for you. For local development, `http://localhost` is a permitted exception.

## Installing to the home screen

### iPhone (Safari)

1. Open the deployed URL in Safari.
2. Tap the Share button.
3. Tap **Add to Home Screen**.
4. Confirm — the app appears on your home screen and runs full-screen.

### Mac (Safari 17+)

1. Open the deployed URL in Safari.
2. **File ▸ Add to Dock…**.

### Chrome / Edge

In the address bar, click the install icon (the small computer-with-arrow), or use the menu's **Install app** option.

## Data and privacy

All your data lives in your browser's `localStorage` under the key `uom-wam-calculator/v1`. Use **Export** in the header to download a JSON backup, **Import** to restore one, or **Reset** to wipe everything.

## Project layout

```
.
├── index.html              # main app shell
├── tests.html              # in-browser test runner
├── styles.css              # all styles (mobile-first, dark mode aware)
├── manifest.webmanifest    # PWA manifest
├── service-worker.js       # offline / install support
├── icon.svg                # app icon
├── package.json            # `npm test` shortcut (Node optional)
└── js/
    ├── app.js              # UI rendering + event wiring
    ├── calculator.js       # pure WAM / grade / required-score functions
    ├── storage.js          # localStorage + timeline + import/export
    ├── tests.js            # the test cases
    ├── run-tests-jsc.js    # entry point for Apple's `jsc`
    └── run-tests-node.js   # entry point for Node
```

## Calculation details

WAM and required-score formulas (every line is unit-tested):

| Quantity | Formula |
|---|---|
| **Final mark** (all scores in) | Σ ( score · weight ) / 100 |
| **Locked-in contribution** | Σ over scored ( score · weight ) / 100 |
| **Current performance** | Σ scored ( score · weight ) / Σ scored weight |
| **Required average for target T** | (T − locked) · 100 / remaining_weight |
| **Projected final** | locked + predicted + current_perf · uncovered_weight / 100 |
| **WAM** | mean(final marks of subjects) — equal credit weighting |
| **Required avg across N future subjects for target WAM W** | (W · (done + N) − Σ done) / N |

The grade bands are: **H1** ≥ 80, **H2A** 75–79.99, **H2B** 70–74.99, **H3** 65–69.99, **Pass** 50–64.99, **Fail** < 50.
