# COS Inter-Departmental Quiz Drill

Practice and team-selection site for the College of Science (KNUST) quiz. Scores and per-answer analytics sync through **Supabase** when configured; otherwise they stay on the device (`localStorage`).

## Database setup (clean install)

1. Open Supabase → **SQL Editor**.
2. Paste and run **[`supabase/schema.sql`](supabase/schema.sql)** once.
   - This **drops** old quiz tables and recreates everything the app needs.
3. **Authentication → Providers → Email**
   - Email: **ON**
   - **Confirm email: OFF** (so signup works immediately — no inbox required)

## Accounts required

Everyone must **Create account** or **Sign in** before practice, official mocks, live showdown, or team selection. Progress, history, missed-question drills, and leaderboard entries sync to that account. Coach analytics stays PIN-gated for organizers.

## Live showdown

Timed shared room for final-showdown practice (especially riddles):

1. Run **[`supabase/live_migration.sql`](supabase/live_migration.sql)** once in the SQL Editor (existing projects). Fresh installs already get the tables from `schema.sql`.
2. Sign in → **Live showdown** → create a room (riddles / showdown mix / rapid 20) and seconds per question (default 20).
3. Share the **link** or **code** — everyone answers the **same set** on the **same clock**. When time runs out, the room advances together.

## Personal focus & candidate audit

- **My scores → Preparation audit** shows bank coverage, never-answered items, persistent gaps, and topic/round need-work counts.
- **Practice my gaps** (or Practice hub → **Personal focus**) builds up to 40 questions from gaps + unseen items.
- Normal practice rounds also soft-prioritize misses, then unanswered questions.
- **Admin scores** includes a **Team planning** board (Ready / Borderline / Needs work), department readiness, coverage & gap meters on people, and a richer leaderboard with podium + score bars.

## Quick start (local)

1. Serve the folder (any static server), e.g. `python -m http.server 5173`
2. Open `http://localhost:5173`
3. Without Supabase you can still run trials; scores stay local.

## Supabase setup

1. Create a project at [supabase.com](https://supabase.com).
2. In **SQL Editor**, paste and run [`supabase/schema.sql`](supabase/schema.sql).
3. Copy [`config.example.js`](config.example.js) → **`config.js`**.
4. Fill in from **Project Settings → API**:
   - `supabaseUrl` — Project URL
   - `supabaseAnonKey` — `anon` `public` key
   - `adminPin` — PIN for Coach analytics (default in example: `cos2026`)
5. Refresh the site. The footer should say **Supabase connected**.

`config.js` is gitignored so keys are not committed.

## Smart scoring (free open-source AI)

Answers are checked in two layers:

1. **Rules** — partial text, typos, aliases, “any two of…” lists (instant). Figures must match exactly; names must be the right person (small typos OK).
2. **Semantic model** — if rules say no, a free browser model checks whether the meaning matches (skipped for pure numbers / wrong names).

| | |
|--|--|
| **Model** | [`all-MiniLM-L6-v2`](https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2) (ONNX: `Xenova/all-MiniLM-L6-v2`) |
| **Library** | [Transformers.js](https://huggingface.co/docs/transformers.js) (`@huggingface/transformers`) |
| **Cost** | Free — runs **in the visitor’s browser**, no API key |
| **License** | Apache-2.0 |
| **Size** | ~23 MB first download (then cached) |

Implementation: [`semanticScorer.js`](semanticScorer.js). If the model fails to load, scoring still works with rules only.

## Official mock

- Draws **92** questions from the full bank (~235).
- Everyone who starts in the same **10‑minute window** on the same attempt number gets the **same set** (fair comparison).
- **Restart / try again** bumps the attempt → a new shared set for that attempt tier.
- Mid-quiz progress is cached on the device (Continue / Restart / Cancel).

## Modes

| Mode | Session kind stored | Identity |
|------|---------------------|----------|
| **Team selection** | `selection` | Name + department required |
| **Official mock** | `official_mock` | Name + department required |
| **Study mode** | `practice` | Optional; flashcards or typed answers |

Each graded answer is logged (`question_id`, topic, correctness, time, moderator override). On finish, the app upserts the participant and inserts the session + answers.

## Coach analytics

Home → **Coach analytics** → enter `adminPin`.

Shows:

- Participant rankings (best / average %, run counts by kind)
- Topic weakness (% correct by topic)
- Hardest questions (lowest accuracy)

Filter by session kind. The PIN is a soft UX gate only — RLS allows anon read/write for this internal team tool. Do not store sensitive personal data.

## Deploy notes

### Vercel
`config.js` is **gitignored**, so Vercel will not get your local keys unless you add env vars.

1. In the Vercel project → **Settings → Environment Variables**, add:

| Name | Value |
|------|--------|
| `supabase_url` | `https://YOUR_PROJECT_REF.supabase.co` |
| `supabase_anon_key` | your anon JWT (`eyJ...`) |
| `admin_pin` | coach PIN (e.g. `cos2026`) |

2. Redeploy (or push). The build runs `npm run build`, which writes `config.js` from those vars.

Locally you still use a hand-written `config.js` (from `config.example.js`).

### General
- Static host (GitHub Pages, Netlify, etc.) works the same idea: inject or upload `config.js` at deploy time.
- Question bank stays in [`data.js`](data.js); the database stores attempts, not the bank.

## Security note

Anon insert/select on `participants`, `sessions`, and `answers` is intentional for a shared COS mock. Anyone with the site + anon key can read trial data. For a public internet audience, add Auth and tighten RLS later.
