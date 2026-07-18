# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Dev Commands

- **Dev server:** `npm run dev` (runs Eleventy with live reload)
- **Build:** `npm run build` (generates static site to `_site/`)
- **Hosting:** Netlify (auto-deploys from `master` branch)

## Architecture

This is an Eleventy (v3) static site for D.A.R.E. Ministries, a faith-based disaster recovery organization.

- **Templating:** Nunjucks (.njk) with includes in `src/_includes/`
- **Content data:** JSON files in `src/_data/` (site.json, projects.json, gallery.json) — these are the primary content source, edited via Sveltia CMS or directly
- **Database:** Netlify DB (managed Postgres). Schema migrations live in `netlify/database/migrations/` and are applied automatically on deploy. Tables: `volunteers`, `contacts`, `impact_stats`.
- **API:** Netlify Functions in `netlify/functions/` (`/api/volunteer`, `/api/contact`, `/api/impact-stats`) using `@netlify/database`. The front end (`src/js/forms.js`) calls these with plain `fetch` — no database credentials in the browser. Optional email notifications on form submissions via Resend (`RESEND_API_KEY`, `NOTIFY_EMAIL` env vars).
- **Admin console:** `/roster` (`src/roster.njk`, `src/js/roster.js`, `src/css/roster.css`) — volunteer roster, contact inbox, and impact stats editor. Auth is a shared admin password (`ADMIN_PASSWORD` env var) checked by `/api/admin/login`, which issues an HMAC-signed HttpOnly session cookie (`SESSION_SECRET` env var, 7-day expiry). All `/api/admin/*` functions verify the cookie server-side.
- **CMS:** Sveltia CMS configured at `src/admin/config.yml` with GitHub backend
- **Static assets:** `src/css/`, `src/js/`, `src/images/` (passed through by Eleventy)
- **Custom filters:** Defined in `.eleventy.js` — date (Luxon), truncate, striptags, capitalize
- **Pages:** `src/index.njk` is the public single-page site; `src/roster.njk` is the admin console at `/roster`

## Key Conventions

- Propose a plan before implementing changes so the approach can be reviewed first
- CSS uses custom properties defined at the top of `src/css/style.css` (colors, fonts, spacing)
- JavaScript is vanilla ES6 — no frameworks or bundlers
- The CMS config (`src/admin/config.yml`) must stay in sync with the JSON data file structures in `src/_data/`
- Node version 20 is required (set in `netlify.toml`)
