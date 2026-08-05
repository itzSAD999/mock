(() => {
  const STORAGE_KEY = "cos-quiz-leaderboard";
  const MISS_KEY = "cos-quiz-misses";
  const COACH_UNLOCK_KEY = "cos-coach-unlocked";
  const DRAFT_KEY = "cos-quiz-draft";
  const DRAFT_VERSION = 2;

  const views = {
    home: document.getElementById("view-home"),
    auth: document.getElementById("view-auth"),
    progress: document.getElementById("view-progress"),
    name: document.getElementById("view-name"),
    hub: document.getElementById("view-hub"),
    mode: document.getElementById("view-mode"),
    practice: document.getElementById("view-practice"),
    results: document.getElementById("view-results"),
    board: document.getElementById("view-board"),
    coachGate: document.getElementById("view-coach-gate"),
    coach: document.getElementById("view-coach"),
  };

  const state = {
    flow: "study", // study | select | official
    sessionKind: "practice", // practice | selection | official_mock
    playerName: "",
    playerDept: "",
    pool: [],
    index: 0,
    score: 0,
    mode: "study",
    context: null,
    revealed: false,
    answered: false,
    timerId: null,
    elapsed: 0,
    startedAt: 0,
    questionStartedAt: 0,
    answerLog: [],
    lastLogIndex: -1,
    lastMissIds: [],
    isMissReview: false,
    lastBoardFrom: "home",
    boardFilter: "tracked",
    coachUnlocked: sessionStorage.getItem(COACH_UNLOCK_KEY) === "1",
    coachData: null,
    coachPersonId: null,
    coachSessionId: null,
    coachSearch: "",
    progressData: null,
    progressSessionId: null,
    pendingStart: null, // { mode } after draft restart
    authUser: null,
    authTab: "signin",
    pendingAfterAuth: null,
  };

  function show(name) {
    Object.values(views).forEach((el) => el && el.classList.remove("is-active"));
    views[name].classList.add("is-active");
    window.scrollTo(0, 0);
  }

  function db() {
    return window.CosDB || null;
  }

  function shuffle(arr) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function allQuestions() {
    return QUIZ.rounds.flatMap((r) =>
      r.questions.map((q) => ({
        ...q,
        roundId: r.id,
        roundName: r.name,
        type: r.type,
      }))
    );
  }

  function questionsForRound(roundId) {
    const r = QUIZ.rounds.find((x) => x.id === roundId);
    return r.questions.map((q) => ({
      ...q,
      roundId: r.id,
      roundName: r.name,
      type: r.type,
    }));
  }

  function questionsForTopic(topic) {
    return allQuestions().filter((q) => q.topic === topic);
  }

  function stopTimer() {
    if (state.timerId) {
      clearInterval(state.timerId);
      state.timerId = null;
    }
  }

  function startTimer() {
    stopTimer();
    state.startedAt = Date.now();
    state.elapsed = 0;
    const el = document.getElementById("timer");
    el.classList.remove("is-hidden");
    state.timerId = setInterval(() => {
      state.elapsed = Math.floor((Date.now() - state.startedAt) / 1000);
      el.textContent = formatTime(state.elapsed);
    }, 250);
  }

  function formatTime(s) {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}:${String(sec).padStart(2, "0")}`;
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function updateDbStatus() {
    const el = document.getElementById("db-status");
    if (!el) return;
    const ready = db()?.isConfigured?.();
    el.textContent = ready
      ? "Supabase connected · accounts & scores sync across devices"
      : "Topics: History of KNUST · Maths · Campus · COS · Local scores until Supabase is configured";
  }

  function updateAuthUI() {
    const btn = document.getElementById("btn-auth");
    const chip = document.getElementById("auth-chip");
    const prog = document.getElementById("btn-my-progress");
    const guestActions = document.getElementById("home-actions-guest");
    const userActions = document.getElementById("home-actions-user");
    const lede = document.getElementById("home-lede");
    const user = state.authUser;

    if (user) {
      const name =
        user.user_metadata?.display_name ||
        user.email?.split("@")[0] ||
        "Account";
      btn.textContent = "Account";
      chip.textContent = name;
      prog.classList.remove("is-hidden");
      guestActions?.classList.add("is-hidden");
      userActions?.classList.remove("is-hidden");
      if (lede) {
        lede.textContent =
          "You're signed in. Practice, take official mocks, and track everything on your account.";
      }
    } else {
      btn.textContent = "Sign in";
      chip.textContent = "KNUST · 2026";
      prog.classList.add("is-hidden");
      guestActions?.classList.remove("is-hidden");
      userActions?.classList.add("is-hidden");
      if (lede) {
        lede.textContent =
          "Sign in first — your practice, official mocks, and history stay on your account with the leaderboard.";
      }
    }
    updateResumeBanner();
  }

  function requireAuth(nextAction) {
    if (state.authUser && state.playerName && state.playerDept) {
      return true;
    }
    state.pendingAfterAuth = nextAction || null;
    setAuthTab("signin");
    show("auth");
    const err = document.getElementById("signin-error");
    if (err) {
      err.textContent = "Create an account or sign in to continue.";
      err.classList.remove("is-hidden");
    }
    return false;
  }

  async function continueAfterAuth() {
    const next = state.pendingAfterAuth;
    state.pendingAfterAuth = null;
    if (!next) {
      show("home");
      return;
    }
    if (next === "practice") openNameScreen("practice");
    else if (next === "official") openNameScreen("official");
    else if (next === "select") openNameScreen("select");
    else if (next === "progress") {
      await loadMyProgress();
      show("progress");
    } else show("home");
  }

  async function refreshAuth() {
    if (!db()?.isConfigured?.()) {
      state.authUser = null;
      updateAuthUI();
      updateResumeBanner();
      return;
    }
    try {
      const session = await db().getSession();
      state.authUser = session?.user || null;
      if (state.authUser) {
        const p = await db().ensureParticipantFromUser();
        if (p) {
          state.playerName = p.display_name;
          state.playerDept = p.department;
        }
      }
    } catch (err) {
      console.error(err);
      state.authUser = null;
    }
    updateAuthUI();
    updateResumeBanner();
  }

  /* ——— SMART ANSWER MATCHING (partial / related OK) ——— */
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

  /** Same idea, different wording — strip filler + map common rewrites. */
  function softNormalize(str) {
    let s = normalize(str);
    s = s
      .replace(
        /^(the\s+)?(answer\s+is|it\s+is|its|it\s+s|called|known\s+as|i\s+think|i\s+believe|maybe|perhaps)\s+/g,
        ""
      )
      .replace(/\b(called|known\s+as|also\s+known\s+as)\b/g, " ");

    const swaps = [
      [/\bprofessor\b/g, "prof"],
      [/\bvice[\s-]?chancellor\b/g, "vc"],
      [/\bkwame nkrumah university of science and technology\b/g, "knust"],
      [/\bkumasi college of technology\b/g, "kct"],
      [/\buniversity\s+hall\b/g, "katanga"],
      [/\bkatanga\s+hall\b/g, "katanga"],
      [/\bqueen\s+elizabeth(\s+ii)?(\s+hall)?\b/g, "queenelizabeth"],
      [/\bafrica\s+hall\b/g, "africa"],
      [/\bunity\s+hall\b/g, "unity"],
      [/\bindependence\s+hall\b/g, "independence"],
      [/\brepublic\s+hall\b/g, "republic"],
      [/\badministration\s+(block|building|office|offices)\b/g, "admin"],
      [/\badmin\s+(block|building)\b/g, "admin"],
      [/\badministration\b/g, "admin"],
      [/\bcarbon dioxide\b/g, "co2"],
      [/\bco 2\b/g, "co2"],
      [/\bcolour\b/g, "color"],
      [/\bcolours\b/g, "colors"],
      [/\bdegrees?\b/g, ""],
      [/\bapproximately\b/g, ""],
      [/\babout\b/g, ""],
      [/\bofficially\b/g, ""],
      [/\btransferred\b/g, ""],
      [/\bstudents?\b/g, ""],
      [/\bcolleges?\b/g, ""],
      [/\bbuilding\b/g, ""],
      [/\bblock\b/g, ""],
      [/\blibrary\b/g, ""],
      [/\bhalls?\b/g, ""],
      [/\bcollege of science\b/g, "cos"],
      [/\bfaculty of\b/g, ""],
      [/\bdepartment of\b/g, ""],
      [/\band\b/g, " "],
      [/\bthe\b/g, ""],
      [/\ba\b/g, ""],
      [/\ban\b/g, ""],
    ];
    swaps.forEach(([re, to]) => {
      s = s.replace(re, to);
    });
    return s.replace(/\s+/g, " ").trim();
  }

  const WORD_ALIASES = {
    gold: "au",
    newton: "n",
    water: "h2o",
    h2o: "h2o",
    co2: "co2",
    carbon: "co2",
    dioxide: "co2",
    admin: "admin",
    prempeh: "prempeh",
    baffour: "baffour",
    dickson: "dickson",
    rita: "rita",
    watson: "watson",
    achimota: "achimota",
    ashanti: "ashanti",
    kumasi: "kumasi",
    university: "katanga",
    katanga: "katanga",
    maths: "mathematic",
    math: "mathematic",
    mathematics: "mathematic",
    queenelizabeth: "queenelizabeth",
    elizabeth: "queenelizabeth",
    queens: "queenelizabeth",
  };

  function canonToken(t) {
    const x = WORD_ALIASES[t] || t;
    if (x.endsWith("ies") && x.length > 4) return x.slice(0, -3) + "y";
    if (x.endsWith("es") && x.length > 4) return x.slice(0, -2);
    if (x.endsWith("s") && x.length > 3) return x.slice(0, -1);
    return x;
  }

  function tokens(str) {
    const stop = new Set([
      "a", "an", "the", "of", "and", "or", "in", "on", "at", "to", "for",
      "from", "by", "is", "was", "were", "are", "any", "two", "with", "its",
      "that", "this", "as", "be", "been", "being", "also", "after", "before",
      "under", "over", "into", "their", "they", "you", "your", "name",
      "value", "equal", "equals", "answer", "correct", "should", "would",
      "where", "what", "who", "which", "when", "how", "many", "much",
      "ii", "i",
    ]);
    return softNormalize(str)
      .split(" ")
      .filter((t) => t.length > 1 && !stop.has(t))
      .map(canonToken);
  }

  function editDistance(a, b) {
    if (a === b) return 0;
    if (!a.length) return b.length;
    if (!b.length) return a.length;
    const m = [];
    for (let i = 0; i <= b.length; i++) m[i] = [i];
    for (let j = 0; j <= a.length; j++) m[0][j] = j;
    for (let i = 1; i <= b.length; i++) {
      for (let j = 1; j <= a.length; j++) {
        m[i][j] =
          b.charAt(i - 1) === a.charAt(j - 1)
            ? m[i - 1][j - 1]
            : Math.min(m[i - 1][j - 1], m[i][j - 1], m[i - 1][j]) + 1;
      }
    }
    return m[b.length][a.length];
  }

  function similarWord(u, k) {
    if (u === k) return true;
    const cu = canonToken(u);
    const ck = canonToken(k);
    if (cu === ck) return true;
    if (cu.length >= 3 && ck.length >= 3 && (ck.includes(cu) || cu.includes(ck))) return true;
    if (cu.length >= 4 && ck.length >= 4) {
      const maxLen = Math.max(cu.length, ck.length);
      const minLen = Math.min(cu.length, ck.length);
      if (Math.abs(cu.length - ck.length) > 4) return false;
      const dist = editDistance(cu, ck);
      if (dist <= 1) return true;
      if (dist <= 2 && maxLen >= 5) return true;
      if (dist <= 3 && maxLen >= 6) return true;
      // messy typos: kantge ≈ katanga (same first letters)
      if (
        maxLen >= 6 &&
        minLen >= 5 &&
        cu.slice(0, 2) === ck.slice(0, 2) &&
        dist <= Math.max(3, Math.floor(maxLen * 0.6))
      ) {
        return true;
      }
      if (maxLen >= 6 && cu.slice(0, 4) === ck.slice(0, 4) && dist <= 4) return true;
    }
    return false;
  }

  function coversMeaning(userToks, keyToks) {
    if (!keyToks.length) return false;
    const hits = keyToks.filter((k) => userToks.some((u) => similarWord(u, k)));
    const ratio = hits.length / keyToks.length;
    const strong = hits.filter((h) => h.length >= 4);

    if (keyToks.length === 1) return hits.length === 1;
    if (keyToks.length === 2) return hits.length >= 1 && (strong.length >= 1 || hits.length === 2);
    if (keyToks.length <= 4) {
      return hits.length >= Math.ceil(keyToks.length * 0.5) || strong.length >= 2;
    }
    return (ratio >= 0.4 && hits.length >= 2) || strong.length >= 2;
  }

  /** University (Katanga) → matches university OR katanga. */
  function parseListOption(rawPart) {
    const raw = String(rawPart || "").trim();
    if (!raw) return null;
    const aliases = [];
    const paren = [...raw.matchAll(/\(([^)]+)\)/g)];
    paren.forEach((m) => {
      if (!/^(approx|officially|also|statutes|building|remove|national)/i.test(m[1])) {
        aliases.push(m[1]);
      }
    });
    const main = raw.replace(/\(.*?\)/g, " ").trim();
    const labels = [main, ...aliases]
      .map((x) => softNormalize(x))
      .filter((x) => x.length > 1);
    const uniq = [...new Set(labels)];
    if (!uniq.length) return null;
    return { labels: uniq, tokens: [...new Set(uniq.flatMap((l) => tokens(l)))] };
  }

  function optionMentioned(userRaw, userToks, option) {
    if (!option) return false;
    const user = softNormalize(userRaw);
    for (const label of option.labels) {
      if (label.length >= 3 && (user.includes(label) || label.includes(user))) return true;
    }
    if (option.tokens.some((ot) => userToks.some((ut) => similarWord(ut, ot)))) return true;
    const distinctive = [...option.tokens].sort((a, b) => b.length - a.length)[0];
    if (distinctive && distinctive.length >= 5) {
      if (userToks.some((ut) => similarWord(ut, distinctive))) return true;
    }
    return false;
  }

  function answerVariants(rawAnswer) {
    let a = String(rawAnswer || "");
    a = a.split(/\s+[—–]\s+|;\s*remove\b|\(remove\b/i)[0];
    const variants = [a];

    const anyOf = a.match(/any\s+(?:two|three|\d+)\s+of[:\s]+(.+)/i);
    if (anyOf) {
      const options = anyOf[1]
        .split(/;|,/)
        .map((x) => parseListOption(x))
        .filter(Boolean);
      options.forEach((opt) => opt.labels.forEach((l) => variants.push(l)));
      variants._anyOfOptions = options;
      const needMatch = a.match(/any\s+(\d+|two|three)\s+of/i);
      let need = 2;
      if (needMatch) {
        const n = needMatch[1].toLowerCase();
        need = n === "two" ? 2 : n === "three" ? 3 : parseInt(n, 10) || 2;
      }
      variants._anyOfNeed = need;
    }

    a.split(/\bor\b|\//i)
      .map((x) => x.trim())
      .filter((x) => x.length > 1)
      .forEach((part) => variants.push(part));

    const paren = [...String(rawAnswer).matchAll(/\(([^)]+)\)/g)];
    paren.forEach((m) => {
      if (!/^(approx|officially|also|statutes|building|remove|national)/i.test(m[1])) {
        variants.push(m[1]);
      }
    });

    const out = [...new Set(variants.map((v) => softNormalize(v)).filter(Boolean))];
    if (variants._anyOfOptions) {
      out._anyOfOptions = variants._anyOfOptions;
      out._anyOfNeed = variants._anyOfNeed;
    }
    return out;
  }

  /** Fast rule-based check (sync). */
  function checkAnswer(userRaw, q) {
    const user = softNormalize(userRaw);
    if (!user) return false;

    if (q.type === "tf") {
      const correct = softNormalize(q.a).startsWith("true") ? "true" : "false";
      if (/^(t|true|yes|y|correct)$/.test(user)) return correct === "true";
      if (/^(f|false|no|n|wrong|incorrect)$/.test(user)) return correct === "false";
      return user === correct || softNormalize(q.a).startsWith(user);
    }

    const variants = answerVariants(q.a);
    const userToks = tokens(userRaw);

    // Any-two/three lists: need enough DIFFERENT options (Unity + Katanga = correct)
    if (variants._anyOfOptions && variants._anyOfOptions.length) {
      const need = variants._anyOfNeed || 2;
      const hitOpts = variants._anyOfOptions.filter((opt) =>
        optionMentioned(userRaw, userToks, opt)
      );
      return hitOpts.length >= need;
    }

    for (const v of variants) {
      if (!v || typeof v !== "string") continue;
      if (user === v) return true;
      if (user.length >= 3 && (v.includes(user) || user.includes(v))) return true;
      if (coversMeaning(userToks, tokens(v))) return true;
    }

    const userNums = user.match(/-?\d+(\.\d+)?/g) || [];
    const ansNums = softNormalize(q.a).match(/-?\d+(\.\d+)?/g) || [];
    if (userNums.length && ansNums.length) {
      const ansSet = new Set(ansNums);
      const matched = userNums.filter((n) => ansSet.has(n));
      if (matched.length >= 1 && (ansNums.length <= 2 || matched.length >= Math.ceil(ansNums.length * 0.5))) {
        if (matched.some((n) => n.length >= 2 || Number(n) >= 10) || userToks.length <= 3) {
          return true;
        }
      }
      if (userNums.length === 1 && ansNums[0] === userNums[0] && userToks.length <= 4) {
        return true;
      }
    }

    const key = tokens(variants[0] || q.a);
    return coversMeaning(userToks, key);
  }

  /** Rule match first; if unsure, MiniLM semantic similarity (free, in-browser). */
  async function checkAnswerSmart(userRaw, q) {
    if (checkAnswer(userRaw, q)) return true;

    const sem = window.CosSemantic;
    if (!sem) return false;

    try {
      const ready = await sem.ensureReady();
      if (!ready) return false;

      const variants = answerVariants(q.a);

      if (variants._anyOfOptions?.length) {
        return sem.matchesAnyOfList(
          userRaw,
          variants._anyOfOptions,
          variants._anyOfNeed || 2
        );
      }

      const candidates = [
        q.a,
        ...variants.filter((v) => typeof v === "string"),
      ].filter(Boolean);

      return sem.matchesAny(userRaw, candidates);
    } catch (err) {
      console.warn("Semantic scoring skipped", err);
      return false;
    }
  }

  function warmSemanticModel() {
    const sem = window.CosSemantic;
    if (!sem || sem.isReady()) return;
    sem.ensureReady().catch(() => {});
  }

  /* ——— LOCAL DRAFT (mid-quiz progress) ——— */
  function draftKey(uid) {
    const id = uid || state.authUser?.id || "local";
    return `${DRAFT_KEY}:${id}`;
  }

  function migrateDraftToUser() {
    if (!state.authUser?.id) return;
    const userKey = draftKey(state.authUser.id);
    const localKey = draftKey("local");
    try {
      if (!localStorage.getItem(userKey) && localStorage.getItem(localKey)) {
        localStorage.setItem(userKey, localStorage.getItem(localKey));
        localStorage.removeItem(localKey);
      }
    } catch {
      /* ignore */
    }
  }

  function peekDraft() {
    try {
      migrateDraftToUser();
      const raw = localStorage.getItem(draftKey());
      if (!raw) return null;
      const d = JSON.parse(raw);
      if (!d?.poolIds?.length) return null;
      return d;
    } catch {
      return null;
    }
  }

  function hasUsableDraft() {
    const d = peekDraft();
    if (!d?.poolIds?.length) return false;
    const answered = new Set((d.answerLog || []).map((a) => a.question_id));
    return d.poolIds.some((id) => !answered.has(id));
  }

  function draftHasProgress() {
    const d = peekDraft();
    if (!d) return false;
    return (d.answerLog || []).length > 0 || (d.index || 0) > 0;
  }

  function saveDraft() {
    if (!state.pool?.length) return;
    if (state.mode === "study" && !state.answerLog.length && state.index === 0) {
      return;
    }
    const answered = new Set(state.answerLog.map((a) => a.question_id));
    const allDone = state.pool.every((q) => answered.has(q.id));
    if (allDone) return;

    const payload = {
      v: DRAFT_VERSION,
      savedAt: Date.now(),
      flow: state.flow,
      sessionKind: state.sessionKind,
      playerName: state.playerName,
      playerDept: state.playerDept,
      mode: state.mode,
      context: state.context,
      poolIds: state.pool.map((q) => q.id),
      index: state.index,
      answerLog: state.answerLog,
      elapsed: state.elapsed,
      startedAt: state.startedAt,
      isMissReview: state.isMissReview,
      lastMissIds: state.lastMissIds || [],
      userId: state.authUser?.id || null,
    };
    try {
      localStorage.setItem(draftKey(), JSON.stringify(payload));
    } catch (err) {
      console.warn("Could not save draft", err);
    }
    updateResumeBanner();
  }

  function clearDraft() {
    try {
      localStorage.removeItem(draftKey());
      localStorage.removeItem(draftKey("local"));
    } catch {
      /* ignore */
    }
    updateResumeBanner();
  }

  /** Re-check every logged answer with current smart scorer (fixes old marking bugs). */
  async function regradeAnswerLog(log) {
    const byId = Object.fromEntries(allQuestions().map((q) => [q.id, q]));
    const out = [];
    let score = 0;
    for (const entry of log || []) {
      const next = { ...entry };
      if (next.marked_override) {
        next.is_correct = true;
        score += 1;
        out.push(next);
        continue;
      }
      const q = byId[next.question_id];
      if (!q) {
        if (next.is_correct) score += 1;
        out.push(next);
        continue;
      }
      let ok = false;
      try {
        ok = await checkAnswerSmart(next.user_answer || "", q);
      } catch {
        ok = checkAnswer(next.user_answer || "", q);
      }
      next.is_correct = Boolean(ok);
      next.correct_answer = q.a || next.correct_answer || "";
      next.question_text = q.q || next.question_text || "";
      next.topic = q.topic || next.topic || null;
      if (ok) score += 1;
      out.push(next);
    }
    return { log: out, score };
  }

  function updateResumeBanner() {
    const banner = document.getElementById("resume-banner");
    if (!banner) return;
    const d = peekDraft();
    const usable = hasUsableDraft() && draftHasProgress();
    if (!usable || !state.authUser) {
      banner.classList.add("is-hidden");
      return;
    }
    const answered = (d.answerLog || []).length;
    const total = d.poolIds.length;
    const kind =
      d.sessionKind === "official_mock"
        ? "Official mock"
        : d.sessionKind === "selection"
          ? "Selection"
          : d.sessionKind === "practice"
            ? "Practice"
            : d.sessionKind || "Quiz";
    const label = d.context?.label || kind;
    document.getElementById("resume-title").textContent =
      `Continue ${label}`;
    document.getElementById("resume-meta").textContent =
      `${answered} of ${total} answered · ${kind} · answers re-checked when you continue`;
    banner.classList.remove("is-hidden");
  }

  async function resumeDraft() {
    const draft = peekDraft();
    if (!draft?.poolIds?.length) {
      updateResumeBanner();
      return;
    }

    const byId = Object.fromEntries(allQuestions().map((q) => [q.id, q]));
    const pool = draft.poolIds.map((id) => byId[id]).filter(Boolean);
    if (!pool.length) {
      clearDraft();
      return;
    }

    warmSemanticModel();

    state.flow = draft.flow || "study";
    state.sessionKind = draft.sessionKind || "practice";
    state.playerName = draft.playerName || state.playerName;
    state.playerDept = draft.playerDept || state.playerDept;
    state.mode = draft.mode || "contest";
    state.context = draft.context || {
      kind: "full",
      id: "full",
      type: "mixed",
      label: "Resumed quiz",
    };
    state.pool = pool;
    state.isMissReview = Boolean(draft.isMissReview);
    state.lastMissIds = draft.lastMissIds || [];
    state.revealed = false;
    state.answered = false;
    state.startedAt = draft.startedAt || Date.now();
    state.elapsed = draft.elapsed || 0;

    // Cross-check all prior answers with current scoring rules + AI
    const { log, score } = await regradeAnswerLog(draft.answerLog || []);
    state.answerLog = log;
    state.score = score;
    state.lastLogIndex = log.length - 1;

    const answeredIds = new Set(log.map((a) => a.question_id));
    let idx = pool.findIndex((q) => !answeredIds.has(q.id));
    if (idx < 0) {
      state.index = pool.length;
      clearDraft();
      await finishSession();
      return;
    }
    state.index = idx;

    document.getElementById("score-pill").textContent = String(state.score);
    const chip = document.getElementById("player-chip");
    if (state.playerName) {
      chip.textContent = state.playerName;
      chip.classList.remove("is-hidden");
    } else {
      chip.classList.add("is-hidden");
    }

    const timer = document.getElementById("timer");
    if (
      state.mode === "speed" ||
      state.sessionKind === "selection" ||
      state.sessionKind === "official_mock"
    ) {
      // Resume timer from saved elapsed
      stopTimer();
      state.startedAt = Date.now() - state.elapsed * 1000;
      const el = document.getElementById("timer");
      el.classList.remove("is-hidden");
      el.textContent = formatTime(state.elapsed);
      state.timerId = setInterval(() => {
        state.elapsed = Math.floor((Date.now() - state.startedAt) / 1000);
        el.textContent = formatTime(state.elapsed);
        if (state.elapsed % 10 === 0) saveDraft();
      }, 1000);
    } else if (state.mode === "contest") {
      stopTimer();
      timer.classList.add("is-hidden");
    } else {
      stopTimer();
      timer.classList.add("is-hidden");
    }

    saveDraft();
    show("practice");
    renderQuestion();
  }

  function discardDraft() {
    if (
      hasUsableDraft() &&
      !confirm("Discard your unfinished quiz on this device?")
    ) {
      return;
    }
    clearDraft();
  }

  /* ——— ANSWER LOG ——— */
  function logAnswer({ q, userAnswer, isCorrect, markedOverride }) {
    const timeMs = state.questionStartedAt
      ? Date.now() - state.questionStartedAt
      : null;
    const entry = {
      question_id: q.id,
      topic: q.topic || null,
      round_id: q.roundId || null,
      user_answer: userAnswer ?? "",
      correct_answer: q.a || "",
      question_text: q.q || "",
      is_correct: Boolean(isCorrect),
      marked_override: Boolean(markedOverride),
      time_ms: timeMs,
      order_index: state.index,
    };
    state.answerLog.push(entry);
    state.lastLogIndex = state.answerLog.length - 1;
    saveDraft();
  }

  function markLastOverride() {
    if (state.lastLogIndex < 0) return;
    const e = state.answerLog[state.lastLogIndex];
    e.is_correct = true;
    e.marked_override = true;
    saveDraft();
  }

  /* ——— MISS BANK (wrong-question re-attempts) ——— */
  function personKey(name, dept) {
    return `${normalize(name)}|${normalize(dept)}`;
  }

  function loadMissStore() {
    try {
      return JSON.parse(localStorage.getItem(MISS_KEY) || "{}");
    } catch {
      return {};
    }
  }

  function saveMissStore(store) {
    localStorage.setItem(MISS_KEY, JSON.stringify(store));
  }

  function getMissIds() {
    if (!state.playerName) return [];
    const store = loadMissStore();
    const key = personKey(state.playerName, state.playerDept);
    const entry = store[key];
    return entry?.ids ? [...entry.ids] : [];
  }

  function updateMissBankFromLog() {
    if (!state.playerName || state.mode === "study") return getMissIds();

    const store = loadMissStore();
    const key = personKey(state.playerName, state.playerDept);
    const set = new Set(store[key]?.ids || []);

    state.answerLog.forEach((a) => {
      if (!a.question_id) return;
      if (a.is_correct) set.delete(a.question_id);
      else set.add(a.question_id);
    });

    store[key] = {
      name: state.playerName,
      department: state.playerDept,
      ids: [...set],
      updatedAt: Date.now(),
    };
    saveMissStore(store);
    return store[key].ids;
  }

  function questionsByIds(ids) {
    const map = Object.fromEntries(allQuestions().map((q) => [q.id, q]));
    return ids.map((id) => map[id]).filter(Boolean);
  }

  /** Put historically missed questions first (practice technique). */
  function prioritizeMisses(pool) {
    if (state.sessionKind === "official_mock" || state.isMissReview) {
      return shuffle(pool);
    }
    const miss = new Set(getMissIds());
    if (!miss.size) return shuffle(pool);
    const weak = [];
    const rest = [];
    pool.forEach((q) => (miss.has(q.id) ? weak : rest).push(q));
    return [...shuffle(weak), ...shuffle(rest)];
  }

  function startMissReview() {
    const ids =
      state.lastMissIds.length > 0 ? state.lastMissIds : getMissIds();
    const pool = questionsByIds(ids);
    if (!pool.length) return;

    state.isMissReview = true;
    state.sessionKind = "practice";
    state.context = {
      kind: "miss_review",
      id: "miss_review",
      type: "mixed",
      label: "Missed questions review",
    };
    state.pool = shuffle(pool);
    startSession("contest");
  }

  /* ——— LOCAL + REMOTE BOARD ——— */
  function loadLocalBoard() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    } catch {
      return [];
    }
  }

  function saveLocalBoard(entries) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  }

  function addLocalBoardEntry(entry) {
    const list = loadLocalBoard();
    list.push(entry);
    list.sort((a, b) => {
      if (b.pct !== a.pct) return b.pct - a.pct;
      if (b.score !== a.score) return b.score - a.score;
      return (a.elapsed || 99999) - (b.elapsed || 99999);
    });
    saveLocalBoard(list);
  }

  async function persistSession(score, total, pct) {
    const syncEl = document.getElementById("results-sync");
    const kind = state.sessionKind;
    const localEntry = {
      name: state.playerName || "Anonymous",
      department: state.playerDept || "",
      score,
      total,
      pct,
      elapsed: state.elapsed,
      label: state.context?.label || "Session",
      kind,
      at: Date.now(),
    };

    if (kind === "selection" || kind === "official_mock") {
      addLocalBoardEntry(localEntry);
    } else if (kind === "practice" && state.playerName) {
      addLocalBoardEntry(localEntry);
    }

    if (!db()?.isConfigured?.()) {
      if (syncEl) {
        syncEl.textContent = "Saved locally (Supabase not configured)";
        syncEl.classList.remove("is-hidden");
      }
      return;
    }

    if (!state.playerName) {
      if (syncEl) {
        syncEl.textContent = "Practice finished — add a name in selection/mock to sync identity";
        syncEl.classList.remove("is-hidden");
      }
      return;
    }

    try {
      if (syncEl) {
        syncEl.textContent = "Syncing to Supabase…";
        syncEl.classList.remove("is-hidden");
      }
      const participant = await db().upsertParticipant(
        state.playerName,
        state.playerDept,
        state.authUser
          ? { userId: state.authUser.id, email: state.authUser.email }
          : {}
      );
      await db().saveSession({
        participant,
        kind,
        mode: state.mode,
        roundId: state.context?.id || null,
        label: state.context?.label || null,
        score,
        total,
        elapsedSec: state.elapsed,
        startedAt: state.startedAt || Date.now(),
        answers: state.answerLog,
      });
      if (syncEl) syncEl.textContent = "Synced to Supabase";
    } catch (err) {
      console.error(err);
      if (syncEl) {
        syncEl.textContent =
          "Cloud sync failed — kept local copy. Check config / schema.";
      }
    }
  }

  async function renderBoard() {
    const empty = document.getElementById("board-empty");
    const ol = document.getElementById("board-list");
    const filter = state.boardFilter;

    document.querySelectorAll("[data-board-filter]").forEach((btn) => {
      btn.classList.toggle("is-active", btn.dataset.boardFilter === filter);
    });

    let list = [];

    if (db()?.isConfigured?.()) {
      try {
        const kinds =
          filter === "tracked"
            ? ["selection", "official_mock"]
            : filter === "selection"
              ? ["selection"]
              : filter === "official_mock"
                ? ["official_mock"]
                : filter === "practice"
                  ? ["practice"]
                  : ["selection", "official_mock"];
        const remote = await db().fetchLeaderboard(kinds, 80);
        list = (remote || []).map((r) => ({
          name: r.display_name,
          department: r.department,
          score: r.score,
          total: r.total,
          pct: Number(r.pct),
          elapsed: r.elapsed_sec,
          label: r.label || r.kind,
          kind: r.kind,
          at: r.finished_at,
        }));
      } catch (err) {
        console.error(err);
        list = [];
      }
    }

    if (!list.length) {
      const local = loadLocalBoard().filter((e) => {
        if (filter === "tracked")
          return e.kind === "selection" || e.kind === "official_mock" || !e.kind;
        if (filter === "practice") return e.kind === "practice";
        return e.kind === filter || (!e.kind && filter === "selection");
      });
      list = local;
    }

    if (!list.length) {
      empty.classList.remove("is-hidden");
      ol.innerHTML = "";
      return;
    }

    empty.classList.add("is-hidden");
    ol.innerHTML = list
      .map(
        (e, i) => `
      <li class="board-row">
        <span class="board-rank">${i + 1}</span>
        <div class="board-info">
          <strong>${escapeHtml(e.name)}</strong>
          <span>${escapeHtml(e.department || "—")} · ${escapeHtml(e.label || e.kind || "")} · ${e.pct}%</span>
        </div>
        <span class="board-score">${e.score}/${e.total}</span>
      </li>`
      )
      .join("");
  }

  /* ——— NAME / FLOW ——— */
  function openNameScreen(flow) {
    state.flow = flow;
    state.sessionKind =
      flow === "official"
        ? "official_mock"
        : flow === "select"
          ? "selection"
          : "practice";
    state.isMissReview = false;

    if (!state.authUser) {
      requireAuth(
        flow === "official" ? "official" : flow === "select" ? "select" : "practice"
      );
      return;
    }

    // Signed-in users go straight to the hub — identity is on the account
    if (state.playerName && state.playerDept) {
      openHub();
      return;
    }

    // Profile incomplete — pull from auth metadata once more
    const meta = state.authUser.user_metadata || {};
    state.playerName =
      meta.display_name || state.authUser.email?.split("@")[0] || "";
    state.playerDept = meta.department || "";
    if (state.playerName && state.playerDept) {
      openHub();
      return;
    }

    // Last resort: show form to complete profile
    document.getElementById("name-eyebrow").textContent = "Complete profile";
    document.getElementById("name-title").textContent = "Finish your details";
    document.getElementById("name-hint").textContent =
      "Add your name and department once — they stay on your account.";
    document.getElementById("player-name").value = state.playerName || "";
    document.getElementById("player-dept").value = state.playerDept || "";
    show("name");
  }

  function confirmIdentity() {
    const name = document.getElementById("player-name").value.trim();
    const dept = document.getElementById("player-dept").value.trim();
    if (!name) {
      document.getElementById("player-name").focus();
      return;
    }
    if (!dept) {
      document.getElementById("player-dept").focus();
      return;
    }
    state.playerName = name;
    state.playerDept = dept;
    openHub();
  }

  const OFFICIAL_MOCK_SIZE = 100;
  const QUICK_MOCK_SIZE = 20;

  function pickRandomPool(size) {
    const all = allQuestions();
    const n = Math.min(size, all.length);
    return shuffle(all).slice(0, n);
  }

  function openDraftModal(message) {
    const modal = document.getElementById("draft-modal");
    const text = document.getElementById("draft-modal-text");
    if (text && message) text.textContent = message;
    else if (text) {
      const d = peekDraft();
      const answered = (d?.answerLog || []).length;
      const total = d?.poolIds?.length || 0;
      const label = d?.context?.label || "quiz";
      text.textContent = `You have “${label}” in progress (${answered}/${total} answered), saved on this device. Continue, restart a new quiz, or cancel.`;
    }
    modal?.classList.remove("is-hidden");
  }

  function closeDraftModal() {
    document.getElementById("draft-modal")?.classList.add("is-hidden");
  }

  /* ——— HUB ——— */
  function openHub() {
    const tracked =
      state.flow === "select" ||
      state.flow === "official" ||
      state.flow === "practice";
    document.getElementById("hub-eyebrow").textContent =
      state.flow === "official"
        ? "Official mock"
        : state.flow === "select"
          ? "Team selection"
          : state.flow === "practice"
            ? "Tracked practice"
            : "Study hub";
    document.getElementById("hub-title").textContent =
      state.flow === "official"
        ? "Start the official mock"
        : tracked
          ? "Pick the question set"
          : "Choose a round";

    const playerEl = document.getElementById("hub-player");
    const boardBtn = document.getElementById("hub-board-btn");
    const topicsWrap = document.getElementById("hub-topics-wrap");

    if (tracked && state.playerName) {
      const missN = getMissIds().length;
      playerEl.textContent = `${state.playerName} · ${state.playerDept}${
        missN ? ` · ${missN} weak Qs` : ""
      }`;
      playerEl.classList.remove("is-hidden");
      boardBtn.classList.remove("is-hidden");
      topicsWrap.classList.toggle("is-hidden", state.flow !== "practice");
    } else {
      playerEl.classList.add("is-hidden");
      boardBtn.classList.add("is-hidden");
      topicsWrap.classList.remove("is-hidden");
    }

    const grid = document.getElementById("hub-grid");
    const missIds = getMissIds();
    const missTile =
      tracked && missIds.length
        ? `
      <button class="round-tile round-tile-miss" data-round="misses">
        <div class="rt-num">Weak spots</div>
        <h3>Retry missed questions</h3>
        <p>Only the questions you got wrong — classic mock re-attempt drill.</p>
        <span class="rt-count">${missIds.length} questions</span>
      </button>`
        : "";

    const bankN = QUIZ.totalQuestions;
    const officialN = Math.min(OFFICIAL_MOCK_SIZE, bankN);
    const officialTile = `
      <button class="round-tile round-tile-full" data-round="official100">
        <div class="rt-num">Official</div>
        <h3>Official mock</h3>
        <p>${officialN} questions chosen at random from the ${bankN}-question bank — new mix every start.</p>
        <span class="rt-count">${officialN} questions</span>
      </button>`;

    const tiles = QUIZ.rounds
      .map(
        (r) => `
      <button class="round-tile" data-round="${r.id}">
        <div class="rt-num">Round ${r.round}</div>
        <h3>${r.name}</h3>
        <p>${r.description}</p>
        <span class="rt-count">${r.questions.length} questions</span>
      </button>`
      )
      .join("");

    const quickTile = `
      <button class="round-tile round-tile-quick" data-round="quick">
        <div class="rt-num">Quick mock</div>
        <h3>Quick mock</h3>
        <p>Random mix of ${QUICK_MOCK_SIZE} questions — fast score + wrong-answer review at the end.</p>
        <span class="rt-count">${QUICK_MOCK_SIZE} questions</span>
      </button>`;

    const fullTile = `
      <button class="round-tile round-tile-full" data-round="full">
        <div class="rt-num">${tracked ? "Full set" : "All rounds"}</div>
        <h3>Full bank</h3>
        <p>${tracked ? `All ${bankN} questions — every item in the bank.` : `All ${bankN} questions shuffled.`}</p>
        <span class="rt-count">${bankN} questions</span>
      </button>`;

    if (state.flow === "official") {
      grid.innerHTML = missTile + officialTile;
      document.getElementById("hub-title").textContent =
        "100 random questions · new selection each time";
    } else {
      grid.innerHTML = missTile + quickTile + tiles + fullTile;
    }

    grid.querySelectorAll("[data-round]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.dataset.round;
        if (id === "misses") {
          state.lastMissIds = getMissIds();
          startMissReview();
          return;
        }
        if (tracked) {
          beginTrackedTrial(id);
        } else if (id === "full" || id === "quick") {
          openModePicker(id === "quick" ? "quick" : "full");
        } else {
          openModePicker("round", id);
        }
      });
    });

    if (state.flow === "practice" || state.flow === "study") {
      const chips = document.getElementById("topic-chips");
      const topics = [...new Set(allQuestions().map((q) => q.topic))];
      chips.innerHTML = topics
        .map((t) => `<button class="topic-chip" data-topic="${t}">${t}</button>`)
        .join("");
      chips.querySelectorAll("[data-topic]").forEach((btn) => {
        btn.addEventListener("click", () => {
          if (state.flow === "practice") {
            const pool = questionsForTopic(btn.dataset.topic);
            state.context = {
              kind: "topic",
              id: btn.dataset.topic,
              type: "mixed",
              label: btn.dataset.topic,
            };
            state.pool = pool;
            state.isMissReview = false;
            startSession("contest");
          } else {
            openModePicker("topic", btn.dataset.topic);
          }
        });
      });
    }

    show("hub");
  }

  function beginTrackedTrial(id) {
    state.isMissReview = false;
    let pool;
    let label;
    if (id === "official100") {
      pool = pickRandomPool(OFFICIAL_MOCK_SIZE);
      label = `Official mock (${pool.length} random)`;
      state.context = {
        kind: "official100",
        id: "official100",
        type: "mixed",
        label,
      };
    } else if (id === "full") {
      pool = allQuestions();
      label = "Full bank";
      state.context = { kind: "full", id: "full", type: "mixed", label };
    } else if (id === "quick") {
      pool = pickRandomPool(QUICK_MOCK_SIZE);
      label = `Quick mock (${QUICK_MOCK_SIZE} Qs)`;
      state.context = { kind: "quick", id: "quick", type: "mixed", label };
    } else {
      const r = QUIZ.rounds.find((x) => x.id === id);
      pool = questionsForRound(id);
      label = `Round ${r.round}: ${r.name}`;
      state.context = { kind: "round", id, type: r.type, label };
    }
    state.pool = pool;
    const mode =
      id === "speed" || state.context.type === "speed" ? "speed" : "contest";
    startSession(mode);
  }

  /* ——— MODE PICKER (study) ——— */
  function openModePicker(kind, id) {
    state.sessionKind = "practice";
    let pool = [];
    let title = "";
    let eyebrow = "";
    let desc = "";

    if (kind === "round") {
      const r = QUIZ.rounds.find((x) => x.id === id);
      pool = questionsForRound(id);
      title = r.name;
      eyebrow = `Round ${r.round}`;
      desc = r.description;
      state.context = { kind, id, type: r.type, label: title };
    } else if (kind === "topic") {
      pool = questionsForTopic(id);
      title = id;
      eyebrow = "Topic drill";
      desc = `${pool.length} questions tagged under this topic.`;
      state.context = { kind, id, type: "mixed", label: title };
    } else if (kind === "full") {
      pool = allQuestions();
      title = "Full mock";
      eyebrow = "All rounds";
      desc = `All ${pool.length} questions shuffled.`;
      state.context = { kind, id: "full", type: "mixed", label: title };
    }

    state.pool = pool;

    document.getElementById("mode-eyebrow").textContent = eyebrow;
    document.getElementById("mode-title").textContent = title;
    document.getElementById("mode-count").textContent = `${pool.length} Qs`;
    document.getElementById("mode-desc").textContent = desc;

    const options = [
      {
        mode: "contest",
        title: "Type your answers",
        blurb: "Enter answers yourself. Graded automatically — use this to test knowledge.",
      },
      {
        mode: "study",
        title: "Study flashcards",
        blurb: "Read the question, reveal the answer when ready. No scoring.",
      },
    ];

    if (state.context.type === "speed" || kind === "full" || kind === "topic") {
      options.push({
        mode: "speed",
        title: "Speed session",
        blurb: "Timed. Type answers as fast as you can.",
      });
    }

    const cards = document.getElementById("mode-cards");
    cards.innerHTML = options
      .map(
        (o) => `
      <button class="mode-opt" data-mode="${o.mode}">
        <h3>${o.title}</h3>
        <p>${o.blurb}</p>
      </button>`
      )
      .join("");

    cards.querySelectorAll("[data-mode]").forEach((btn) => {
      btn.addEventListener("click", () => startSession(btn.dataset.mode));
    });

    show("mode");
  }

  /* ——— SESSION ——— */
  function startSession(mode) {
    if (hasUsableDraft() && draftHasProgress()) {
      state.pendingStart = { mode };
      openDraftModal();
      return;
    }
    clearDraft();
    beginFreshSession(mode);
  }

  function beginFreshSession(mode) {
    state.mode = mode;
    state.index = 0;
    state.score = 0;
    state.revealed = false;
    state.answered = false;
    state.answerLog = [];
    state.lastLogIndex = -1;

    if (state.context?.kind === "official100")
      state.pool = pickRandomPool(OFFICIAL_MOCK_SIZE);
    else if (state.context?.kind === "full") state.pool = allQuestions();
    else if (state.context?.kind === "quick")
      state.pool = pickRandomPool(QUICK_MOCK_SIZE);
    else if (state.context?.kind === "round")
      state.pool = questionsForRound(state.context.id);
    else if (state.context?.kind === "topic")
      state.pool = questionsForTopic(state.context.id);
    // miss_review keeps pool from startMissReview

    if (state.context?.kind === "miss_review") {
      state.pool = shuffle(state.pool);
    } else if (
      state.context?.kind !== "official100" &&
      state.context?.kind !== "quick"
    ) {
      state.pool = prioritizeMisses(state.pool);
    } else {
      // already a fresh random slice
      state.pool = state.pool;
    }

    if (state.context?.kind === "official100") {
      state.context.label = `Official mock (${state.pool.length} random)`;
    }

    document.getElementById("score-pill").textContent = "0";

    const chip = document.getElementById("player-chip");
    if (state.playerName) {
      chip.textContent = state.isMissReview
        ? `${state.playerName} · misses`
        : state.playerName;
      chip.classList.remove("is-hidden");
    } else {
      chip.classList.add("is-hidden");
    }

    const timer = document.getElementById("timer");
    if (
      mode === "speed" ||
      state.sessionKind === "selection" ||
      state.sessionKind === "official_mock"
    ) {
      startTimer();
    } else if (mode === "contest") {
      state.startedAt = Date.now();
      stopTimer();
      timer.classList.add("is-hidden");
    } else {
      stopTimer();
      timer.classList.add("is-hidden");
    }

    show("practice");
    warmSemanticModel();
    saveDraft();
    renderQuestion();
  }

  function currentQ() {
    return state.pool[state.index];
  }

  function renderQuestion() {
    const q = currentQ();
    if (!q) return finishSession();

    state.revealed = false;
    state.answered = false;
    state.questionStartedAt = Date.now();

    const total = state.pool.length;
    const n = state.index + 1;
    document.getElementById("progress-label").textContent = `Q ${n} / ${total}`;
    document.getElementById("progress-fill").style.width = `${(n / total) * 100}%`;
    document.getElementById("q-topic").textContent =
      q.topic + (q.roundName ? ` · ${q.roundName}` : "");
    document.getElementById("q-text").textContent = q.q;

    const reveal = document.getElementById("reveal-panel");
    reveal.classList.add("is-hidden");
    reveal.classList.remove("is-correct", "is-wrong");
    document.getElementById("reveal-explain").classList.add("is-hidden");

    const inputArea = document.getElementById("q-input-area");
    const actions = document.getElementById("practice-actions");
    inputArea.innerHTML = "";
    actions.innerHTML = "";

    const typedModes = state.mode === "contest" || state.mode === "speed";

    if (typedModes && q.type === "tf") {
      inputArea.innerHTML = `
        <div class="tf-row">
          <button class="btn btn-true" data-tf="TRUE">True</button>
          <button class="btn btn-false" data-tf="FALSE">False</button>
        </div>`;
      inputArea.querySelectorAll("[data-tf]").forEach((btn) => {
        btn.addEventListener("click", () => gradeTF(btn.dataset.tf, btn));
      });
      return;
    }

    if (typedModes) {
      inputArea.innerHTML = `
        <input
          class="answer-field"
          id="answer-input"
          type="text"
          placeholder="Same idea, your words — partial OK…"
          autocomplete="off"
          autocapitalize="sentences"
        />`;
      actions.innerHTML = `
        <button class="btn btn-primary" data-act="submit">Submit answer</button>`;
      const input = document.getElementById("answer-input");
      input.focus();
      actions.querySelector("[data-act=submit]").addEventListener("click", submitTyped);
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          submitTyped();
        }
      });
      return;
    }

    actions.innerHTML = `
      <button class="btn btn-primary" data-act="reveal">Reveal answer</button>`;
    actions.querySelector("[data-act=reveal]").addEventListener("click", revealAnswer);
  }

  async function submitTyped() {
    if (state.answered) return;
    const input = document.getElementById("answer-input");
    const raw = input ? input.value : "";
    if (!raw.trim()) {
      input?.focus();
      return;
    }

    state.answered = true;
    if (input) input.disabled = true;

    const q = currentQ();
    const actions = document.getElementById("practice-actions");
    const submitBtn = actions?.querySelector("[data-act=submit]");
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = "Checking…";
    }

    let ok = false;
    try {
      ok = await checkAnswerSmart(raw, q);
    } catch {
      ok = checkAnswer(raw, q);
    }

    if (ok) {
      state.score += 1;
      document.getElementById("score-pill").textContent = state.score;
    }

    logAnswer({ q, userAnswer: raw, isCorrect: ok, markedOverride: false });
    showFeedback(ok, q, raw);
  }

  function showFeedback(ok, q, userRaw) {
    const panel = document.getElementById("reveal-panel");
    panel.classList.remove("is-hidden");
    panel.classList.add(ok ? "is-correct" : "is-wrong");
    document.getElementById("reveal-label").textContent = ok
      ? "Correct"
      : "Incorrect";
    document.getElementById("reveal-answer").textContent = q.a;

    const exp = document.getElementById("reveal-explain");
    const bits = [];
    if (!ok && userRaw) bits.push(`You answered: ${userRaw}`);
    if (q.explain) bits.push(q.explain);
    if (bits.length) {
      exp.textContent = bits.join(" · ");
      exp.classList.remove("is-hidden");
    } else {
      exp.classList.add("is-hidden");
    }

    const actions = document.getElementById("practice-actions");
    if (!ok && q.type !== "tf") {
      actions.innerHTML = `
        <button class="btn btn-ghost" data-act="override">Mark correct</button>
        <button class="btn btn-primary" data-act="next">Next</button>`;
      actions.querySelector("[data-act=override]").addEventListener("click", () => {
        state.score += 1;
        document.getElementById("score-pill").textContent = state.score;
        markLastOverride();
        panel.classList.remove("is-wrong");
        panel.classList.add("is-correct");
        document.getElementById("reveal-label").textContent = "Marked correct";
        nextQuestion();
      });
    } else {
      actions.innerHTML = `
        <button class="btn btn-primary" data-act="next">Next</button>`;
    }
    actions.querySelector("[data-act=next]").addEventListener("click", nextQuestion);
  }

  function revealAnswer() {
    const q = currentQ();
    state.revealed = true;
    const panel = document.getElementById("reveal-panel");
    panel.classList.remove("is-hidden");
    document.getElementById("reveal-label").textContent = "Answer";
    document.getElementById("reveal-answer").textContent = q.a;
    const exp = document.getElementById("reveal-explain");
    if (q.explain) {
      exp.textContent = q.explain;
      exp.classList.remove("is-hidden");
    } else {
      exp.classList.add("is-hidden");
    }

    const actions = document.getElementById("practice-actions");
    actions.innerHTML = `
      <button class="btn btn-primary" data-act="next">Next</button>`;
    actions.querySelector("[data-act=next]").addEventListener("click", nextQuestion);
  }

  function gradeTF(choice, btn) {
    if (state.answered) return;
    state.answered = true;
    const q = currentQ();
    const correct = normalize(q.a).startsWith("true") ? "TRUE" : "FALSE";
    const ok = choice === correct;

    const row = document.querySelector(".tf-row");
    row.querySelectorAll("button").forEach((b) => {
      b.disabled = true;
      if (b.dataset.tf === correct) b.classList.add("is-correct");
      if (b === btn && !ok) b.classList.add("is-wrong");
    });

    if (ok) {
      state.score += 1;
      document.getElementById("score-pill").textContent = state.score;
    }

    logAnswer({ q, userAnswer: choice, isCorrect: ok, markedOverride: false });
    showFeedback(ok, q, choice);
  }

  function nextQuestion() {
    state.index += 1;
    saveDraft();
    if (state.index >= state.pool.length) {
      finishSession();
    } else {
      renderQuestion();
    }
  }

  async function finishSession() {
    stopTimer();
    if (!state.startedAt) state.startedAt = Date.now();
    if (!state.elapsed && state.startedAt) {
      state.elapsed = Math.floor((Date.now() - state.startedAt) / 1000);
    }

    // Re-score everything with current matcher before saving
    if (state.mode !== "study" && state.answerLog.length) {
      const { log, score } = await regradeAnswerLog(state.answerLog);
      state.answerLog = log;
      state.score = score;
      document.getElementById("score-pill").textContent = String(score);
    }

    clearDraft();

    const total = state.pool.length;
    const scored = state.mode !== "study";
    const score = scored ? state.score : null;
    const pct = score !== null && total ? Math.round((score / total) * 100) : null;

    const syncEl = document.getElementById("results-sync");
    syncEl.classList.add("is-hidden");

    const sessionMisses = scored
      ? state.answerLog.filter((a) => !a.is_correct).map((a) => a.question_id)
      : [];
    state.lastMissIds = [...new Set(sessionMisses)];

    if (scored) {
      updateMissBankFromLog();
      await persistSession(score, total, pct);
    }

    let title = "Session complete";
    if (state.isMissReview) {
      title = pct >= 80 ? "Weak spots clearing" : "Keep drilling misses";
    } else if (pct !== null) {
      if (pct >= 85) title = "Strong pick";
      else if (pct >= 65) title = "Solid run";
      else if (pct >= 40) title = "Needs more drill";
      else title = "Not ready yet";
    } else {
      title = "Flashcards done";
    }

    const eyebrow = document.getElementById("results-eyebrow");
    eyebrow.textContent = state.playerName
      ? `${state.playerName} · ${state.sessionKind.replace("_", " ")}`
      : "Session complete";

    document.getElementById("results-title").textContent = title;
    document.getElementById("results-score").textContent =
      score !== null ? score : "—";
    document.getElementById("results-total").textContent = total;

    const pctEl = document.getElementById("results-pct");
    if (pct !== null) {
      pctEl.textContent = `${pct}% correct · ${state.context?.label || ""}`;
    } else {
      pctEl.textContent = "Review complete — no score in study mode";
    }

    const timeEl = document.getElementById("results-time");
    if (state.elapsed > 0 && scored) {
      timeEl.textContent = `Time: ${formatTime(state.elapsed)}`;
      timeEl.classList.remove("is-hidden");
    } else {
      timeEl.classList.add("is-hidden");
    }

    const missWrap = document.getElementById("results-misses");
    const missList = document.getElementById("results-miss-list");
    const retryMissBtn = document.getElementById("btn-retry-misses");
    const summaryStats = document.getElementById("summary-stats");
    const wrongEntries = scored
      ? state.answerLog.filter((a) => !a.is_correct)
      : [];
    const correctCount = scored ? state.answerLog.filter((a) => a.is_correct).length : 0;

    if (scored && summaryStats) {
      summaryStats.classList.remove("is-hidden");
      document.getElementById("stat-correct").textContent = correctCount;
      document.getElementById("stat-wrong").textContent = wrongEntries.length;
      document.getElementById("stat-pct").textContent = `${pct}%`;
    } else if (summaryStats) {
      summaryStats.classList.add("is-hidden");
    }

    if (wrongEntries.length) {
      missWrap.classList.remove("is-hidden");
      missList.innerHTML = wrongEntries
        .map((a) => {
          const q = allQuestions().find((x) => x.id === a.question_id);
          const correct = a.correct_answer || q?.a || "—";
          const qText = a.question_text || q?.q || a.question_id;
          return `<li class="miss-item">
            <p class="miss-topic">${escapeHtml(a.topic || q?.topic || "")}</p>
            <p class="miss-q">${escapeHtml(qText)}</p>
            <p class="miss-yours"><span>Your answer</span> ${escapeHtml(a.user_answer || "—")}</p>
            <p class="miss-correct"><span>Correct</span> ${escapeHtml(correct)}</p>
          </li>`;
        })
        .join("");
      retryMissBtn.classList.remove("is-hidden");
      retryMissBtn.textContent = `Retry missed (${wrongEntries.length})`;
    } else {
      missWrap.classList.add("is-hidden");
      missList.innerHTML = "";
      retryMissBtn.classList.add("is-hidden");
    }

    if (scored && state.authUser) {
      const note = syncEl?.textContent || "";
      if (syncEl && note && !note.includes("coach")) {
        syncEl.textContent = `${note} · Visible to coach`;
      } else if (syncEl && !note) {
        syncEl.textContent = "Score saved · Visible to coach";
        syncEl.classList.remove("is-hidden");
      }
    }

    const tracked =
      state.sessionKind === "selection" ||
      state.sessionKind === "official_mock" ||
      state.sessionKind === "practice";
    const nextC = document.getElementById("btn-next-contestant");
    const boardBtn = document.getElementById("btn-view-board");
    const retry = document.getElementById("btn-retry");
    const hubBtn = document.getElementById("btn-results-hub");

    if (state.sessionKind === "selection" || state.sessionKind === "official_mock") {
      nextC.classList.remove("is-hidden");
      boardBtn.classList.remove("is-hidden");
      retry.textContent = "Retake full set";
      hubBtn.textContent = "Different round";
    } else {
      nextC.classList.add("is-hidden");
      boardBtn.classList.toggle("is-hidden", !scored);
      retry.textContent = "Retake full set";
      hubBtn.textContent = "Back to rounds";
    }

    state.isMissReview = false;
    show("results");
  }

  /* ——— COACH ANALYTICS ——— */
  function openCoach() {
    if (state.coachUnlocked) {
      show("coach");
      loadCoachDashboard();
    } else {
      document.getElementById("coach-error").classList.add("is-hidden");
      document.getElementById("coach-pin").value = "";
      show("coachGate");
      setTimeout(() => document.getElementById("coach-pin").focus(), 80);
    }
  }

  function unlockCoach() {
    const pin = document.getElementById("coach-pin").value;
    const ok = db()?.checkAdminPin?.(pin) ?? pin === "cos2026";
    const err = document.getElementById("coach-error");
    if (!ok) {
      err.classList.remove("is-hidden");
      return;
    }
    state.coachUnlocked = true;
    sessionStorage.setItem(COACH_UNLOCK_KEY, "1");
    err.classList.add("is-hidden");
    show("coach");
    loadCoachDashboard();
  }

  function questionTextById(id) {
    const q = allQuestions().find((x) => x.id === id);
    return q ? q.q : id;
  }

  function questionAnswerById(id) {
    const q = allQuestions().find((x) => x.id === id);
    return q ? q.a : "—";
  }

  function kindLabel(kind) {
    if (kind === "official_mock") return "Official mock";
    if (kind === "selection") return "Selection";
    if (kind === "practice") return "Practice";
    return kind || "—";
  }

  function kindBadge(kind) {
    const cls =
      kind === "official_mock"
        ? "badge-mock"
        : kind === "selection"
          ? "badge-select"
          : "badge-practice";
    return `<span class="kind-badge ${cls}">${escapeHtml(kindLabel(kind))}</span>`;
  }

  function pctOf(score, total) {
    return total ? Math.round((score / total) * 100) : 0;
  }

  function renderSummaryCards(cards) {
    return `<div class="score-summary-grid">${cards
      .map(
        (c) => `<div class="score-card">
        <em>${escapeHtml(String(c.value))}</em>
        <span>${escapeHtml(c.label)}</span>
      </div>`
      )
      .join("")}</div>`;
  }

  function renderWrongAnswerList(wrongAnswers) {
    if (!wrongAnswers.length) {
      return `<p class="coach-empty">No wrong answers in this session — clean run.</p>`;
    }
    return `<ul class="miss-review-list">${wrongAnswers
      .map((a) => {
        const qText = questionTextById(a.question_id);
        const correct = questionAnswerById(a.question_id);
        return `<li class="miss-item">
          <p class="miss-topic">${escapeHtml(a.topic || "")}</p>
          <p class="miss-q">${escapeHtml(qText)}</p>
          <p class="miss-yours"><span>Their answer</span> ${escapeHtml(a.user_answer || "—")}</p>
          <p class="miss-correct"><span>Correct</span> ${escapeHtml(correct)}</p>
        </li>`;
      })
      .join("")}</ul>`;
  }

  async function loadCoachDashboard() {
    const status = document.getElementById("coach-status");
    const kindFilter = document.getElementById("coach-kind").value;

    if (!db()?.isConfigured?.()) {
      status.textContent =
        "Supabase not configured. Copy config.example.js → config.js and run supabase/schema.sql.";
      document.getElementById("coach-rankings").innerHTML = "";
      document.getElementById("coach-topics").innerHTML = "";
      document.getElementById("coach-hard").innerHTML = "";
      document.getElementById("coach-summary").innerHTML = "";
      return;
    }

    status.textContent = "Loading analytics…";
    try {
      const data = await db().fetchAnalytics();
      state.coachData = data;
      renderCoach(data, kindFilter);
      status.textContent = `${data.participants.length} people · ${data.sessions.length} sessions · ${data.answers.length} answers · saved to Supabase`;
    } catch (err) {
      console.error(err);
      status.textContent = "Failed to load analytics. Check schema and RLS policies.";
    }
  }

  function filteredCoachSessions(data, kindFilter) {
    return data.sessions.filter(
      (s) => kindFilter === "all" || s.kind === kindFilter
    );
  }

  function buildPersonStats(data, kindFilter) {
    const sessions = filteredCoachSessions(data, kindFilter);
    const byId = Object.fromEntries(data.participants.map((p) => [p.id, p]));
    const stats = {};
    sessions.forEach((s) => {
      const p = byId[s.participant_id];
      if (!p) return;
      if (!stats[p.id]) {
        stats[p.id] = {
          id: p.id,
          name: p.display_name,
          department: p.department,
          email: p.email || "",
          bestPct: 0,
          bestScore: "0/0",
          runs: 0,
          practice: 0,
          selection: 0,
          official_mock: 0,
          avgPct: 0,
          pctSum: 0,
          lastAt: null,
        };
      }
      const st = stats[p.id];
      st.runs += 1;
      st[s.kind] = (st[s.kind] || 0) + 1;
      const pct = pctOf(s.score, s.total);
      st.pctSum += pct;
      if (pct >= st.bestPct) {
        st.bestPct = pct;
        st.bestScore = `${s.score}/${s.total}`;
      }
      if (!st.lastAt || new Date(s.finished_at) > new Date(st.lastAt)) {
        st.lastAt = s.finished_at;
      }
    });
    Object.values(stats).forEach((st) => {
      st.avgPct = st.runs ? Math.round(st.pctSum / st.runs) : 0;
    });
    return Object.values(stats).sort(
      (a, b) => b.bestPct - a.bestPct || b.avgPct - a.avgPct
    );
  }

  function renderCoach(data, kindFilter) {
    const sessions = filteredCoachSessions(data, kindFilter);
    const sessionIds = new Set(sessions.map((s) => s.id));
    const answers = data.answers.filter((a) => sessionIds.has(a.session_id));
    const ranked = buildPersonStats(data, kindFilter);
    const q = (state.coachSearch || "").trim().toLowerCase();
    const filteredPeople = q
      ? ranked.filter(
          (r) =>
            r.name.toLowerCase().includes(q) ||
            (r.department || "").toLowerCase().includes(q) ||
            (r.email || "").toLowerCase().includes(q)
        )
      : ranked;

    const peopleSection = document.getElementById("coach-people-section");
    const personSection = document.getElementById("coach-person-section");
    const aggTopics = document.getElementById("coach-agg-topics");
    const aggHard = document.getElementById("coach-agg-hard");

    document.getElementById("coach-summary").innerHTML = renderSummaryCards([
      { value: filteredPeople.length, label: "People" },
      { value: sessions.length, label: "Sessions" },
      {
        value: sessions.filter((s) => s.kind === "official_mock").length,
        label: "Official mocks",
      },
      {
        value: sessions.filter((s) => s.kind === "practice").length,
        label: "Practice runs",
      },
      {
        value: answers.length
          ? `${Math.round(
              (answers.filter((a) => a.is_correct).length / answers.length) * 100
            )}%`
          : "—",
        label: "Overall accuracy",
      },
    ]);

    if (state.coachPersonId) {
      peopleSection.classList.add("is-hidden");
      aggTopics.classList.add("is-hidden");
      aggHard.classList.add("is-hidden");
      personSection.classList.remove("is-hidden");
      renderCoachPerson(data, kindFilter, state.coachPersonId);
      return;
    }

    peopleSection.classList.remove("is-hidden");
    aggTopics.classList.remove("is-hidden");
    aggHard.classList.remove("is-hidden");
    personSection.classList.add("is-hidden");

    document.getElementById("coach-rankings").innerHTML = filteredPeople.length
      ? `<table class="coach-table coach-table-click">
        <thead><tr><th>#</th><th>Name</th><th>Dept</th><th>Best</th><th>Avg</th><th>Runs</th><th>Mock</th><th>Select</th><th>Practice</th></tr></thead>
        <tbody>
          ${filteredPeople
            .map(
              (r, i) => `<tr data-action="coach-open-person" data-person-id="${escapeHtml(r.id)}" tabindex="0" role="button">
              <td>${i + 1}</td>
              <td><strong>${escapeHtml(r.name)}</strong></td>
              <td>${escapeHtml(r.department || "—")}</td>
              <td>${r.bestPct}% <span class="muted">(${r.bestScore})</span></td>
              <td>${r.avgPct}%</td>
              <td>${r.runs}</td>
              <td>${r.official_mock || 0}</td>
              <td>${r.selection || 0}</td>
              <td>${r.practice || 0}</td>
            </tr>`
            )
            .join("")}
        </tbody>
      </table>`
      : `<p class="coach-empty">No sessions for this filter yet.</p>`;

    const topics = {};
    answers.forEach((a) => {
      const t = a.topic || "Untagged";
      if (!topics[t]) topics[t] = { topic: t, correct: 0, total: 0 };
      topics[t].total += 1;
      if (a.is_correct) topics[t].correct += 1;
    });
    const topicRows = Object.values(topics)
      .map((t) => ({
        ...t,
        pct: t.total ? Math.round((t.correct / t.total) * 100) : 0,
      }))
      .sort((a, b) => a.pct - b.pct);

    document.getElementById("coach-topics").innerHTML = topicRows.length
      ? `<table class="coach-table">
        <thead><tr><th>Topic</th><th>Accuracy</th><th>Correct</th><th>Attempts</th></tr></thead>
        <tbody>
          ${topicRows
            .map(
              (t) => `<tr>
              <td>${escapeHtml(t.topic)}</td>
              <td>${t.pct}%</td>
              <td>${t.correct}</td>
              <td>${t.total}</td>
            </tr>`
            )
            .join("")}
        </tbody>
      </table>`
      : `<p class="coach-empty">No answer data yet.</p>`;

    const qs = {};
    answers.forEach((a) => {
      if (!qs[a.question_id])
        qs[a.question_id] = { id: a.question_id, correct: 0, total: 0 };
      qs[a.question_id].total += 1;
      if (a.is_correct) qs[a.question_id].correct += 1;
    });
    const hard = Object.values(qs)
      .filter((qRow) => qRow.total >= 1)
      .map((qRow) => ({
        ...qRow,
        pct: Math.round((qRow.correct / qRow.total) * 100),
        text: questionTextById(qRow.id),
      }))
      .sort((a, b) => a.pct - b.pct || b.total - a.total)
      .slice(0, 15);

    document.getElementById("coach-hard").innerHTML = hard.length
      ? `<table class="coach-table">
        <thead><tr><th>Question</th><th>Accuracy</th><th>n</th></tr></thead>
        <tbody>
          ${hard
            .map(
              (qRow) => `<tr>
              <td title="${escapeHtml(qRow.id)}">${escapeHtml(qRow.text.slice(0, 120))}${qRow.text.length > 120 ? "…" : ""}</td>
              <td>${qRow.pct}%</td>
              <td>${qRow.total}</td>
            </tr>`
            )
            .join("")}
        </tbody>
      </table>`
      : `<p class="coach-empty">No question stats yet.</p>`;
  }

  function renderCoachPerson(data, kindFilter, personId) {
    const person = data.participants.find((p) => p.id === personId);
    if (!person) {
      state.coachPersonId = null;
      renderCoach(data, kindFilter);
      return;
    }

    const sessions = filteredCoachSessions(data, kindFilter).filter(
      (s) => s.participant_id === personId
    );
    const sessionIds = new Set(sessions.map((s) => s.id));
    const answers = data.answers.filter((a) => sessionIds.has(a.session_id));
    const wrongAll = answers.filter((a) => !a.is_correct);
    const best = sessions.reduce(
      (m, s) => Math.max(m, pctOf(s.score, s.total)),
      0
    );
    const avg = sessions.length
      ? Math.round(
          sessions.reduce((n, s) => n + pctOf(s.score, s.total), 0) / sessions.length
        )
      : 0;

    document.getElementById("coach-person-name").textContent =
      person.display_name;
    document.getElementById("coach-person-meta").textContent = [
      person.department || "No department",
      person.email || null,
      `${sessions.length} session${sessions.length === 1 ? "" : "s"}`,
    ]
      .filter(Boolean)
      .join(" · ");

    document.getElementById("coach-person-summary").innerHTML = renderSummaryCards([
      { value: `${best}%`, label: "Best score" },
      { value: `${avg}%`, label: "Average" },
      {
        value: sessions.filter((s) => s.kind === "official_mock").length,
        label: "Official mocks",
      },
      {
        value: sessions.filter((s) => s.kind === "practice").length,
        label: "Practice",
      },
      { value: wrongAll.length, label: "Wrong answers (all)" },
    ]);

    document.getElementById("coach-person-sessions").innerHTML = sessions.length
      ? `<table class="coach-table coach-table-click">
        <thead><tr><th>When</th><th>Type</th><th>Set</th><th>Score</th><th>Wrong</th><th>Time</th></tr></thead>
        <tbody>
          ${sessions
            .map((s) => {
              const pct = pctOf(s.score, s.total);
              const wrong = answers.filter(
                (a) => a.session_id === s.id && !a.is_correct
              ).length;
              const active =
                state.coachSessionId === s.id ? " is-selected" : "";
              return `<tr class="${active}" data-action="coach-open-session" data-session-id="${escapeHtml(s.id)}" tabindex="0" role="button">
                <td>${escapeHtml(new Date(s.finished_at).toLocaleString())}</td>
                <td>${kindBadge(s.kind)}</td>
                <td>${escapeHtml(s.label || s.round_id || "—")}</td>
                <td><strong>${s.score}/${s.total}</strong> <span class="muted">(${pct}%)</span></td>
                <td>${wrong}</td>
                <td>${formatTime(s.elapsed_sec || 0)}</td>
              </tr>`;
            })
            .join("")}
        </tbody>
      </table>`
      : `<p class="coach-empty">No sessions for this filter.</p>`;

    const detail = document.getElementById("coach-session-detail");
    const missesEl = document.getElementById("coach-session-misses");
    if (state.coachSessionId && sessionIds.has(state.coachSessionId)) {
      const sess = sessions.find((s) => s.id === state.coachSessionId);
      const wrong = answers
        .filter((a) => a.session_id === state.coachSessionId && !a.is_correct)
        .sort((a, b) => (a.order_index || 0) - (b.order_index || 0));
      detail.classList.remove("is-hidden");
      document.getElementById("coach-session-title").textContent = sess
        ? `Wrong answers · ${kindLabel(sess.kind)} · ${sess.score}/${sess.total}`
        : "Wrong answers";
      missesEl.innerHTML = renderWrongAnswerList(wrong);
    } else {
      detail.classList.add("is-hidden");
      missesEl.innerHTML = "";
    }
  }

  /* ——— EVENTS ——— */
  function setAuthTab(tab) {
    state.authTab = tab;
    document.querySelectorAll("[data-auth-tab]").forEach((b) => {
      b.classList.toggle("is-active", b.dataset.authTab === tab);
    });
    document.getElementById("auth-signin").classList.toggle("is-hidden", tab !== "signin");
    document.getElementById("auth-signup").classList.toggle("is-hidden", tab !== "signup");
    document.getElementById("auth-title").textContent =
      tab === "signup" ? "Create account" : "Sign in";
    document.getElementById("signin-error").classList.add("is-hidden");
    document.getElementById("signup-error").classList.add("is-hidden");
  }

  async function doSignIn() {
    const errEl = document.getElementById("signin-error");
    errEl.classList.add("is-hidden");
    const email = document.getElementById("signin-email").value.trim();
    const password = document.getElementById("signin-password").value;
    try {
      await db().signIn({ email, password });
      await refreshAuth();
      await continueAfterAuth();
    } catch (err) {
      errEl.textContent = err.message || "Sign in failed";
      errEl.classList.remove("is-hidden");
    }
  }

  async function doSignUp() {
    const errEl = document.getElementById("signup-error");
    errEl.classList.add("is-hidden");
    try {
      const result = await db().signUp({
        email: document.getElementById("signup-email").value.trim(),
        password: document.getElementById("signup-password").value,
        displayName: document.getElementById("signup-name").value.trim(),
        department: document.getElementById("signup-dept").value.trim(),
      });
      await refreshAuth();
      if (state.authUser) {
        await continueAfterAuth();
        return;
      }
      if (result.user && !result.session) {
        errEl.textContent =
          "Account created, but Confirm email is still ON in Supabase. Turn it OFF under Authentication → Providers → Email, then sign in.";
        errEl.classList.remove("is-hidden");
      }
    } catch (err) {
      errEl.textContent = err.message || "Sign up failed";
      errEl.classList.remove("is-hidden");
    }
  }

  async function doSignOut() {
    const keepPending = state.pendingAfterAuth;
    try {
      await db().signOut();
    } catch (err) {
      console.error(err);
    }
    state.authUser = null;
    state.playerName = "";
    state.playerDept = "";
    state.pendingAfterAuth = keepPending;
    updateAuthUI();
    if (!keepPending) show("home");
  }

  async function loadMyProgress() {
    const status = document.getElementById("progress-status");
    const sessEl = document.getElementById("progress-sessions");
    const topicEl = document.getElementById("progress-topics");
    const summaryEl = document.getElementById("progress-summary");
    const detailSection = document.getElementById("progress-detail-section");

    if (!state.authUser) {
      status.textContent = "Sign in to see your saved scores.";
      sessEl.innerHTML = "";
      topicEl.innerHTML = "";
      summaryEl.innerHTML = "";
      detailSection.classList.add("is-hidden");
      return;
    }

    status.textContent = "Loading your sessions…";
    try {
      const data = await db().fetchMyProgress();
      state.progressData = data;
      if (!data) {
        status.textContent = "No progress yet — run a practice or mock.";
        sessEl.innerHTML = "";
        topicEl.innerHTML = "";
        summaryEl.innerHTML = "";
        detailSection.classList.add("is-hidden");
        return;
      }

      renderMyProgress(data);
    } catch (err) {
      console.error(err);
      status.textContent =
        "Could not load progress. Run supabase/schema.sql if tables are missing.";
    }
  }

  function renderMyProgress(data) {
    const status = document.getElementById("progress-status");
    const sessEl = document.getElementById("progress-sessions");
    const topicEl = document.getElementById("progress-topics");
    const summaryEl = document.getElementById("progress-summary");
    const detailSection = document.getElementById("progress-detail-section");
    const { participant, sessions, answers } = data;

    status.textContent = `${participant.display_name} · ${participant.department || "—"} · ${sessions.length} saved session${sessions.length === 1 ? "" : "s"}`;

    const bestMock = sessions
      .filter((s) => s.kind === "official_mock")
      .reduce((m, s) => Math.max(m, pctOf(s.score, s.total)), 0);
    const bestPractice = sessions
      .filter((s) => s.kind === "practice")
      .reduce((m, s) => Math.max(m, pctOf(s.score, s.total)), 0);
    const avg = sessions.length
      ? Math.round(
          sessions.reduce((n, s) => n + pctOf(s.score, s.total), 0) / sessions.length
        )
      : 0;
    const wrongTotal = answers.filter((a) => !a.is_correct).length;

    summaryEl.innerHTML = renderSummaryCards([
      { value: sessions.length, label: "Sessions saved" },
      { value: bestMock ? `${bestMock}%` : "—", label: "Best official mock" },
      {
        value: bestPractice ? `${bestPractice}%` : "—",
        label: "Best practice",
      },
      { value: `${avg}%`, label: "Average" },
      { value: wrongTotal, label: "Wrong answers (all)" },
    ]);

    if (state.progressSessionId) {
      const sess = sessions.find((s) => s.id === state.progressSessionId);
      if (!sess) {
        state.progressSessionId = null;
      } else {
        const wrong = answers
          .filter((a) => a.session_id === sess.id && !a.is_correct)
          .sort((a, b) => (a.order_index || 0) - (b.order_index || 0));
        detailSection.classList.remove("is-hidden");
        document.getElementById("progress-detail-title").textContent =
          `${kindLabel(sess.kind)} · ${sess.score}/${sess.total} (${pctOf(sess.score, sess.total)}%)`;
        document.getElementById("progress-detail-meta").textContent = [
          sess.label || sess.round_id || "Full set",
          new Date(sess.finished_at).toLocaleString(),
          formatTime(sess.elapsed_sec || 0),
        ].join(" · ");
        const listHtml = renderWrongAnswerList(wrong).replace(
          /Their answer/g,
          "Your answer"
        );
        document.getElementById("progress-detail-misses").innerHTML = listHtml;
      }
    } else {
      detailSection.classList.add("is-hidden");
    }

    sessEl.innerHTML = sessions.length
      ? `<table class="coach-table coach-table-click">
          <thead><tr><th>When</th><th>Type</th><th>Set</th><th>Score</th><th>Wrong</th><th>Time</th></tr></thead>
          <tbody>
            ${sessions
              .slice(0, 40)
              .map((s) => {
                const pct = pctOf(s.score, s.total);
                const wrong = answers.filter(
                  (a) => a.session_id === s.id && !a.is_correct
                ).length;
                const active =
                  state.progressSessionId === s.id ? " is-selected" : "";
                return `<tr class="${active}" data-action="progress-open-session" data-session-id="${escapeHtml(s.id)}" tabindex="0" role="button">
                  <td>${escapeHtml(new Date(s.finished_at).toLocaleString())}</td>
                  <td>${kindBadge(s.kind)}</td>
                  <td>${escapeHtml(s.label || s.round_id || "—")}</td>
                  <td><strong>${s.score}/${s.total}</strong> <span class="muted">(${pct}%)</span></td>
                  <td>${wrong}</td>
                  <td>${formatTime(s.elapsed_sec || 0)}</td>
                </tr>`;
              })
              .join("")}
          </tbody>
        </table>`
      : `<p class="coach-empty">No sessions saved yet.</p>`;

    const topics = {};
    answers.forEach((a) => {
      const t = a.topic || "Untagged";
      if (!topics[t]) topics[t] = { topic: t, correct: 0, total: 0 };
      topics[t].total += 1;
      if (a.is_correct) topics[t].correct += 1;
    });
    const topicRows = Object.values(topics)
      .map((t) => ({
        ...t,
        pct: t.total ? Math.round((t.correct / t.total) * 100) : 0,
      }))
      .sort((a, b) => a.pct - b.pct);

    topicEl.innerHTML = topicRows.length
      ? `<table class="coach-table">
          <thead><tr><th>Topic</th><th>Accuracy</th><th>Attempts</th></tr></thead>
          <tbody>
            ${topicRows
              .map(
                (t) => `<tr>
                <td>${escapeHtml(t.topic)}</td>
                <td>${t.pct}%</td>
                <td>${t.total}</td>
              </tr>`
              )
              .join("")}
          </tbody>
        </table>`
      : `<p class="coach-empty">Answer-level data appears after you complete a scored session.</p>`;
  }

  document.body.addEventListener("click", (e) => {
    const authTab = e.target.closest("[data-auth-tab]");
    if (authTab) {
      setAuthTab(authTab.dataset.authTab);
      return;
    }

    const filterBtn = e.target.closest("[data-board-filter]");
    if (filterBtn) {
      state.boardFilter = filterBtn.dataset.boardFilter;
      renderBoard();
      return;
    }

    const btn = e.target.closest("[data-action]");
    if (!btn) return;
    const action = btn.dataset.action;

    if (action === "start-select") {
      if (!requireAuth("select")) return;
      openNameScreen("select");
    } else if (action === "start-official") {
      if (!requireAuth("official")) return;
      openNameScreen("official");
    } else if (action === "start-practice" || action === "start-study") {
      if (!requireAuth("practice")) return;
      openNameScreen("practice");
    } else if (action === "open-auth-signup") {
      setAuthTab("signup");
      show("auth");
    } else if (action === "open-auth") {
      if (state.authUser) {
        loadMyProgress();
        show("progress");
      } else {
        setAuthTab("signin");
        show("auth");
      }
    } else if (action === "my-progress") {
      if (!requireAuth("progress")) return;
      loadMyProgress();
      show("progress");
    } else if (action === "do-signin") {
      doSignIn();
    } else if (action === "do-signup") {
      doSignUp();
    } else if (action === "sign-out") {
      doSignOut();
    } else if (action === "confirm-name") {
      confirmIdentity();
    } else if (action === "go-home") {
      stopTimer();
      show("home");
    } else if (action === "hub-back") {
      stopTimer();
      show("home");
    } else if (action === "go-hub") {
      stopTimer();
      if (!requireAuth(state.flow === "official" ? "official" : state.flow === "select" ? "select" : "practice"))
        return;
      openHub();
    } else if (action === "exit-practice") {
      stopTimer();
      openHub();
    } else if (action === "retry") {
      state.isMissReview = false;
      startSession(state.mode === "study" ? "contest" : state.mode);
    } else if (action === "retry-misses") {
      startMissReview();
    } else if (action === "next-contestant") {
      state.pendingAfterAuth =
        state.flow === "official" ? "official" : "select";
      doSignOut().then(() => {
        setAuthTab("signin");
        show("auth");
        const err = document.getElementById("signin-error");
        if (err) {
          err.textContent = "Next contestant: sign in with their account.";
          err.classList.remove("is-hidden");
        }
      });
    } else if (action === "show-board") {
      if (!requireAuth(null)) return;
      state.lastBoardFrom = views.results.classList.contains("is-active")
        ? "results"
        : views.hub.classList.contains("is-active")
          ? "hub"
          : "home";
      renderBoard();
      show("board");
    } else if (action === "board-back") {
      if (state.lastBoardFrom === "results") show("results");
      else if (state.lastBoardFrom === "hub") openHub();
      else show("home");
    } else if (action === "clear-board") {
      if (confirm("Clear local leaderboard cache on this device?")) {
        saveLocalBoard([]);
        renderBoard();
      }
    } else if (action === "open-coach") {
      openCoach();
    } else if (action === "coach-unlock") {
      unlockCoach();
    } else if (action === "coach-refresh") {
      state.coachPersonId = null;
      state.coachSessionId = null;
      loadCoachDashboard();
    } else if (action === "coach-back-people") {
      state.coachPersonId = null;
      state.coachSessionId = null;
      if (state.coachData) {
        renderCoach(state.coachData, document.getElementById("coach-kind").value);
      }
    } else if (action === "coach-open-person") {
      state.coachPersonId = btn.dataset.personId;
      state.coachSessionId = null;
      if (state.coachData) {
        renderCoach(state.coachData, document.getElementById("coach-kind").value);
      }
    } else if (action === "coach-open-session") {
      state.coachSessionId = btn.dataset.sessionId;
      if (state.coachData && state.coachPersonId) {
        renderCoach(state.coachData, document.getElementById("coach-kind").value);
        document
          .getElementById("coach-session-detail")
          ?.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    } else if (action === "progress-open-session") {
      state.progressSessionId = btn.dataset.sessionId;
      if (state.progressData) {
        renderMyProgress(state.progressData);
        document
          .getElementById("progress-detail-section")
          ?.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    } else if (action === "progress-back-sessions") {
      state.progressSessionId = null;
      if (state.progressData) renderMyProgress(state.progressData);
    } else if (action === "resume-draft") {
      resumeDraft();
    } else if (action === "discard-draft") {
      discardDraft();
    } else if (action === "draft-continue") {
      closeDraftModal();
      state.pendingStart = null;
      resumeDraft();
    } else if (action === "draft-restart") {
      closeDraftModal();
      const pending = state.pendingStart;
      state.pendingStart = null;
      clearDraft();
      if (pending?.mode) beginFreshSession(pending.mode);
      else updateResumeBanner();
    } else if (action === "draft-cancel") {
      closeDraftModal();
      state.pendingStart = null;
      updateResumeBanner();
    } else if (action === "toggle-theme") {
      toggleTheme();
    }
  });

  const THEME_KEY = "cos-quiz-theme";

  function applyTheme(theme) {
    const t = theme === "light" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", t);
    localStorage.setItem(THEME_KEY, t);
    const btn = document.getElementById("btn-theme");
    if (btn) btn.textContent = t === "light" ? "Dark" : "Light";
  }

  function toggleTheme() {
    const cur = document.documentElement.getAttribute("data-theme") || "dark";
    applyTheme(cur === "light" ? "dark" : "light");
  }

  applyTheme(localStorage.getItem(THEME_KEY) || "dark");

  document.getElementById("player-name").addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      document.getElementById("player-dept").focus();
    }
  });

  document.getElementById("coach-pin").addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      unlockCoach();
    }
  });

  document.getElementById("coach-kind").addEventListener("change", () => {
    state.coachSessionId = null;
    if (state.coachData) renderCoach(state.coachData, document.getElementById("coach-kind").value);
    else loadCoachDashboard();
  });

  const coachSearch = document.getElementById("coach-search");
  if (coachSearch) {
    coachSearch.addEventListener("input", () => {
      state.coachSearch = coachSearch.value || "";
      if (state.coachData && !state.coachPersonId) {
        renderCoach(state.coachData, document.getElementById("coach-kind").value);
      }
    });
  }

  window.addEventListener("beforeunload", () => {
    if (state.pool?.length && views.practice?.classList.contains("is-active")) {
      saveDraft();
    }
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden" && state.pool?.length) {
      saveDraft();
    }
  });

  function syncHeroCounts() {
    const totalEl = document.getElementById("hero-total");
    const list = document.getElementById("hero-rounds");
    if (totalEl && QUIZ.totalQuestions) {
      totalEl.textContent = QUIZ.totalQuestions;
    }
    if (list) {
      list.innerHTML = QUIZ.rounds
        .map((r) => `<li><em>${r.questions.length}</em> ${r.name}</li>`)
        .join("");
    }
  }

  syncHeroCounts();
  updateDbStatus();
  updateAuthUI();
  refreshAuth();
  if (db()?.isConfigured?.()) {
    db().onAuthChange((session) => {
      state.authUser = session?.user || null;
      updateAuthUI();
    });
  }

  document.addEventListener("keydown", (e) => {
    if (!views.practice.classList.contains("is-active")) return;
    if (e.target.matches("input, textarea, select")) return;

    if (e.key === " " || e.key === "Enter") {
      const revealBtn = document.querySelector("[data-act=reveal]");
      const nextBtn = document.querySelector("[data-act=next]");
      if (revealBtn) {
        e.preventDefault();
        revealBtn.click();
      } else if (nextBtn) {
        e.preventDefault();
        nextBtn.click();
      }
    }
    if (e.key === "t" || e.key === "T") {
      const t = document.querySelector('[data-tf="TRUE"]');
      if (t && !state.answered) t.click();
    }
    if (e.key === "f" || e.key === "F") {
      const f = document.querySelector('[data-tf="FALSE"]');
      if (f && !state.answered) f.click();
    }
  });
})();
