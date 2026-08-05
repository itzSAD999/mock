(() => {
  const STORAGE_KEY = "cos-quiz-leaderboard";

  const views = {
    home: document.getElementById("view-home"),
    name: document.getElementById("view-name"),
    hub: document.getElementById("view-hub"),
    mode: document.getElementById("view-mode"),
    practice: document.getElementById("view-practice"),
    results: document.getElementById("view-results"),
    board: document.getElementById("view-board"),
  };

  const state = {
    flow: "study", // study | select
    playerName: "",
    pool: [],
    index: 0,
    score: 0,
    mode: "study", // study | contest | speed
    context: null,
    revealed: false,
    answered: false,
    timerId: null,
    elapsed: 0,
    startedAt: 0,
    lastBoardFrom: "home",
  };

  function show(name) {
    Object.values(views).forEach((el) => el.classList.remove("is-active"));
    views[name].classList.add("is-active");
    window.scrollTo(0, 0);
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

    // TRUE / FALSE
    if (q.type === "tf") {
      const correct = normalize(q.a).startsWith("true") ? "true" : "false";
      if (user === "t" || user === "true" || user === "yes") return correct === "true";
      if (user === "f" || user === "false" || user === "no") return correct === "false";
      return user === correct;
    }

    const answer = normalize(q.a);
    // strip parentheticals for matching core
    const core = answer.replace(/\([^)]*\)/g, " ").replace(/\s+/g, " ").trim();

    if (user === answer || user === core) return true;
    if (answer.includes(user) && user.length >= 3) return true;
    if (core.includes(user) && user.length >= 3) return true;

    // numeric answers: extract numbers
    const userNums = user.match(/-?\d+(\.\d+)?/g);
    const ansNums = (core || answer).match(/-?\d+(\.\d+)?/g);
    if (userNums && ansNums && userNums.length === 1 && ansNums[0] === userNums[0]) {
      // if answer is mainly a number (math), accept
      const ansWords = tokens(core);
      if (ansWords.length <= 2 || /^x\s*=/.test(core) || ansWords.every((w) => /^\d/.test(w) || w === "degrees" || w === "x")) {
        return true;
      }
    }

    // keyword overlap: user must cover most key tokens from the answer
    const key = tokens(core.length > 2 ? core : answer);
    if (key.length === 0) return false;
    const userToks = new Set(tokens(user));
    const hits = key.filter((k) => {
      if (userToks.has(k)) return true;
      // partial: "prempeh" matches "prempeh"
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

  /* ——— LEADERBOARD ——— */
  function loadBoard() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    } catch {
      return [];
    }
  }

  function saveBoard(entries) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  }

  function addBoardEntry(entry) {
    const list = loadBoard();
    list.push(entry);
    list.sort((a, b) => {
      if (b.pct !== a.pct) return b.pct - a.pct;
      if (b.score !== a.score) return b.score - a.score;
      return (a.elapsed || 99999) - (b.elapsed || 99999);
    });
    saveBoard(list);
  }

  function renderBoard() {
    const list = loadBoard();
    const empty = document.getElementById("board-empty");
    const ol = document.getElementById("board-list");

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
          <span>${escapeHtml(e.label)} · ${e.pct}%</span>
        </div>
        <span class="board-score">${e.score}/${e.total}</span>
      </li>`
      )
      .join("");
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  /* ——— HUB ——— */
  function openHub() {
    const select = state.flow === "select";
    document.getElementById("hub-eyebrow").textContent = select
      ? "Team selection"
      : "Study hub";
    document.getElementById("hub-title").textContent = select
      ? "Pick the trial set"
      : "Choose a round";

    const playerEl = document.getElementById("hub-player");
    const boardBtn = document.getElementById("hub-board-btn");
    const topicsWrap = document.getElementById("hub-topics-wrap");

    if (select && state.playerName) {
      playerEl.textContent = `Contestant: ${state.playerName}`;
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
        <div class="rt-num">${select ? "Full trial" : "All rounds"}</div>
        <h3>Full mock</h3>
        <p>${select ? `All ${QUIZ.totalQuestions} questions — best for final comparison.` : `All ${QUIZ.totalQuestions} questions shuffled.`}</p>
        <span class="rt-count">${QUIZ.totalQuestions} questions</span>
      </button>`;

    grid.innerHTML = tiles + fullTile;

    grid.querySelectorAll("[data-round]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.dataset.round;
        if (state.flow === "select") {
          beginSelectTrial(id);
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
        btn.addEventListener("click", () => openModePicker("topic", btn.dataset.topic));
      });
    }

    show("hub");
  }

  function beginSelectTrial(id) {
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
    const mode = id === "speed" || state.context.type === "speed" ? "speed" : "contest";
    startSession(mode);
  }

  /* ——— MODE PICKER (study) ——— */
  function openModePicker(kind, id) {
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

    if (state.context?.kind === "full") state.pool = allQuestions();
    else if (state.context?.kind === "round")
      state.pool = questionsForRound(state.context.id);
    else if (state.context?.kind === "topic")
      state.pool = questionsForTopic(state.context.id);

    state.pool = shuffle(state.pool);

    document.getElementById("score-pill").textContent = "0";

    const chip = document.getElementById("player-chip");
    if (state.flow === "select" && state.playerName) {
      chip.textContent = state.playerName;
      chip.classList.remove("is-hidden");
    } else {
      chip.classList.add("is-hidden");
    }

    const timer = document.getElementById("timer");
    if (mode === "speed" || state.flow === "select") {
      startTimer();
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

    // study flashcards
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
    // Moderator override for borderline open answers
    if (!ok && q.type !== "tf") {
      actions.innerHTML = `
        <button class="btn btn-ghost" data-act="override">Mark correct</button>
        <button class="btn btn-primary" data-act="next">Next</button>`;
      actions.querySelector("[data-act=override]").addEventListener("click", () => {
        state.score += 1;
        document.getElementById("score-pill").textContent = state.score;
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

  function finishSession() {
    stopTimer();
    const total = state.pool.length;
    const scored = state.mode !== "study";
    const score = scored ? state.score : null;
    const pct = score !== null && total ? Math.round((score / total) * 100) : null;

    if (state.flow === "select" && scored) {
      addBoardEntry({
        name: state.playerName,
        score,
        total,
        pct,
        elapsed: state.elapsed,
        label: state.context?.label || "Trial",
        at: Date.now(),
      });
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
    eyebrow.textContent =
      state.flow === "select" && state.playerName
        ? state.playerName
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

    const nextC = document.getElementById("btn-next-contestant");
    const boardBtn = document.getElementById("btn-view-board");
    const retry = document.getElementById("btn-retry");
    const hubBtn = document.getElementById("btn-results-hub");

    if (state.flow === "select") {
      nextC.classList.remove("is-hidden");
      boardBtn.classList.remove("is-hidden");
      retry.textContent = "Retake same set";
      hubBtn.textContent = "Different round";
    } else {
      nextC.classList.add("is-hidden");
      boardBtn.classList.add("is-hidden");
      retry.textContent = "Try again";
      hubBtn.textContent = "Back to rounds";
    }

    show("results");
  }

  /* ——— EVENTS ——— */
  document.body.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-action]");
    if (!btn) return;
    const action = btn.dataset.action;

    if (action === "start-select") {
      state.flow = "select";
      document.getElementById("player-name").value = "";
      show("name");
      setTimeout(() => document.getElementById("player-name").focus(), 100);
    } else if (action === "start-study") {
      state.flow = "study";
      state.playerName = "";
      openHub();
    } else if (action === "confirm-name") {
      const name = document.getElementById("player-name").value.trim();
      if (!name) {
        document.getElementById("player-name").focus();
        return;
      }
      state.playerName = name;
      openHub();
    } else if (action === "go-home") {
      stopTimer();
      show("home");
    } else if (action === "hub-back") {
      stopTimer();
      if (state.flow === "select") show("name");
      else show("home");
    } else if (action === "go-hub") {
      stopTimer();
      openHub();
    } else if (action === "exit-practice") {
      stopTimer();
      if (state.flow === "study" && state.mode !== "contest") show("mode");
      else openHub();
    } else if (action === "retry") {
      // rebuild pool from context
      if (state.context?.kind === "full") state.pool = allQuestions();
      else if (state.context?.kind === "round")
        state.pool = questionsForRound(state.context.id);
      else if (state.context?.kind === "topic")
        state.pool = questionsForTopic(state.context.id);
      startSession(state.mode);
    } else if (action === "next-contestant") {
      state.playerName = "";
      document.getElementById("player-name").value = "";
      show("name");
      setTimeout(() => document.getElementById("player-name").focus(), 100);
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
      if (confirm("Clear all saved trial scores?")) {
        saveBoard([]);
        renderBoard();
      }
    }
  });

  document.getElementById("player-name").addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      document.getElementById("btn-confirm-name").click();
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
        .map(
          (r) =>
            `<li><em>${r.questions.length}</em> ${r.name}</li>`
        )
        .join("");
    }
  }

  syncHeroCounts();

  document.addEventListener("keydown", (e) => {
    if (!views.practice.classList.contains("is-active")) return;
    // Don't steal keys while typing in the answer field
    if (e.target.matches("input, textarea")) return;

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
