/**
 * Thin Supabase wrapper for the COS quiz drill.
 * Auth: email + password accounts; progress linked via participants.user_id.
 */
(function (global) {
  const cfg = global.COS_CONFIG || {};
  let client = null;
  let cachedUser = null;
  let cachedParticipant = null;

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
    client = global.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    });
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

  async function getSession() {
    const sb = getClient();
    if (!sb) return null;
    const { data, error } = await sb.auth.getSession();
    if (error) throw error;
    cachedUser = data.session?.user || null;
    return data.session;
  }

  async function getUser() {
    const session = await getSession();
    return session?.user || null;
  }

  function onAuthChange(cb) {
    const sb = getClient();
    if (!sb) return { data: { subscription: { unsubscribe() {} } } };
    return sb.auth.onAuthStateChange((_event, session) => {
      cachedUser = session?.user || null;
      if (!session) cachedParticipant = null;
      cb(session);
    });
  }

  async function signUp({ email, password, displayName, department }) {
    const sb = getClient();
    if (!sb) throw new Error("Supabase not configured");

    const name = String(displayName || "").trim();
    const dept = String(department || "").trim();
    if (!email || !password || !name || !dept) {
      throw new Error("Name, department, email, and password are required");
    }
    if (password.length < 6) {
      throw new Error("Password must be at least 6 characters");
    }

    const { data, error } = await sb.auth.signUp({
      email: String(email).trim(),
      password,
      options: {
        data: {
          display_name: name,
          department: dept,
        },
      },
    });
    if (error) throw error;

    cachedUser = data.user;
    if (data.user) {
      cachedParticipant = await upsertParticipant(name, dept, {
        userId: data.user.id,
        email: data.user.email,
      });
    }
    return data;
  }

  async function signIn({ email, password }) {
    const sb = getClient();
    if (!sb) throw new Error("Supabase not configured");

    const { data, error } = await sb.auth.signInWithPassword({
      email: String(email).trim(),
      password,
    });
    if (error) throw error;

    cachedUser = data.user;
    const meta = data.user?.user_metadata || {};
    cachedParticipant = await upsertParticipant(
      meta.display_name || data.user.email,
      meta.department || "",
      { userId: data.user.id, email: data.user.email }
    );
    return data;
  }

  async function signOut() {
    const sb = getClient();
    if (!sb) return;
    await sb.auth.signOut();
    cachedUser = null;
    cachedParticipant = null;
  }

  async function upsertParticipant(displayName, department, opts = {}) {
    const sb = getClient();
    if (!sb) return null;

    const key = nameKey(displayName);
    const dept = String(department || "").trim();
    const userId = opts.userId || cachedUser?.id || null;
    const email = opts.email || cachedUser?.email || null;

    // Prefer lookup by auth user_id
    if (userId) {
      const { data: byUser, error: byUserErr } = await sb
        .from("participants")
        .select("id, display_name, department, email, user_id")
        .eq("user_id", userId)
        .maybeSingle();
      if (byUserErr) throw byUserErr;
      if (byUser) {
        const { data: updated, error: upErr } = await sb
          .from("participants")
          .update({
            display_name: String(displayName).trim(),
            department: dept,
            name_key: key,
            email: email || byUser.email,
          })
          .eq("id", byUser.id)
          .select("id, display_name, department, email, user_id")
          .single();
        if (upErr) throw upErr;
        cachedParticipant = updated;
        return updated;
      }
    }

    const { data: existing, error: findErr } = await sb
      .from("participants")
      .select("id, display_name, department, email, user_id")
      .eq("name_key", key)
      .eq("department", dept)
      .maybeSingle();

    if (findErr) throw findErr;

    if (existing) {
      const patch = {};
      if (userId && !existing.user_id) patch.user_id = userId;
      if (email) patch.email = email;
      if (Object.keys(patch).length) {
        const { data: linked, error: linkErr } = await sb
          .from("participants")
          .update(patch)
          .eq("id", existing.id)
          .select("id, display_name, department, email, user_id")
          .single();
        if (linkErr) throw linkErr;
        cachedParticipant = linked;
        return linked;
      }
      cachedParticipant = existing;
      return existing;
    }

    const row = {
      display_name: String(displayName).trim(),
      department: dept,
      name_key: key,
    };
    if (userId) row.user_id = userId;
    if (email) row.email = email;

    const { data, error } = await sb
      .from("participants")
      .insert(row)
      .select("id, display_name, department, email, user_id")
      .single();

    if (error) {
      if (error.code === "23505") {
        const { data: again, error: againErr } = await sb
          .from("participants")
          .select("id, display_name, department, email, user_id")
          .eq("name_key", key)
          .eq("department", dept)
          .single();
        if (againErr) throw againErr;
        cachedParticipant = again;
        return again;
      }
      throw error;
    }
    cachedParticipant = data;
    return data;
  }

  async function ensureParticipantFromUser() {
    const user = await getUser();
    if (!user) return null;
    if (cachedParticipant?.user_id === user.id) return cachedParticipant;
    const meta = user.user_metadata || {};
    return upsertParticipant(
      meta.display_name || user.email?.split("@")[0] || "Student",
      meta.department || "Other / Not listed",
      { userId: user.id, email: user.email }
    );
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
      sb
        .from("participants")
        .select("id, display_name, department, email, user_id, created_at"),
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

  async function fetchMyProgress() {
    const sb = getClient();
    if (!sb) return null;
    const participant = await ensureParticipantFromUser();
    if (!participant) return null;

    const { data: sessions, error } = await sb
      .from("sessions")
      .select(
        "id, kind, mode, round_id, label, score, total, elapsed_sec, finished_at"
      )
      .eq("participant_id", participant.id)
      .order("finished_at", { ascending: false });

    if (error) throw error;

    const sessionIds = (sessions || []).map((s) => s.id);
    let answers = [];
    if (sessionIds.length) {
      const { data: ans, error: ansErr } = await sb
        .from("answers")
        .select(
          "session_id, question_id, topic, is_correct, marked_override, time_ms"
        )
        .in("session_id", sessionIds);
      if (ansErr) throw ansErr;
      answers = ans || [];
    }

    return { participant, sessions: sessions || [], answers };
  }

  function checkAdminPin(pin) {
    return String(pin || "") === String(cfg.adminPin || "cos2026");
  }

  global.CosDB = {
    isConfigured,
    getClient,
    nameKey,
    getSession,
    getUser,
    onAuthChange,
    signUp,
    signIn,
    signOut,
    upsertParticipant,
    ensureParticipantFromUser,
    saveSession,
    fetchLeaderboard,
    fetchAnalytics,
    fetchMyProgress,
    checkAdminPin,
    getAdminPinHint: () => (cfg.adminPin ? "Set in config.js" : "cos2026"),
    getCachedParticipant: () => cachedParticipant,
  };
})(window);
