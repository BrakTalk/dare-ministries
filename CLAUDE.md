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
- **From the Field:** trip recap entries authored in the Field Notes tab of `/roster`, stored in `field_notes` (markdown body, draft/published status, server-generated slug frozen once published). Photos upload to the Netlify Blobs store `field-photos` (key `<note_id>/<photo_id>`) and are served by `netlify/functions/field-photo.mjs` at `/images/field/:noteId/:photoId` with immutable caching — never create `src/images/field/`, the passthrough copy would shadow that route. The public pages are static: `src/_data/fieldNotes.js` fetches **published** entries at build time (returns `[]` without `NETLIFY_DATABASE_URL`; throws on DB errors so a bad build never replaces a good one), and publish/unpublish/delete trigger a rebuild via the `BUILD_HOOK_URL` env var (Functions scope only). Markdown renders at build via the `markdown` filter (markdown-it, `html: false` — authors must not be able to inject HTML).
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

This project is indexed by GitNexus as **dare-ministries** (169 symbols, 300 relationships, 12 execution flows). Use the GitNexus MCP tools to understand code, assess impact, and navigate safely.

> If any GitNexus tool warns the index is stale, run `npx gitnexus analyze` in terminal first.

## Always Do

- **MUST run impact analysis before editing any symbol.** Before modifying a function, class, or method, run `gitnexus_impact({target: "symbolName", direction: "upstream"})` and report the blast radius (direct callers, affected processes, risk level) to the user.
- **MUST run `gitnexus_detect_changes()` before committing** to verify your changes only affect expected symbols and execution flows.
- **MUST warn the user** if impact analysis returns HIGH or CRITICAL risk before proceeding with edits.
- When exploring unfamiliar code, use `gitnexus_query({query: "concept"})` to find execution flows instead of grepping. It returns process-grouped results ranked by relevance.
- When you need full context on a specific symbol — callers, callees, which execution flows it participates in — use `gitnexus_context({name: "symbolName"})`.

## When Debugging

1. `gitnexus_query({query: "<error or symptom>"})` — find execution flows related to the issue
2. `gitnexus_context({name: "<suspect function>"})` — see all callers, callees, and process participation
3. `READ gitnexus://repo/dare-ministries/process/{processName}` — trace the full execution flow step by step
4. For regressions: `gitnexus_detect_changes({scope: "compare", base_ref: "main"})` — see what your branch changed

## When Refactoring

- **Renaming**: MUST use `gitnexus_rename({symbol_name: "old", new_name: "new", dry_run: true})` first. Review the preview — graph edits are safe, text_search edits need manual review. Then run with `dry_run: false`.
- **Extracting/Splitting**: MUST run `gitnexus_context({name: "target"})` to see all incoming/outgoing refs, then `gitnexus_impact({target: "target", direction: "upstream"})` to find all external callers before moving code.
- After any refactor: run `gitnexus_detect_changes({scope: "all"})` to verify only expected files changed.

## Never Do

- NEVER edit a function, class, or method without first running `gitnexus_impact` on it.
- NEVER ignore HIGH or CRITICAL risk warnings from impact analysis.
- NEVER rename symbols with find-and-replace — use `gitnexus_rename` which understands the call graph.
- NEVER commit changes without running `gitnexus_detect_changes()` to check affected scope.

## Tools Quick Reference

| Tool | When to use | Command |
|------|-------------|---------|
| `query` | Find code by concept | `gitnexus_query({query: "auth validation"})` |
| `context` | 360-degree view of one symbol | `gitnexus_context({name: "validateUser"})` |
| `impact` | Blast radius before editing | `gitnexus_impact({target: "X", direction: "upstream"})` |
| `detect_changes` | Pre-commit scope check | `gitnexus_detect_changes({scope: "staged"})` |
| `rename` | Safe multi-file rename | `gitnexus_rename({symbol_name: "old", new_name: "new", dry_run: true})` |
| `cypher` | Custom graph queries | `gitnexus_cypher({query: "MATCH ..."})` |

## Impact Risk Levels

| Depth | Meaning | Action |
|-------|---------|--------|
| d=1 | WILL BREAK — direct callers/importers | MUST update these |
| d=2 | LIKELY AFFECTED — indirect deps | Should test |
| d=3 | MAY NEED TESTING — transitive | Test if critical path |

## Resources

| Resource | Use for |
|----------|---------|
| `gitnexus://repo/dare-ministries/context` | Codebase overview, check index freshness |
| `gitnexus://repo/dare-ministries/clusters` | All functional areas |
| `gitnexus://repo/dare-ministries/processes` | All execution flows |
| `gitnexus://repo/dare-ministries/process/{name}` | Step-by-step execution trace |

## Self-Check Before Finishing

Before completing any code modification task, verify:
1. `gitnexus_impact` was run for all modified symbols
2. No HIGH/CRITICAL risk warnings were ignored
3. `gitnexus_detect_changes()` confirms changes match expected scope
4. All d=1 (WILL BREAK) dependents were updated

## Keeping the Index Fresh

After committing code changes, the GitNexus index becomes stale. Re-run analyze to update it:

```bash
npx gitnexus analyze
```

If the index previously included embeddings, preserve them by adding `--embeddings`:

```bash
npx gitnexus analyze --embeddings
```

To check whether embeddings exist, inspect `.gitnexus/meta.json` — the `stats.embeddings` field shows the count (0 means no embeddings). **Running analyze without `--embeddings` will delete any previously generated embeddings.**

> Claude Code users: A PostToolUse hook handles this automatically after `git commit` and `git merge`.

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
