# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Dev Commands

- **Dev server:** `npm run dev` (runs Eleventy with live reload)
- **Build:** `npm run build` (generates static site to `_site/`)
- **Hosting:** Netlify (auto-deploys from `master` branch)

## Architecture

This is an Eleventy (v3) static site for D.A.R.E. Ministries, a faith-based disaster recovery organization.

- **Templating:** Nunjucks (.njk) with shared partials in `src/_includes/` (`head.njk`, `navbar.njk`, `footer.njk`, `icons.njk`) used by the public pages
- **Content data:** JSON files in `src/_data/` (site.json, projects.json, gallery.json) — edited directly in the repo
- **Database:** Netlify DB (managed Postgres). Schema migrations live in `netlify/database/migrations/` and are applied automatically on deploy. Tables: `volunteers`, `contacts`, `impact_stats`, `field_notes`, `field_note_photos`.
- **API:** Netlify Functions in `netlify/functions/` (`/api/volunteer`, `/api/contact`, `/api/impact-stats`) using `@netlify/database`. The front end (`src/js/forms.js`) calls these with plain `fetch` — no database credentials in the browser. Optional email notifications on form submissions via Resend (`RESEND_API_KEY`, `NOTIFY_EMAIL` env vars).
- **Admin console:** `/roster` (`src/roster.njk`, `src/js/roster.js`, `src/css/roster.css`) — volunteer roster, contact inbox, impact stats editor, and field notes editor. Auth is a shared admin password (`ADMIN_PASSWORD` env var) checked by `/api/admin/login`, which issues an HMAC-signed HttpOnly session cookie (`SESSION_SECRET` env var, 7-day expiry). All `/api/admin/*` functions verify the cookie server-side.
- **From the Field:** trip recap entries authored in the Field Notes tab of `/roster`, stored in `field_notes` (markdown body, draft/published status, server-generated slug frozen once published). Photos upload to the Netlify Blobs store `field-photos` (key `<note_id>/<photo_id>`) and are served by `netlify/functions/field-photo.mjs` at `/images/field/:noteId/:photoId` with immutable caching — never create `src/images/field/`, the passthrough copy would shadow that route. The public pages are static: `src/_data/fieldNotes.js` fetches **published** entries at build time — directly from Postgres when `NETLIFY_DATABASE_URL` is present, else (Netlify builds: the platform injects that var into the functions runtime only, never into builds) via the site's own `/api/field-notes-feed` function (`netlify/functions/field-notes-feed.mjs`, published-only, no-store); feed 404 = bootstrap → empty build, any other error throws so a bad build never replaces a good one. Publish/unpublish/delete trigger a rebuild via the `BUILD_HOOK_URL` env var (all scopes — per-scope env vars need a paid Netlify plan; safe because no build-time code ever calls the hook, only the admin functions do, so a build loop can't occur). Markdown renders at build via the `markdown` filter (markdown-it, `html: false` — authors must not be able to inject HTML).
- **Static assets:** `src/css/`, `src/js/`, `src/images/` (passed through by Eleventy)
- **Custom filters:** Defined in `.eleventy.js` — date (Luxon), truncate, striptags, capitalize, markdown
- **Pages:** `src/index.njk` is the public homepage; `src/field-notes.njk` (landing) and `src/field-note.njk` (one static page per published entry, via pagination) make up `/field-notes/`; `src/roster.njk` is the admin console at `/roster`

## Key Conventions

- Propose a plan before implementing changes so the approach can be reviewed first
- CSS uses custom properties defined at the top of `src/css/style.css` (colors, fonts, spacing)
- JavaScript is vanilla ES6 — no frameworks or bundlers
- Node version 20 is required (set in `netlify.toml`)

<!-- gitnexus:start -->
# GitNexus — Code Intelligence

This project is indexed by GitNexus as **dare-ministries** (337 symbols, 647 relationships, 20 execution flows). Use the GitNexus MCP tools to understand code, assess impact, and navigate safely.

> Index stale? Run `node .gitnexus/run.cjs analyze` from the project root — it auto-selects an available runner. No `.gitnexus/run.cjs` yet? `npx gitnexus analyze` (npm 11 crash → `npm i -g gitnexus`; #1939).

## Always Do

- **MUST run impact analysis before editing any symbol.** Before modifying a function, class, or method, run `impact({target: "symbolName", direction: "upstream"})` and report the blast radius (direct callers, affected processes, risk level) to the user.
- **MUST run `detect_changes()` before committing** to verify your changes only affect expected symbols and execution flows. For regression review, compare against the default branch: `detect_changes({scope: "compare", base_ref: "master"})`.
- **MUST warn the user** if impact analysis returns HIGH or CRITICAL risk before proceeding with edits.
- When exploring unfamiliar code, use `query({search_query: "concept"})` to find execution flows instead of grepping. It returns process-grouped results ranked by relevance.
- When you need full context on a specific symbol — callers, callees, which execution flows it participates in — use `context({name: "symbolName"})`.
- For security review, `explain({target: "fileOrSymbol"})` lists taint findings (source→sink flows; needs `analyze --pdg`).

## Never Do

- NEVER edit a function, class, or method without first running `impact` on it.
- NEVER ignore HIGH or CRITICAL risk warnings from impact analysis.
- NEVER rename symbols with find-and-replace — use `rename` which understands the call graph.
- NEVER commit changes without running `detect_changes()` to check affected scope.

## Resources

| Resource | Use for |
|----------|---------|
| `gitnexus://repo/dare-ministries/context` | Codebase overview, check index freshness |
| `gitnexus://repo/dare-ministries/clusters` | All functional areas |
| `gitnexus://repo/dare-ministries/processes` | All execution flows |
| `gitnexus://repo/dare-ministries/process/{name}` | Step-by-step execution trace |

## CLI

| Task | Read this skill file |
|------|---------------------|
| Understand architecture / "How does X work?" | `.claude/skills/gitnexus/gitnexus-exploring/SKILL.md` |
| Blast radius / "What breaks if I change X?" | `.claude/skills/gitnexus/gitnexus-impact-analysis/SKILL.md` |
| Trace bugs / "Why is X failing?" | `.claude/skills/gitnexus/gitnexus-debugging/SKILL.md` |
| Rename / extract / split / refactor | `.claude/skills/gitnexus/gitnexus-refactoring/SKILL.md` |
| Tools, resources, schema reference | `.claude/skills/gitnexus/gitnexus-guide/SKILL.md` |
| Index, status, clean, wiki CLI commands | `.claude/skills/gitnexus/gitnexus-cli/SKILL.md` |

<!-- gitnexus:end -->
