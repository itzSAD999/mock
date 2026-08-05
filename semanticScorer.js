/**
 * Free open-source semantic scoring for quiz answers.
 * Model: Xenova/all-MiniLM-L6-v2 (sentence-transformers)
 * Runtime: Transformers.js in the browser — no API key, no server.
 *
 * Apache-2.0 / open weights. First load downloads ~23MB (cached by the browser).
 */
import { pipeline, env } from "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.5.1";

env.allowLocalModels = false;
env.useBrowserCache = true;

const MODEL_ID = "Xenova/all-MiniLM-L6-v2";
/** Cosine similarity floor for "same meaning" (MiniLM, normalized). */
const THRESHOLD = 0.56;
const THRESHOLD_STRICT = 0.62;

let extractor = null;
let loadPromise = null;
const cache = new Map();

function cosine(a, b) {
  let s = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) s += a[i] * b[i];
  return s;
}

async function embed(text) {
  const key = String(text || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
  if (!key) return null;
  if (cache.has(key)) return cache.get(key);

  const out = await extractor(key, { pooling: "mean", normalize: true });
  const row = out.tolist ? out.tolist()[0] : Array.from(out.data).slice(0, 384);
  cache.set(key, row);
  return row;
}

/**
 * @param {(msg: {status?: string, progress?: number}) => void} [onProgress]
 * @returns {Promise<boolean>}
 */
export async function ensureReady(onProgress) {
  if (extractor) return true;
  if (loadPromise) return loadPromise;

  loadPromise = (async () => {
    try {
      extractor = await pipeline("feature-extraction", MODEL_ID, {
        dtype: "q8",
        progress_callback: (p) => {
          if (typeof onProgress === "function") onProgress(p);
        },
      });
      return true;
    } catch (err) {
      console.warn("[CosSemantic] model load failed — rule matching only", err);
      extractor = null;
      loadPromise = null;
      return false;
    }
  })();

  return loadPromise;
}

export function isReady() {
  return Boolean(extractor);
}

export function modelInfo() {
  return {
    id: MODEL_ID,
    name: "all-MiniLM-L6-v2",
    license: "Apache-2.0",
    runtime: "Transformers.js (browser)",
    threshold: THRESHOLD,
  };
}

/** @returns {Promise<number|null>} cosine similarity 0–1, or null if unavailable */
export async function similarity(a, b) {
  if (!extractor) {
    const ok = await ensureReady();
    if (!ok) return null;
  }
  const [va, vb] = await Promise.all([embed(a), embed(b)]);
  if (!va || !vb) return null;
  return cosine(va, vb);
}

/**
 * True if user text is semantically close to any candidate string.
 * @param {string} user
 * @param {string[]} candidates
 * @param {number} [threshold]
 */
export async function matchesAny(user, candidates, threshold = THRESHOLD) {
  if (!user?.trim() || !candidates?.length) return false;
  const ready = extractor || (await ensureReady());
  if (!ready) return false;

  let best = 0;
  for (const c of candidates) {
    if (!c?.trim()) continue;
    const s = await similarity(user, c);
    if (s != null && s > best) best = s;
    if (best >= threshold) return true;
  }
  return best >= threshold;
}

/**
 * For "any N of …" lists: count how many options the user covered.
 * Splits on commas / "and" so "Unity and Katanga" can hit two options.
 * @param {string} userRaw
 * @param {{ labels: string[] }[]} options
 * @param {number} need
 * @param {number} [threshold]
 */
export async function matchesAnyOfList(userRaw, options, need, threshold = THRESHOLD) {
  const ready = extractor || (await ensureReady());
  if (!ready || !options?.length) return false;

  const chunks = String(userRaw)
    .split(/\s*(?:,|;|\/|&|\band\b)\s*/i)
    .map((s) => s.trim())
    .filter((s) => s.length > 1);
  const texts = chunks.length ? chunks : [String(userRaw).trim()];

  let hits = 0;
  for (const opt of options) {
    const labels = opt.labels || [];
    let best = 0;
    for (const label of labels) {
      for (const t of texts) {
        const s = await similarity(t, label);
        if (s != null && s > best) best = s;
      }
      const full = await similarity(userRaw, label);
      if (full != null && full > best) best = full;
    }
    if (best >= threshold) hits += 1;
  }
  return hits >= need;
}

export { THRESHOLD, THRESHOLD_STRICT, MODEL_ID };

// Classic script bridge (app.js is not an ES module)
window.CosSemantic = {
  ensureReady,
  isReady,
  modelInfo,
  similarity,
  matchesAny,
  matchesAnyOfList,
  THRESHOLD,
  THRESHOLD_STRICT,
  MODEL_ID,
};
