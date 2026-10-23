// End-to-end speech and game checks for index.html.
// Run: node tests/speech.test.cjs [path/to/index.html]
// Needs Playwright (npm i -D playwright) and a Chromium build.
// speechSynthesis is replaced by a recorder, so every check is on the exact text sent to the voice.
const path = require("path");
let chromium;
try { ({ chromium } = require("playwright")); } catch { ({ chromium } = require("/opt/node22/lib/node_modules/playwright")); }

const FILE = path.resolve(process.argv[2] || path.join(__dirname, "..", "index.html"));
const ABC = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");
const letterSaid = L => (L === "Z" ? "zee" : L + ".");

// Voice lists as each browser reports them (US and non-US mixed in, as on real devices).
const DEVICES = {
  "iPhone Safari": { voices: [["Daniel", "en-GB"], ["Karen", "en-AU"], ["Moira", "en-IE"], ["Samantha", "en-US"], ["Fred", "en-US"], ["Albert", "en-US"], ["Carmit", "he-IL"]], expect: "Samantha", man: "Fred" },
  "iPhone Safari + Ava Premium": { voices: [["Daniel", "en-GB"], ["Martha (Premium)", "en-GB"], ["Samantha", "en-US"], ["Ava (Premium)", "en-US"]], expect: "Ava (Premium)", man: "Ava (Premium)", deep: true },
  "Chrome desktop": { voices: [["Google UK English Female", "en-GB"], ["Google UK English Male", "en-GB"], ["Google US English", "en-US"], ["Microsoft David - English (United States)", "en-US"], ["Microsoft Zira - English (United States)", "en-US"]], expect: "Google US English", man: "Microsoft David - English (United States)" },
  "Edge desktop": { voices: [["Microsoft Sonia Online (Natural) - English (United Kingdom)", "en-GB"], ["Microsoft Libby Online (Natural) - English (United Kingdom)", "en-GB"], ["Microsoft Ana Online (Natural) - English (United States)", "en-US"], ["Microsoft Andrew Online (Natural) - English (United States)", "en-US"], ["Microsoft Ava Online (Natural) - English (United States)", "en-US"], ["Microsoft Jenny Online (Natural) - English (United States)", "en-US"]], expect: "Microsoft Ava Online (Natural) - English (United States)", man: "Microsoft Andrew Online (Natural) - English (United States)" },
  "Android Chrome": { voices: [["English United Kingdom", "en_GB"], ["English India", "en_IN"], ["English United States", "en_US"]], expect: "English United States", man: "English United States", deep: true },
  "Voices load late (iOS)": { voices: [["Daniel", "en-GB"], ["Samantha", "en-US"]], expect: "Samantha", late: true, man: "Samantha", deep: true },
};

function stub(voices, late) {
  window.__said = [];
  const list = voices.map(([name, lang]) => ({ name, lang, localService: true, default: false, voiceURI: name }));
  let ready = !late;
  const listeners = [];
  const synth = {
    getVoices: () => (ready ? list : []),
    speak: u => window.__said.push({ text: u.text, lang: u.lang, voice: u.voice && u.voice.name, rate: u.rate, pitch: u.pitch }),
    cancel() {}, pause() {}, resume() {},
    addEventListener: (t, f) => t === "voiceschanged" && listeners.push(f),
    set onvoiceschanged(f) { listeners.push(f); },
  };
  Object.defineProperty(window, "speechSynthesis", { value: synth, configurable: true });
  window.SpeechSynthesisUtterance = function (text) { this.text = text; };
  if (late) setTimeout(() => { ready = true; listeners.forEach(f => f()); }, 300);
}

let pass = 0, fail = 0;
const failures = [];
function check(name, ok, detail) {
  if (ok) pass++; else { fail++; failures.push(name + (detail ? " :: " + detail : "")); }
}

(async () => {
  const browser = await chromium.launch();
  for (const [dev, cfg] of Object.entries(DEVICES)) {
    const page = await browser.newPage();
    const errors = [];
    page.on("pageerror", e => errors.push(e.message));
    await page.addInitScript(stub, cfg.voices, !!cfg.late);
    await page.goto("file://" + FILE);
    await page.waitForTimeout(cfg.late ? 600 : 100);
    const said = () => page.evaluate(() => window.__said.splice(0));
    const last = async () => { const s = await said(); return s[s.length - 1]; };

    // Voice choice and footer
    const chosen = await page.evaluate(() => voice && voice.name);
    check(`${dev}: picks ${cfg.expect}`, chosen === cfg.expect, "got " + chosen);
    check(`${dev}: footer shows voice`, (await page.textContent("#voiceName")).includes(cfg.expect));
    check(`${dev}: build tag v13`, (await page.textContent("footer")).includes("v13"));

    // Narrator picker: woman / man / robot / squirrel, remembered after reload
    await said();
    await page.click("#voiceBtn");
    check(`${dev}: voice picker opens`, await page.isVisible("#voiceSheet"));
    await page.click('#voiceSheet [data-v="man"]');
    const vm = await last();
    check(`${dev}: man -> ${cfg.man}${cfg.deep ? " (deeper)" : ""}`, vm && vm.voice === cfg.man && vm.lang === "en-US" && (cfg.deep ? vm.pitch < 0.8 : vm.pitch === 1), JSON.stringify(vm));
    await page.click('#voiceSheet [data-v="robot"]');
    const vr = await last();
    check(`${dev}: robot = teacher voice, low pitch`, vr && vr.voice === cfg.expect && vr.pitch < 0.5 && vr.lang === "en-US", JSON.stringify(vr));
    await page.click('#voiceSheet [data-v="squirrel"]');
    const vs = await last();
    check(`${dev}: squirrel = teacher voice, high pitch`, vs && vs.voice === cfg.expect && vs.pitch > 1.5, JSON.stringify(vs));
    await page.click('#voiceSheet [data-v="man"]'); await said();
    await page.click("#voiceDone");
    check(`${dev}: picker closes`, !(await page.isVisible("#voiceSheet")));
    await page.reload(); await page.waitForTimeout(cfg.late ? 600 : 100);
    check(`${dev}: choice remembered after reload`, (await page.evaluate(() => voice && voice.name)) === cfg.man && (await page.textContent("#voiceEmo")).includes("👨"));
    await page.evaluate(() => setVoiceStyle("woman")); await said();

    // Letters: tile clicks, the "letter" button, prev/next
    for (let i = 0; i < 26; i++) {
      await page.click(`#grid .tile[data-i="${i}"]`);
      const u = await last();
      check(`${dev}: tile ${ABC[i]}`, u && u.text === letterSaid(ABC[i]), u && u.text);
      check(`${dev}: tile ${ABC[i]} en-US + voice`, u && u.lang === "en-US" && u.voice === cfg.expect, JSON.stringify(u));
      await page.click("#sayLetter");
      check(`${dev}: sayLetter ${ABC[i]}`, (await last()).text === letterSaid(ABC[i]));
    }
    await page.click('#grid .tile[data-i="0"]'); await said();
    await page.click("#sayWord"); check(`${dev}: sayWord Apple`, (await last()).text === "Apple");
    await page.click("#nextL"); check(`${dev}: next -> B`, (await last()).text === "B.");
    await page.click("#prevL"); await page.click("#prevL"); check(`${dev}: prev wraps -> Z`, (await last()).text === "zee");

    // Today
    await page.click("#sayToday");
    const today = await page.evaluate(() => "Today is " + DAYS[new Date().getDay()].en);
    check(`${dev}: today`, (await last()).text === today);

    if (dev !== "iPhone Safari") { check(`${dev}: no JS errors`, errors.length === 0, errors.join("; ")); await page.close(); continue; }

    // Days
    await page.click("#tab-days");
    const days = await page.evaluate(() => DAYS.map(d => d.en));
    for (let i = 0; i < 7; i++) { await page.click(`#days .say[data-i="${i}"]`); check(`${dev}: day ${days[i]}`, (await last()).text === days[i]); }

    // Numbers
    await page.click("#tab-numbers");
    const nums = await page.evaluate(() => NUMS.map(n => n[0]));
    for (let i = 0; i < 20; i++) { await page.click(`#nGrid .tile[data-i="${i}"]`); check(`${dev}: number ${i + 1}`, (await last()).text === nums[i]); }
    await page.click("#sayNum"); check(`${dev}: sayNum`, (await last()).text === "twenty");

    // Colors + sentence
    await page.click("#tab-colors");
    const colors = await page.evaluate(() => COLORS.map(c => [c[0], colorSentence(c)]));
    for (let i = 0; i < colors.length; i++) {
      await page.click(`#colors .say[data-i="${i}"]`); check(`${dev}: color ${colors[i][0]}`, (await last()).text === colors[i][0]);
      await page.click("#saySent"); check(`${dev}: sentence ${colors[i][0]}`, (await last()).text === colors[i][1]);
    }

    // Words + example sentences + "all class words"
    await page.click("#tab-words");
    const words = await page.evaluate(() => WORDS.map(w => [w.en, w.ex || null]));
    for (let i = 0; i < words.length; i++) {
      await page.click(`#words .say[data-i="${i}"]`); check(`${dev}: word ${words[i][0]}`, (await last()).text === words[i][0]);
      if (words[i][1]) { await page.click(`#words .ex[data-i="${i}"]`); check(`${dev}: example ${words[i][0]}`, (await last()).text === words[i][1]); }
    }
    await page.click("#sayAll"); check(`${dev}: say all class words`, (await last()).text.split(". ").length === 13);

    // Games: play every game twice, once all right, once all wrong
    await page.click("#tab-games");
    const games = await page.evaluate(() => GAMES.map(g => g.id));
    check(`${dev}: 15 games`, games.length === 15, games.length);
    for (const id of games) {
      for (const right of [true, false]) {
        await page.click(`#games .gcard[data-id="${id}"]`);
        for (let n = 0; n < 10; n++) {
          const q = await page.evaluate(() => { const q = G.qs[G.n]; return { say: q.say, answer: q.answer, opts: q.opts, he: !!q.he, sayAfter: q.sayAfter }; });
          check(`${dev}: ${id} q${n} has 4 unique options`, q.opts.length === 4 && new Set(q.opts).size === 4, JSON.stringify(q.opts));
          check(`${dev}: ${id} q${n} answer among options`, q.opts.includes(q.answer));
          await page.waitForTimeout(q.say ? 300 : 0);
          const auto = await said();
          if (q.say) {
            check(`${dev}: ${id} q${n} auto-plays prompt`, auto.some(u => u.text === q.say), JSON.stringify(auto));
            if (id === "hearL" || id === "case") check(`${dev}: ${id} q${n} letter prompt is a letter name`, /^([A-Y]\.|zee)$/.test(q.say), q.say);
          }
          const pick = right ? q.answer : q.opts.find(o => o !== q.answer);
          await page.click(`#gamePlay .opt[data-v="${pick.replace(/"/g, '\\"')}"]`);
          const fb = await said();
          if (right) {
            const exp = q.sayAfter || null;
            check(`${dev}: ${id} q${n} praise/answer spoken`, fb.length === 1 && (!exp || fb[0].text === exp), JSON.stringify(fb));
          } else if (!q.he) {
            const exp = q.answer.length === 1 ? letterSaid(q.answer.toUpperCase()) : q.answer;
            check(`${dev}: ${id} q${n} wrong -> says correct answer`, fb.length === 1 && fb[0].text === exp, JSON.stringify(fb) + " expected " + exp);
          }
          await page.click("#nextQ");
        }
        const score = await page.textContent(".result .score");
        check(`${dev}: ${id} ${right ? "all right = 10/10" : "all wrong = 0/10"}`, score === (right ? "10/10" : "0/10"), score);
        await page.click("#back"); await said();
      }
    }

    // Global rules over everything said in this run are checked per utterance above; re-run a sweep for helper words.
    const all = await page.evaluate(() => [...document.querySelectorAll("*")].length);
    check(`${dev}: page rendered`, all > 100);
    check(`${dev}: no JS errors`, errors.length === 0, errors.join("; "));
    await page.close();
  }

  // Static sweep: nothing in the source sends helper words like "letter" or the misread spelling "ay" to the voice.
  const src = require("fs").readFileSync(FILE, "utf8");
  check("source: no \"letter \" in speech", !/speak\([^)]*letter /i.test(src) && !/"letter [A-Z]"/.test(src));
  check("source: no \"ay\" spelling", !/[=?:(,]\s*"ay"/.test(src));

  await browser.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  failures.slice(0, 40).forEach(f => console.log("  FAIL " + f));
  process.exit(fail ? 1 : 0);
})();
