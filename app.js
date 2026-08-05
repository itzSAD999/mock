(() => {
  const views = {
    home: document.getElementById("view-home"),
    hub: document.getElementById("view-hub"),
    mode: document.getElementById("view-mode"),
    practice: document.getElementById("view-practice"),
    results: document.getElementById("view-results"),
  };

  const state = {
    pool: [],
    index: 0,
    score: 0,
    mode: "study", // study | quiz | speed | tf
    context: null, // { kind: 'round'|'topic'|'full', id/name }
    revealed: false,
    answered: false,
    timerId: null,
    elapsed: 0,
    startedAt: 0,
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
      r.questions.map((q) => ({ ...q, roundId: r.id, roundName: r.name, type: r.type }))
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

  /* ——— HUB ——— */
  function renderHub() {
    const grid = document.getElementById("hub-grid");
    grid.innerHTML = QUIZ.rounds
      .map(
        (r) => `
      <button class="round-tile" data-round="${r.id}">
        <div class="rt-num">Round ${r.round}</div>
        <h3>${r.name}</h3>
        <p>${r.description}</p>
        <span class="rt-count">${r.count} questions</span>
      </button>`
      )
      .join("");

    grid.querySelectorAll("[data-round]").forEach((btn) => {
      btn.addEventListener("click", () => openModePicker("round", btn.dataset.round));
    });

    const chips = document.getElementById("topic-chips");
    const topics = [...new Set(allQuestions().map((q) => q.topic))];
    chips.innerHTML = topics
      .map((t) => `<button class="topic-chip" data-topic="${t}">${t}</button>`)
      .join("");
    chips.querySelectorAll("[data-topic]").forEach((btn) => {
      btn.addEventListener("click", () => openModePicker("topic", btn.dataset.topic));
    });
  }

  /* ——— MODE PICKER ——— */
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
      state.context = { kind, id, type: r.type };
    } else if (kind === "topic") {
      pool = questionsForTopic(id);
      title = id;
      eyebrow = "Topic drill";
      desc = `${pool.length} questions tagged under this topic.`;
      state.context = { kind, id, type: "mixed" };
    } else if (kind === "full") {
      pool = allQuestions();
      title = "Full mock";
      eyebrow = "All rounds";
      desc = "All 51 questions shuffled — simulate the full contest.";
      state.context = { kind, id: "full", type: "mixed" };
    }

    state.pool = pool;

    document.getElementById("mode-eyebrow").textContent = eyebrow;
    document.getElementById("mode-title").textContent = title;
    document.getElementById("mode-count").textContent = `${pool.length} Qs`;
    document.getElementById("mode-desc").textContent = desc;

    const isTF =
      state.context.type === "tf" ||
      (pool.length > 0 && pool.every((q) => q.type === "tf"));
    const isSpeed = state.context.type === "speed";

    const options = [];
    options.push({
      mode: "study",
      title: "Study flashcards",
      blurb: "Read the question, reveal the answer when ready. No scoring.",
    });
    if (isTF) {
      options.push({
        mode: "tf",
        title: "True / False tap",
        blurb: "Tap True or False. Instant feedback with explanations.",
      });
    } else {
      options.push({
        mode: "quiz",
        title: "Self-check quiz",
        blurb: "Answer in your head, reveal, then mark yourself right or wrong.",
      });
    }
    if (isSpeed || kind === "full" || kind === "topic") {
      options.push({
        mode: "speed",
        title: "Speed session",
        blurb: "Timed run. Reveal fast and grade yourself. Built for Round 2 pace.",
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
    state.pool = shuffle(state.pool);

    document.getElementById("score-pill").textContent = "0";
    const timer = document.getElementById("timer");
    if (mode === "speed") {
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

    const isTF = q.type === "tf";
    const useTFButtons =
      isTF && (state.mode === "tf" || state.mode === "quiz" || state.mode === "speed");

    if (useTFButtons) {
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

    if (state.mode === "study") {
      actions.innerHTML = `
        <button class="btn btn-primary" data-act="reveal">Reveal answer</button>`;
      actions.querySelector("[data-act=reveal]").addEventListener("click", revealAnswer);
      return;
    }

    // quiz / speed open answers — self grade after reveal
    actions.innerHTML = `
      <button class="btn btn-primary" data-act="reveal">Reveal answer</button>`;
    actions.querySelector("[data-act=reveal]").addEventListener("click", () => {
      revealAnswer();
      showSelfGrade();
    });
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
    if (state.mode === "study") {
      actions.innerHTML = `
        <button class="btn btn-primary" data-act="next">Next</button>`;
      actions.querySelector("[data-act=next]").addEventListener("click", nextQuestion);
    }
  }

  function showSelfGrade() {
    const actions = document.getElementById("practice-actions");
    actions.innerHTML = `
      <div class="self-grade">
        <button class="btn btn-true" data-grade="1">I got it</button>
        <button class="btn btn-false" data-grade="0">Missed it</button>
      </div>`;
    actions.querySelectorAll("[data-grade]").forEach((btn) => {
      btn.addEventListener("click", () => {
        if (state.answered) return;
        state.answered = true;
        const ok = btn.dataset.grade === "1";
        if (ok) {
          state.score += 1;
          document.getElementById("score-pill").textContent = state.score;
          document.getElementById("reveal-panel").classList.add("is-correct");
        } else {
          document.getElementById("reveal-panel").classList.add("is-wrong");
        }
        setTimeout(nextQuestion, 450);
      });
    });
  }

  function gradeTF(choice, btn) {
    if (state.answered) return;
    state.answered = true;
    const q = currentQ();
    const correct = q.a.toUpperCase() === "TRUE" ? "TRUE" : "FALSE";
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

    const panel = document.getElementById("reveal-panel");
    panel.classList.remove("is-hidden");
    panel.classList.add(ok ? "is-correct" : "is-wrong");
    document.getElementById("reveal-label").textContent = ok ? "Correct" : "Incorrect";
    document.getElementById("reveal-answer").textContent = `${q.a}${q.explain ? "" : ""}`;
    const exp = document.getElementById("reveal-explain");
    if (q.explain) {
      exp.textContent = q.explain;
      exp.classList.remove("is-hidden");
    } else if (!ok) {
      exp.textContent = `Correct answer: ${q.a}`;
      exp.classList.remove("is-hidden");
    } else {
      exp.classList.add("is-hidden");
    }

    const actions = document.getElementById("practice-actions");
    actions.innerHTML = `
      <button class="btn btn-primary" data-act="next">Next</button>`;
    actions.querySelector("[data-act=next]").addEventListener("click", nextQuestion);
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
    const score = state.mode === "study" ? null : state.score;
    const pct = score !== null && total ? Math.round((score / total) * 100) : null;

    let title = "Session complete";
    if (pct !== null) {
      if (pct >= 85) title = "Competition ready";
      else if (pct >= 65) title = "Solid run";
      else if (pct >= 40) title = "Keep drilling";
      else title = "Study up";
    } else {
      title = "Flashcards done";
    }

    document.getElementById("results-title").textContent = title;
    document.getElementById("results-score").textContent =
      score !== null ? score : "—";
    document.getElementById("results-total").textContent = total;

    const pctEl = document.getElementById("results-pct");
    if (pct !== null) {
      pctEl.textContent = `${pct}% correct`;
      pctEl.classList.remove("is-hidden");
    } else {
      pctEl.textContent = "Review complete — no score in study mode";
    }

    const timeEl = document.getElementById("results-time");
    if (state.mode === "speed") {
      timeEl.textContent = `Time: ${formatTime(state.elapsed)}`;
      timeEl.classList.remove("is-hidden");
    } else {
      timeEl.classList.add("is-hidden");
    }

    show("results");
  }

  /* ——— EVENTS ——— */
  document.body.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-action]");
    if (!btn) return;
    const action = btn.dataset.action;

    if (action === "start-hub") {
      show("hub");
    } else if (action === "go-home") {
      stopTimer();
      show("home");
    } else if (action === "go-hub") {
      stopTimer();
      show("hub");
    } else if (action === "full-mock") {
      openModePicker("full");
    } else if (action === "exit-practice") {
      stopTimer();
      if (state.context?.kind === "round" || state.context?.kind === "topic") {
        show("mode");
      } else {
        show("hub");
      }
    } else if (action === "retry") {
      startSession(state.mode);
    }
  });

  // Keyboard shortcuts
  document.addEventListener("keydown", (e) => {
    if (!views.practice.classList.contains("is-active")) return;
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

  renderHub();
})();
