# COS Inter-Departmental Quiz Drill

Practice and team-selection site for the College of Science (KNUST) quiz. Scores and per-answer analytics sync through **Supabase** when configured; otherwise they stay on the device (`localStorage`).

## Database setup (clean install)

1. Open Supabase → **SQL Editor**.
2. Paste and run **[`supabase/schema.sql`](supabase/schema.sql)** once.
   - This **drops** old quiz tables and recreates everything the app needs.
3. **Authentication → Providers → Email**
   - Email: **ON**
   - **Confirm email: OFF** (so signup works immediately — no inbox required)

## Accounts (email + password)

On the site: **Sign in → Create account** (name, department, email, password).

Logged-in users skip the guest name form; practice / selection / official mocks sync to their account. **My progress** shows sessions and topic accuracy. Coach analytics still sees everyone.

Guests can still enter name + department without an account.

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
