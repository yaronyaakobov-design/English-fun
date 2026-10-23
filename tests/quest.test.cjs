// End-to-end checks for quest.html (English Quest levels game).
// Run: node tests/quest.test.cjs [path/to/quest.html]
// Needs Playwright and a Chromium build. speechSynthesis is replaced by a recorder.
const path = require("path");
let chromium;
try { ({ chromium } = require("playwright")); } catch { ({ chromium } = require("/opt/node22/lib/node_modules/playwright")); }

const FILE = path.resolve(process.argv[2] || path.join(__dirname, "..", "quest.html"));
const URL = "file://" + FILE;

function stub() {
  window.__said = [];
  const list = [["Daniel", "en-GB"], ["Samantha", "en-US"]].map(([name, lang]) => ({ name, lang, voiceURI: name }));
  const synth = { getVoices: () => list, speak: u => window.__said.push({ text: u.text, lang: u.lang }), cancel() {}, addEventListener() {} };
  Object.defineProperty(window, "speechSynthesis", { value: synth, configurable: true });
  window.SpeechSynthesisUtterance = function (text) { this.text = text; };
}

let pass = 0, fail = 0;
const failures = [];
function check(name, ok, detail) { if (ok) pass++; else { fail++; failures.push(name + (detail ? " :: " + detail : "")); } }

async function newPage(browser) {
  const ctx = await browser.newContext({ viewport: { width: 375, height: 740 }, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  page.errors = [];
  page.on("pageerror", e => page.errors.push(e.message));
  await page.addInitScript(stub);
  await page.goto(URL);
  return page;
}
const noOverflow = page => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

async function createPlayer(page, name, boy) {
  await page.fill("#pName", name);
  if (boy) await page.click('.seg button[data-g="m"]');
  await page.click("#newP button[type=submit]");
}

// Answer the current question right or wrong through the UI, then move on without waiting for the auto-advance.
async function answerQ(page, right) {
  const q = await page.evaluate(() => { const R = EQ.R, q = R.qs[R.n]; return { answer: q.answer, opts: q.opts || null, build: q.build || null, n: R.n }; });
  if (q.build) {
    const used = new Set();
    const letters = right ? q.answer.split("") : q.build.slice(0, q.answer.length).reverse();
    for (const ch of letters) {
      const i = q.build.findIndex((c, j) => c === ch && !used.has(j));
      used.add(i);
      await page.click(`#tiles button[data-t="${i}"]`);
    }
  } else {
    const i = right ? q.opts.indexOf(q.answer) : q.opts.findIndex(o => o !== q.answer);
    await page.click(`.opt[data-i="${i}"]`);
  }
  return q;
}
const advance = page => page.evaluate(() => next());

(async () => {
  const browser = await chromium.launch();

  /* ---------- pure logic ---------- */
  {
    const page = await newPage(browser);
    const r = await page.evaluate(() => {
      const out = [];
      const known = new Set([...WORDS.map(w => w.en), ...NUMS.map(n => n[0]), ...COLORS.map(c => c[0]), ...DAYS.map(d => d.en)].map(x => x.toLowerCase()));
      EQ.LEVELS.forEach((L, li) => {
        for (let rep = 0; rep < 40; rep++) {
          const qs = EQ.makeQuestions(li);
          out.push(["count", li, qs.length === (L.n || 8)]);
          qs.forEach(q => {
            out.push(["text", li, typeof q.text === "string" && q.text.length > 0 && !/undefined|NaN/.test(JSON.stringify(q))]);
            if (q.build) {
              const need = q.answer.split("").sort().join(""), have = q.build.slice();
              const okLetters = q.answer.split("").every(c => { const i = have.indexOf(c); if (i < 0) return false; have.splice(i, 1); return true; });
              out.push(["build letters", li, okLetters && need.length >= 3]);
            } else {
              out.push(["answer in options", li, q.opts.includes(q.answer)]);
              out.push(["unique options", li, new Set(q.opts).size === q.opts.length]);
              out.push(["option count", li, q.opts.length === L.k, q.opts.length + " vs " + L.k]);
              if (q.sw) out.push(["swatch exists", li, q.opts.every(o => COLORS.some(c => c[0] === o))]);
              const spelling = /כותבים נכון/.test(q.text);
              if (spelling) out.push(["misspellings are not real words", li, q.opts.filter(o => o !== q.answer).every(o => !known.has(o.toLowerCase())), q.opts.join(",")]);
            }
            if (q.say && /איזו אות שמעת|האות הקטנה/.test(q.text)) out.push(["letter spoken as bare name", li, /^([A-Y]\.|zee)$/.test(q.say), q.say]);
          });
        }
      });
      return out;
    });
    const agg = {};
    for (const [name, li, ok, d] of r) { const k = `level ${li + 1}: ${name}`; if (!ok) check(k, false, d); else agg[k] = 1; }
    pass += Object.keys(agg).length;

    const levels = await page.evaluate(() => EQ.LEVELS.map(L => ({ w: L.w, k: L.k, time: L.time || 0 })));
    check("24 levels in 6 worlds", levels.length === 24 && new Set(levels.map(l => l.w)).size === 6);
    check("worlds never get easier", levels.every((l, i) => i === 0 || l.w >= levels[i - 1].w));
    check("last level of each world is timed", [3, 7, 11, 15, 18, 21, 22, 23].every(i => levels[i].time > 0));
    const timed = levels.filter(l => l.time);
    check("final levels have the shortest timer", timed.slice(-2).every(l => l.time <= Math.min(...timed.slice(0, -2).map(x => x.time))));

    const s = await page.evaluate(() => [EQ.scoreAnswer(1, 0, 1), EQ.scoreAnswer(1, 0, 3), EQ.scoreAnswer(2, 1, 3), EQ.scoreAnswer(6, 0.5, 1), EQ.scoreAnswer(3, 0.04, 0), EQ.finishBonus(3, 2), EQ.finishBonus(6, 0), EQ.finishBonus(1, 3)]);
    check("score: world 1 plain", s[0] === 10, s[0]);
    check("score: world 1 streak", s[1] === 15, s[1]);
    check("score: world 2 full speed + streak", s[2] === 40, s[2]);
    check("score: world 6 half time", s[3] === 75, s[3]);
    check("score: world 3 almost no time", s[4] === 31, s[4]);
    check("bonus: world 3, 2 hearts", s[5] === 60, s[5]);
    check("bonus: lost level gets nothing", s[6] === 0, s[6]);
    check("bonus: world 1, 3 hearts", s[7] === 30, s[7]);

    const c = await page.evaluate(() => {
      const a = EQ.makeCode("A1B2"), b = EQ.makeCode("ZZ99");
      const bad = a.slice(0, -1) + (a.endsWith("A") ? "B" : "A");
      return [a, EQ.validCode(a), EQ.validCode(b), EQ.validCode(a.toLowerCase()), EQ.validCode(a.replace(/-/g, "")), EQ.validCode(" " + a + " "), EQ.validCode(bad), EQ.validCode("EQ-A1B2-AAAA"), EQ.validCode(""), EQ.validCode("hello")];
    });
    check("access code format", /^EQ-A1B2-[A-Z2-9]{4}$/.test(c[0]), c[0]);
    check("access code valid", c[1] && c[2]);
    check("access code: case, dashes, spaces forgiven", c[3] && c[4] && c[5]);
    check("access code: tampered rejected", !c[6] && !c[8] && !c[9]);

    const sh = await page.evaluate(() => {
      const p = { name: "נועה", av: "🦊", g: "f", best: { 0: { pts: 140, stars: 3 }, 1: { pts: 120, stars: 2 }, 3: { pts: 90, stars: 1 } } };
      const code = EQ.encodeShare(p), msg = "🏆 blah blah הקוד: " + code + " עוד טקסט";
      const back = EQ.parseShare(msg);
      const [b64, chk] = code.slice(3).split(".");
      const forged = JSON.stringify([1, "נועה", "🦊", "f", 24, 99999, 72, 1]);
      const forgedCode = "EQ:" + btoa(String.fromCharCode(...new TextEncoder().encode(forged))).replace(/=+$/, "") + "." + chk;
      return { code, back, tampered: EQ.parseShare("EQ:" + b64.slice(0, -2) + "AA." + chk), forged: EQ.parseShare(forgedCode), junk: EQ.parseShare("hello") };
    });
    check("share: round trip keeps Hebrew name", sh.back && sh.back.name === "נועה" && sh.back.av === "🦊");
    check("share: passed = consecutive levels only", sh.back && sh.back.passed === 2, JSON.stringify(sh.back));
    check("share: points and stars summed", sh.back && sh.back.pts === 350 && sh.back.stars === 6);
    check("share: tampered code rejected", sh.tampered === null && sh.forged === null && sh.junk === null);

    const order = await page.evaluate(() => EQ.sortBoard([
      { name: "A", passed: 3, pts: 900, stars: 9 }, { name: "B", passed: 5, pts: 100, stars: 5 },
      { name: "C", passed: 5, pts: 300, stars: 5 }, { name: "D", passed: 5, pts: 300, stars: 9 }]).map(r => r.name).join(""));
    check("leaderboard: level first, then points, then stars", order === "DCBA", order);
    check("no JS errors (logic)", page.errors.length === 0, page.errors.join("; "));
    await page.context().close();
  }

  /* ---------- full playthrough on a phone screen ---------- */
  {
    const page = await newPage(browser);
    check("first screen: create player form", await page.isVisible("#newP"));
    check("no overflow: profiles", await noOverflow(page));
    await page.click("#newP button[type=submit]");
    check("empty name refused", (await page.textContent("#pMsg")).length > 0);
    await createPlayer(page, "נועה");
    check("map shown after creating player", await page.isVisible(".hero"));
    check("hero shows level 1", (await page.textContent(".hero .stat b")).startsWith("1"));
    check("only level 1 open", (await page.$$(".node:not(.lock)")).length === 1);
    check("no overflow: map", await noOverflow(page));
    check("footer credit", (await page.textContent("footer")).includes("Made with ❤ by Yaron Y"));

    // Level 1: all right -> 3 stars, 140 points (8x10 + 6 streak bonuses of 5 + 3 hearts x 10)
    await page.click("#cont");
    check("no overflow: level", await noOverflow(page));
    await page.evaluate(() => window.__said.splice(0));
    for (let n = 0; n < 8; n++) { await answerQ(page, true); if (n < 7) await advance(page); }
    const said = await page.evaluate(() => window.__said.map(u => u.lang));
    check("speech is en-US", said.length > 0 && said.every(l => l === "en-US"));
    await advance(page);
    check("level 1 result: 3 stars", (await page.$$(".bigst .off")).length === 0 && (await page.textContent(".result h2")).includes("מושלם"));
    check("level 1 result: +140", (await page.textContent(".gain")).trim() === "+140", await page.textContent(".gain"));
    check("level 1 result: level 2 unlocked", (await page.textContent(".news")).includes("שלב 2"));
    check("no overflow: result", await noOverflow(page));
    const st = await page.evaluate(() => EQ.S.profiles[0].best[0]);
    check("saved best for level 1", st.pts === 140 && st.stars === 3, JSON.stringify(st));

    // Replay level 1 and lose: 3 wrong answers end the level, best score is kept
    await page.click("#again");
    for (let n = 0; n < 3; n++) { await answerQ(page, false); await advance(page); }
    check("3 mistakes end the level", (await page.textContent(".result h2")).includes("נגמרו הלבבות"));
    check("losing keeps the best score", (await page.evaluate(() => EQ.S.profiles[0].best[0].pts)) === 140);
    await page.click("#toMap");

    // Locked level does nothing
    await page.click('.node[data-li="5"]');
    check("locked level stays on map", await page.isVisible(".hero"));

    // Play every level to the end with one mistake each (2 stars), forcing one timeout on timed levels
    for (let li = 1; li < 24; li++) {
      await page.evaluate(i => { go(startLevel, i); }, li);
      const L = await page.evaluate(i => EQ.LEVELS[i], li);
      const qn = L.n || 8;
      for (let n = 0; n < qn; n++) {
        if (n === 2 && L.time) {
          check(`level ${li + 1}: timer bar shown`, await page.isVisible("#tbar"));
          await page.evaluate(() => { EQ.R.deadline = Date.now() - 1; });
          await page.waitForTimeout(250);
          check(`level ${li + 1}: timeout costs a heart`, (await page.evaluate(() => EQ.R.hearts)) === 2);
          await advance(page);
          continue;
        }
        const wrong = n === 2 && !L.time;
        await answerQ(page, !wrong);
        if (n === qn - 1) break;
        await advance(page);
      }
      await advance(page);
      const h = await page.textContent(".result h2");
      check(`level ${li + 1}: passed with 2 stars`, h.includes("עברת") && (await page.$$(".bigst .off")).length === 1, h);
      if (li === 23) check("no overflow: final result", await noOverflow(page));
    }
    const prog = await page.evaluate(() => { const p = EQ.S.profiles[0]; return { passed: EQ.passedCount(p), pts: EQ.totalPts(p) }; });
    check("all 24 levels passed", prog.passed === 24, prog.passed);
    check("points grow with worlds", prog.pts > 140 * 24, prog.pts);
    await page.evaluate(() => go(showMap));
    check("map rank is legend", (await page.textContent(".rank")).includes("אגדה"));
    check("no JS errors (playthrough)", page.errors.length === 0, page.errors.join("; "));

    // Leaderboard + sharing to a second device
    await page.click("#toBoard");
    check("no overflow: leaderboard", await noOverflow(page));
    const msg = await page.textContent("#myCode");
    check("share message has name and code", msg.includes("נועה") && /EQ:[A-Za-z0-9_-]+\.[a-z0-9]+/.test(msg));
    check("whatsapp link carries the code", (await page.getAttribute("#wa", "href")).includes(encodeURIComponent("EQ:")));

    const p2 = await newPage(browser);
    await createPlayer(p2, "דני", true);
    await p2.click("#toBoard");
    await p2.fill("#fCode", "garbage");
    await p2.click("#addF button[type=submit]");
    check("bad friend code shows an error", (await p2.textContent("#fMsg")).includes("לא מצאתי"));
    await p2.fill("#fCode", msg);
    await p2.click("#addF button[type=submit]");
    await p2.waitForTimeout(1000);
    const rows = await p2.$$eval(".brow .nm b", els => els.map(e => e.textContent));
    check("friend added and ranked first", rows[0] === "נועה" && rows[1] === "דני", rows.join(","));
    check("boy profile uses masculine text", (await p2.evaluate(() => tx("נסי", "נסה"))) === "נסה");
    await p2.click(".del");
    check("friend can be removed", (await p2.$$(".brow")).length === 1);

    // Paywall preview: level 9 needs a code
    await p2.evaluate(() => { EQ.setPaywall(true); const p = EQ.S.profiles[0]; for (let i = 0; i < 8; i++) p.best[i] = { pts: 100, stars: 3 }; go(showMap); });
    check("paywalled levels show a key", (await p2.$$('.node.lock .ball')).length > 0 && (await p2.textContent('.node[data-li="8"] .ball')).includes("🔑"));
    await p2.click('.node[data-li="8"]');
    check("paywall sheet opens", await p2.isVisible("#sheet"));
    check("no overflow: paywall", await noOverflow(p2));
    await p2.fill("#acc", "EQ-AAAA-AAAA");
    await p2.click("#payF button[type=submit]");
    check("wrong access code refused", (await p2.textContent("#accMsg")).includes("לא תקין"));
    const code = await p2.evaluate(() => EQ.makeCode("T3ST"));
    await p2.fill("#acc", code.toLowerCase());
    await p2.click("#payF button[type=submit]");
    await p2.waitForTimeout(1100);
    check("valid access code unlocks", !(await p2.isVisible("#sheet")) && !(await p2.textContent('.node[data-li="8"] .ball')).includes("🔑"));
    await p2.reload();
    check("license survives reload", await p2.evaluate(() => !!EQ.S.license));
    check("no JS errors (second device)", p2.errors.length === 0, p2.errors.join("; "));
    await p2.context().close();
    await page.context().close();
  }

  await browser.close();
  console.log(`${pass} passed, ${fail} failed`);
  if (fail) { console.log(failures.slice(0, 40).join("\n")); process.exit(1); }
})().catch(e => { console.error(e); process.exit(1); });
