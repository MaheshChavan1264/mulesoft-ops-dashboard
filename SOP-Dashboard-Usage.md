# SOP: MuleSoft Integration Dashboard — Usage Guide

**Document Type:** Standard Operating Procedure  
**Audience:** MuleSoft Platform Operators, Integration Developers  
**Version:** 1.0  
**Last Updated:** August 2026

---

## 1. Purpose

This SOP provides step-by-step instructions for using the MuleSoft Integration Dashboard to monitor applications, verify API configurations, inspect CPS properties, and run live health checks against deployed Mule integrations.

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
   - **Status** — Running, Stopped, or All.
   - **Search box** — type an app name or partial name.
3. Review the table. Apps are listed with Type (CH1/CH2), Status, Environment, Workers/Replicas, and Runtime Version.
4. Click an **application name** to open the Application Detail page.

### 6.1 Starting / Stopping / Restarting an Application

1. Locate the application row in the table.
2. Click the **▶ Start**, **⏹ Stop**, or **🔄 Restart** button at the end of the row.
3. Wait for the status badge to update (may take 15–30 seconds; refresh if needed).

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

There are three ways to run a ping test. Choose the method that fits your task.

---

### Method A — Single App Ping (from Application Detail)

**When to use:** Quick spot-check on one app.

1. Navigate to **Applications** → click the app name.
2. Click the **Ping Test** tab.
3. (Optional) Enter `client_id` and `client_secret` if the app's API requires client credentials.
4. Click **Run Ping**.
5. Review the result:
   - ✅ **Green / 200** — app is reachable and responded successfully.
   - ❌ **Red / Error** — check the error message and attempt log to identify the cause.

---

### Method B — Bulk Ping from Applications Page

**When to use:** Verifying a set of apps before or after a release; pre-incident sweep.

1. Go to **Applications** in the sidebar.
2. Filter and/or search to find the apps you want to test.
3. Tick the **checkboxes** on the left of each row for every app you want to ping.
   - Selected rows float to the top of the table automatically.
4. Click **Ping Selected** (button appears when at least one row is selected).
5. The Ping Test page opens with results pre-loaded for all selected apps.
6. Review the results table (see Section 9.4).

---

### Method C — Dedicated Ping Test Page

**When to use:** Running a full sweep of all apps in scope; ongoing health monitoring.

1. Click **Ping Test** in the sidebar.
2. The page loads all applications visible in the current BG/environment scope.
3. (Optional) Select specific apps using the checkboxes — selected rows float to the top.
4. Click:
   - **Run (N selected)** — ping only the checked apps.
   - **Run All** — ping every app in the list.
5. Review results as they populate (see Section 9.4).

---

### 9.4 Interpreting Ping Results

| Indicator | Meaning | Action |
|---|---|---|
| ✅ HTTP 200, low latency | App is healthy and responding | No action needed |
| ✅ HTTP 200, high latency (>2s) | App is reachable but slow | Investigate GC, thread contention, or DB latency |
| ⚠️ HTTP 401 / 403 | App running but credentials rejected | Verify `client_id`/`client_secret`; check Client ID Enforcement policy |
| ⚠️ HTTP 404 | App running but no matching ping endpoint | Expected for apps without `/ping` — not a failure |
| ❌ ECONNREFUSED | App port not accepting connections | App may be stopped or crashed — check ARM status |
| ❌ ETIMEDOUT | Request timed out | Check network routing, VPC rules, or app overload |
| ❌ All paths: "No listener" | App running but no HTTP listener configured for any ping path | Not a connectivity failure — inform the app owner to add a `/ping` or `/api/v1/ping` endpoint |

**Expanding a row** for more detail:
1. Click anywhere on the result row.
2. The row expands to show:
   - Full URL attempted
   - Error message (if any)
   - Response payload snippet
   - Attempt log (each path tried in sequence)

**Toggling "View tested apps":**
- Switch to **Tested apps only** to filter out apps that haven't been pinged yet.

---

## 10. Browsing Exchange Assets

**When to use:** Discovering published APIs or connectors; verifying spec versions before implementing an integration.

1. Click **Exchange Assets** in the sidebar.
2. Select a **Business Group** from the dropdown.
3. (Optional) Enter a search term in the search box.
4. (Optional) Filter by asset type (REST API, RAML Fragment, Connector, etc.).
5. Click an asset in the list to open the **detail panel** on the right.
6. Review the description, version, classifier, tags, and portal link.

---

## 11. Checking Business Groups and Environments

### Business Groups

1. Click **Business Groups** in the sidebar.
2. View the BG hierarchy tree.
3. Note the **Organisation ID** for each BG — useful when raising support tickets or constructing direct API calls.

### Environments

1. Click **Environments** in the sidebar.
2. Review the list of environments (Production, Sandbox, UAT, Design, etc.).
3. Use environment **IDs** when needed for direct Anypoint API calls.

---

## 12. Common Workflows

### Pre-Release Smoke Test

1. Go to **Applications** → set Status filter to **Running**.
2. Select all apps in scope using checkboxes.
3. Click **Ping Selected**.
4. On the Ping Test page, review all results.
5. Flag any apps that return errors for investigation before go-live.
6. Document the results (screenshot or export) as evidence in your release record.

---

### Post-Incident Health Sweep

1. Go to **Ping Test** in the sidebar.
2. Set BG to the affected Business Group.
3. Click **Run All**.
4. Filter by **View tested apps** and sort by HTTP status to identify all failing apps.
5. For each failing app, click to expand and capture the error and attempt log.
6. Navigate to Application Detail → **Raw JSON** tab for full deployment state.

---

### Verifying a Property Change After Deployment

1. Go to **Applications** → find the redeployed app.
2. Click the app name → open the **Properties** tab.
3. Confirm the expected property value is showing.
4. Open the **CPS Config** tab to verify CPS-managed values.
5. Run a quick ping from the **Ping Test** tab to confirm the app is responding.

---

### Checking Which Apps Are Consuming a Given API

1. Go to **API Manager**.
2. Find the API instance by name or environment.
3. Expand the row and open the **Consumer Contracts** section.
4. Note the Consumer App Name, Client ID, and Contract Status.
5. If an unexpected consumer appears, notify the API owner and Anypoint Platform admin.

---

## 13. Troubleshooting the Dashboard Itself

| Symptom | Likely Cause | Resolution |
|---|---|---|
| Login fails | Wrong credentials or account locked | Verify on anypoint.mulesoft.com directly |
| All pages show "Unauthorised" | Session expired (60-min token TTL) | Log out and log back in |
| Applications page shows empty list | No apps in selected BG/environment | Try **All Organizations** and remove filters |
| Ping Test shows all ETIMEDOUT | Network/firewall blocking outbound HTTPS from backend server | Check proxy/firewall rules on the machine running the backend |
| CPS Config tab shows empty | CPS not enabled for this org or app name mismatch | Contact your Anypoint Platform admin |
| Exchange assets return no results | Search query too narrow or wrong BG selected | Broaden the search or switch to a parent BG |
| Metrics widgets show "N/A" | Metrics API not returning data for this BG | This is expected for BGs without active traffic or Anypoint Monitoring entitlement |

---

## 14. Logging Out

1. Click your username or the **Logout** button in the sidebar or header.
2. You will be redirected to the login page.
3. Your server-side session is cleared immediately — no further API calls can be made with the previous token.

> 💡 Always log out when leaving your workstation, especially in shared or production-access environments.

---

## 15. Quick Reference Card

| Task | Where to Go | Key Action |
|---|---|---|
| See overall platform health | Dashboard | Check summary cards and charts |
| Find a stopped/failed app | Applications → Status: Stopped | Review status badge |
| Start / stop an app | Applications → action buttons | ▶ / ⏹ buttons on the row |
| Check property values | App Detail → Properties tab | Read property list |
| Check CPS values | App Detail → CPS Config tab | Read key-value list |
| Ping one app quickly | App Detail → Ping Test tab | Click Run Ping |
| Ping multiple apps | Applications → select rows → Ping Selected | Review Ping Test page |
| Run full health sweep | Ping Test → Run All | Review results table |
| Check who consumes an API | API Manager → expand row → Contracts | Note Client ID and status |
| Find a published API spec | Exchange Assets → search | Click asset for details |
| View BG org IDs | Business Groups | Note Organisation ID column |

---

## 16. Do's and Don'ts

### ✅ Do

- Use **All Organizations** as your default starting point on the Dashboard and Applications pages to get a complete picture.
- Always **select rows and ping before a release** to establish a baseline.
- Check the **attempt log** in expanded ping rows when diagnosing failures — it shows exactly which paths were tried.
- Use the **CPS Config** tab as your first stop when an app behaves differently between environments.
- **Log out** when you're done, especially if accessing production data.

### ❌ Don't

- Don't **stop or restart production applications** without a change approval and owner sign-off.
- Don't interpret **HTTP 404** as an app failure on the Ping Test page — many apps don't implement a `/ping` endpoint.
- Don't **share your Anypoint credentials** to let others use the dashboard — each user must log in independently.
- Don't treat the dashboard as a real-time monitor — data is fetched on page load/navigation, not streamed live. Refresh to get the latest state.
- Don't use the **Raw JSON** tab data for automated integrations — call the Anypoint APIs directly for that purpose.

---

*For technical issues with the dashboard itself, contact your platform engineering team. For Anypoint Platform access issues, contact your Anypoint Platform administrator.*
