# SOP: MuleSoft Integration Dashboard — Usage Guide

**Document Type:** Standard Operating Procedure  
**Audience:** MuleSoft Platform Operators, Integration Developers  
**Version:** 1.2  
**Last Updated:** August 2026

---

## Revision History

| Version | Date | Change Summary |
|---|---|---|
| 1.0 | August 2026 | Initial release |
| 1.1 | August 2026 | Added Section 10: CPS Properties Comparison (single-app and multi-app diff, collapsible side panels, credentials import); updated Quick Reference Card, Common Workflows, and Do's & Don'ts |
| 1.2 | August 2026 | Updated Section 6 (Applications): Import Credentials CSV, BG Filter, Export CPS, Deployment Type filter, lifecycle confirmation dialog. Rewrote Section 9 (Ping Test): Bulk Ping Modal with auto-credential resolution from API Manager, parallel batches of 10, 3-status system (Healthy/Partial/Unreachable), latency colour coding, 10-column CSV export, attempt log with per-attempt latency. Updated Quick Reference, Pre-Release Smoke Test and Post-Incident workflows, Do's & Don'ts |

---

## 1. Purpose

This SOP provides step-by-step instructions for using the MuleSoft Integration Dashboard to monitor applications, verify API configurations, inspect CPS properties, compare CPS property values across environments, and run live health checks against deployed Mule integrations.

---

## 2. Prerequisites

Before using the dashboard, confirm:

- [ ] You have an active Anypoint Platform account with at least **Read** access to the relevant Business Groups and Environments.
- [ ] The dashboard backend is running (`http://localhost:5000` or the hosted URL your team uses).
- [ ] The dashboard frontend is accessible in your browser (`http://localhost:5173` or the hosted URL).
- [ ] Your Anypoint session is active (tokens expire after ~60 minutes — re-login if prompted).

---

## 3. Logging In

1. Open the dashboard URL in your browser.
2. Enter your **Anypoint Platform username** and **password**.
3. Click **Login**.
4. On success, you are redirected to the **Dashboard** home page.

> ⚠️ If login fails, verify your credentials directly on [anypoint.mulesoft.com](https://anypoint.mulesoft.com). Do not share credentials with others — each user should log in with their own account.

---

## 4. Navigation

The **left sidebar** provides access to all modules:

| Sidebar Link | What It Does |
|---|---|
| 🏠 Dashboard | Platform overview — app counts, status charts |
| 📦 Applications | Full list of all deployed Mule applications |
| 🌐 Environments | List of Anypoint environments |
| 🏢 Business Groups | Organisation / BG hierarchy |
| 🔌 API Manager | API instances, policies, contracts |
| 📚 Exchange Assets | Anypoint Exchange asset browser |
| 🏓 Ping Test | Live HTTP health-check workspace |
| 🔀 CPS Compare | Side-by-side CPS property diff tool |

---

## 5. Viewing the Dashboard (Home)

**When to use:** Start of day health check; executive overview of platform health.

1. Click **Dashboard** in the sidebar.
2. Select a **Business Group** from the dropdown at the top, or leave it on **All Organizations** to see the full estate.
3. Review the summary cards:
   - **Total Applications** — total deployments in scope
   - **Running / Stopped** — live status counts
   - **Total APIs** — API Manager instances registered
4. Review the **status chart** (donut) and **environment breakdown chart** (bar).
5. If numbers look unexpected, proceed to the **Applications** page for details.

---

## 6. Monitoring Applications

**When to use:** Identifying failed/stopped apps; reviewing what is deployed across BGs.

1. Click **Applications** in the sidebar.
2. Use the filters at the top to narrow results:
   - **Business Group** — select a specific BG or keep **All Organizations**.
   - **Environment** — Production, Sandbox, UAT, etc.
   - **Status** — Running, Stopped, Deploying, Partially Started, etc.
   - **Deployment Type** — Filter to CloudHub 2.0 (CH2) or CloudHub 1.0 (CH1) only.
   - **Search box** — type an app name or partial name.
3. Review the table. Apps are listed with Status, Environment, Type (CH1/CH2), Mule Version, and Last Modified date.
4. Click an **application name** to open the Application Detail page.

### 6.1 Importing Credentials for Ping Tests

Before running a bulk ping test, import a credentials CSV so the dashboard can auto-resolve `client_id`/`client_secret` per app:

1. Click **Import Creds CSV** in the Applications page toolbar.
2. Upload a CSV file with at least `clientId` and `clientSecret` columns.
3. A **N creds loaded 🛡** badge replaces the import button when successful.
4. Credentials are stored in browser memory only — never written to disk or sent to any server until a ping is triggered.
5. To clear credentials, click the **✕** next to the badge.

> 💡 Imported credentials persist for the full session. You only need to import once even if you navigate away and return.

### 6.2 Filtering Business Groups

1. Click **Filter BGs** in the Business Group section of the page.
2. Check only the BGs relevant to your work and click **Save**.
3. The dropdown shows `N/M shown` when a filter is active.

### 6.3 Exporting CPS Properties

1. Click **Export CPS** in the toolbar.
2. In the Export modal, choose the scope (current env, all envs, etc.).
3. Click **Export** to download the CPS properties for all visible apps as an Excel/CSV file.

### 6.4 Starting / Stopping / Restarting an Application

1. Locate the application row in the table.
2. Click the **▶ Start**, **⏹ Stop**, or **🔄 Restart** button at the end of the row.
3. A confirmation dialog appears — review and confirm.
4. Wait for the status badge to update (may take 15–30 seconds; use **Refresh** button if needed).

> ⚠️ Only perform start/stop/restart after confirming with the application owner. Stopping a production app mid-traffic can cause data loss.

---

## 7. Inspecting an Application in Detail

**When to use:** Troubleshooting a specific app; verifying deployment configuration.

1. From the Applications page, click the application name.
2. Use the **six tabs** to inspect different aspects:

| Tab | What to Look For |
|---|---|
| **Overview** | Status, runtime version, region, last deployment time |
| **Properties** | Property placeholder values (e.g., `db.url`, `api.key`) |
| **Infra & Config** | Worker size, persistent queues, VPC settings |
| **CPS Config** | Config Property Server values at runtime |
| **Ping Test** | Run a live health check from this page (see Section 9) |
| **Raw JSON** | Full ARM API response — useful for debugging |

### Checking CPS Config Values

1. Open the **CPS Config** tab.
2. Review the key-value pairs.
3. If values are missing or wrong, escalate to the platform team to update CPS entries in Anypoint.

---

## 8. Reviewing API Manager Instances

**When to use:** Governance checks; identifying policy enforcement; finding consumer client IDs.

1. Click **API Manager** in the sidebar.
2. The table lists all API instances with Name, Version, Status, and Environment.
3. Click an API row to expand it and see:

### 8.1 Applied Policies

- Lists each policy by **name** (e.g., "Client ID Enforcement", "Rate Limiting SLA Based").
- Verify that required policies are applied before going live.
- If a policy shows an unexpected name or is missing, raise a governance ticket.

### 8.2 Consumer Contracts

- Lists all client applications that have been granted access.
- Each entry shows: **Consumer App Name**, **Client ID**, **Status** (APPROVED / PENDING / REVOKED), and **SLA Tier**.
- Use this to identify which teams/apps are consuming your API.
- If an unknown client ID appears, investigate with the Anypoint Platform admin.

---

## 9. Running a Ping / Health Check

There are two ways to run a ping test.

### Method A — Single App Ping (from Application Detail)

**When to use:** Quick spot-check on one app.

1. Navigate to **Applications** → click the app name.
2. Click the **Ping Test** tab.
3. (Optional) Enter `client_id` and `client_secret` if the app's API requires client credentials.
4. Click **Run Ping**.
5. Review the result:
   - ✅ **Healthy** — app is reachable and responded successfully.
   - ❌ **Unreachable / Error** — check the error message and attempt log.

### Method B — Bulk Ping from Applications Page

**When to use:** Verifying a set of apps (or all apps) before or after a release; incident sweep.

#### Step 1 — Launch the Bulk Ping Modal

1. Go to **Applications** in the sidebar.
2. (Optional) Filter/search to narrow the app list.
3. To ping **selected apps only**: tick checkboxes on the desired rows, then click **Ping (N)**.  
   To ping **all visible apps**: click **Ping Test** without selecting any rows.
4. The **Bulk Ping Modal** opens.

#### Step 2 — Configure Credentials in the Modal

- **Auto-resolve (recommended):** If you imported a credentials CSV (Section 6.1), leave `client_id` blank. The modal will automatically look up each app's `client_id` via API Manager contracts and match it against your CSV. A "Resolving credentials…" banner appears during this step.
- **Manual override:** Enter `client_id` and `client_secret` directly to use the same credentials for all apps.
- **x-transaction-id:** Defaults to `smokeTest`; change if your API requires a specific value.

#### Step 3 — Run

1. Click **Run All Pings**.
2. Pings run in **parallel batches of 10**. Per-app result cards update in real time showing status, HTTP code, and latency.
3. A progress summary shows `X/total · N healthy · N partial · N failed · N auto-creds`.
4. When complete, the modal automatically navigates to the **Ping Test Results page**.

### 9.3 Reading the Ping Test Results Page

The results page (`/ping-test`) shows all outcomes from the most recent bulk ping run:

**Summary bar** (top of results):
- Total apps tested
- ✓ Healthy / ~ Partial / ✗ Failed counts
- 🔑 Number of apps where credentials were auto-resolved
- Toggle: **✓ Showing tested (N)** ↔ **Show all apps**

**Results table** — sorted by status (Healthy first, then Partial, then Unreachable):

| Status Badge | Meaning |
|---|---|
| ✅ Healthy | At least one endpoint path returned a successful response |
| ⚠️ Partial | App responded but with a non-success HTTP status |
| ❌ Unreachable | All paths failed or timed out |

- **🔑 auto badge** next to an app name: credentials were auto-resolved from API Manager
- **HTTP column**: colour-coded — green (<300), yellow (<500), red (≥500)
- **Latency column**: colour-coded — green (<300 ms), yellow (<1000 ms), red (≥1000 ms)

**Expanding a row** for detail:
1. Click the **▶** button on any row.
2. The row expands to show:
   - 🔑 Auto-resolved credentials detail (API Manager instance → contract app → `client_id` prefix)
   - Full endpoint URL
   - Error message (if failed)
   - Response payload (formatted)
   - Attempt log: each path tried, HTTP result or error, per-attempt latency

**Exporting results:**
- Click **Export CSV** to download a 10-column CSV (Application, Environment, Type, Status, HTTP Code, Active Endpoint, Latency, Credentials, Error, Response Payload).

### 9.4 Interpreting Result Statuses

| Status / Indicator | Meaning | Action |
|---|---|---|
| ✅ Healthy, low latency (<300 ms) | App is healthy and fast | No action needed |
| ✅ Healthy, high latency (>1000 ms) | App reachable but slow | Investigate GC, thread contention, or DB latency |
| ⚠️ Partial — HTTP 401 / 403 | App running but credentials rejected | Verify auto-resolved or manual `client_id`/`client_secret`; check Client ID Enforcement policy |
| ⚠️ Partial — HTTP 404 | App running but no matching ping endpoint | Expected for apps without `/ping` — not a failure |
| ❌ Unreachable — ECONNREFUSED | App port not accepting connections | App may be stopped or crashed — check ARM status |
| ❌ Unreachable — ETIMEDOUT | Request timed out | Check network routing, VPC rules, or app overload |
| ❌ All paths: "No listener" | App running but no HTTP listener for any ping path | Not a connectivity failure — inform app owner to add a `/ping` or `/api/v1/ping` endpoint |

---

## 10. Comparing CPS Properties Between Environments

**When to use:** Verifying CPS property values are aligned between UAT and Production before a release; detecting configuration drift after a migration; auditing all apps' CPS configurations in bulk.

Click **CPS Compare** in the sidebar to open the comparison workspace.

### 10.1 Importing CPS Credentials (one-time setup)

CPS secure property fetches require a `clientId`/`clientSecret` pair. Import these once per session:

1. Click **Import CPS Creds** in the page header.
2. Upload a CSV file containing at least `clientId` and `clientSecret` columns.
3. The credentials are stored in the browser session.
4. When you select an app, the dashboard automatically matches credentials to that app based on its `clientId` deployment property. A **🔑 CPS creds** badge in the side panel confirms the match.

> 💡 Credentials persist for the entire browser session. You only need to import once per login.

### 10.2 Configuring Side A and Side B

Both side panels start **expanded** for initial setup. Complete these steps for both sides:

1. **Select a Business Group** — choose from the dropdown, or leave on "All Organizations".
2. **Select an Environment** — Production, Sandbox, UAT, etc., or leave on "All Environments".
3. **Select an Application** — type to search/filter the app list. CPS Base URL, environment prefix, and project key are **auto-populated** from the selected app's deployment properties. Edit manually if needed.
4. **Select Property Type** using the three tabs at the top of each panel:

   | Tab | Properties Fetched |
   |---|---|
   | **Non-Secure** | Standard key-value CPS properties |
   | **Secure** | Encrypted properties (keys auto-discovered from `cps.secure.properties`) |
   | **Binaries** | Binary files stored in CPS (keys auto-discovered from `cps.secure.binaries`) |

   > ℹ️ Side A and Side B can independently use different property types.

### 10.3 Choosing a Compare Mode

Use the **1 App / All Apps** toggle in the centre column:

| Mode | When to Use |
|---|---|
| **1 App** | Comparing one application between two environments or BGs |
| **All Apps** | Comparing all (or a selected subset of) apps across two BGs or environments in one run |

**In All Apps mode:** a numbered checklist replaces the single app dropdown. Check the apps you want; they are paired **positionally** (1st Side A ↔ 1st Side B, 2nd ↔ 2nd, etc.). Use **All** / **Clear** to select or deselect all at once.

### 10.4 Running the Comparison

1. Confirm both sides are configured (BG, environment, app, property type).
2. Click **Compare** (single-app) or **Compare (N)** (multi-app) in the centre column.
3. The diff results appear below the panels.
4. **Both side panels automatically collapse** to compact summary bars after the comparison completes, maximising space for the diff table.

Each collapsed bar shows: **Side A / Side B** label · Business Group · Environment · App/key · 🔑 if credentials matched.

### 10.5 Re-expanding a Side Panel

To change a selection after comparing:

1. Click the **▼ Edit** bar on the collapsed panel you want to change.
2. The panel re-expands to the full form.
3. Make your changes, then click **Compare** again.

To collapse manually without re-running, click **▲ Collapse** in the expanded panel header.

### 10.6 Reading the Diff Table (Single-App Mode)

| Badge | Row Colour | Meaning |
|---|---|---|
| **DIFF** | 🔴 Red | Key on both sides, values differ |
| **A ONLY** | 🔵 Blue | Key only in Side A |
| **B ONLY** | 🟠 Orange | Key only in Side B |
| **MATCH** | No highlight | Identical on both sides |

- **Filter tabs** — All / Different / Only A / Only B / Matching.
- **Search box** — filter visible rows by key name.
- **Click any 🔴🔵🟠 row** — opens the word-level diff modal; changed tokens highlighted red (A) and orange (B).
- **Export CSV** — downloads the complete diff as a `.csv` file.

### 10.7 Reading Multi-App Results (All Apps Mode)

Results appear as a collapsible accordion — one row per app pair:

1. Each row shows app name (Side A), Side B match, 🔴 **N diffs** or ✅ **identical**, and total property count.
2. Click a row to expand and see the per-property diff for that pair.
3. Click any 🔴🔵🟠 property row to open the word-level diff modal.
4. **Export All CSV** downloads a combined diff across all pairs.

The summary line above the accordion shows: total apps compared · pairs with diffs · identical pairs.

### 10.8 Using the BG Filter

1. Click **Filter BGs** in the page header.
2. Check only the BGs relevant to your comparison and click **Save**.
3. The button label changes to **N/M BGs** while the filter is active.

---

## 11. Browsing Exchange Assets

**When to use:** Discovering published APIs or connectors; verifying spec versions before implementing an integration.

1. Click **Exchange Assets** in the sidebar.
2. Select a **Business Group** from the dropdown.
3. (Optional) Enter a search term in the search box.
4. (Optional) Filter by asset type (REST API, RAML Fragment, Connector, etc.).
5. Click an asset in the list to open the **detail panel** on the right.
6. Review the description, version, classifier, tags, and portal link.

---

## 12. Checking Business Groups and Environments

### Business Groups

1. Click **Business Groups** in the sidebar.
2. View the BG hierarchy tree.
3. Note the **Organisation ID** for each BG — useful when raising support tickets or constructing direct API calls.

### Environments

1. Click **Environments** in the sidebar.
2. Review the list of environments (Production, Sandbox, UAT, Design, etc.).
3. Use environment **IDs** when needed for direct Anypoint API calls.

---

## 13. Common Workflows

### Pre-Release Smoke Test

1. Go to **Applications** → set Status filter to **Running**.
2. (Optional) Import credentials CSV via **Import Creds CSV** if apps use Client ID Enforcement (Section 6.1).
3. Leave rows unselected (to ping all visible apps) or select specific apps using checkboxes.
4. Click **Ping Test** or **Ping (N)** to open the Bulk Ping Modal.
5. Leave `client_id` blank to use auto-resolve, or enter manually if needed.
6. Click **Run All Pings** and wait for completion.
7. Review results on the Ping Test Results page:
   - Sort by status — ❌ Unreachable apps appear at the bottom.
   - Click **Export CSV** and attach to your release ticket as evidence.
8. Flag any ❌ Unreachable or ⚠️ Partial apps for investigation before go-live.

---

### Post-Incident Health Sweep

1. Go to **Applications** in the sidebar.
2. Set BG to the affected Business Group and Environment.
3. Click **Ping Test** (no rows selected) to ping all visible apps.
4. In the Bulk Ping Modal click **Run All Pings**.
5. On the Results page, review the summary bar for ❌ Unreachable counts.
6. Expand any failing row to capture the error message and attempt log.
7. Navigate to Application Detail → **Raw JSON** tab for full deployment state.

---

### Verifying a Property Change After Deployment

1. Go to **Applications** → find the redeployed app.
2. Click the app name → open the **Properties** tab.
3. Confirm the expected property value is showing.
4. Open the **CPS Config** tab to verify CPS-managed values.
5. Run a quick ping from the **Ping Test** tab to confirm the app is responding.

---

### Comparing CPS Values Before a Release (UAT → Production)

1. Click **CPS Compare** in the sidebar.
2. If you have secure properties, click **Import CPS Creds** and upload your credentials CSV first.
3. **Side A — UAT:**
   - Select the UAT Business Group and Environment.
   - Select the application being released.
   - Choose the property type (Non-Secure, Secure, or Binaries).
4. **Side B — Production:**
   - Select the Production Business Group and Environment.
   - Select the same application (production instance).
   - Choose the same property type.
5. Click **Compare**.
6. Both panels collapse automatically. Review the diff table:
   - 🔴 **DIFF** rows — values differ between UAT and Production; verify which is correct.
   - 🔵 **A ONLY** rows — properties set in UAT but missing from Production; may need to be added before go-live.
   - 🟠 **B ONLY** rows — properties in Production but not in UAT; confirm these are expected.
7. Click any coloured row to open the word-level diff modal for detailed inspection.
8. Click **Export CSV** to attach the diff report to your release ticket.
9. To change a selection (e.g., switch to Secure properties), click **▼ Edit** on the relevant panel, update the selection, and click **Compare** again.

---

### Bulk CPS Audit Across a Business Group

1. Click **CPS Compare** in the sidebar.
2. Import CPS credentials if required (Section 10.1).
3. Switch the mode toggle to **All Apps**.
4. **Side A:** Select the source BG and environment; tick all relevant apps.
5. **Side B:** Select the target BG and environment; tick the corresponding apps in the same order.
6. Click **Compare (N)**.
7. Panels collapse and the multi-app accordion appears.
8. Review the summary line: total apps · pairs with diffs · identical pairs.
9. Expand any app row to see its full property diff.
10. Click **Export All CSV** for a consolidated audit report.

---

### Checking Which Apps Are Consuming a Given API

1. Go to **API Manager**.
2. Find the API instance by name or environment.
3. Expand the row and open the **Consumer Contracts** section.
4. Note the Consumer App Name, Client ID, and Contract Status.
5. If an unexpected consumer appears, notify the API owner and Anypoint Platform admin.

---

## 14. Troubleshooting the Dashboard Itself

| Symptom | Likely Cause | Resolution |
|---|---|---|
| Login fails | Wrong credentials or account locked | Verify on anypoint.mulesoft.com directly |
| All pages show "Unauthorised" | Session expired (60-min token TTL) | Log out and log back in |
| Applications page shows empty list | No apps in selected BG/environment | Try **All Organizations** and remove filters |
| Ping Test shows all ETIMEDOUT | Network/firewall blocking outbound HTTPS from backend server | Check proxy/firewall rules on the machine running the backend |
| CPS Config tab shows empty | CPS not enabled for this org or app name mismatch | Contact your Anypoint Platform admin |
| CPS Compare shows no properties | CPS URL or project key incorrect; credentials missing | Verify auto-populated CPS fields; re-import credentials (Section 10.1) |
| CPS Compare panels won't collapse | JavaScript error in the browser | Refresh the page; check browser console for errors |
| Exchange assets return no results | Search query too narrow or wrong BG selected | Broaden the search or switch to a parent BG |
| Metrics widgets show "N/A" | Metrics API not returning data for this BG | Expected for BGs without active traffic or Anypoint Monitoring entitlement |

---

## 15. Logging Out

1. Click your username or the **Logout** button in the sidebar or header.
2. You will be redirected to the login page.
3. Your server-side session is cleared immediately — no further API calls can be made with the previous token.

> 💡 Always log out when leaving your workstation, especially in shared or production-access environments. CPS credentials imported during your session are also cleared on logout.

---

## 16. Quick Reference Card

| Task | Where to Go | Key Action |
|---|---|---|
| See overall platform health | Dashboard | Check summary cards and charts |
| Find a stopped/failed app | Applications → Status: Stopped | Review status badge |
| Start / stop an app | Applications → action buttons | ▶ / ⏹ buttons on the row |
| Check property values | App Detail → Properties tab | Read property list |
| Check CPS values (single app) | App Detail → CPS Config tab | Read key-value list |
| Compare CPS values (two environments) | CPS Compare → 1 App mode | Configure sides, click Compare |
| Compare CPS values (bulk / all apps) | CPS Compare → All Apps mode | Select app checklists, click Compare (N) |
| Re-edit a CPS side after comparison | CPS Compare → collapsed summary bar | Click ▼ Edit to re-expand |
| Export CPS diff report | CPS Compare → diff table | Click Export CSV |
| Import ping credentials | Applications → Import Creds CSV | Upload client_id/secret CSV |
| Ping one app quickly | App Detail → Ping Test tab | Click Run Ping |
| Ping selected apps | Applications → select rows → Ping (N) | Complete modal → review Results page |
| Ping all visible apps | Applications → Ping Test (no rows selected) | Complete modal → review Results page |
| Export ping results | Ping Test Results page | Click Export CSV |
| View auto-creds detail | Ping Test Results → expand row | Check 🔑 auto-resolved section |
| Check who consumes an API | API Manager → expand row → Contracts | Note Client ID and status |
| Find a published API spec | Exchange Assets → search | Click asset for details |
| View BG org IDs | Business Groups | Note Organisation ID column |

---

## 17. Do's and Don'ts

### ✅ Do

- Use **All Organizations** as your default starting point on the Dashboard and Applications pages to get a complete picture.
- Always **run a bulk ping before a release** — use the Applications page Bulk Ping modal rather than the App Detail ping tab for multiple apps.
- **Import the credentials CSV** before running a bulk ping so credentials are auto-resolved per app rather than using a single manual pair.
- Check the **attempt log** in expanded ping result rows when diagnosing failures — it shows each path tried, the HTTP result, and per-attempt latency.
- Use the **CPS Config** tab as your first stop when an app behaves differently between environments.
- Use **CPS Compare** before every release to verify property alignment between UAT and Production.
- **Import CPS credentials** at the start of any CPS comparison session to enable automatic credential matching.
- After a CPS comparison, use the **▼ Edit** bar to switch property types (Non-Secure → Secure → Binaries) and re-run without reconfiguring from scratch.
- **Export CSV** from CPS Compare and attach to your release record as evidence of property verification.
- **Log out** when you're done, especially if accessing production data.

### ❌ Don't

- Don't **stop or restart production applications** without a change approval and owner sign-off.
- Don't interpret **HTTP 404** as an app failure on the Ping Test page — many apps don't implement a `/ping` endpoint.
- Don't **share your Anypoint credentials** to let others use the dashboard — each user must log in independently.
- Don't treat the dashboard as a real-time monitor — data is fetched on page load/navigation, not streamed live. Refresh to get the latest state.
- Don't use the **Raw JSON** tab data for automated integrations — call the Anypoint APIs directly for that purpose.
- Don't close the browser tab **during a bulk ping run** — the batch processing will be interrupted and results will be incomplete.
- Don't close the browser tab mid-comparison in **CPS All Apps** mode — the CPS batch processing will also be interrupted.
- Don't rely solely on **MATCH** rows in CPS Compare to confirm a property is correctly set — also verify the value itself makes sense for the target environment.

---

*For technical issues with the dashboard itself, contact your platform engineering team. For Anypoint Platform access issues, contact your Anypoint Platform administrator.*
