# How to Update the Impact Stats on the Website

**Prepared for:** Leonard Scarboro, Director — D.A.R.E. Ministries
**What this controls:** The "Our Impact" section on dare-ministries.netlify.app

---

## What You're Updating

The website displays a live counter showing D.A.R.E.'s impact — numbers like homes repaired, families helped, and years of service. These numbers are stored in a database and displayed automatically on the site. You can update them anytime without touching any code.

---

## Step-by-Step Instructions

### Step 1 — Log into Supabase

1. Open your browser and go to **[supabase.com](https://supabase.com)**
2. Click **"Sign In"** in the top right
3. Log in with your Supabase account credentials

> **Need your login?** Contact Mason Foley — he set up the account and can share the credentials.

---

### Step 2 — Open the DARE Ministries project

Once logged in, you'll see a dashboard. Click on the project named **"dare-ministries"**.

---

### Step 3 — Open the Impact Stats table

1. In the left sidebar, click **"Table Editor"** (it looks like a grid icon)
2. You'll see a list of tables — click on **"impact_stats"**
3. You'll see a single row of data — this is what the website reads

---

### Step 4 — Edit the numbers

1. **Click anywhere on the row** to select it
2. Click the **pencil/edit icon** that appears, or simply **double-click a cell** to edit it
3. Update the values for each field:

| Field                   | What to enter                                      |
| ----------------------- | -------------------------------------------------- |
| `homes_repaired`        | Total number of homes DARE has repaired since 2004 |
| `families_helped`       | Total number of families assisted                  |
| `deployments_completed` | Total number of deployment trips taken             |
| `volunteer_hours`       | Estimated total volunteer hours served             |
| `partner_organizations` | Number of partner churches and organizations       |
| `years_of_service`      | Years DARE has been active (currently 21)          |

4. Click **"Save"** when done

> **Tip:** If you're not sure of an exact number, a round estimate is fine — for example, entering `150` for homes repaired is perfectly acceptable. The website will display it as "150+".

---

### Step 5 — Verify on the website

1. Go to **[dare-ministries.netlify.app](https://dare-ministries.netlify.app)**
2. Scroll down to the **"Our Impact"** section
3. Your new numbers should appear within a few seconds (the page may need a refresh)

> **Note:** The site shows a "Last updated" date below the stats — this updates automatically when you save.

---

## Resetting Test Data

The website currently shows **placeholder/test numbers**. Before DARE goes fully public, please replace them with real figures. To reset all stats to zero and start fresh:

1. Follow Steps 1–3 above to open the `impact_stats` table
2. Double-click each number field and change it to `0`
3. Save the row
4. Then re-enter the real numbers using Step 4

---

## Questions?

Contact Mason Foley for any technical help:

- The database is at **supabase.com** — log in any time to view volunteer signups and update stats
- Numbers update on the live website immediately — no waiting, no developer needed

---

_The "Our Impact" section was built as part of the D.A.R.E. Ministries website improvement initiative, March 2026._
