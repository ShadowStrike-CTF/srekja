// Sreḱa v0.5 acceptance tests: every v0.4.1 assertion (with the SPEC §7.9 / §7.12 text deltas only)
// plus the v0.5 planner tests T-01 … T-18 (SPEC v1.3 §7.11).
// Run:  node tests/v0_5.test.js      (from the repo root, or from tests/)
// Output: tests/results_v0_5.txt (every assertion, PASS/FAIL, plus summary counts)
//         tests/screenshots/*.png (390px wide)
"use strict";
const fs = require("fs");
const path = require("path");
const { pathToFileURL } = require("url");
const { chromium } = require("playwright");
const crypto = require("crypto");

const ROOT = path.resolve(__dirname, "..");
const HTML = path.join(ROOT, "srekja_prototype_v0_5.html");
const URL_ = pathToFileURL(HTML).href;
const OUT = path.join(__dirname, "results_v0_5.txt");
const SHOTS = path.join(__dirname, "screenshots");

const results = [];
let section = "";
function sec(name) { section = name; results.push({ section: name }); }
function check(name, ok, detail) {
  results.push({ name: name, ok: !!ok, detail: ok ? "" : String(detail === undefined ? "" : detail) });
}
function eq(name, actual, expected) {
  check(name + " (expected " + JSON.stringify(expected) + ")", actual === expected, "got " + JSON.stringify(actual));
}
function has(name, text, sub) {
  check(name + " — contains " + JSON.stringify(sub), typeof text === "string" && text.indexOf(sub) >= 0, "text: " + text);
}
function hasNot(name, text, sub) {
  check(name + " — does not contain " + JSON.stringify(sub), typeof text === "string" && text.indexOf(sub) < 0, "text: " + text);
}

const IDX = {
  "au-powerball": 0, "oz-lotto": 1, "saturday-lotto": 2, "weekday-windfall": 3, "set-for-life": 4,
  "futureball": 5, "us-powerball": 6, "us-mega-millions": 7, "euromillions": 8, "uk-lotto": 9,
  "eurojackpot": 10, "superenalotto": 11
};

async function setup(page, gameId, entry, size, count) {
  await page.selectOption("#game", String(IDX[gameId]));
  if (entry && await page.isVisible("#entry")) await page.selectOption("#entry", entry);
  if (size) await page.selectOption("#sys", size);
  if (count !== undefined) {
    const presets = [1, 4, 8, 12, 18, 50];
    if (presets.indexOf(count) >= 0) {
      await page.click("#chips .chip >> text='" + count + "'");
    } else {
      await page.click("#chips .chip >> text=Custom");
      await page.fill("#custom", String(count));
      await page.dispatchEvent("#custom", "input");
    }
  }
  return page.textContent("#summary");
}

// ==================================================================== v0.5 planner tests (SPEC v1.3 §7.11)
const BANNED = ["better value", "best value", "increase your budget", "hot", "cold", "overdue", "lucky number", "lucky"];

async function planUI(page, label, budget, goal) {
  await page.click("#mode-plan");
  await page.selectOption("#plan-game", { label: label });
  await page.fill("#budget", String(budget));
  await page.check("#goal-" + goal);
  await page.click("#show-plans");
  return page.textContent("#plans");
}

async function v05Tests(page, consoleErrors) {
  const errBefore = consoleErrors.length;
  await page.reload();

  sec("v0.5 · Mode toggle and planner UI (§7.2)");
  eq("Mode toggle: Generate label", (await page.textContent("#mode-gen")).trim(), "Generate numbers");
  eq("Mode toggle: Planner label", (await page.textContent("#mode-plan")).trim(), "Plan my spend");
  check("Defaults to Generate mode (generate view visible)", await page.isVisible("#pick"));
  check("Defaults to Generate mode (planner hidden)", await page.isHidden("#plan-view"));
  await page.click("#mode-plan");
  check("Plan my spend shows planner", await page.isVisible("#show-plans"));
  check("Plan my spend hides Generate view", await page.isHidden("#pick"));
  const budgetAttrs = await page.evaluate(function () {
    var b = document.getElementById("budget"); return [b.min, b.max, b.step].join(",");
  });
  eq("Budget input min/max/step", budgetAttrs, "0.05,100000,0.05");
  eq("Goal radios", (await page.$$eval('input[name="goal"]', function (r) {
    return r.map(function (x) { return x.parentNode.textContent.trim(); }).join(" · ");
  })), "Jackpot only · Smaller prizes too · Balanced");
  eq("Show plans button", (await page.textContent("#show-plans")).trim(), "Show plans");
  eq("Price note (AU Powerball)", await page.textContent("#price-note"), "Prices as at 2026-11-13 (The Lott). Check your cart.");
  await page.selectOption("#plan-game", { label: "USA Power Lotto (US Powerball)" });
  eq("Price note (USA Power Lotto)", await page.textContent("#price-note"), "Prices as at 2026-11-13 (The Lottery Office). Check your cart.");
  await page.selectOption("#plan-game", { label: "FutureBall" });
  eq("Price note (FutureBall)", await page.textContent("#price-note"), "Prices as at 2026-11-12 (The Lottery Office). Check your cart.");
  check("No editable price override in the planner (D-13)", (await page.locator("#plan-view input").count()) === 4,
    "inputs: " + (await page.locator("#plan-view input").count()));

  // ---------------------------------------------------------------- T-13
  sec("v0.5 · T-13 Odds line and Gambling Help always visible");
  const ODDS = "Every game has the same Division 1 chance per dollar — ticket type changes how your chances are packaged, not how big they are.";
  eq("T-13 odds line text", await page.textContent("#odds-line"), ODDS);
  eq("T-13 help line text", await page.textContent("#help-line"), "Gambling Help: 1800 858 858");
  check("T-13 odds line visible before plans", await page.isVisible("#odds-line"));
  check("T-13 help line visible before plans", await page.isVisible("#help-line"));
  await planUI(page, "AU Powerball", 63, "jackpot");
  check("T-13 odds line visible with plans", await page.isVisible("#odds-line"));
  check("T-13 help line visible with plans", await page.isVisible("#help-line"));
  await planUI(page, "Saturday Lotto", 3, "jackpot");
  check("T-13 odds line visible with no-fit message", await page.isVisible("#odds-line"));
  check("T-13 help line visible with no-fit message", await page.isVisible("#help-line"));

  // pure-function view of the planner
  async function plans(gameId, budgetCents, goal) {
    return page.evaluate(function (a) {
      var S = window.SREKJA;
      var pg = S.plannerGames().filter(function (x) { return x.game.id === a[0]; })[0];
      return S.rankPlans(S.planCandidates(pg.game, a[1]), a[2]).map(function (p) {
        return { title: p.title, cost: S.planCostText(pg.game, p), totalGames: p.totalGames, totalCents: p.totalCents,
                 exact: p.exact, leftover: p.leftoverCents, sets: p.distinctSets, oneIn: p.div1OneIn,
                 pkg: p.packageName || null, label: p.label || null, mixed: p.mixed, draws: p.drawsCovered,
                 tradeOff: p.tradeOff, parts: p.parts.map(function (x) { return [x.spec.kind, x.spec.size, x.count, x.cents, x.exact]; }) };
      });
    }, [gameId, budgetCents, goal]);
  }

  // ---------------------------------------------------------------- T-01
  sec("v0.5 · T-01 PB A$63.00 Jackpot only");
  let P = await plans("au-powerball", 6300, "jackpot");
  eq("T-01 top plan", P[0].title, "2 × PowerHit");
  eq("T-01 totalGames", P[0].totalGames, 40);
  eq("T-01 cost exact", P[0].cost, "A$63.00 (exact)");
  eq("T-01 leftover", P[0].leftover, 0);
  eq("T-01 Division 1 1 in", P[0].oneIn, 3362260);
  let txt = await planUI(page, "AU Powerball", 63, "jackpot");
  has("T-01 card", txt, "2 × PowerHit — A$63.00 (exact)");
  has("T-01 card", txt, "Left over: A$0.00");
  has("T-01 card", txt, "Division 1: 1 in 3,362,260");

  // ---------------------------------------------------------------- T-02
  sec("v0.5 · T-02 PB A$63.00 Smaller prizes too");
  P = await plans("au-powerball", 6300, "smaller");
  eq("T-02 top plan", P[0].title, "39 standard games");
  eq("T-02 cost (≈)", P[0].cost, "≈ A$61.32 (check your cart)");
  check("T-02 headroom: ceil(6132 × 1.01) = 6194 ≤ 6300", Math.ceil(6132 * 101 / 100) === 6194 && 6194 <= 6300);
  const pb40 = await page.evaluate(function () {
    var S = window.SREKJA, g = S.GAMES[0], c = S.costFor(g, S.entrySpec(g, "standard"), 40);
    return [c.cents, c.exact, S.fits(c, 6300)];
  });
  eq("T-02 40 standard ≈ A$62.89", pb40[0], 6289);
  eq("T-02 40 standard excluded by headroom (63.52 > 63.00)", pb40[2], false);
  check("T-02 no 40-standard plan in any goal", (await Promise.all(["jackpot", "smaller", "balanced"].map(function (g) {
    return plans("au-powerball", 6300, g);
  }))).every(function (L) { return L.every(function (p) { return p.title !== "40 standard games"; }); }));

  // ---------------------------------------------------------------- T-03
  sec("v0.5 · T-03 PB A$31.50, every goal");
  for (const goal of ["jackpot", "smaller", "balanced"]) {
    txt = await planUI(page, "AU Powerball", 31.5, goal);
    has("T-03 " + goal + " card", txt, "1 × PowerHit — A$31.50 (exact)");
  }

  // ---------------------------------------------------------------- T-04
  sec("v0.5 · T-04 Saturday Lotto A$3.00: no-fit");
  txt = await planUI(page, "Saturday Lotto", 3, "jackpot");
  eq("T-04 exact message, nothing else", txt, "That budget is below the minimum entry for Saturday Lotto (4 games = A$3.85).");
  eq("T-04 only one element in results", await page.locator("#plans > *").count(), 1);
  hasNot("T-04 no upsell", txt.toLowerCase(), "more");

  // ---------------------------------------------------------------- T-05
  sec("v0.5 · T-05 Oz Lotto A$23.40 Jackpot only");
  P = await plans("oz-lotto", 2340, "jackpot");
  eq("T-05 top plan", P[0].title, "2 × System 8");
  eq("T-05 totalGames", P[0].totalGames, 16);
  eq("T-05 cost exact", P[0].cost, "A$23.40 (exact)");
  eq("T-05 packageName", P[0].pkg, "2 × System 8");
  const oz16 = await page.evaluate(function () {
    var S = window.SREKJA, g = S.GAMES[1], c = S.costFor(g, S.entrySpec(g, "standard"), 16); return [c.cents, S.fits(c, 2340)];
  });
  eq("T-05 16 standard ≈ A$23.36", oz16[0], 2336);
  eq("T-05 16 standard excluded by headroom (23.59 > 23.40)", oz16[1], false);
  check("T-05 no plan exceeds 23.40 (all goals)", (await Promise.all(["jackpot", "smaller", "balanced"].map(function (g) {
    return plans("oz-lotto", 2340, g);
  }))).every(function (L) { return L.every(function (p) { return p.totalCents <= 2340; }); }));
  txt = await planUI(page, "Oz Lotto", 23.4, "jackpot");
  has("T-05 card shows Lott package", txt, "Lott package: 2 × System 8");

  // ---------------------------------------------------------------- T-06 / T-07 / T-12
  sec("v0.5 · T-06 / T-07 / T-12 Property: budget ceiling, headroom, banned text");
  const prop = await page.evaluate(function (banned) {
    var S = window.SREKJA, PG = S.plannerGames(), goals = ["jackpot", "smaller", "balanced"];
    var budgets = [];
    for (var b = 5; b <= 50000; b += 25) budgets.push(b);            // 2,000 budgets, 0.05 … 499.80
    budgets.push(50000);                                              // + 500.00
    var n = 0, over = [], headroom = [], estPlans = 0, partFails = [];
    PG.forEach(function (pg) {
      budgets.forEach(function (bc) {
        var cands = S.planCandidates(pg.game, bc);
        goals.forEach(function (goal) {
          S.rankPlans(cands, goal).forEach(function (p) {
            n++;
            if (p.totalCents > bc) over.push(pg.label + " " + bc + " " + goal + " " + p.title);
            var ex = 0, est = 0;
            p.parts.forEach(function (x) {
              if (x.exact) ex += x.cents; else { est += x.cents; if (Math.ceil(x.cents * 101 / 100) > bc) partFails.push(pg.label + " " + bc + " " + p.title); }
            });
            if (est) { estPlans++; if (ex + Math.ceil(est * 101 / 100) > bc) headroom.push(pg.label + " " + bc + " " + goal + " " + p.title); }
          });
        });
      });
    });
    // T-12: drive the real planner DOM over the same sample and scan everything it shows.
    var sel = document.getElementById("plan-game"), bud = document.getElementById("budget");
    var btn = document.getElementById("show-plans"), view = document.getElementById("plan-view");
    var hits = [], renders = 0, sawLucky = false;
    PG.forEach(function (pg, gi) {
      sel.value = String(gi); sel.dispatchEvent(new Event("change"));
      budgets.forEach(function (bc) {
        bud.value = (bc / 100).toFixed(2);
        goals.forEach(function (goal) {
          document.getElementById("goal-" + goal).checked = true;
          btn.click(); renders++;
          var t = view.textContent.toLowerCase();
          var f = t.indexOf("for $");
          if (f >= 0 && t.indexOf("more", f) >= 0) hits.push(pg.label + " " + bc + " " + goal + ": for $…more");
          banned.forEach(function (w) { if (t.indexOf(w) >= 0) hits.push(pg.label + " " + bc + " " + goal + ": " + w); });
        });
      });
    });
    return { plans: n, budgets: budgets.length, games: PG.length, over: over.slice(0, 5), overN: over.length,
             headroom: headroom.slice(0, 5), headroomN: headroom.length, estPlans: estPlans,
             partFails: partFails.length, renders: renders, hits: hits.slice(0, 5), hitsN: hits.length };
  }, BANNED);
  check("T-06 sample size ≥ 2,000 budgets (" + prop.budgets + " budgets × " + prop.games + " games × 3 goals = " + prop.plans + " plans)", prop.budgets >= 2000);
  eq("T-06 plans with totalCents > budgetCents", prop.overN, 0);
  if (prop.overN) results.push({ name: "  e.g. " + prop.over.join("; "), ok: false, detail: "" });
  check("T-07 estimated plans checked (" + prop.estPlans + ")", prop.estPlans > 0);
  eq("T-07 estimated plans where exact + ceil(estimate × 1.01) > budget", prop.headroomN, 0);
  eq("T-07 estimated parts where ceil(part × 1.01) > budget", prop.partFails, 0);
  check("T-12 planner DOM rendered across the T-06 sample (" + prop.renders + " renders)", prop.renders === prop.budgets * prop.games * 3);
  eq("T-12 banned-text hits (for $…more, better/best value, increase your budget, hot, cold, overdue, lucky)", prop.hitsN, 0);
  if (prop.hitsN) results.push({ name: "  e.g. " + prop.hits.join("; "), ok: false, detail: "" });

  // ---------------------------------------------------------------- T-08 / T-08b
  sec("v0.5 · T-08 Balanced PB A$50.00 (SPEC v1.3 order)");
  P = await plans("au-powerball", 5000, "balanced");
  eq("T-08 (1)", P[0].title, "1 × System 8 + 23 standard games");
  eq("T-08 (2)", P[1].title, "2 × System 8 + 15 standard games");
  eq("T-08 (3)", P[2].title, "1 × PowerHit + 11 standard games");
  eq("T-08 all 31 games", P.map(function (p) { return p.totalGames; }).join(","), "31,31,31");
  eq("T-08 distinctSets 24 / 17 / 12", P.map(function (p) { return p.sets; }).join(","), "24,17,12");
  eq("T-08 (1) parts: ≈ 12.58 + ≈ 36.16", JSON.stringify(P[0].parts), JSON.stringify([["system", 8, 1, 1258, false], ["standard", null, 23, 3616, false]]));
  eq("T-08 (3) parts: 31.50 exact + ≈ 17.29", JSON.stringify(P[2].parts), JSON.stringify([["powerhit", null, 1, 3150, true], ["standard", null, 11, 1729, false]]));
  check("T-08 each component passes its own fits() rule", P.every(function (p) {
    return p.parts.every(function (x) { return (x[4] ? x[3] : Math.ceil(x[3] * 101 / 100)) <= 5000; });
  }));
  check("T-08 all mixed, no label", P.every(function (p) { return p.mixed && !p.label; }));
  const pb12 = await page.evaluate(function () {
    var S = window.SREKJA, g = S.GAMES[0], c = S.costFor(g, S.entrySpec(g, "standard"), 12); return [c.cents, c.exact];
  });
  check("T-08 12 standard (18.90 exact) doesn't fit beside PowerHit (31.50 + 18.90 > 50.00)", pb12[0] === 1890 && pb12[1] && 3150 + 1890 > 5000);
  sec("v0.5 · T-08b Balanced PB A$31.50");
  P = await plans("au-powerball", 3150, "balanced");
  check("T-08b mixed plan first", P[0].mixed && !P[0].label, JSON.stringify(P[0]));
  check("T-08b top-up plans labelled 'Not mixed'", P.slice(1).length === 2 && P.slice(1).every(function (p) { return !p.mixed && p.label === "Not mixed"; }));
  check("T-08b 1 × PowerHit present, labelled 'Not mixed'", P.some(function (p) { return p.title === "1 × PowerHit" && p.label === "Not mixed"; }));
  txt = await planUI(page, "AU Powerball", 31.5, "balanced");
  has("T-08b card", txt, "Not mixed1 × PowerHit — A$31.50");
  P = await plans("us-powerball", 5000, "balanced");
  check("Balanced with no mixed plan → all labelled 'No mixed plan fits this budget'", P.length >= 1 && P.every(function (p) { return p.label === "No mixed plan fits this budget"; }), JSON.stringify(P));

  // ---------------------------------------------------------------- T-09 / T-10
  sec("v0.5 · T-09 Set for Life / T-10 Weekday 3 Play");
  txt = await planUI(page, "Set for Life", 30, "jackpot");
  has("T-09 Set for Life card", txt, "Each game plays 7 daily draws.");
  for (const goal of ["jackpot", "smaller"]) {
    P = await plans("weekday-windfall", 1000, goal);
    const w3 = P.filter(function (p) { return p.title === "Weekday 3 Play — 5 games"; })[0];
    check("T-10 " + goal + ": Weekday 3 Play 5-games plan present", !!w3, JSON.stringify(P.map(function (p) { return p.title; })));
    if (w3) { eq("T-10 " + goal + ": covers 3 draws", w3.draws, 3); eq("T-10 " + goal + ": A$10.00 exact", w3.cost, "A$10.00 (exact)"); }
  }
  txt = await planUI(page, "Weekday Windfall", 10, "jackpot");
  has("T-10 card", txt, "Weekday 3 Play — 5 games — A$10.00 (exact)");
  has("T-10 card", txt, "Covers: 3 draws");
  has("T-10 card", txt, "Plays Friday, Monday and Wednesday.");

  // ---------------------------------------------------------------- trade-off templates (§7.6)
  sec("v0.5 · Trade-off sentences (§7.6)");
  P = await plans("au-powerball", 6300, "jackpot");
  eq("PowerHit sentence", P[0].tradeOff, "Powerball guaranteed — you only need the 7 main numbers. One set of numbers per entry.");
  P = await plans("au-powerball", 6300, "smaller");
  eq("Standard sentence", P[0].tradeOff, "Most different number sets for the money — best spread for smaller prizes.");
  P = await plans("oz-lotto", 2340, "jackpot");
  eq("System sentence", P[0].tradeOff, "Covers every combination of your 8 numbers. When it hits, it hits several divisions at once; fewer different number sets.");
  P = await plans("au-powerball", 5000, "balanced");
  eq("Mixed sentence", P[2].tradeOff, "Powerball guaranteed — you only need the 7 main numbers. One set of numbers per entry. Plus 11 standard games for spread.");
  P = await plans("oz-lotto", 6000, "jackpot");
  const pick = P.filter(function (p) { return p.parts[0][0] === "pick"; })[0];
  check("Pick sentence", pick && pick.tradeOff === "Covers every possible value for the numbers you don't choose; expensive per entry.", JSON.stringify(P.map(function (p) { return p.title; })));

  // ---------------------------------------------------------------- T-14
  sec("v0.5 · T-14 Overseas games in the planner (D-15 / D-16)");
  const t14 = await page.evaluate(function () {
    var S = window.SREKJA;
    var labels = S.plannerGames().map(function (x) { return x.label; });
    // Stand-ins defined only here: one without auVia, one with auVia.priceVerified false.
    var noAu = JSON.parse(JSON.stringify(S.GAMES[6])); delete noAu.auVia; noAu.id = "test-stand-in-no-auvia";
    var unver = JSON.parse(JSON.stringify(S.GAMES[7])); unver.auVia.priceVerified = false; unver.id = "test-stand-in-unverified";
    var fx = S.plannerGames(S.GAMES.concat([noAu, unver])).map(function (x) { return x.game.id; });
    var costs = S.plannerGames().filter(function (x) { return x.base.availability === "overseas-only"; }).map(function (x) {
      var p = S.rankPlans(S.planCandidates(x.game, 5000), "jackpot")[0];
      return [x.base.id, x.game.currency, p.parts[0][1] === undefined ? 0 : 0, p.totalGames, p.totalCents, p.exact, x.base.auVia.pricePerGame,
              x.game.entryTypes.map(function (e) { return e.id; }).join("/"), x.game.minGames];
    });
    return { labels: labels, fx: fx, costs: costs, gamesLen: S.GAMES.length };
  });
  eq("T-14 planner game list", t14.labels.join(" | "),
    "AU Powerball | Oz Lotto | Saturday Lotto | Weekday Windfall | Set for Life | FutureBall | USA Power Lotto (US Powerball) | " +
    "USA Mega Lotto (US Mega Millions) | European Millions (EuroMillions) | UK Lotto (UK Lotto) | European Jackpot (Eurojackpot) | " +
    "Italian Super Jackpot (SuperEnalotto)");
  check("T-14 stand-in without auVia excluded", t14.fx.indexOf("test-stand-in-no-auvia") < 0);
  check("T-14 stand-in with auVia.priceVerified=false excluded", t14.fx.indexOf("test-stand-in-unverified") < 0);
  eq("T-14 stand-ins never added to the app's GAMES", t14.gamesLen, 12);
  const LO = { "us-powerball": 700, "us-mega-millions": 1195, "euromillions": 950, "uk-lotto": 965, "eurojackpot": 750, "superenalotto": 475 };
  t14.costs.forEach(function (c) {
    eq("T-14 " + c[0] + " planner currency", c[1], "AUD");
    eq("T-14 " + c[0] + " A$50 top plan = floor(5000 / LO price) games × LO price (exact)",
      c[4] + "/" + c[5], (Math.floor(5000 / LO[c[0]]) * LO[c[0]]) + "/true");
    eq("T-14 " + c[0] + " auVia entry types (standard only, D-16) / minGames 1", c[7] + "/" + c[8], "standard/1");
  });
  txt = await planUI(page, "USA Power Lotto (US Powerball)", 50, "jackpot");
  has("T-14 USA Power Lotto card in AUD", txt, "7 standard games — A$49.00 (exact)");
  hasNot("T-14 USA Power Lotto card: no US$", txt, "US$");
  const auData = await page.evaluate(function () {
    return window.SREKJA.GAMES.filter(function (g) { return g.auVia; }).map(function (g) {
      return g.id + ":" + g.auVia.product + ":" + g.auVia.pricePerGame + ":" + g.auVia.priceAsOf + ":" + (g.auVia.auDrawDays ? "days" : "-") + ":" + (g.auVia.auSalesClose ? "close" : "-");
    }).join(" | ");
  });
  eq("auVia data (product, A$/game, as-of, AU draw days + close stored)", auData,
    "us-powerball:USA Power Lotto:7:2026-11-13:days:close | us-mega-millions:USA Mega Lotto:11.95:2026-11-13:days:close | " +
    "euromillions:European Millions:9.5:2026-11-13:days:close | uk-lotto:UK Lotto:9.65:2026-11-13:days:close | " +
    "eurojackpot:European Jackpot:7.5:2026-11-13:days:close | superenalotto:Italian Super Jackpot:4.75:2026-11-13:days:close");

  // ---------------------------------------------------------------- T-17
  sec("v0.5 · T-17 Generate-mode overseas labelling (§7.12)");
  await page.click("#mode-gen");
  const GEN = [["us-powerball", "A$7.00 via The Lottery Office (USA Power Lotto)"], ["us-mega-millions", "A$11.95 via The Lottery Office (USA Mega Lotto)"],
               ["euromillions", "A$9.50 via The Lottery Office (European Millions)"], ["uk-lotto", "A$9.65 via The Lottery Office (UK Lotto)"],
               ["eurojackpot", "A$7.50 via The Lottery Office (European Jackpot)"], ["superenalotto", "A$4.75 via The Lottery Office (Italian Super Jackpot)"]];
  for (const gx of GEN) {
    const sm = await setup(page, gx[0], null, null, 1);
    has("T-17 verified " + gx[0], sm, gx[1]);
    hasNot("T-17 verified " + gx[0] + ": no home-country label", sm, "Australian prices differ");
    eq("T-17 verified " + gx[0] + " availability tag", await page.textContent("#avail"), "Available in Australia via The Lottery Office (NT-licensed)");
  }
  hasNot("T-17 Eurojackpot via LO: no German order fee", await setup(page, "eurojackpot", null, null, 1), "Plus order fee");
  has("T-17 UK Lotto rule line keeps home draw days", (await setup(page, "uk-lotto"), await page.textContent("#rule")), "Wednesday, Saturday");
  const t17 = await page.evaluate(function () {
    var S = window.SREKJA;
    var fx = JSON.parse(JSON.stringify(S.GAMES[6])); delete fx.auVia; fx.id = "test-stand-in-no-auvia";  // test-only stand-in
    var sum = S.summaryText(fx, S.entrySpec(fx, "standard"), 1);
    return { sum: sum, avail: S.availabilityText(fx), inGames: S.GAMES.some(function (g) { return g.id === fx.id; }), au: S.GAMES[0] };
  });
  has("T-17 unverified stand-in: home-country price + label", t17.sum, "US$2.00 — MUSL / US state lotteries home-country price; Australian prices differ");
  hasNot("T-17 unverified stand-in: no Lottery Office note", t17.sum, "via The Lottery Office");
  eq("T-17 unverified stand-in: existing availability tag", t17.avail, "Overseas game — not sold by Australian official operators");
  eq("T-17 stand-in not in the app's GAMES", t17.inGames, false);
  const auSum = await setup(page, "au-powerball");
  hasNot("T-17 AU game summary unchanged (no LO note)", auSum, "via The Lottery Office");
  hasNot("T-17 AU game summary unchanged (no home-country label)", auSum, "home-country");

  // ---------------------------------------------------------------- T-11
  sec("v0.5 · T-11 Generate these numbers (§7.8)");
  async function genState() {
    return page.evaluate(function () {
      var cnt = document.querySelectorAll("#output .line").length;
      return { game: document.getElementById("game").value, entry: document.getElementById("entry").value || "standard",
               sys: document.getElementById("sys-wrap").hidden ? null : document.getElementById("sys").value,
               lines: cnt, summary: document.getElementById("summary").textContent,
               genVisible: !document.getElementById("gen-view").hidden, planHidden: document.getElementById("plan-view").hidden,
               then: document.getElementById("then-wrap").hidden ? null : document.getElementById("then-text").textContent };
    });
  }
  await planUI(page, "AU Powerball", 50, "balanced");
  await page.click("#plans .plan-card:nth-child(1) .gen-these");
  let st = await genState();
  check("T-11 switches to Generate mode", st.genVisible && st.planHidden);
  eq("T-11 mixed (1): game", st.game, "0");
  eq("T-11 mixed (1): entry type", st.entry, "system");
  eq("T-11 mixed (1): size", st.sys, "s8");
  eq("T-11 mixed (1): lines generated (1 entry)", st.lines, 1);
  has("T-11 mixed (1): summary", st.summary, "8 games per entry · 8 games total");
  eq("T-11 mixed (1): follow-up line", st.then, "Then generate 23 standard games separately.");
  await page.click("#then-btn");
  st = await genState();
  eq("T-11 follow-up: entry type standard", st.entry, "standard");
  eq("T-11 follow-up: 23 lines generated", st.lines, 23);
  has("T-11 follow-up: summary", st.summary, "23 games total");
  eq("T-11 follow-up line hidden after use", st.then, null);
  await planUI(page, "AU Powerball", 63, "jackpot");
  await page.click("#plans .plan-card:nth-child(1) .gen-these");
  st = await genState();
  eq("T-11 2 × PowerHit: entry", st.entry, "powerhit");
  eq("T-11 2 × PowerHit: 2 entries generated", st.lines, 2);
  has("T-11 2 × PowerHit: summary", st.summary, "40 games total");
  eq("T-11 pure plan: no follow-up line", st.then, null);
  await planUI(page, "Oz Lotto", 60, "jackpot");
  P = await plans("oz-lotto", 6000, "jackpot");
  const pickIdx = P.findIndex(function (p) { return p.parts[0][0] === "pick"; });
  await page.click("#plans .plan-card:nth-child(" + (pickIdx + 1) + ") .gen-these");
  st = await genState();
  eq("T-11 Pick 6: entry/size", st.entry + "/" + st.sys, "system/p6");
  eq("T-11 Pick 6: 1 entry generated", st.lines, 1);
  await planUI(page, "Saturday Lotto", 40, "smaller");
  await page.click("#plans .plan-card:nth-child(1) .gen-these");
  st = await genState();
  eq("T-11 Saturday standard: game", st.game, "2");
  eq("T-11 Saturday standard: lines generated = plan games", st.lines, (await plans("saturday-lotto", 4000, "smaller"))[0].totalGames);
  await planUI(page, "USA Power Lotto (US Powerball)", 50, "jackpot");
  await page.click("#plans .plan-card:nth-child(1) .gen-these");
  st = await genState();
  eq("T-11 USA Power Lotto → US Powerball in Generate", st.game, "6");
  eq("T-11 USA Power Lotto: 7 lines", st.lines, 7);
  has("T-11 USA Power Lotto: summary priced via LO", st.summary, "A$49.00 via The Lottery Office (USA Power Lotto)");

  // ---------------------------------------------------------------- T-18
  sec("v0.5 · T-18 Nothing reads from the docs folder");
  const needle = "docs" + "/";
  const offenders = [];
  (function walk(dir) {
    fs.readdirSync(dir, { withFileTypes: true }).forEach(function (d) {
      const p = path.join(dir, d.name);
      if (d.isDirectory()) { if (d.name !== "node_modules") walk(p); return; }
      if (/\.png$/i.test(d.name)) return;
      if (fs.readFileSync(p, "utf8").indexOf(needle) >= 0) offenders.push(path.relative(ROOT, p));
    });
  })(__dirname);
  if (fs.readFileSync(HTML, "utf8").indexOf(needle) >= 0) offenders.push("srekja_prototype_v0_5.html");
  eq("T-18 files under tests/ + v0.5 HTML mentioning the docs folder path", offenders.join(", "), "");

  // ---------------------------------------------------------------- T-16 screenshots
  sec("v0.5 · T-16 Planner screenshots (390px)");
  async function pshot(file, label, budget, goal) {
    await page.reload();
    await page.click("#mode-plan");
    if (label) { await planUI(page, label, budget, goal); }
    const p = path.join(SHOTS, file);
    await page.screenshot({ path: p, fullPage: true });
    check("Screenshot " + path.relative(ROOT, p).split(path.sep).join("/"), fs.statSync(p).size > 0);
  }
  fs.mkdirSync(SHOTS, { recursive: true });
  await pshot("v0_5_planner_inputs.png", null);
  await pshot("v0_5_planner_pb_63_jackpot.png", "AU Powerball", 63, "jackpot");
  await pshot("v0_5_planner_saturday_40_smaller.png", "Saturday Lotto", 40, "smaller");
  await pshot("v0_5_planner_nofit.png", "Saturday Lotto", 3, "jackpot");
  await pshot("v0_5_planner_pb_50_jackpot.png", "AU Powerball", 50, "jackpot");
  await pshot("v0_5_planner_pb_50_smaller.png", "AU Powerball", 50, "smaller");
  await pshot("v0_5_planner_pb_50_balanced.png", "AU Powerball", 50, "balanced");
  const wide = await page.evaluate(function () { return document.documentElement.scrollWidth; });
  check("No horizontal scroll at 390 px (scrollWidth " + wide + ")", wide <= 390);

  sec("v0.5 · Console errors");
  eq("Console errors during v0.5 tests", consoleErrors.length - errBefore, 0);
  if (consoleErrors.length - errBefore) results.push({ name: "  errors: " + consoleErrors.slice(errBefore).join(" || "), ok: false, detail: "" });
  await page.reload();
}

(async function main() {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 390, height: 900 }, deviceScaleFactor: 2 });
  const page = await context.newPage();
  const consoleErrors = [];
  page.on("console", function (m) { if (m.type() === "error") consoleErrors.push(m.text()); });
  page.on("pageerror", function (e) { consoleErrors.push(String(e)); });
  await page.goto(URL_);

  // ---------------------------------------------------------------- static file checks
  sec("Static file checks");
  const src = fs.readFileSync(HTML, "utf8");
  check("No Math.random anywhere in v0.5", src.indexOf("Math.random") < 0, "Math.random found");
  check("Uses crypto.getRandomValues", src.indexOf("crypto.getRandomValues") >= 0);
  ["#0d1117", "#161b22", "#9b59f5"].forEach(function (c) { check("Locked colour " + c + " present", src.indexOf(c) >= 0); });
  check("No external scripts/stylesheets", !/<script[^>]+src=|<link[^>]+stylesheet/i.test(src));
  check("No storage / network APIs", !/localStorage|sessionStorage|indexedDB|fetch\(|XMLHttpRequest/.test(src));
  const footer = await page.textContent("footer");
  has("Footer", footer, "Random picks only");
  has("Footer", footer, "18+ only");
  has("Footer", footer, "Gambling Help: 1800 858 858");
  hasNot("Footer", footer, "ShadowStrike × Pumpkin");
  check("v0.2 file unchanged in repo", fs.existsSync(path.join(ROOT, "srekja_prototype_v0_2.html")));
  check("v0.3 file present", fs.existsSync(path.join(ROOT, "srekja_prototype_v0_3.html")));
  check("v0.4 file present (left untouched)", fs.existsSync(path.join(ROOT, "srekja_prototype_v0_4.html")));
  eq("v0.4.1 file unchanged (SHA-256)", crypto.createHash("sha256").update(fs.readFileSync(path.join(ROOT, "srekja_prototype_v0_4_1.html"))).digest("hex"),
    "f5bc9cc5e07ff63b0a750d63663f64e9b30698afdb6273054466b7c5e01d77f0");

  // ---------------------------------------------------------------- combinatorics
  sec("Combinatorics (exact choose)");
  const C = await page.evaluate(function () {
    var c = window.SREKJA.choose;
    return { c357: c(35, 7), c477: c(47, 7), c456: c(45, 6), c447: c(44, 7), c346: c(34, 6), c695: c(69, 5),
             c705: c(70, 5), c505: c(50, 5), c122: c(12, 2), c596: c(59, 6), c906: c(90, 6), c196: c(19, 6),
             c187: c(18, 7), c206: c(20, 6), c137: c(13, 7) };
  });
  eq("C(35,7)", C.c357, 6724520); eq("C(47,7)", C.c477, 62891499); eq("C(45,6)", C.c456, 8145060);
  eq("C(44,7)", C.c447, 38320568); eq("C(34,6)", C.c346, 1344904); eq("C(69,5)", C.c695, 11238513);
  eq("C(70,5)", C.c705, 12103014); eq("C(50,5)", C.c505, 2118760); eq("C(12,2)", C.c122, 66);
  eq("C(59,6)", C.c596, 45057474); eq("C(90,6)", C.c906, 622614630); eq("C(19,6)", C.c196, 27132);
  eq("C(18,7)", C.c187, 31824); eq("C(20,6)", C.c206, 38760); eq("C(13,7)", C.c137, 1716);

  sec("Division 1 odds per game (perGameOdds)");
  const odds = await page.evaluate(function () {
    var S = window.SREKJA; var o = {};
    S.GAMES.forEach(function (g) { o[g.id] = S.perGameOdds(g); });
    return o;
  });
  const expectedOdds = { "au-powerball": 134490400, "oz-lotto": 62891499, "saturday-lotto": 8145060,
    "weekday-windfall": 8145060, "set-for-life": 38320568, "futureball": 4034712, "us-powerball": 292201338,
    "us-mega-millions": 290472336, "euromillions": 139838160, "uk-lotto": 45057474, "eurojackpot": 139838160,
    "superenalotto": 622614630 };
  Object.keys(expectedOdds).forEach(function (k) { eq(k + " Div 1 1 in N", odds[k], expectedOdds[k]); });

  // ---------------------------------------------------------------- entry types / games per entry
  sec("Entry types, sizes and games per entry (R rulings)");
  const ent = await page.evaluate(function () {
    var S = window.SREKJA, G = {};
    S.GAMES.forEach(function (g) { G[g.id] = g; });
    function games(id, t, s) { return S.entrySpec(G[id], t, s).games; }
    function labels(id, t) { return S.sizeOptions(G[id], t).map(function (o) { return o.label; }); }
    return {
      types: S.GAMES.map(function (g) { return g.id + ":" + g.entryTypes.map(function (e) { return e.id; }).join(","); }),
      pbPH: games("au-powerball", "powerhit"), pbP5: games("au-powerball", "system", "p5"), pbP6: games("au-powerball", "system", "p6"),
      pbS8: games("au-powerball", "system", "s8"), pbS18: games("au-powerball", "system", "s18"),
      pbPHS8: games("au-powerball", "phsystem", "s8"), pbPHS13: games("au-powerball", "phsystem", "s13"),
      ozP5: games("oz-lotto", "system", "p5"), ozP6: games("oz-lotto", "system", "p6"), ozS8: games("oz-lotto", "system", "s8"),
      satP4: games("saturday-lotto", "system", "p4"), satP5: games("saturday-lotto", "system", "p5"),
      satS7: games("saturday-lotto", "system", "s7"), satS20: games("saturday-lotto", "system", "s20"),
      wwP4: games("weekday-windfall", "system", "p4"), wwP5: games("weekday-windfall", "system", "p5"),
      wwS7: games("weekday-windfall", "system", "s7"), seS19: games("superenalotto", "system", "s19"),
      pbSys: labels("au-powerball", "system"), pbPhs: labels("au-powerball", "phsystem"),
      ozSys: labels("oz-lotto", "system"), satSys: labels("saturday-lotto", "system"),
      wwSys: labels("weekday-windfall", "system"), seSys: labels("superenalotto", "system"),
      minGames: S.GAMES.map(function (g) { return g.id + ":" + g.minGames; }),
      maxes: S.GAMES.every(function (g) { return g.maxGames === 50 && g.maxEntries === 50; })
    };
  });
  eq("Entry types per game", ent.types.join(" | "),
    "au-powerball:standard,powerhit,system,phsystem | oz-lotto:standard,system | saturday-lotto:standard,system | " +
    "weekday-windfall:standard,system | set-for-life:standard | futureball:standard | us-powerball:standard | " +
    "us-mega-millions:standard | euromillions:standard | uk-lotto:standard | eurojackpot:standard | superenalotto:standard,system");
  eq("AU Powerball PowerHit games", ent.pbPH, 20);
  eq("AU Powerball Pick 5 games", ent.pbP5, 435);
  eq("AU Powerball Pick 6 games", ent.pbP6, 29);
  eq("AU Powerball System 8 games", ent.pbS8, 8);
  eq("AU Powerball System 18 games", ent.pbS18, 31824);
  eq("AU Powerball PowerHit System 8 games", ent.pbPHS8, 160);
  eq("AU Powerball PowerHit System 13 games", ent.pbPHS13, 34320);
  eq("Oz Lotto Pick 5 games", ent.ozP5, 861);
  eq("Oz Lotto Pick 6 games", ent.ozP6, 41);
  eq("Oz Lotto System 8 games", ent.ozS8, 8);
  eq("Saturday Lotto Pick 4 games", ent.satP4, 820);
  eq("Saturday Lotto Pick 5 games", ent.satP5, 40);
  eq("Saturday Lotto System 7 games", ent.satS7, 7);
  eq("Saturday Lotto System 20 games", ent.satS20, 38760);
  eq("Weekday Windfall Pick 4 games", ent.wwP4, 820);
  eq("Weekday Windfall Pick 5 games", ent.wwP5, 40);
  eq("Weekday Windfall System 7 games", ent.wwS7, 7);
  eq("SuperEnalotto System 19 games", ent.seS19, 27132);
  eq("AU Powerball System tab: count", ent.pbSys.length, 13);
  eq("AU Powerball System tab: first", ent.pbSys[0], "Pick 5 — 435 games");
  eq("AU Powerball System tab: second", ent.pbSys[1], "Pick 6 — 29 games");
  eq("AU Powerball System tab: third", ent.pbSys[2], "System 8 — 8 games");
  eq("AU Powerball System tab: last", ent.pbSys[12], "System 18 — 31,824 games");
  eq("AU Powerball PowerHit System: count", ent.pbPhs.length, 6);
  eq("AU Powerball PowerHit System: last", ent.pbPhs[5], "System 13 — 34,320 games");
  eq("Oz Lotto System tab: count", ent.ozSys.length, 13);
  eq("Oz Lotto System tab: first", ent.ozSys[0], "Pick 5 — 861 games");
  eq("Oz Lotto System tab: last", ent.ozSys[12], "System 18 — 31,824 games");
  eq("Saturday Lotto System tab: count", ent.satSys.length, 16);
  eq("Saturday Lotto System tab: first", ent.satSys[0], "Pick 4 — 820 games");
  eq("Saturday Lotto System tab: last", ent.satSys[15], "System 20 — 38,760 games");
  eq("Weekday Windfall System tab: count", ent.wwSys.length, 16);
  eq("SuperEnalotto System: count (7–19)", ent.seSys.length, 13);
  eq("SuperEnalotto System: last", ent.seSys[12], "System 19 — 27,132 games");
  eq("minGames per game", ent.minGames.join(","),
    "au-powerball:4,oz-lotto:1,saturday-lotto:4,weekday-windfall:4,set-for-life:2,futureball:5,us-powerball:1," +
    "us-mega-millions:1,euromillions:1,uk-lotto:1,eurojackpot:1,superenalotto:1");
  check("Max 50 games / 50 entries on every game", ent.maxes);

  // ---------------------------------------------------------------- pricing
  sec("Verified price points (exact, no ≈)");
  const P = await page.evaluate(function () {
    var S = window.SREKJA, G = {}, out = {};
    S.GAMES.forEach(function (g) { G[g.id] = g; });
    function cost(id, t, s, n) { var g = G[id]; var c = S.costFor(g, S.entrySpec(g, t, s), n); return [c.cents, c.exact]; }
    var std = {
      "au-powerball": [4, 6, 8, 12, 18, 25, 36, 50], "oz-lotto": [1, 6, 10, 12, 18, 25, 36, 50],
      "saturday-lotto": [4, 6, 10, 12, 18, 25, 36, 50], "weekday-windfall": [4, 6, 10, 12, 18, 25, 36, 50],
      "set-for-life": [2]
    };
    out.std = {};
    Object.keys(std).forEach(function (id) { out.std[id] = std[id].map(function (n) { return [n].concat(cost(id, "standard", null, n)); }); });
    out.pts = {
      pbPH: cost("au-powerball", "powerhit", null, 1), pbPH2: cost("au-powerball", "powerhit", null, 2),
      pbP6: cost("au-powerball", "system", "p6", 1), pbP5: cost("au-powerball", "system", "p5", 1),
      pbS18: cost("au-powerball", "system", "s18", 1), pbPHS13: cost("au-powerball", "phsystem", "s13", 1),
      ozS8: cost("oz-lotto", "system", "s8", 1), ozP6: cost("oz-lotto", "system", "p6", 1),
      ozP5: cost("oz-lotto", "system", "p5", 1), ozS18: cost("oz-lotto", "system", "s18", 1),
      satS7: cost("saturday-lotto", "system", "s7", 1), satP5: cost("saturday-lotto", "system", "p5", 1),
      satP4: cost("saturday-lotto", "system", "p4", 1), satS20: cost("saturday-lotto", "system", "s20", 1),
      wwS7: cost("weekday-windfall", "system", "s7", 1), wwP5: cost("weekday-windfall", "system", "p5", 1),
      wwP4: cost("weekday-windfall", "system", "p4", 1), wwS20: cost("weekday-windfall", "system", "s20", 1)
    };
    out.lin = {
      pbP6x50: cost("au-powerball", "system", "p6", 50), pbP5x50: cost("au-powerball", "system", "p5", 50),
      ozS8x50: cost("oz-lotto", "system", "s8", 50), ozP5x48: cost("oz-lotto", "system", "p5", 48),
      satP4x50: cost("saturday-lotto", "system", "p4", 50), satP5x50: cost("saturday-lotto", "system", "p5", 50),
      satS7x50: cost("saturday-lotto", "system", "s7", 50), wwP4x50: cost("weekday-windfall", "system", "p4", 50),
      wwP5x50: cost("weekday-windfall", "system", "p5", 50), wwS7x50: cost("weekday-windfall", "system", "s7", 50)
    };
    out.fb = {
      pbStd5: cost("au-powerball", "standard", null, 5), pbS8: cost("au-powerball", "system", "s8", 1),
      pbS8x3: cost("au-powerball", "system", "s8", 3), ozS9: cost("oz-lotto", "system", "s9", 1),
      sfl3: cost("set-for-life", "standard", null, 3)
    };
    out.over = {
      fb5: cost("futureball", "standard", null, 5), usPB1: cost("us-powerball", "standard", null, 1),
      mm1: cost("us-mega-millions", "standard", null, 1), em1: cost("euromillions", "standard", null, 1),
      uk1: cost("uk-lotto", "standard", null, 1), ej1: cost("eurojackpot", "standard", null, 1),
      se1: cost("superenalotto", "standard", null, 1), seS7: cost("superenalotto", "system", "s7", 1),
      seS19: cost("superenalotto", "system", "s19", 1)
    };
    out.eff = S.GAMES.filter(function (g) { return g.effectivePerGame; }).map(function (g) { return [g.id, g.effectivePerGame]; });
    out.money = S.formatMoney("AUD", 5003370);
    out.pv = S.GAMES.map(function (g) { return g.id + ":" + g.priceVerified; });
    out.qp = Object.keys(S.QP_PACKAGES).map(function (k) { return k + ":" + S.QP_PACKAGES[k].length; });
    out.w3 = S.QP_PACKAGES["weekday-windfall"].filter(function (p) { return p.drawsPerEntry === 3; }).map(function (p) { return p.games + "=" + p.price; });
    return out;
  });
  const STD = {
    "au-powerball": { 4: 630, 6: 950, 8: 1260, 12: 1890, 18: 2830, 25: 3930, 36: 5660, 50: 7860 },
    "oz-lotto": { 1: 150, 6: 875, 10: 1460, 12: 1750, 18: 2630, 25: 3650, 36: 5260, 50: 7300 },
    "saturday-lotto": { 4: 385, 6: 575, 10: 960, 12: 1150, 18: 1720, 25: 2390, 36: 3440, 50: 4780 },
    "weekday-windfall": { 4: 270, 6: 400, 10: 680, 12: 810, 18: 1210, 25: 1690, 36: 2430, 50: 3360 },
    "set-for-life": { 2: 1100 }
  };
  Object.keys(STD).forEach(function (id) {
    P.std[id].forEach(function (r) {
      eq(id + " standard " + r[0] + " games cents", r[1], STD[id][r[0]]);
      eq(id + " standard " + r[0] + " games exact", r[2], true);
    });
  });
  const PTS = { pbPH: 3150, pbPH2: 6300, pbP6: 4560, pbP5: 68390, pbS18: 5003370, pbPHS13: 5395790,
    ozS8: 1170, ozP6: 5985, ozP5: 125695, ozS18: 4645985, satS7: 670, satP5: 3820, satP4: 78275, satS20: 3699900,
    wwS7: 475, wwP5: 2695, wwP4: 55250, wwS20: 2611650 };
  Object.keys(PTS).forEach(function (k) {
    eq("Price point " + k + " cents", P.pts[k][0], PTS[k]);
    eq("Price point " + k + " exact", P.pts[k][1], true);
  });
  eq("formatMoney AUD 50,033.70", P.money, "A$50,033.70");

  sec("Linear multiples (R verified)");
  const LIN = { pbP6x50: 228000, pbP5x50: 3419500, ozS8x50: 58500, ozP5x48: 6033360, satP4x50: 3913750,
    satP5x50: 191000, satS7x50: 33500, wwP4x50: 2762500, wwP5x50: 134750, wwS7x50: 23750 };
  Object.keys(LIN).forEach(function (k) {
    eq(k + " cents", P.lin[k][0], LIN[k]);
    eq(k + " exact", P.lin[k][1], true);
  });

  sec("Fallback pricing (≈) and effectivePerGame");
  eq("PB standard 5 games ≈ (5 × 1.5722 = 7.86)", P.fb.pbStd5[0], 786); eq("PB standard 5 not exact", P.fb.pbStd5[1], false);
  eq("PB System 8 ≈ (8 × 1.5722 = 12.58)", P.fb.pbS8[0], 1258); eq("PB System 8 not exact", P.fb.pbS8[1], false);
  eq("PB System 8 × 3 entries ≈ 37.74 (entry × count)", P.fb.pbS8x3[0], 3774);
  eq("Oz System 9 ≈ (36 × 1.4599 = 52.56)", P.fb.ozS9[0], 5256); eq("Oz System 9 not exact", P.fb.ozS9[1], false);
  eq("Set for Life 3 games ≈ 16.50", P.fb.sfl3[0], 1650); eq("Set for Life 3 games not exact", P.fb.sfl3[1], false);
  const effExpect = { "au-powerball": [[50033.70, 31824], [53957.90, 34320]], "oz-lotto": [[46459.85, 31824]],
    "saturday-lotto": [[36999.00, 38760]], "weekday-windfall": [[26116.50, 38760]] };
  P.eff.forEach(function (r) {
    (effExpect[r[0]] || []).forEach(function (pg) {
      eq(r[0] + " effectivePerGame matches " + pg[0] + " / " + pg[1] + " to 4 dp", (pg[0] / pg[1]).toFixed(4), r[1].toFixed(4));
    });
  });

  sec("Overseas / FutureBall prices (operator per-game, linear)");
  eq("FutureBall 5 games = A$4.75", P.over.fb5[0], 475); eq("FutureBall exact", P.over.fb5[1], true);
  eq("US Powerball 1 = US$2", P.over.usPB1[0], 200); eq("Mega Millions 1 = US$5", P.over.mm1[0], 500);
  eq("EuroMillions 1 = £2.50", P.over.em1[0], 250); eq("UK Lotto 1 = £2", P.over.uk1[0], 200);
  eq("Eurojackpot 1 = €2", P.over.ej1[0], 200); eq("SuperEnalotto 1 = €1", P.over.se1[0], 100);
  eq("SuperEnalotto System 7 = €7", P.over.seS7[0], 700); eq("SuperEnalotto System 19 = €27,132", P.over.seS19[0], 2713200);

  sec("priceVerified matches inline expected data");
  const EXPECTED_PV = [
    "au-powerball:true", "oz-lotto:true", "saturday-lotto:true", "weekday-windfall:true",
    "set-for-life:true", "futureball:true", "us-powerball:true", "us-mega-millions:true",
    "euromillions:true", "uk-lotto:true", "eurojackpot:true", "superenalotto:true"
  ];
  eq("priceVerified per game", P.pv.join(","), EXPECTED_PV.join(","));
  const expIds = EXPECTED_PV.map(function (e) { return e.split(":")[0]; }).join(",");
  const gameIds = P.pv.map(function (e) { return e.split(":")[0]; }).join(",");
  check("Expected priceVerified map covers all 12 games", EXPECTED_PV.length === 12 && expIds === gameIds,
    "expected ids " + expIds + " vs GAMES ids " + gameIds);
  eq("QuickPick packages stored", P.qp.join(","), "au-powerball:8,oz-lotto:8,saturday-lotto:8,weekday-windfall:10");
  eq("Weekday 3 Play packages", P.w3.join(","), "5=10,15=30");

  // ---------------------------------------------------------------- UI summaries
  sec("UI summary text");
  let s;
  s = await setup(page, "au-powerball");
  has("AU Powerball default (4 standard games)", s, "4 games total");
  has("AU Powerball default", s, "A$6.30");
  hasNot("AU Powerball default", s, "≈ A$6.30");
  has("AU Powerball default", s, "1 in 33,622,600");
  s = await setup(page, "au-powerball", null, null, 1);
  has("AU Powerball standard 1 line", s, "Division 1 ≈ 1 in 134,490,400");
  eq("AU Powerball 1 line: min message", (await page.textContent("#min-msg")).trim(), "Minimum entry is 4 games.");
  eq("AU Powerball 1 line: Pick disabled", await page.isDisabled("#pick"), true);
  s = await setup(page, "au-powerball", "powerhit", null, 1);
  has("PowerHit ×1", s, "20 games per entry");
  has("PowerHit ×1", s, "1 in 6,724,520");
  has("PowerHit ×1", s, "A$31.50");
  check("PowerHit ×1: min message hidden", await page.isHidden("#min-msg"));
  eq("PowerHit ×1: Pick enabled", await page.isDisabled("#pick"), false);
  s = await setup(page, "au-powerball", "powerhit", null, 2);
  has("PowerHit ×2", s, "40 games total");
  has("PowerHit ×2", s, "A$63.00");
  hasNot("PowerHit ×2 (verified → no ≈)", s, "≈ A$63.00");
  has("PowerHit ×2", s, "1 in 3,362,260");
  s = await setup(page, "au-powerball", "system", "s8", 1);
  has("PB System 8", s, "8 games per entry");
  has("PB System 8 (fallback)", s, "≈ A$12.58 (check your cart)");
  s = await setup(page, "au-powerball", "system", "p6", 1);
  has("PB Pick 6", s, "29 games per entry");
  has("PB Pick 6", s, "A$45.60");
  hasNot("PB Pick 6 (verified → no ≈ on price)", s, "≈ A$");
  s = await setup(page, "oz-lotto", null, null, 1);
  has("Oz Lotto standard", s, "1 in 62,891,499");
  has("Oz Lotto standard", s, "A$1.50");
  s = await setup(page, "oz-lotto", "system", "s8", 1);
  has("Oz System 8", s, "8 games per entry"); has("Oz System 8", s, "A$11.70");
  s = await setup(page, "oz-lotto", "system", "p6", 1);
  has("Oz Pick 6", s, "41 games per entry"); has("Oz Pick 6", s, "A$59.85");
  s = await setup(page, "oz-lotto", "system", "p5", 1);
  has("Oz Pick 5", s, "861 games per entry"); has("Oz Pick 5", s, "A$1,256.95");
  s = await setup(page, "saturday-lotto", null, null, 4);
  has("Saturday Lotto 4 games", s, "A$3.85");
  s = await setup(page, "saturday-lotto", null, null, 1);
  has("Saturday Lotto standard 1 line", s, "1 in 8,145,060");
  s = await setup(page, "saturday-lotto", "system", "s7", 1);
  has("Saturday System 7", s, "7 games per entry"); has("Saturday System 7", s, "A$6.70");
  s = await setup(page, "saturday-lotto", "system", "p5", 1);
  has("Saturday Pick 5", s, "40 games per entry");
  s = await setup(page, "saturday-lotto", "system", "p4", 1);
  has("Saturday Pick 4", s, "820 games per entry");
  s = await setup(page, "weekday-windfall", null, null, 4);
  has("Weekday Windfall 4 games", s, "A$2.70");
  s = await setup(page, "set-for-life");
  check("Set for Life: no entry-type selector", await page.isHidden("#entry-wrap"));
  has("Set for Life 2 games", s, "A$11.00");
  has("Set for Life 2 games", s, "Each game plays 7 daily draws");
  s = await setup(page, "set-for-life", null, null, 1);
  has("Set for Life 1 game", s, "1 in 38,320,568 per draw");
  eq("Set for Life 1 game: min message", (await page.textContent("#min-msg")).trim(), "Minimum entry is 2 games.");
  s = await setup(page, "futureball");
  has("FutureBall default 5 games", s, "A$4.75");
  check("FutureBall default: min message hidden", await page.isHidden("#min-msg"));
  s = await setup(page, "futureball", null, null, 4);
  has("FutureBall 4 lines", s, "1 in 1,008,678");
  eq("FutureBall 4 lines: min message", (await page.textContent("#min-msg")).trim(), "Minimum entry is 5 games.");
  eq("FutureBall 4 lines: Pick disabled", await page.isDisabled("#pick"), true);
  s = await setup(page, "futureball", null, null, 1);
  has("FutureBall 1 line", s, "1 in 4,034,712");
  has("FutureBall note", await page.textContent("#notes"), "Each combination is sold once per draw");
  eq("FutureBall availability tag", await page.textContent("#avail"), "NT-licensed (The Lottery Office)");
  s = await setup(page, "us-powerball", null, null, 1);
  has("US Powerball", s, "1 in 292,201,338"); has("US Powerball [§7.12: Lottery Office AUD]", s, "A$7.00 via The Lottery Office (USA Power Lotto)");
  eq("US Powerball availability tag [§7.12]", await page.textContent("#avail"), "Available in Australia via The Lottery Office (NT-licensed)");
  s = await setup(page, "us-mega-millions", null, null, 1);
  has("Mega Millions", s, "1 in 290,472,336"); has("Mega Millions [§7.12: Lottery Office AUD]", s, "A$11.95 via The Lottery Office (USA Mega Lotto)");
  s = await setup(page, "euromillions", null, null, 1);
  has("EuroMillions", s, "1 in 139,838,160"); has("EuroMillions [§7.12: Lottery Office AUD]", s, "A$9.50 via The Lottery Office (European Millions)");
  s = await setup(page, "eurojackpot", null, null, 1);
  has("Eurojackpot", s, "1 in 139,838,160"); has("Eurojackpot [§7.12: Lottery Office AUD]", s, "A$7.50 via The Lottery Office (European Jackpot)");
  s = await setup(page, "uk-lotto", null, null, 1);
  has("UK Lotto", s, "per round 1 in 45,057,474");
  has("UK Lotto", s, "≈ 1 in 22,528,737 per draw");
  has("UK Lotto", s, "Each line plays two rounds per draw");
  s = await setup(page, "superenalotto", null, null, 1);
  has("SuperEnalotto", s, "1 in 622,614,630"); has("SuperEnalotto [§7.12: Lottery Office AUD]", s, "A$4.75 via The Lottery Office (Italian Super Jackpot)");
  s = await setup(page, "superenalotto", "system", "s19", 1);
  has("SuperEnalotto System 19", s, "27,132 games per entry"); has("SuperEnalotto System 19 [§7.12: not sold by the LO in v0.5 → home price, labelled]", s, "€27,132.00 — Sisal (ADM) home-country price; Australian prices differ");
  eq("AU Powerball availability tag", (await setup(page, "au-powerball"), await page.textContent("#avail")), "Sold in Australia");

  sec("Labels, button text (Generate) and copy text");
  await setup(page, "oz-lotto", "system", "s8", 1);
  eq("Size selector label", await page.textContent("#sys-label"), "Size");
  eq("Button with 1 entry", await page.textContent("#pick"), "Generate");
  await setup(page, "saturday-lotto", "standard", null, 4);
  eq("Button with 4 lines", await page.textContent("#pick"), "Generate 4 lines");
  await setup(page, "au-powerball", "powerhit", null, 8);
  eq("Button with 8 entries", await page.textContent("#pick"), "Generate 8 entries");
  await page.click("#pick");
  eq("Button after generating", await page.textContent("#pick"), "Generate again");
  await page.reload();
  has("Empty-state prompt", await page.textContent("#output"), "Press “Generate” for AU Powerball.");
  const src2 = fs.readFileSync(HTML, "utf8");
  check("No 'Pick numbers' / 'Pick again' button text left in v0.5", src2.indexOf("Pick numbers") < 0 && src2.indexOf("Pick again") < 0);
  check("Rule line keeps supplementary info: Oz '(+ 3 supplementaries)'",
    (await setup(page, "oz-lotto"), (await page.textContent("#rule")).indexOf("(+ 3 supplementaries)") >= 0));
  await page.click("#pick");
  eq("Oz Lotto note under results", await page.textContent("#supp-note"), "The draw also includes 3 supplementary numbers — you don't pick these.");
  await setup(page, "us-powerball");
  await page.click("#pick");
  eq("US Powerball: no supplementary note", await page.locator("#supp-note").count(), 0);
  await setup(page, "au-powerball", "powerhit", null, 1);
  eq("Lines chip label for entries", await page.textContent("#lines-label"), "Entries");
  await setup(page, "au-powerball", "standard", null, 4);
  eq("Lines chip label for standard", await page.textContent("#lines-label"), "Lines");
  await setup(page, "oz-lotto", "system", "p6", 1);
  await page.click("#pick");
  let ct = await page.evaluate(function () { return window.SREKJA.clipboardText(); });
  check("Copy: Oz Pick 6 format 'A [Pick 6]: n n n n n n + any 1'", /^A \[Pick 6\]: (\d+ ){5}\d+ \+ any 1$/.test(ct), ct);
  check("Pick 6 shows '+ any 1 of the rest' pill", (await page.textContent("#output")).indexOf("+ any 1 of the rest") >= 0);
  await setup(page, "oz-lotto", "system", "s9", 1);
  await page.click("#pick");
  ct = await page.evaluate(function () { return window.SREKJA.clipboardText(); });
  check("Copy: Oz System 9 format 'A [System 9]: 9 numbers' (no Supp field)", /^A \[System 9\]: (\d+ ){8}\d+$/.test(ct), ct);
  await setup(page, "au-powerball", "system", "p5", 1);
  await page.click("#pick");
  ct = await page.evaluate(function () { return window.SREKJA.clipboardText(); });
  check("Copy: PB Pick 5 includes chosen Powerball", /^A \[Pick 5\]: (\d+ ){4}\d+ \+ any 2 \| Powerball: \d+$/.test(ct), ct);
  await setup(page, "au-powerball", "powerhit", null, 1);
  await page.click("#pick");
  ct = await page.evaluate(function () { return window.SREKJA.clipboardText(); });
  check("Copy: PowerHit shows Powerball: ALL", /^A \[PowerHit\]: (\d+ ){6}\d+ \| Powerball: ALL$/.test(ct), ct);

  sec("SuperEnalotto: Jolly never generated");
  await setup(page, "superenalotto", null, null, 50);
  await page.click("#pick");
  const seOut = await page.textContent("#output");
  hasNot("SuperEnalotto output (50 lines)", seOut, "Jolly");
  eq("SuperEnalotto: no extra/supp balls generated", await page.locator("#output .ball.extra, #output .ball.supp").count(), 0);
  ct = await page.evaluate(function () { return window.SREKJA.clipboardText(); });
  hasNot("SuperEnalotto copy text", ct, "Jolly");

  // ---------------------------------------------------------------- line validity (every game × entry × size)
  sec("Generated lines valid for every game × entry type × size (50 lines each)");
  const validity = await page.evaluate(function () {
    var S = window.SREKJA, report = [];
    function sortedUniqueInRange(a, max) {
      for (var i = 0; i < a.length; i++) {
        if (a[i] < 1 || a[i] > max || Math.floor(a[i]) !== a[i]) return false;
        if (i && a[i] <= a[i - 1]) return false;
      }
      return true;
    }
    S.GAMES.forEach(function (g) {
      g.entryTypes.forEach(function (et) {
        var codes = (et.id === "system" || et.id === "phsystem") ? S.sizeOptions(g, et.id).map(function (o) { return o.code; }) : [null];
        codes.forEach(function (code) {
          var spec = S.entrySpec(g, et.id, code);
          var lines = S.drawLines(g, spec, 50), ok = true, why = "";
          var keys = {};
          lines.forEach(function (l) {
            if (l.main.length !== spec.chosen) { ok = false; why = "main length " + l.main.length; }
            if (!sortedUniqueInRange(l.main, g.mainMax)) { ok = false; why = "main not sorted/unique/in range"; }
            if (l.kind === "supp" || l.kind === "suppna") { ok = false; why = "supplementaries generated"; }
            if (g.suppPick && l.second.length !== 0) { ok = false; why = "supp game generated second-row numbers"; }
            if (l.kind === "extra" && (l.second.length !== g.extraPick || !sortedUniqueInRange(l.second, g.extraMax))) { ok = false; why = "extra shape"; }
            if (spec.kind === "pick" && l.any !== g.mainPick - spec.size) { ok = false; why = "pick any"; }
            if ((spec.kind === "powerhit" || spec.kind === "phsystem") && l.kind !== "all") { ok = false; why = "powerhit kind"; }
            if (g.extraDisplayOnly && l.kind === "extra") { ok = false; why = "display-only extra generated"; }
            keys[l.main.join(",") + "|" + l.second.join(",")] = 1;
          });
          if (Object.keys(keys).length !== 50) { ok = false; why = "duplicate lines"; }
          report.push([g.name + " / " + spec.name, ok, why]);
        });
      });
    });
    return report;
  });
  validity.forEach(function (r) { check(r[0], r[1], r[2]); });

  sec("Randomness smoke");
  const rnd = await page.evaluate(function () {
    var counts = []; for (var i = 0; i <= 35; i++) counts.push(0);
    for (var d = 0; d < 20000; d++) window.SREKJA.pickUnique(35, 7).forEach(function (n) { counts[n]++; });
    var exp = 20000 * 7 / 35, worst = 0;
    for (var k = 1; k <= 35; k++) worst = Math.max(worst, Math.abs(counts[k] - exp) / exp);
    return { worst: worst, min: Math.min.apply(null, counts.slice(1)), max: Math.max.apply(null, counts.slice(1)) };
  });
  check("20,000 × pickUnique(35,7): every count within ±8% of 4,000 (worst " + (rnd.worst * 100).toFixed(2) +
    "%, min " + rnd.min + ", max " + rnd.max + ")", rnd.worst <= 0.08, rnd.worst);

  // ---------------------------------------------------------------- console errors across every combo in the UI
  sec("Zero console errors across every game × entry type × size (UI)");
  const combos = await page.evaluate(function () {
    var S = window.SREKJA, c = [];
    S.GAMES.forEach(function (g, gi) {
      g.entryTypes.forEach(function (et) {
        var codes = (et.id === "system" || et.id === "phsystem") ? S.sizeOptions(g, et.id).map(function (o) { return o.code; }) : [null];
        codes.forEach(function (code) { c.push([gi, et.id, code, et.id === "standard" ? g.minGames : 2]); });
      });
    });
    return c;
  });
  const before = consoleErrors.length;
  let uiPicked = 0, suppCombos = 0, nonSuppCombos = 0;
  const suppBallFails = [], suppCopyFails = [], noteFails = [];
  for (const c of combos) {
    await page.selectOption("#game", String(c[0]));
    if (await page.isVisible("#entry")) await page.selectOption("#entry", c[1]);
    if (c[2]) await page.selectOption("#sys", c[2]);
    await page.click("#chips .chip >> text=Custom");
    await page.fill("#custom", String(c[3]));
    await page.dispatchEvent("#custom", "input");
    if (!(await page.isDisabled("#pick"))) { await page.click("#pick"); uiPicked++; }
    await page.click("#copy").catch(function () {});
    const st = await page.evaluate(function () {
      var g = window.SREKJA.GAMES[document.getElementById("game").value];
      var note = document.getElementById("supp-note");
      return { name: g.name, supp: !!g.suppPick, suppPick: g.suppPick || 0,
               note: note ? note.textContent : null, copy: window.SREKJA.clipboardText(),
               suppBalls: document.querySelectorAll("#output .ball.supp").length,
               suppRow: document.getElementById("output").textContent.indexOf("Supplementaries") >= 0 };
    });
    const label = st.name + " / " + c[1] + (c[2] ? " " + c[2] : "");
    if (st.suppBalls || st.suppRow) suppBallFails.push(label);
    if (st.copy.indexOf("Supp") >= 0) suppCopyFails.push(label + ": " + st.copy.split("\n")[0]);
    const wantNote = st.supp ? "The draw also includes " + st.suppPick + " supplementary numbers — you don't pick these." : null;
    if (st.note !== wantNote) noteFails.push(label + ": got " + JSON.stringify(st.note));
    if (st.supp) suppCombos++; else nonSuppCombos++;
  }
  check("No supplementary balls/rows generated in any game × entry × size (" + combos.length + " combos)", suppBallFails.length === 0, suppBallFails.join("; "));
  check("No 'Supp' in any copy text (" + combos.length + " combos)", suppCopyFails.length === 0, suppCopyFails.join("; "));
  check("Supplementary note shown for supp games only (" + suppCombos + " supp combos, " + nonSuppCombos + " others)", noteFails.length === 0, noteFails.join("; "));
  eq("UI combos exercised", uiPicked, combos.length);
  eq("Console errors during UI sweep", consoleErrors.length - before, 0);
  eq("Console errors total", consoleErrors.length, 0);
  if (consoleErrors.length) results.push({ name: "  errors: " + consoleErrors.join(" || "), ok: false, detail: "" });

  // ================================================================ v0.5 PLANNER (SPEC v1.3 §7)
  await v05Tests(page, consoleErrors);

  // ---------------------------------------------------------------- screenshots
  sec("Screenshots (390px)");
  fs.mkdirSync(SHOTS, { recursive: true });
  async function shot(file, gameId, entry, size, count) {
    await page.reload();
    await setup(page, gameId, entry, size, count);
    await page.click("#pick");
    const p = path.join(SHOTS, file);
    await page.screenshot({ path: p, fullPage: true });
    check("Screenshot " + path.relative(ROOT, p).split(path.sep).join("/"), fs.statSync(p).size > 0);
  }
  await shot("v0_5_gen_au_powerball_powerhit.png", "au-powerball", "powerhit", null, 1);
  await shot("v0_5_gen_oz_lotto_pick6.png", "oz-lotto", "system", "p6", 1);
  await shot("v0_5_gen_saturday_lotto_system9.png", "saturday-lotto", "system", "s9", 1);
  await shot("v0_5_gen_superenalotto_standard.png", "superenalotto", "standard", null, 1);

  await browser.close();

  // ---------------------------------------------------------------- write results
  const pass = results.filter(function (r) { return r.name && r.ok; }).length;
  const fail = results.filter(function (r) { return r.name && !r.ok; }).length;
  const lines = [];
  lines.push("Sreḱa v0.5 — acceptance test results");
  lines.push("File:    srekja_prototype_v0_5.html  (SHA-256 " + crypto.createHash("sha256").update(fs.readFileSync(HTML)).digest("hex") + ")");
  lines.push("Run at:  " + new Date().toISOString());
  lines.push("Node:    " + process.version + " · Playwright " + require("playwright/package.json").version);
  lines.push("");
  results.forEach(function (r) {
    if (r.section) { lines.push(""); lines.push("== " + r.section + " =="); return; }
    lines.push((r.ok ? "PASS  " : "FAIL  ") + r.name + (r.ok ? "" : "   <-- " + r.detail));
  });
  lines.push("");
  lines.push("SUMMARY: " + pass + " passed, " + fail + " failed, " + (pass + fail) + " total");
  fs.writeFileSync(OUT, lines.join("\n") + "\n", "utf8");
  console.log("SUMMARY: " + pass + " passed, " + fail + " failed, " + (pass + fail) + " total");
  console.log("Results written to " + OUT);
  process.exit(fail ? 1 : 0);
})().catch(function (e) {
  fs.writeFileSync(OUT, "Sreḱa v0.5 test run CRASHED\n" + (e && e.stack || e) + "\n", "utf8");
  console.error(e);
  process.exit(2);
});
