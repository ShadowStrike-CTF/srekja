# Sreḱa tests

`v0_4.test.js` runs the v0.4 acceptance tests in headless Chromium (Playwright). It needs no web server: it opens `srekja_prototype_v0_4.html` straight from disk.

## Outputs

- `tests\results_v0_4.txt`: every assertion as PASS or FAIL, grouped by section, plus the summary counts. The run overwrites it.
- `tests\screenshots\`: four 390 px-wide screenshots (AU Powerball PowerHit, Oz Lotto Pick 6, Saturday Lotto System 9, SuperEnalotto standard).

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
node v0_4.test.js
```

Then open `D:\ShadowStrike_Github\Co_Coding\srekja\tests\results_v0_4.txt`.

## Notes

- Results were last generated with Playwright 1.63.0 on Node 22. The committed `results_v0_4.txt` comes from that run.
- The randomness check draws 20,000 random lines. In principle it could fail by bad luck, but the ±8% limit is about 5 standard deviations wide, so a failure is very unlikely.
