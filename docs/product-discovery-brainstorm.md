# D.A.R.E. Ministries — Product Discovery Brainstorm

**Date:** March 24, 2026
**Site:** https://dare-ministries.netlify.app

---

## 🎯 Opportunity Summary

**Product:** dare-ministries.netlify.app — a static website for a faith-based disaster recovery volunteer organization.

**Objective:** Evolve from a first-pass static brochure site into a professional, functional web presence that converts visitors into volunteers and donors, and builds long-term credibility.

**Target Segments:**

- Prospective volunteers (individuals, church groups)
- Donors (individuals, congregations)
- Disaster survivors seeking help
- Partner organizations (churches, Habitat for Humanity, etc.)

**Desired Outcomes:**

- More volunteer signups that are actually captured and acted on
- Donations flowing through a real payment channel
- Trust and credibility established for a growing multi-church coalition
- Reduced admin burden on Leonard Scarboro

---

## 💡 Ideation: Three Perspectives

### 🧭 Product Manager — Business Value & Strategic Alignment

| #   | Idea                                     | Description                                                                                                                                                                                                                                                            |
| --- | ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PM1 | **Volunteer Pipeline (Form → Database)** | Replace the dead-end form with a working pipeline backed by Supabase (PostgreSQL). Form submissions are stored in a `volunteers` table; Leonard manages the roster via Supabase Studio. Scales to support deployments, partner orgs, and impact tracking in one place. |
| PM2 | **Real-Time Impact Counter**             | A stats bar (or section) showing live/updated numbers: homes repaired, volunteer hours served, deployments completed, families helped. Builds donor confidence and validates the mission at a glance.                                                                  |
| PM3 | **Deployment Calendar**                  | A public-facing calendar of upcoming deployments so volunteers can browse and sign up for specific dates — turning vague interest into concrete commitment.                                                                                                            |
| PM4 | **Monthly Prayer/Update Email**          | A simple newsletter signup (Mailchimp free tier) that keeps donors and prayer supporters engaged between deployments — critical for long-term donor retention.                                                                                                         |
| PM5 | **Partner Church Registration**          | A lightweight form for churches/groups to register as DARE partners, formalizing the 30+ partner org relationships and creating a pipeline for new organizational volunteers.                                                                                          |

---

### 🎨 Product Designer — UX, Usability & Delight

| #   | Idea                                            | Description                                                                                                                                                                                                       |
| --- | ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | **Gallery Redesign: Before/After Storytelling** | Replace the static image grid with before/after sliders or story cards — showing a damaged home alongside the finished repair. Nothing builds emotional trust faster than visible transformation.                 |
| D2  | **"How It Works" Volunteer Journey**            | A simple 3–4 step visual guide (Sign Up → Get Matched → Deploy → Make a Difference) that answers "what actually happens after I fill out the form?" — reducing friction for hesitant first-timers.                |
| D3  | **Survivor/Volunteer Testimonials**             | A quotes section featuring real volunteers or homeowners. Faces, names, and 2–3 sentence stories. Social proof is the #1 trust signal for nonprofits.                                                             |
| D4  | **Streamlined Donation Experience**             | Even linking to an external platform (Givelify, PayPal, Venmo), the donation flow should feel frictionless and trustworthy — clear amounts, a short "where your money goes" statement, and a receipt expectation. |
| D5  | **Mobile-First Navigation Audit**               | The nav has 8 items, which is cramped on mobile. Simplifying or reorganizing (e.g., grouping "Get Involved" + "Donate" under one CTA) would improve conversion on phones.                                         |

---

### ⚙️ Software Engineer — Technical Possibilities & Scalable Solutions

| #   | Idea                                          | Description                                                                                                                                                                                                                                                                             |
| --- | --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| E1  | **Supabase PostgreSQL Backend** ✅ _Selected_ | A managed PostgreSQL database (Supabase free tier) replaces the Netlify Forms → Zapier → Airtable chain. Single source of truth for volunteers, contacts, deployments, and impact stats. Row Level Security locks down all tables by default. Leonard manages data via Supabase Studio. |
| E2  | **Givelify or PayPal.me Donation Link**       | DARE's denomination (UMC) has Givelify built in — it may already exist. Otherwise, a PayPal.me or Venmo link is instant to set up, costs nothing, and gets the Donate button working today.                                                                                             |
| E3  | **Sveltia CMS Editorial Workflow**            | Fully enable the CMS so Leonard (or a volunteer admin) can post deployment updates, add/remove projects, and upload gallery photos without touching code. The config is already 80% there.                                                                                              |
| E4  | **Cloudinary Free Tier for Gallery**          | Use Cloudinary's free image CDN for uploads and auto-cropping. Enables a much richer gallery with consistent thumbnails, lazy loading, and lightbox without bloating the repo.                                                                                                          |
| E5  | **Social Media Feed Embed**                   | If DARE has a Facebook or Instagram presence, embed a live feed widget (Elfsight free tier or similar) so the site stays fresh without manual CMS updates.                                                                                                                              |

---

## 🏆 Top 5 Prioritized Ideas

### 1. 🥇 Volunteer Form → Supabase Database _(E1 + PM1)_ ✅ _In Progress_

**"Make the signup form actually work"**

> Connect the volunteer form directly to a Supabase PostgreSQL database. Submissions land in a `volunteers` table; Leonard manages the roster via Supabase Studio (no technical knowledge needed).

**Why #1:** The form is the primary conversion goal of the site. Right now it collects nothing. Supabase replaces the fragile Netlify Forms → Zapier → Airtable chain with a single, scalable backend that also powers the impact counter, contact form, and future features.

**Decision:** Supabase chosen over Netlify Forms + Zapier + Airtable — eliminates three free-tier limits, zero server maintenance, and positions DARE for future growth (deployments calendar, partner portal, etc.).

**Key assumptions to validate:**

- Leonard is comfortable managing data in Supabase Studio
- Supabase free tier (500MB, unlimited API requests) is sufficient for current volume
- Row Level Security policies adequately protect volunteer data

---

### 2. 🥈 Donation Platform Integration _(E2 + D4)_

**"Get the Donate button pointing somewhere real"**

> Link the Donate button to Givelify (DARE's UMC connection may already have an account), PayPal, or a Venmo link — whichever is simplest to set up immediately.

**Why #2:** Money left on the table every day this goes live with a dead button. The fix could take 30 minutes.

**Key assumptions to validate:**

- DARE/Roswell UMC has or can create a Givelify account
- Leonard is comfortable receiving funds digitally
- A simple external link is acceptable (vs. embedded widget)

---

### 3. 🥉 Before/After Gallery Redesign _(D1)_

**"Show the transformation, not just the work"**

> Restructure the gallery around before/after pairs with brief captions ("Augusta, GA — June 2024 — roof destroyed by storm → fully repaired in 4 days"). Emotional storytelling drives both volunteering and donations.

**Why #3:** The current gallery is acknowledged as weak. Visual proof of impact is the most powerful trust signal for any nonprofit. High designer value, moderate engineering effort.

**Key assumptions to validate:**

- Before/after photo pairs exist or can be collected from volunteers
- Leonard can source captions/context for existing photos
- A lightbox or slider implementation fits the static site architecture

---

### 4. 4️⃣ Impact Stats Section _(PM2)_

**"Show the scale of what DARE has done"**

> Add a credibility-building section with real numbers: homes repaired, volunteer hours, deployments completed, partner organizations, years of service. Update annually.

**Why #4:** Donors and first-time volunteers need to see that this is a serious, proven organization — not just a church side project. Numbers do that instantly.

**Key assumptions to validate:**

- Leonard has access to historical deployment/impact data
- Numbers can be maintained in the Supabase `impact_stats` table and updated via Supabase Studio
- Approximate figures are acceptable where exact data isn't available

---

### 5. 5️⃣ "How It Works" Volunteer Journey _(D2)_

**"Answer the #1 question: what happens after I sign up?"**

> A simple 4-step visual flow (Sign Up → We'll Contact You → Join a Team → Deploy) that removes anxiety for first-time volunteers who don't know what they're committing to.

**Why #5:** Many volunteer organizations lose signups not because people aren't interested, but because they don't know what to expect. This is low engineering effort and high conversion impact.

**Key assumptions to validate:**

- The actual volunteer onboarding process is well-defined enough to document
- Leonard's team has capacity to follow up with every signup
- A simple icon + step layout fits the existing design system

---

## 📋 Volunteer Org Best Practices Audit

| Practice                      | Status          | Notes                                  |
| ----------------------------- | --------------- | -------------------------------------- |
| Clear mission statement       | ✅ Strong       | Hero + About sections are well-written |
| Easy volunteer signup         | ⚠️ Partial      | Form exists, no backend                |
| Transparent impact / stats    | ❌ Missing      | No numbers or outcomes shown           |
| Visual storytelling / gallery | ⚠️ Weak         | Needs before/after redesign            |
| Donation channel              | ❌ Broken       | Button exists, no destination          |
| Regular updates / news        | ❌ Missing      | Blog section exists but no posts       |
| Testimonials / social proof   | ❌ Missing      | No volunteer or survivor voices        |
| Contact info prominent        | ✅ Good         | Footer + Contact section               |
| Partner recognition           | ✅ Good         | Footer lists partners                  |
| Social media links            | ❌ Missing      | No Facebook/Instagram links            |
| Mobile experience             | ⚠️ Needs review | Nav has 8 items, may be cramped        |
| SEO basics                    | ⚠️ Partial      | Meta description set, no OG tags       |

---

## 🏛️ Architecture Decisions

| Decision                        | Options Considered                                                    | Choice       | Rationale                                                                                                                                                                           |
| ------------------------------- | --------------------------------------------------------------------- | ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Form backend & data storage** | Netlify Forms + Zapier + Airtable / Self-hosted PostgreSQL / Supabase | **Supabase** | Managed PostgreSQL with zero server maintenance, generous free tier, built-in admin UI (Supabase Studio), Row Level Security, and Realtime — replaces three separate tools with one |
| **Self-hosted vs. managed DB**  | Self-hosted PostgreSQL (DigitalOcean/AWS) / Supabase                  | **Supabase** | No developer needed for maintenance; Leonard can manage data without technical knowledge; scales gracefully; open source and self-hostable if needs change                          |

---

## 🗺️ Recommended Sequencing

```
Phase 1 — Make it functional (this week)
  ├── ✅ Supabase project created (PostgreSQL backend)
  ├── Volunteer form → Supabase (volunteers table)
  ├── Contact form → Supabase (contacts table)
  └── Donation button → Givelify/PayPal

Phase 2 — Build trust (next 2–4 weeks)
  ├── Live impact counter (impact_stats table via Supabase Realtime)
  ├── Before/after gallery redesign
  └── "How It Works" volunteer journey

Phase 3 — Polish & grow (ongoing)
  ├── Deployment calendar (deployments table)
  ├── Testimonials section
  ├── Newsletter signup
  ├── Social media links/feed
  └── SEO & Open Graph tags

Phase 4 — Roster management portal (see full spec below)
  ├── Supabase Auth — secure login for Leonard (and future admins)
  ├── Protected /roster page — not accessible without login
  ├── Volunteer roster table — sortable, filterable, searchable
  ├── Status tracking — mark volunteers as New / Contacted / Active / Inactive
  ├── Contact form inbox — view and action contact submissions
  └── Mobile-friendly — Leonard may access from phone in the field

Phase 5 — Hosting migration (when ready)
  ├── Gather hosting & domain intel from Roswell UMC IT (see questions below)
  ├── Decide on deployment method (FTP upload vs. GitHub Actions pipeline)
  ├── Configure Supabase credentials in new environment
  ├── Set up SSL certificate on new host
  ├── DNS cutover (low-TTL window)
  └── Decommission Netlify site
```

---

## 🏠 Phase 4 — Hosting Migration to Roswell UMC

### Overview

The site currently lives on **Netlify** (dare-ministries.netlify.app) which is a solid free-tier solution for development and early launch. Eventually DARE may want to migrate to Roswell UMC's existing hosting infrastructure for organizational consolidation, cost management, or domain alignment (e.g. `dare.ruwmc.org`).

The good news: because this is a **static site** (just HTML, CSS, and JS files), the migration is far simpler than moving a database-driven site like WordPress. The Supabase database stays exactly where it is — only the file hosting changes.

---

### ❓ Questions for Roswell UMC Domain & Hosting Owners

#### Domain Questions

1. **Who is the domain registrar?** (e.g., GoDaddy, Namecheap, Google Domains, Network Solutions) — this is where DNS records are managed
2. **Who has login access to the domain registrar account?** Name and contact info of the person who can make DNS changes
3. **What domain should DARE use?** Options to discuss:
   - A standalone domain: `dare-ministries.org` or `whofixedtheroof.org`
   - A subdomain of RUMC: `dare.ruwmc.org` or `recovery.ruwmc.org`
   - Keep `dare-ministries.netlify.app` permanently (free, no migration needed)
4. **Is the intended domain already registered?** If not, who will register it and pay the annual fee (~$12–15/year)?
5. **What is the current DNS TTL setting?** (Time-to-live — lower is better during cutover to minimize downtime)

#### Hosting Questions

6. **Who hosts the Roswell UMC website?** Company name and any account contacts
7. **What type of hosting is it?** e.g.:
   - Shared hosting with cPanel (GoDaddy, Bluehost, SiteGround)
   - Managed WordPress (WP Engine, Flywheel)
   - Church management platform (Squarespace, Wix, Ministry Brands)
   - VPS or dedicated server
8. **Is there FTP or SFTP access to upload files?** Credentials or the ability to create them?
9. **Can a subdirectory or subdomain be created for DARE?** e.g., a `/dare/` folder or `dare.ruwmc.org`
10. **How much disk space is available?** (The DARE site is under 5MB — rarely a concern)
11. **Does the hosting support SSL/HTTPS?** Is there a free Let's Encrypt certificate, or is a paid cert required?

#### Technical & Process Questions

12. **Is there a staging environment?** Somewhere to test before going live?
13. **Who is the IT contact at RUMC?** Name, email, and phone for the person who manages the website
14. **What is the approval process for DNS changes?** Some churches require committee or staff approval
15. **Are there any content policies or restrictions?** Brand guidelines, approval workflows for new pages, etc.
16. **Does RUMC use a CDN?** (e.g., Cloudflare) If so, this simplifies the migration significantly
17. **Is there an existing deployment pipeline?** Or is the site updated manually via FTP?

---

### ⚠️ Key Migration Considerations

| Concern                    | Notes                                                                                                                                                                                |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Supabase stays put**     | The database is hosted by Supabase independently — it doesn't move. Only the HTML/CSS/JS files migrate.                                                                              |
| **Credentials / env vars** | The Supabase anon key is a public key by design. If the new host has no build pipeline, we bake it directly into the JS — no security risk.                                          |
| **Build pipeline**         | Netlify currently runs `npx @11ty/eleventy` on every GitHub push. If RUMC uses simple FTP hosting, we switch to a GitHub Actions workflow that builds and FTP-deploys automatically. |
| **SSL is non-negotiable**  | The Supabase JS client requires HTTPS. The site will not function on plain HTTP. Confirm SSL is available before migrating.                                                          |
| **Zero-downtime cutover**  | Lower DNS TTL to 5 minutes 24 hours before cutover. Upload files to new host. Switch DNS. Keep Netlify live for 24–48 hours as a fallback.                                           |
| **No rush**                | There is no cost to keeping Netlify as-is indefinitely. Migration is only worth doing if RUMC hosting is preferred for organizational reasons.                                       |

---

## 👤 Phase 4 — Roster Management Portal

### Why This Matters

Currently, Leonard views volunteer signups by logging into **Supabase Studio** — a raw database admin tool that requires navigating a technical interface not designed for everyday use. This is a workable interim solution but is not sustainable long-term.

A purpose-built, password-protected roster page gives Leonard (and any future DARE admins) a clean, simple interface to manage volunteers, track follow-ups, and view contact form submissions — without any technical knowledge required.

> **Note:** This replaces the "use Supabase Studio for everything" interim approach once built. Supabase Studio remains available as a power-user fallback.

---

### 🔐 Security Model

Authentication will be handled by **Supabase Auth** — the same platform already in use for the database. This avoids introducing a separate auth system and keeps everything in one place.

| Requirement            | Implementation                                                                               |
| ---------------------- | -------------------------------------------------------------------------------------------- |
| **Login**              | Email + strong password via Supabase Auth                                                    |
| **Session management** | JWT tokens with automatic expiry                                                             |
| **Route protection**   | `/roster` page checks auth state on load; redirects to login if unauthenticated              |
| **RLS enforcement**    | Supabase Row Level Security ensures only authenticated users can read volunteer/contact data |
| **Password strength**  | Minimum 12 characters enforced at account creation                                           |
| **Who can access**     | Leonard Scarboro + any future admins explicitly added in Supabase Auth                       |
| **Public anon key**    | Cannot access protected tables — RLS blocks all reads from unauthenticated requests          |

---

### 📋 Roster Page Feature Spec

#### Volunteer Roster Tab

- Table view of all volunteer submissions with columns:
  - Name, Email, Phone, Organization, Skills, Availability, Date Signed Up, Status
- **Status field** — track each volunteer through a simple workflow:
  - `New` → `Contacted` → `Active` → `Inactive`
- Sort by any column (date, name, status)
- Filter by availability or status
- Search by name, email, or organization
- Click a row to view full submission details
- Export to CSV for use in email campaigns or spreadsheets

#### Contact Inbox Tab

- Table view of all contact form submissions
- Columns: Name, Email, Subject, Message preview, Date, Read/Unread status
- Mark messages as read
- Click to view full message

#### Impact Stats Tab

- Simple form to update the six impact counter numbers
- Replaces the need to use Supabase Studio for this task entirely
- "Last updated" timestamp shown after save

---

### 🏗️ Technical Approach

```
/roster              → protected — redirects to /login if not authenticated
/roster/login        → Supabase Auth email/password login form
/roster/volunteers   → volunteer roster table
/roster/contacts     → contact form inbox
/roster/stats        → impact stats editor
```

- Built as additional static pages in the Eleventy site
- Supabase Auth JS client handles login/session on the client side
- RLS policies updated to allow authenticated users (not just anon) to SELECT from volunteers and contacts tables
- No server-side code required — fully client-side auth via Supabase JS SDK

---

### ❓ Questions to Resolve Before Building

1. **Who needs access besides Leonard?** Any co-directors, volunteers, or church staff who should be able to view the roster?
2. **Should admins be able to delete volunteer records?** Or only update status?
3. **Email notifications?** Should Leonard receive an email when a new volunteer signs up? (Supabase has built-in webhooks for this)
4. **Data retention policy?** How long should volunteer records be kept? Any privacy considerations given the church context?
5. **Mobile priority?** Will Leonard primarily access this from a phone, tablet, or desktop?
