/**
 * Standalone smoke tests for smart answer matching.
 * Pulls matching helpers from app.js by eval in a mini harness.
 */
const fs = require("fs");
const path = require("path");

const src = fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8");
const start = src.indexOf("  /** Same idea, different wording");
const end = src.indexOf("  function warmSemanticModel()");
const body = src.slice(start, end);

function normalize(str) {
  return String(str || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const harness = { normalize, checkAnswer: null };
eval(`
  (function () {
    ${body}
    harness.checkAnswer = checkAnswer;
  })();
`);

const halls =
  "Any two of: Queen Elizabeth II, Unity, Independence, Republic, University (Katanga), Africa Hall";
const depts =
  "Any three of: Chemistry; Computer Science; Mathematics; Actuarial Science; Physics; Meteorology and Climate Science (also National Centre for Mathematical Sciences)";

const cases = [
  [true, "unity and katanga hall", halls],
  [true, "Unity and kantge hall", halls],
  [true, "katanga, republic", halls],
  [true, "university hall and africa", halls],
  [true, "Queen Elizabeth and Independence", halls],
  [false, "unity only", halls],
  [false, "random words", halls],
  [true, "Chemistry, Physics, Maths", depts],
  [true, "computer science actuarial science chemistry", depts],
  [false, "Chemistry only", depts],
  [true, "prempeh", "Prempeh II Library"],
  [true, "admin block", "The Administration Block"],
  [true, "rita dickson", "Professor Rita Akosua Dickson"],
  [true, "dickson", "Professor Rita Akosua Dickson"],
  [false, "john smith", "Professor Rita Akosua Dickson"],
  [true, "christian agyare", "Professor Christian Agyare"],
  [true, "agyare", "Professor Christian Agyare"],
  [false, "rita dickson", "Professor Christian Agyare"],
  [true, "kct", "Kumasi College of Technology (KCT)"],
  [true, "co2", "Carbon dioxide (CO₂)"],
  [true, "white and blue", "Blue and White"],
  [true, "5", "x = 5"],
  [true, "x=5", "x = 5"],
  [false, "3", "x = 5"],
  [false, "2", "3"],
  [true, "3", "3"],
  [false, "10", "100"],
  [true, "t", { a: "TRUE", type: "tf" }],
];

let fail = 0;
for (const [expect, user, ans] of cases) {
  const q = typeof ans === "string" ? { a: ans } : ans;
  const got = harness.checkAnswer(user, q);
  const ok = got === expect;
  if (!ok) {
    fail++;
    console.log("FAIL", { expect, got, user, a: q.a });
  } else {
    console.log("ok", user.slice(0, 40));
  }
}
console.log(fail ? `\n${fail} failed` : "\nall passed");
process.exit(fail ? 1 : 0);
