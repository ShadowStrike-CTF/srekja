# Sreḱa tests

`v0_5.test.js` runs the v0.5 acceptance tests (current). It covers every v0.4.1 assertion, with only the text changes the v0.5 spec allows, plus the Budget Planner tests T-01 to T-18. `v0_4_1.test.js` and `v0_4.test.js` are kept for v0.4.1 and v0.4. Each one runs its version's acceptance tests in headless Chromium (Playwright). It needs no web server: it opens its `srekja_prototype_v0_*.html` straight from disk.

## Outputs

- `tests\results_v0_5.txt` (and `results_v0_4_1.txt` / `results_v0_4.txt` for the older suites): every assertion as PASS or FAIL, grouped by section, plus the summary counts. The run overwrites it.
- `tests\screenshots\`: 390 px-wide screenshots. v0.5 writes `v0_5_gen_*.png` (four Generate-mode views) and `v0_5_planner_*.png` (planner inputs; AU Powerball A$63 Jackpot only; Saturday Lotto A$40 Smaller prizes too; the no-fit message; AU Powerball A$50 for each of the three goals). The older suites write `v0_4_1_*.png` / `v0_4_*.png`.

The exit code is 0 if everything passes, 1 if any assertion fails, and 2 if the run crashed. The crash reason is written to the results file.

## Run on Windows (PowerShell or Command Prompt)

You need Node.js 18 or later installed (https://nodejs.org).

### One-off install

Run once per machine. It installs Playwright and its Chromium into `tests\node_modules`, which is git-ignored.

```
cd D:\ShadowStrike_Github\Co_Coding\srekja\tests
npm install --no-save playwright@1.63.0
npx playwright install chromium
```

### Each run

```
cd D:\ShadowStrike_Github\Co_Coding\srekja\tests
node v0_5.test.js
```

Then open `D:\ShadowStrike_Github\Co_Coding\srekja\tests\results_v0_5.txt`.

To re-run an older suite instead: `node v0_4_1.test.js` (writes `results_v0_4_1.txt`) or `node v0_4.test.js` (writes `results_v0_4.txt`). They overwrite their committed results and screenshots, so restore them afterwards with `git checkout -- tests/results_v0_4* tests/screenshots/v0_4*`.

## Notes

- Results were last generated with Playwright 1.63.0 on Node 22. The committed `results_v0_5.txt`, `results_v0_4_1.txt` and `results_v0_4.txt` come from those runs.
- The v0.5 property test (T-06/T-07/T-12) runs 2,001 budgets × 12 planner games × 3 goals through the planner and its on-screen cards. Allow about a minute for the whole suite.
- The randomness check draws 20,000 random lines. In principle it could fail by bad luck, but the ±8% limit is about 5 standard deviations wide, so a failure is very unlikely.
