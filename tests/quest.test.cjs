// End-to-end checks for English Quest, the levels game in the "מסע" tab of index.html.
// Run: node tests/quest.test.cjs [path/to/index.html]
// Needs Playwright and a Chromium build. speechSynthesis is replaced by a recorder.
const path = require("path");
let chromium;
try { ({ chromium } = require("playwright")); } catch { ({ chromium } = require("/opt/node22/lib/node_modules/playwright")); }

const FILE = path.resolve(process.argv[2] || path.join(__dirname, "..", "index.html"));
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
  await page.click("#tab-quest");
  return page;
}
const noOverflow = page => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

async function createPlayer(page, name, boy) {
  await page.fill("#qx-pName", name);
  if (boy) await page.click('.seg button[data-g="m"]');
  await page.click("#qx-newP button[type=submit]");
  // New players are offered the opening challenge; these tests start from the beginning
  await page.click("#qx-placeNo");
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
      await page.click(`#qx-tiles button[data-t="${i}"]`);
    }
  } else {
    const i = right ? q.opts.indexOf(q.answer) : q.opts.findIndex(o => o !== q.answer);
    await page.click(`.opt[data-i="${i}"]`);
  }
  return q;
}
const advance = page => page.evaluate(() => EQ.next());
// Visible buttons in the game smaller than the 44px Apple recommends for small fingers
const smallTargets = page => page.evaluate(() => [...document.querySelectorAll("#sec-quest button, #sec-quest a.btn")].filter(b => b.offsetParent && !b.disabled).map(b => [b, b.getBoundingClientRect()]).filter(([, r]) => r.width < 44 || r.height < 44).map(([b, r]) => (b.id || b.className || b.textContent.trim().slice(0, 12)) + " " + Math.round(r.width) + "x" + Math.round(r.height)));

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
          out.push(["count", li, qs.length === (L.n || 6)]);
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
    check("40 levels in 8 worlds of 5", levels.length === 40 && new Set(levels.map(l => l.w)).size === 8 && [1,2,3,4,5,6,7,8].every(w => levels.filter(l => l.w === w).length === 5));
    check("worlds never get easier", levels.every((l, i) => i === 0 || l.w >= levels[i - 1].w));
    check("every level has an hourglass, shrinking from 30s to 9s", levels.every((l, i) => l.time > 0 && (i === 0 || l.time <= levels[i - 1].time)) && levels[0].time === 30 && levels[39].time === 9);
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
      const p = { name: "נועה", av: "🦊", g: "f", best: { "abc-case": { pts: 140, stars: 3 }, "abc-hear": { pts: 120, stars: 2 }, "abc-next": { pts: 90, stars: 1 } } };
      const code = EQ.encodeShare(p), msg = "🏆 blah blah הקוד: " + code + " עוד טקסט";
      const back = EQ.parseShare(msg);
      const [b64, chk] = code.slice(3).split(".");
      const forged = JSON.stringify([1, "נועה", "🦊", "f", 24, 99999, 72, 1]);
      const forgedCode = "EQ:" + btoa(String.fromCharCode(...new TextEncoder().encode(forged))).replace(/=+$/, "") + "." + chk;
      return { code, back, tampered: EQ.parseShare("EQ:" + b64.slice(0, -2) + "AA." + chk), forged: EQ.parseShare(forgedCode), junk: EQ.parseShare("hello") };
    });
    check("share: round trip keeps Hebrew name", sh.back && sh.back.name === "נועה" && sh.back.av === "🦊");
    check("share: passed = levels done", sh.back && sh.back.passed === 3, JSON.stringify(sh.back));
    check("share: points and stars summed", sh.back && sh.back.pts === 350 && sh.back.stars === 6);
    check("share: tampered code rejected", sh.tampered === null && sh.forged === null && sh.junk === null);

    const order = await page.evaluate(() => EQ.sortBoard([
      { name: "A", passed: 3, pts: 900, stars: 9 }, { name: "B", passed: 5, pts: 100, stars: 5 },
      { name: "C", passed: 5, pts: 300, stars: 5 }, { name: "D", passed: 5, pts: 300, stars: 9 }]).map(r => r.name).join(""));
    check("leaderboard: points first, then stars, then level", order === "ADCB", order);
    check("no JS errors (logic)", page.errors.length === 0, page.errors.join("; "));
    await page.context().close();
  }

  /* ---------- full playthrough on a phone screen ---------- */
  {
    const page = await newPage(browser);
    check("first screen: create player form", await page.isVisible("#qx-newP"));
    check("no overflow: profiles", await noOverflow(page));
    await page.click("#qx-newP button[type=submit]");
    check("empty name refused", (await page.textContent("#qx-pMsg")).length > 0);
    await createPlayer(page, "נועה");
    check("map shown after creating player", await page.isVisible(".hero"));
    check("hero shows level 1", (await page.textContent(".hero .stat b")).startsWith("1"));
    check("only level 1 open", (await page.$$(".mnode:not(.lock)")).length === 1);
    check("no overflow: map", await noOverflow(page));
    const mapCheck = async label => {
      const m = await page.evaluate(() => {
        const box = document.querySelector("#qx-qmap").getBoundingClientRect();
        const balls = [...document.querySelectorAll(".mnode .ball")].map(b => b.getBoundingClientRect());
        const bans = [...document.querySelectorAll(".wban")].map(b => b.getBoundingClientRect());
        const hit = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
        const inside = r => r.left >= box.left - 1 && r.right <= box.right + 1 && r.top >= box.top - 1 && r.bottom <= box.bottom + 1;
        let overlaps = 0, outside = 0, banHits = 0;
        balls.forEach((a, i) => { if (!inside(a)) outside++; balls.slice(i + 1).forEach(b => { if (hit(a, b)) overlaps++; }); bans.forEach(b => { if (hit(a, b)) banHits++; }); });
        bans.forEach(b => { if (!inside(b)) outside++; });
        return { n: balls.length, overlaps, outside, banHits, avatar: !!document.querySelector(".me-av"), now: document.querySelectorAll(".mnode.now").length };
      });
      check(`map ${label}: 40 level buttons`, m.n === 40, m.n);
      check(`map ${label}: level circles never overlap`, m.overlaps === 0, m.overlaps);
      check(`map ${label}: world banners never cover a level`, m.banHits === 0, m.banHits);
      check(`map ${label}: everything inside the map`, m.outside === 0, m.outside);
      check(`map ${label}: avatar and one current level`, m.avatar && m.now === 1, JSON.stringify(m));
    };
    await mapCheck("phone");
    check("footer credit", (await page.textContent("footer")).includes("Made with ❤ by Yaron Y"));

    // Level 1: all right -> 3 stars. Points depend on speed now, so check the range: 6x10 + 4 streaks x5 + 30 hearts = 110, plus up to 6x5 speed
    await page.click("#qx-cont");
    check("no overflow: level", await noOverflow(page));
    await page.evaluate(() => window.__said.splice(0));
    for (let n = 0; n < 6; n++) { await answerQ(page, true); if (n < 5) await advance(page); }
    const said = await page.evaluate(() => window.__said.map(u => u.lang));
    check("speech is en-US", said.length > 0 && said.every(l => l === "en-US"));
    await advance(page);
    check("level 1 result: 3 stars", (await page.$$(".bigst .off")).length === 0 && (await page.textContent(".qres h2")).includes("מושלם"));
    const gain1 = +(await page.textContent(".gain")).trim().slice(1);
    check("level 1 result: 110-140 points", gain1 >= 110 && gain1 <= 140, gain1);
    check("level 1 result: level 2 unlocked", (await page.textContent(".news")).includes("שלב 2"));
    check("no overflow: result", await noOverflow(page));
    const shareHref = await page.getAttribute("#qx-share", "href");
    check("result screen: send-to-friends button with link", shareHref && decodeURIComponent(shareHref).includes("English-fun/#eq=EQ:"), shareHref);
    check("result screen: confetti on a win", (await page.$$(".confetti")).length > 0);
    check("touch targets >= 44px: result", (await smallTargets(page)).length === 0, (await smallTargets(page)).join(","));
    const st = await page.evaluate(() => EQ.S.profiles[0].best["abc-case"]);
    check("saved best for level 1", st.pts === gain1 && st.stars === 3, JSON.stringify(st));
    const dupIds = () => page.evaluate(() => { const c = {}; document.querySelectorAll("[id]").forEach(e => c[e.id] = (c[e.id] || 0) + 1); return Object.keys(c).filter(k => c[k] > 1); });
    check("no duplicate ids on the result screen", (await dupIds()).length === 0, (await dupIds()).join(","));
    // The "next level" button on the result screen starts level 2
    await page.click("#qx-nextL");
    check("next-level button starts level 2", (await page.evaluate(() => EQ.R && EQ.R.li)) === 1);
    check("hourglass shown", await page.isVisible(".hg"));
    check("touch targets >= 44px: question", (await smallTargets(page)).length === 0, (await smallTargets(page)).join(","));
    check("no duplicate ids while playing", (await dupIds()).length === 0, (await dupIds()).join(","));
    await page.waitForTimeout(400);
    check("hourglass counts seconds", /^\d+$/.test((await page.textContent("#qx-tsec")).trim()));
    // A wrong answer moves on by itself
    const n0 = await page.evaluate(() => EQ.R.n);
    await answerQ(page, false);
    await page.waitForTimeout(2600);
    check("wrong answer auto-advances", (await page.evaluate(() => EQ.R && EQ.R.n)) === n0 + 1);
    await page.evaluate(() => EQ.go(EQ.startLevel, 0));

    // Replay level 1 and lose: 3 wrong answers end the level, best score is kept
    for (let n = 0; n < 3; n++) { await answerQ(page, false); await advance(page); }
    check("3 mistakes end the level", (await page.textContent(".qres h2")).includes("נגמרו הלבבות"));
    check("losing keeps the best score", (await page.evaluate(() => EQ.S.profiles[0].best["abc-case"].pts)) === gain1);
    await page.click("#qx-toMap");

    // Locked level does nothing
    await page.click('.mnode[data-li="5"]');
    check("locked level stays on map", await page.isVisible(".hero"));

    // Play every level to the end with one mistake each (2 stars), forcing one timeout on timed levels
    for (let li = 1; li < 40; li++) {
      await page.evaluate(i => { EQ.go(EQ.startLevel, i); }, li);
      const L = await page.evaluate(i => EQ.LEVELS[i], li);
      const qn = L.n || 6;
      for (let n = 0; n < qn; n++) {
        if (n === 2 && L.time) {
          check(`level ${li + 1}: timer bar shown`, await page.isVisible("#qx-tbar"));
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
      const h = await page.textContent(".qres h2");
      check(`level ${li + 1}: passed with 2 stars`, h.includes("עברת") && (await page.$$(".bigst .off")).length === 1, h);
      if (li === 39) check("no overflow: final result", await noOverflow(page));
    }
    const prog = await page.evaluate(() => { const p = EQ.S.profiles[0]; return { passed: EQ.passedCount(p), pts: EQ.totalPts(p) }; });
    check("all 40 levels passed", prog.passed === 40, prog.passed);
    check("points grow with worlds", prog.pts > 100 * 40, prog.pts);
    await page.evaluate(() => EQ.go(EQ.showMap));
    check("map rank is legend", (await page.textContent(".rank")).includes("אגדה"));
    check("days-in-a-row shown after playing", (await page.textContent(".hero .streak")).includes("1 יום"));
    check("touch targets >= 44px: map", (await smallTargets(page)).length === 0, (await smallTargets(page)).join(","));
    for (const w of [320, 430, 820]) { await page.setViewportSize({ width: w, height: 800 }); await page.waitForTimeout(100); await mapCheck(w + "px"); check(`no overflow: map at ${w}px`, await noOverflow(page)); }
    await page.setViewportSize({ width: 375, height: 740 });
    check("no JS errors (playthrough)", page.errors.length === 0, page.errors.join("; "));

    // Leaderboard + sharing to a second device
    await page.click("#qx-toBoard");
    check("no overflow: leaderboard", await noOverflow(page));
    const msg = await page.textContent("#qx-myCode");
    check("share message has name and code", msg.includes("נועה") && /EQ:[A-Za-z0-9_-]+\.[a-z0-9]+/.test(msg));
    check("whatsapp link carries the code", (await page.getAttribute("#qx-wa", "href")).includes(encodeURIComponent("EQ:")));
    check("share message has a one-tap link", msg.includes("https://yaronyaakobov-design.github.io/English-fun/#eq=EQ:"));
    check("touch targets >= 44px: leaderboard", (await smallTargets(page)).length === 0, (await smallTargets(page)).join(","));

    const p2 = await newPage(browser);
    await createPlayer(p2, "דני", true);
    await p2.click("#qx-toBoard");
    await p2.fill("#qx-fCode", "garbage");
    await p2.click("#qx-addF button[type=submit]");
    check("bad friend code shows an error", (await p2.textContent("#qx-fMsg")).includes("לא מצאתי"));
    await p2.fill("#qx-fCode", msg);
    await p2.click("#qx-addF button[type=submit]");
    await p2.waitForTimeout(1000);
    const rows = await p2.$$eval(".brow .nm b", els => els.map(e => e.textContent));
    check("friend added and ranked first", rows[0] === "נועה" && rows[1] === "דני", rows.join(","));
    check("boy profile uses masculine text", (await p2.evaluate(() => EQ.tx("נסי", "נסה"))) === "נסה");
    await p2.click("#qx-toMap");
    check("map shows place on the leaderboard", (await p2.textContent("#qx-toBoard")).includes("מקום 2 מ-2"));
    await p2.click("#qx-toBoard");
    await p2.click(".del");
    check("friend can be removed", (await p2.$$(".brow")).length === 1);

    // Paywall preview: level 9 needs a code
    await p2.evaluate(() => { EQ.setPaywall(true); const p = EQ.S.profiles[0]; for (let i = 0; i < 8; i++) p.best[EQ.LEVELS[i].id] = { pts: 100, stars: 3 }; EQ.go(EQ.showMap); });
    check("paywalled levels show a key", (await p2.$$('.mnode.lock .ball')).length > 0 && (await p2.textContent('.mnode[data-li="8"] .ball')).includes("🔑"));
    await p2.click('.mnode[data-li="8"]');
    check("paywall sheet opens", await p2.isVisible("#qx-sheet"));
    check("no overflow: paywall", await noOverflow(p2));
    await p2.fill("#qx-acc", "EQ-AAAA-AAAA");
    await p2.click("#qx-payF button[type=submit]");
    check("wrong access code refused", (await p2.textContent("#qx-accMsg")).includes("לא תקין"));
    const code = await p2.evaluate(() => EQ.makeCode("T3ST"));
    await p2.fill("#qx-acc", code.toLowerCase());
    await p2.click("#qx-payF button[type=submit]");
    await p2.waitForTimeout(1100);
    check("valid access code unlocks", !(await p2.isVisible("#qx-sheet")) && !(await p2.textContent('.mnode[data-li="8"] .ball')).includes("🔑"));
    await p2.reload();
    check("license survives reload", await p2.evaluate(() => !!EQ.S.license));
    check("no JS errors (second device)", p2.errors.length === 0, p2.errors.join("; "));
    await p2.context().close();

    // A friend's link opens the game and adds them to the leaderboard in one tap
    for (const [label, withPlayer] of [["new device", false], ["device with a player", true]]) {
      const ctx = await browser.newContext({ viewport: { width: 375, height: 740 }, isMobile: true, hasTouch: true });
      const p3 = await ctx.newPage(); p3.errors = []; p3.on("pageerror", e => p3.errors.push(e.message));
      await p3.addInitScript(stub);
      await p3.goto(URL);
      if (withPlayer) { await p3.click("#tab-quest"); await createPlayer(p3, "רוני", true); await p3.click("#tab-letters"); }
      const link = msg.match(/https:\S+/)[0];
      await p3.goto(URL + link.slice(link.indexOf("#")));
      await p3.waitForTimeout(300);
      check(`link (${label}): quest tab opens on the leaderboard`, await p3.isVisible("#sec-quest") && await p3.isVisible(".board"));
      check(`link (${label}): friend added`, (await p3.$$eval(".brow .nm b", els => els.map(e => e.textContent))).includes("נועה"));
      check(`link (${label}): confirmation shown`, (await p3.textContent("#qx-linkMsg")).includes("נועה"));
      check(`link (${label}): address cleaned`, !(await p3.evaluate(() => location.hash)));
      await p3.reload(); await p3.click("#tab-quest");
      check(`link (${label}): friend kept after reload`, (await p3.evaluate(() => EQ.S.friends.map(f => f.name))).includes("נועה"));
      check(`no JS errors (link, ${label})`, p3.errors.length === 0, p3.errors.join("; "));
      await ctx.close();
    }
    {
      const ctx = await browser.newContext({ viewport: { width: 375, height: 740 } });
      const p4 = await ctx.newPage(); p4.errors = []; p4.on("pageerror", e => p4.errors.push(e.message));
      await p4.addInitScript(stub);
      await p4.goto(URL + "#eq=EQ:broken.zz");
      await p4.waitForTimeout(300);
      check("broken link: friendly error, nothing added", (await p4.textContent("#qx-linkMsg")).includes("לא תקין") && (await p4.evaluate(() => EQ.S.friends.length)) === 0);
      check("no JS errors (broken link)", p4.errors.length === 0, p4.errors.join("; "));
      await ctx.close();
    }
    await page.context().close();
  }

  // ---------- Opening challenge: finds the child's level by itself ----------
  async function placement(knows) {
    const ctx = await browser.newContext({ viewport: { width: 375, height: 740 }, isMobile: true, hasTouch: true });
    const pg = await ctx.newPage(); pg.errors = []; pg.on("pageerror", e => pg.errors.push(e.message));
    await pg.addInitScript(stub);
    await pg.goto(URL); await pg.click("#tab-quest");
    await pg.fill("#qx-pName", "בודק");
    await pg.click("#qx-newP button[type=submit]");
    const offered = await pg.isVisible("#qx-placeGo");
    await pg.click("#qx-placeGo");
    const worlds = [];
    while (await pg.evaluate(() => !!(EQ.R && EQ.R.place))) {
      const w = await pg.evaluate(() => EQ.R.L.w);
      worlds.push(w);
      if (worlds.length === 1) check("challenge: no hourglass, no hearts", !(await pg.isVisible(".hg")) && !(await pg.isVisible(".hearts")));
      await answerQ(pg, knows(w, worlds));
      await advance(pg);
    }
    const r = await pg.evaluate(() => { const p = EQ.S.profiles[0]; return { placed: p.placed, first: EQ.firstOpen(p), pts: EQ.totalPts(p), stars: EQ.totalStars(p), passed: EQ.passedCount(p) }; });
    const text = await pg.textContent(".qres");
    return { pg, offered, worlds, r, text };
  }
  {
    const { pg, offered, worlds, r, text } = await placement(() => true);
    check("challenge offered to a new player", offered);
    check("challenge: knows everything -> harder questions each time, 8 questions", worlds.join() === "2,2,5,5,7,7,8,8", worlds.join());
    check("challenge: knows everything -> starts in the last world", r.placed.w === 8 && r.first === 35 && text.includes("טירת האלופים"), JSON.stringify(r));
    check("challenge: skipped levels give no points or stars", r.pts === 0 && r.stars === 0 && r.passed === 35, JSON.stringify(r));
    await pg.click("#qx-placeOk");
    check("challenge: map opens on level 36", (await pg.textContent(".hero .stat b")).trim().startsWith("36"));
    check("challenge: skipped levels show 1 star and stay open", (await pg.$$eval('.mnode[data-li="3"] .nst span.off', e => e.length)) === 1 && !(await pg.$eval('.mnode[data-li="3"]', e => e.classList.contains("lock"))));
    check("challenge: not offered again", !(await pg.isVisible("#qx-placeGo")));
    // Playing a skipped level for real replaces the free star with what was earned
    await pg.evaluate(() => EQ.go(EQ.startLevel, 0));
    for (let n = 0; n < 6; n++) { await answerQ(pg, true); await advance(pg); }
    const after = await pg.evaluate(() => { const p = EQ.S.profiles[0]; return { b: p.best["abc-case"], stars: EQ.totalStars(p) }; });
    check("challenge: replaying a skipped level earns real stars and points", after.b.stars === 3 && after.b.pts > 0 && !after.b.skip && after.stars === 3, JSON.stringify(after));
    check("no JS errors (challenge, strong)", pg.errors.length === 0, pg.errors.join("; "));
    await pg.context().close();
  }
  {
    const { pg, worlds, r, text } = await placement(() => false);
    check("challenge: knows nothing -> easier questions, stops after 4", worlds.join() === "2,2,1,1", worlds.join());
    check("challenge: knows nothing -> starts at the beginning", r.placed.w === 1 && r.first === 0 && r.passed === 0 && text.includes("מההתחלה"), JSON.stringify(r));
    check("no JS errors (challenge, beginner)", pg.errors.length === 0, pg.errors.join("; "));
    await pg.context().close();
  }
  {
    const { pg, worlds, r } = await placement(w => w <= 4);
    check("challenge: knows worlds 1-4 -> starts in world 5", r.placed.w === 5 && r.first === 20, JSON.stringify(r) + " " + worlds.join());
    check("challenge: never more than 10 questions", worlds.length <= 10, worlds.length);
    await pg.context().close();
  }
  {
    // One slip in a world gets a third, deciding question
    const { pg, worlds } = await placement((w, ws) => !(w === 2 && ws.length === 1));
    check("challenge: a tie gets a third question", worlds.slice(0, 4).join() === "2,2,2,5", worlds.join());
    await pg.context().close();
  }
  {
    // Existing players get the offer on the map once, and can say no
    const pg = await withSave({ ver: 3, cur: "f6", friends: [], profiles: [{ id: "f6", name: "עדי", av: "🐝", g: "f", best: { "abc-case": { pts: 100, stars: 3 } } }] });
    check("existing player: challenge offered on the map", await pg.isVisible(".placecard"));
    await pg.click("#qx-placeNo");
    await pg.reload(); await pg.click("#tab-quest");
    check("existing player: 'no thanks' is remembered", !(await pg.isVisible(".placecard")));
    // Help mode: a child who keeps missing gets fewer choices and more time, same scoring
    const h = await pg.evaluate(() => {
      const p = EQ.S.profiles[0], li = 2;
      const normal = EQ.needsHelp(p, li);
      EQ.go(EQ.startLevel, li); const nOpts = EQ.R.qs[0].opts.length, nTime = EQ.R.L.time;
      p.fails = { "abc-start": 2 };
      const help = EQ.needsHelp(p, li);
      EQ.go(EQ.startLevel, li);
      const hOpts = EQ.R.qs[0].opts.length, badge = !!document.querySelector(".phead .help"), deadline = EQ.R.deadline - Date.now();
      p.fails = {}; p.recent = [false, false, false, false, true, false, false, true, false, false];
      const help2 = EQ.needsHelp(p, li);
      p.recent = [];
      return { normal, nOpts, help, hOpts, badge, help2, secs: Math.round(deadline / 1000), nTime };
    });
    check("help mode: off for a child doing fine", !h.normal && h.nOpts === 4);
    check("help mode: after losing a level twice, 3 choices instead of 4", h.help && h.hOpts === 3 && h.badge, JSON.stringify(h));
    check("help mode: 50% more time", h.secs >= Math.round(h.nTime * 1.5) - 1, JSON.stringify(h));
    check("help mode: also when most recent answers were wrong", h.help2);
    check("no JS errors (offer + help)", pg.errors.length === 0, pg.errors.join("; "));
    await pg.context().close();
  }
  {
    // Leaderboard order: points, then stars, then levels
    const pg = await withSave({ ver: 3, friends: [], profiles: [] });
    const order = await pg.evaluate(() => EQ.sortBoard([
      { name: "far", passed: 30, pts: 500, stars: 30 }, { name: "busy", passed: 8, pts: 900, stars: 20 },
      { name: "tieA", passed: 5, pts: 400, stars: 9 }, { name: "tieB", passed: 9, pts: 400, stars: 12 }]).map(r => r.name));
    check("leaderboard: ranked by points, then stars", order.join() === "busy,far,tieB,tieA", order.join());
    await pg.context().close();
  }

  // ---------- Upgrades keep saved progress ----------
  // Load a save written by an earlier version and check nothing is lost.
  async function withSave(save) {
    const ctx = await browser.newContext({ viewport: { width: 375, height: 740 }, isMobile: true, hasTouch: true });
    const pg = await ctx.newPage(); pg.errors = []; pg.on("pageerror", e => pg.errors.push(e.message));
    await pg.addInitScript(stub);
    await pg.goto(URL);
    await pg.evaluate(s => { localStorage.clear(); localStorage.setItem("englishquest.v1", s); }, typeof save === "string" ? save : JSON.stringify(save));
    await pg.reload();
    await pg.click("#tab-quest");
    return pg;
  }
  const friend = { name: "תמר", av: "🐼", g: "f", passed: 7, pts: 900, stars: 18, ts: 1761200000 };
  {
    // v10 save (ver 2): 40 levels, progress keyed by position. Player passed levels 1-12.
    const best = {}; for (let i = 0; i < 12; i++) best[i] = { pts: 100 + i, stars: 1 + (i % 3) };
    const v2 = { ver: 2, cur: "a1", mute: true, license: null, friends: [friend], profiles: [{ id: "a1", name: "מיה", av: "🦄", g: "f", best }, { id: "b2", name: "יואב", av: "🐯", g: "m", best: { 0: { pts: 120, stars: 3 } } }] };
    const pg = await withSave(v2);
    const r = await pg.evaluate(() => { const p = EQ.S.profiles[0]; return { ver: EQ.S.ver, passed: EQ.passedCount(p), pts: EQ.totalPts(p), first: EQ.firstOpen(p), keys: Object.keys(p.best), mute: EQ.S.mute, friends: EQ.S.friends.length, other: EQ.passedCount(EQ.S.profiles[1]), backup: JSON.parse(localStorage.getItem(EQ.BACKUP_KEY) || "null"), saved: JSON.parse(localStorage.getItem("englishquest.v1")) }; });
    const expPts = Object.values(best).reduce((a, b) => a + b.pts, 0);
    check("upgrade from v10: save version raised to 3", r.ver === 3 && r.saved.ver === 3, r.ver);
    check("upgrade from v10: all 12 levels kept", r.passed === 12, r.passed);
    check("upgrade from v10: points kept", r.pts === expPts, r.pts + " vs " + expPts);
    check("upgrade from v10: progress keyed by level id", r.keys.includes("abc-case") && r.keys.includes("col-hear") && !r.keys.includes("0"), r.keys.join(","));
    check("upgrade from v10: player stands on level 13", r.first === 12 && (await pg.textContent(".hero .stat b")).trim().startsWith("13"));
    check("upgrade from v10: second player, friends, settings kept", r.other === 1 && r.friends === 1 && r.mute === true);
    check("upgrade from v10: backup of the old save kept", r.backup && r.backup.ver === 2 && r.backup.profiles[0].best["11"].pts === 111);
    await pg.reload(); await pg.click("#tab-quest");
    check("upgrade from v10: second load changes nothing", (await pg.evaluate(() => EQ.passedCount(EQ.S.profiles[0]))) === 12);
    check("no JS errors (upgrade from v10)", pg.errors.length === 0, pg.errors.join("; "));
    await pg.context().close();
  }
  {
    // v9 save (no version): 24 levels in the old order
    const v1 = { cur: "c3", friends: [], profiles: [{ id: "c3", name: "אורי", av: "🐸", g: "m", best: { 0: { pts: 90, stars: 3 }, 1: { pts: 80, stars: 2 }, 2: { pts: 70, stars: 1 }, 3: { pts: 60, stars: 3 }, 4: { pts: 50, stars: 1 } } }] };
    const pg = await withSave(v1);
    const r = await pg.evaluate(() => { const p = EQ.S.profiles[0]; return { keys: Object.keys(p.best).sort(), pts: EQ.totalPts(p), first: EQ.firstOpen(p), lockedDone: EQ.LEVELS.filter((L, i) => p.best[L.id] && !EQ.unlocked(p, i)).length }; });
    check("upgrade from v9: levels mapped to the right ids", r.keys.join() === "abc-case,abc-hear,abc-mix,abc-start,num-hear10", r.keys.join());
    check("upgrade from v9: points kept", r.pts === 350, r.pts);
    check("upgrade from v9: new level 4 is next, nothing passed is locked", r.first === 3 && r.lockedDone === 0, JSON.stringify(r));
    check("no JS errors (upgrade from v9)", pg.errors.length === 0, pg.errors.join("; "));
    await pg.context().close();
  }
  {
    // A future version adds a level in the middle and keeps a level id this build does not know
    const v3 = { ver: 3, cur: "d4", friends: [], profiles: [{ id: "d4", name: "שירה", av: "🐨", g: "f", best: { "abc-case": { pts: 100, stars: 3 }, "abc-hear": { pts: 100, stars: 3 }, "future-level": { pts: 77, stars: 2 }, "abc-mix": { pts: 100, stars: 3 } } }] };
    const pg = await withSave(v3);
    const r = await pg.evaluate(() => { const p = EQ.S.profiles[0]; return { pts: EQ.totalPts(p), kept: !!p.best["future-level"], start: EQ.unlocked(p, 2), next: EQ.unlocked(p, 3), mix: EQ.unlocked(p, 4), after: EQ.unlocked(p, 5), backup: localStorage.getItem(EQ.BACKUP_KEY) }; });
    check("unknown level ids are kept, not dropped", r.kept && r.pts === 377, JSON.stringify(r));
    check("a gap in the middle never locks levels already reached", r.start && r.next && r.mix && r.after, JSON.stringify(r));
    check("current saves are not re-converted", r.backup === null);
    await pg.context().close();
  }
  {
    const pg = await withSave("{not json");
    check("broken save: game still opens", await pg.isVisible("#qx-newP"));
    check("no JS errors (broken save)", pg.errors.length === 0, pg.errors.join("; "));
    await pg.context().close();
  }
  {
    // Days in a row
    const pg = await withSave({ ver: 3, cur: "e5", friends: [], profiles: [{ id: "e5", name: "גל", av: "🐙", g: "m", best: {} }] });
    const r = await pg.evaluate(() => {
      const p = EQ.S.profiles[0], d = new Date(); d.setDate(d.getDate() - 1);
      const y = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
      p.days = { last: y, n: 4 }; const before = EQ.streakDays(p); EQ.playedToday(p); const after = EQ.streakDays(p); EQ.playedToday(p);
      const same = EQ.streakDays(p); p.days = { last: "2020-01-01", n: 9 }; const gone = EQ.streakDays(p); EQ.playedToday(p);
      return [before, after, same, gone, EQ.streakDays(p)];
    });
    check("days in a row: continue, same day, reset after a gap", r.join() === "4,5,5,0,1", r.join());
    await pg.context().close();
  }

  await browser.close();
  console.log(`${pass} passed, ${fail} failed`);
  if (fail) { console.log(failures.slice(0, 40).join("\n")); process.exit(1); }
})().catch(e => { console.error(e); console.log(pass + " passed so far; failures:\n" + failures.join("\n")); process.exit(1); });
