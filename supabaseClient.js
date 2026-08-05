/**
 * Thin Supabase wrapper for the COS quiz drill.
 * Requires window.COS_CONFIG + CDN supabase-js (createClient on window.supabase).
 */
(function (global) {
  const cfg = global.COS_CONFIG || {};
  let client = null;

  function isConfigured() {
    return Boolean(
      cfg.supabaseUrl &&
        cfg.supabaseAnonKey &&
        !String(cfg.supabaseUrl).includes("YOUR_PROJECT") &&
        !String(cfg.supabaseAnonKey).includes("YOUR_SUPABASE")
    );
  }

  function getClient() {
    if (!isConfigured()) return null;
    if (client) return client;
    if (!global.supabase || typeof global.supabase.createClient !== "function") {
      console.warn("Supabase JS SDK not loaded");
      return null;
    }
    client = global.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey);
    return client;
  }

  function nameKey(displayName) {
    return String(displayName || "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9\s]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  async function upsertParticipant(displayName, department) {
    const sb = getClient();
    if (!sb) return null;

    const key = nameKey(displayName);
    const dept = String(department || "").trim();

    const { data: existing, error: findErr } = await sb
      .from("participants")
      .select("id, display_name, department")
      .eq("name_key", key)
      .eq("department", dept)
      .maybeSingle();

    if (findErr) throw findErr;
    if (existing) return existing;

    const { data, error } = await sb
      .from("participants")
      .insert({
        display_name: String(displayName).trim(),
        department: dept,
        name_key: key,
      })
      .select("id, display_name, department")
      .single();

    if (error) {
      // Race: another insert won — fetch again
      if (error.code === "23505") {
        const { data: again, error: againErr } = await sb
          .from("participants")
          .select("id, display_name, department")
          .eq("name_key", key)
          .eq("department", dept)
          .single();
        if (againErr) throw againErr;
        return again;
      }
      throw error;
    }
    return data;
  }

  async function saveSession({
    participant,
    kind,
    mode,
    roundId,
    label,
    score,
    total,
    elapsedSec,
    startedAt,
    answers,
  }) {
    const sb = getClient();
    if (!sb || !participant?.id) return { ok: false, reason: "not_configured" };

    const { data: session, error: sessErr } = await sb
      .from("sessions")
      .insert({
        participant_id: participant.id,
        kind,
        mode,
        round_id: roundId || null,
        label: label || null,
        score: score ?? 0,
        total: total ?? 0,
        elapsed_sec: elapsedSec ?? 0,
        started_at: startedAt
          ? new Date(startedAt).toISOString()
          : new Date().toISOString(),
        finished_at: new Date().toISOString(),
      })
      .select("id")
      .single();

    if (sessErr) throw sessErr;

    if (answers && answers.length) {
      const rows = answers.map((a) => ({
        session_id: session.id,
        question_id: a.question_id,
        topic: a.topic || null,
        round_id: a.round_id || null,
        user_answer: a.user_answer ?? null,
        is_correct: Boolean(a.is_correct),
        marked_override: Boolean(a.marked_override),
        time_ms: a.time_ms ?? null,
        order_index: a.order_index ?? 0,
      }));

      const { error: ansErr } = await sb.from("answers").insert(rows);
      if (ansErr) throw ansErr;
    }

    return { ok: true, sessionId: session.id };
  }

  async function fetchLeaderboard(kinds = ["selection", "official_mock"], limit = 100) {
    const sb = getClient();
    if (!sb) return null;

    const { data, error } = await sb
      .from("session_leaderboard")
      .select("*")
      .in("kind", kinds)
      .order("pct", { ascending: false })
      .order("elapsed_sec", { ascending: true })
      .limit(limit);

    if (error) throw error;
    return data || [];
  }

  async function fetchAnalytics() {
    const sb = getClient();
    if (!sb) return null;

    const [parts, sessions, answers] = await Promise.all([
      sb.from("participants").select("id, display_name, department, created_at"),
      sb
        .from("sessions")
        .select(
          "id, participant_id, kind, mode, round_id, label, score, total, elapsed_sec, finished_at"
        )
        .order("finished_at", { ascending: false }),
      sb
        .from("answers")
        .select(
          "id, session_id, question_id, topic, round_id, is_correct, marked_override, time_ms, order_index, user_answer"
        ),
    ]);

    if (parts.error) throw parts.error;
    if (sessions.error) throw sessions.error;
    if (answers.error) throw answers.error;

    return {
      participants: parts.data || [],
      sessions: sessions.data || [],
      answers: answers.data || [],
    };
  }

  function checkAdminPin(pin) {
    return String(pin || "") === String(cfg.adminPin || "cos2026");
  }

  global.CosDB = {
    isConfigured,
    getClient,
    nameKey,
    upsertParticipant,
    saveSession,
    fetchLeaderboard,
    fetchAnalytics,
    checkAdminPin,
    getAdminPinHint: () => (cfg.adminPin ? "Set in config.js" : "cos2026"),
  };
})(window);
