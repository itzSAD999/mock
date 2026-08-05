(() => {
  const STORAGE_KEY = "cos-quiz-leaderboard";
  const COACH_UNLOCK_KEY = "cos-coach-unlocked";

  const views = {
    home: document.getElementById("view-home"),
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
    lastBoardFrom: "home",
    boardFilter: "tracked",
    coachUnlocked: sessionStorage.getItem(COACH_UNLOCK_KEY) === "1",
    coachData: null,
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
      ? "Supabase connected · scores sync across devices"
      : "Topics: History of KNUST · Maths · Campus · COS · Local scores until Supabase is configured";
  }

  /* ——— ANSWER MATCHING ——— */
  function normalize(str) {
    return String(str || "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9\s]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function tokens(str) {
    const stop = new Set([
      "a", "an", "the", "of", "and", "or", "in", "on", "at", "to", "for",
      "from", "by", "is", "was", "were", "are", "any", "two", "with",
    ]);
    return normalize(str)
      .split(" ")
      .filter((t) => t.length > 1 && !stop.has(t));
  }

  function checkAnswer(userRaw, q) {
    const user = normalize(userRaw);
    if (!user) return false;

    if (q.type === "tf") {
      const correct = normalize(q.a).startsWith("true") ? "true" : "false";
      if (user === "t" || user === "true" || user === "yes") return correct === "true";
      if (user === "f" || user === "false" || user === "no") return correct === "false";
      return user === correct;
    }

    const answer = normalize(q.a);
    const core = answer.replace(/\([^)]*\)/g, " ").replace(/\s+/g, " ").trim();

    if (user === answer || user === core) return true;
    if (answer.includes(user) && user.length >= 3) return true;
    if (core.includes(user) && user.length >= 3) return true;

    const userNums = user.match(/-?\d+(\.\d+)?/g);
    const ansNums = (core || answer).match(/-?\d+(\.\d+)?/g);
    if (userNums && ansNums && userNums.length === 1 && ansNums[0] === userNums[0]) {
      const ansWords = tokens(core);
      if (
        ansWords.length <= 2 ||
        /^x\s*=/.test(core) ||
        ansWords.every((w) => /^\d/.test(w) || w === "degrees" || w === "x")
      ) {
        return true;
      }
    }

    const key = tokens(core.length > 2 ? core : answer);
    if (key.length === 0) return false;
    const userToks = new Set(tokens(user));
    const hits = key.filter((k) => {
      if (userToks.has(k)) return true;
      for (const u of userToks) {
        if (u.length >= 4 && (k.includes(u) || u.includes(k))) return true;
      }
      return false;
    });
    const ratio = hits.length / key.length;
    if (key.length <= 2) return hits.length === key.length;
    if (key.length <= 4) return hits.length >= Math.ceil(key.length * 0.7);
    return ratio >= 0.6 && hits.length >= 2;
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
      is_correct: Boolean(isCorrect),
      marked_override: Boolean(markedOverride),
      time_ms: timeMs,
      order_index: state.index,
    };
    state.answerLog.push(entry);
    state.lastLogIndex = state.answerLog.length - 1;
  }

  function markLastOverride() {
    if (state.lastLogIndex < 0) return;
    const e = state.answerLog[state.lastLogIndex];
    e.is_correct = true;
    e.marked_override = true;
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
        state.playerDept
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

    const eyebrow = document.getElementById("name-eyebrow");
    const title = document.getElementById("name-title");
    const hint = document.getElementById("name-hint");

    if (flow === "official") {
      eyebrow.textContent = "Official mock";
      title.textContent = "Who is sitting the mock?";
      hint.textContent =
        "Official mock scores are tagged separately from selection trials for fair comparison.";
    } else {
      eyebrow.textContent = "Team selection";
      title.textContent = "Who is trying out?";
      hint.textContent =
        "They type their own answers. Scores sync so you can compare everyone.";
    }

    document.getElementById("player-name").value = "";
    document.getElementById("player-dept").value = "";
    show("name");
    setTimeout(() => document.getElementById("player-name").focus(), 80);
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

  /* ——— HUB ——— */
  function openHub() {
    const tracked = state.flow === "select" || state.flow === "official";
    document.getElementById("hub-eyebrow").textContent =
      state.flow === "official"
        ? "Official mock"
        : state.flow === "select"
          ? "Team selection"
          : "Study hub";
    document.getElementById("hub-title").textContent = tracked
      ? "Pick the question set"
      : "Choose a round";

    const playerEl = document.getElementById("hub-player");
    const boardBtn = document.getElementById("hub-board-btn");
    const topicsWrap = document.getElementById("hub-topics-wrap");

    if (tracked && state.playerName) {
      playerEl.textContent = `${state.playerName} · ${state.playerDept}`;
      playerEl.classList.remove("is-hidden");
      boardBtn.classList.remove("is-hidden");
      topicsWrap.classList.add("is-hidden");
    } else {
      playerEl.classList.add("is-hidden");
      boardBtn.classList.add("is-hidden");
      topicsWrap.classList.remove("is-hidden");
    }

    const grid = document.getElementById("hub-grid");
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

    const fullTile = `
      <button class="round-tile round-tile-full" data-round="full">
        <div class="rt-num">${tracked ? "Full set" : "All rounds"}</div>
        <h3>Full mock</h3>
        <p>${tracked ? `All ${QUIZ.totalQuestions} questions — best for final comparison.` : `All ${QUIZ.totalQuestions} questions shuffled.`}</p>
        <span class="rt-count">${QUIZ.totalQuestions} questions</span>
      </button>`;

    grid.innerHTML = tiles + fullTile;

    grid.querySelectorAll("[data-round]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.dataset.round;
        if (tracked) {
          beginTrackedTrial(id);
        } else if (id === "full") {
          openModePicker("full");
        } else {
          openModePicker("round", id);
        }
      });
    });

    if (state.flow === "study") {
      const chips = document.getElementById("topic-chips");
      const topics = [...new Set(allQuestions().map((q) => q.topic))];
      chips.innerHTML = topics
        .map((t) => `<button class="topic-chip" data-topic="${t}">${t}</button>`)
        .join("");
      chips.querySelectorAll("[data-topic]").forEach((btn) => {
        btn.addEventListener("click", () =>
          openModePicker("topic", btn.dataset.topic)
        );
      });
    }

    show("hub");
  }

  function beginTrackedTrial(id) {
    let pool;
    let label;
    if (id === "full") {
      pool = allQuestions();
      label = "Full mock";
      state.context = { kind: "full", id: "full", type: "mixed", label };
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
    state.mode = mode;
    state.index = 0;
    state.score = 0;
    state.revealed = false;
    state.answered = false;
    state.answerLog = [];
    state.lastLogIndex = -1;

    if (state.context?.kind === "full") state.pool = allQuestions();
    else if (state.context?.kind === "round")
      state.pool = questionsForRound(state.context.id);
    else if (state.context?.kind === "topic")
      state.pool = questionsForTopic(state.context.id);

    state.pool = shuffle(state.pool);

    document.getElementById("score-pill").textContent = "0";

    const chip = document.getElementById("player-chip");
    if (state.playerName && state.sessionKind !== "practice") {
      chip.textContent = state.playerName;
      chip.classList.remove("is-hidden");
    } else {
      chip.classList.add("is-hidden");
    }

    const timer = document.getElementById("timer");
    if (mode === "speed" || state.sessionKind !== "practice") {
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
          placeholder="Type your answer…"
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

  function submitTyped() {
    if (state.answered) return;
    const input = document.getElementById("answer-input");
    const raw = input ? input.value : "";
    if (!raw.trim()) {
      input?.focus();
      return;
    }

    state.answered = true;
    const q = currentQ();
    const ok = checkAnswer(raw, q);

    if (input) input.disabled = true;

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

    const total = state.pool.length;
    const scored = state.mode !== "study";
    const score = scored ? state.score : null;
    const pct = score !== null && total ? Math.round((score / total) * 100) : null;

    const syncEl = document.getElementById("results-sync");
    syncEl.classList.add("is-hidden");

    if (scored) {
      await persistSession(score, total, pct);
    }

    let title = "Session complete";
    if (pct !== null) {
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

    const tracked =
      state.sessionKind === "selection" || state.sessionKind === "official_mock";
    const nextC = document.getElementById("btn-next-contestant");
    const boardBtn = document.getElementById("btn-view-board");
    const retry = document.getElementById("btn-retry");
    const hubBtn = document.getElementById("btn-results-hub");

    if (tracked) {
      nextC.classList.remove("is-hidden");
      boardBtn.classList.remove("is-hidden");
      retry.textContent = "Retake same set";
      hubBtn.textContent = "Different round";
    } else {
      nextC.classList.add("is-hidden");
      boardBtn.classList.toggle("is-hidden", !scored);
      retry.textContent = "Try again";
      hubBtn.textContent = "Back to rounds";
    }

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

  async function loadCoachDashboard() {
    const status = document.getElementById("coach-status");
    const kindFilter = document.getElementById("coach-kind").value;

    if (!db()?.isConfigured?.()) {
      status.textContent =
        "Supabase not configured. Copy config.example.js → config.js and run supabase/schema.sql.";
      document.getElementById("coach-rankings").innerHTML = "";
      document.getElementById("coach-topics").innerHTML = "";
      document.getElementById("coach-hard").innerHTML = "";
      return;
    }

    status.textContent = "Loading analytics…";
    try {
      const data = await db().fetchAnalytics();
      state.coachData = data;
      renderCoach(data, kindFilter);
      status.textContent = `${data.participants.length} participants · ${data.sessions.length} sessions · ${data.answers.length} answers`;
    } catch (err) {
      console.error(err);
      status.textContent = "Failed to load analytics. Check schema and RLS policies.";
    }
  }

  function renderCoach(data, kindFilter) {
    const sessions = data.sessions.filter(
      (s) => kindFilter === "all" || s.kind === kindFilter
    );
    const sessionIds = new Set(sessions.map((s) => s.id));
    const answers = data.answers.filter((a) => sessionIds.has(a.session_id));
    const byId = Object.fromEntries(data.participants.map((p) => [p.id, p]));

    // Rankings: best % per participant (within filter), plus counts
    const stats = {};
    sessions.forEach((s) => {
      const p = byId[s.participant_id];
      if (!p) return;
      if (!stats[p.id]) {
        stats[p.id] = {
          name: p.display_name,
          department: p.department,
          bestPct: 0,
          bestScore: "0/0",
          runs: 0,
          practice: 0,
          selection: 0,
          official_mock: 0,
          avgPct: 0,
          pctSum: 0,
        };
      }
      const st = stats[p.id];
      st.runs += 1;
      st[s.kind] = (st[s.kind] || 0) + 1;
      const pct = s.total ? Math.round((s.score / s.total) * 100) : 0;
      st.pctSum += pct;
      if (pct >= st.bestPct) {
        st.bestPct = pct;
        st.bestScore = `${s.score}/${s.total}`;
      }
    });
    Object.values(stats).forEach((st) => {
      st.avgPct = st.runs ? Math.round(st.pctSum / st.runs) : 0;
    });

    const ranked = Object.values(stats).sort(
      (a, b) => b.bestPct - a.bestPct || b.avgPct - a.avgPct
    );

    document.getElementById("coach-rankings").innerHTML = ranked.length
      ? `<table class="coach-table">
        <thead><tr><th>#</th><th>Name</th><th>Dept</th><th>Best</th><th>Avg</th><th>Runs</th><th>Mock</th><th>Select</th><th>Practice</th></tr></thead>
        <tbody>
          ${ranked
            .map(
              (r, i) => `<tr>
              <td>${i + 1}</td>
              <td>${escapeHtml(r.name)}</td>
              <td>${escapeHtml(r.department || "—")}</td>
              <td>${r.bestPct}% (${r.bestScore})</td>
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

    // Topic weakness
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

    // Hardest questions
    const qs = {};
    answers.forEach((a) => {
      if (!qs[a.question_id])
        qs[a.question_id] = { id: a.question_id, correct: 0, total: 0 };
      qs[a.question_id].total += 1;
      if (a.is_correct) qs[a.question_id].correct += 1;
    });
    const hard = Object.values(qs)
      .filter((q) => q.total >= 1)
      .map((q) => ({
        ...q,
        pct: Math.round((q.correct / q.total) * 100),
        text: questionTextById(q.id),
      }))
      .sort((a, b) => a.pct - b.pct || b.total - a.total)
      .slice(0, 15);

    document.getElementById("coach-hard").innerHTML = hard.length
      ? `<table class="coach-table">
        <thead><tr><th>Question</th><th>Accuracy</th><th>n</th></tr></thead>
        <tbody>
          ${hard
            .map(
              (q) => `<tr>
              <td title="${escapeHtml(q.id)}">${escapeHtml(q.text.slice(0, 120))}${q.text.length > 120 ? "…" : ""}</td>
              <td>${q.pct}%</td>
              <td>${q.total}</td>
            </tr>`
            )
            .join("")}
        </tbody>
      </table>`
      : `<p class="coach-empty">No question stats yet.</p>`;
  }

  /* ——— EVENTS ——— */
  document.body.addEventListener("click", (e) => {
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
      openNameScreen("select");
    } else if (action === "start-official") {
      openNameScreen("official");
    } else if (action === "start-study") {
      state.flow = "study";
      state.sessionKind = "practice";
      state.playerName = "";
      state.playerDept = "";
      openHub();
    } else if (action === "confirm-name") {
      confirmIdentity();
    } else if (action === "go-home") {
      stopTimer();
      show("home");
    } else if (action === "hub-back") {
      stopTimer();
      if (state.flow === "select" || state.flow === "official") show("name");
      else show("home");
    } else if (action === "go-hub") {
      stopTimer();
      openHub();
    } else if (action === "exit-practice") {
      stopTimer();
      if (state.flow === "study" && state.mode === "study") show("mode");
      else if (state.flow === "study") show("mode");
      else openHub();
    } else if (action === "retry") {
      startSession(state.mode);
    } else if (action === "next-contestant") {
      openNameScreen(state.flow === "official" ? "official" : "select");
    } else if (action === "show-board") {
      state.lastBoardFrom = views.results.classList.contains("is-active")
        ? "results"
        : views.name.classList.contains("is-active")
          ? "name"
          : views.hub.classList.contains("is-active")
            ? "hub"
            : "home";
      renderBoard();
      show("board");
    } else if (action === "board-back") {
      if (state.lastBoardFrom === "results") show("results");
      else if (state.lastBoardFrom === "name") show("name");
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
      loadCoachDashboard();
    }
  });

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
    if (state.coachData) renderCoach(state.coachData, document.getElementById("coach-kind").value);
    else loadCoachDashboard();
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
