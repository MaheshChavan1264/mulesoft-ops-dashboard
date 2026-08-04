# MuleSoft Integration Dashboard

A full-stack web dashboard for monitoring and managing MuleSoft integrations on Anypoint Platform. View deployed applications, environments, business groups, API Manager instances, and Exchange assets — all in one place.

---

## Features

| Section | Capabilities |
|---|---|
| **Dashboard** | Summary stats, application status pie chart, Exchange asset bar chart, environment list |
| **Applications** | List all integrations across CloudHub 1.0, CloudHub 2.0, and Runtime Fabric with search & filter |
| **Application Detail** | Overview, configuration properties, environment variables, raw JSON view |
| **Environments** | All environments with type (production/sandbox), app counts, and IDs |
| **Business Groups** | Organization hierarchy with members |
| **API Manager** | API instances per environment, applied policies, endpoint details |
| **Exchange Assets** | Search and browse assets by type (REST API, Connector, Template, etc.) |

---

## Tech Stack

| Layer | Technology |
|---|---|
| Backend | Node.js + Express |
| Frontend | React 18 + Vite + Tailwind CSS |
| Charts | Recharts |
| Icons | Lucide React |
| API | Anypoint Platform REST APIs |

---

## Prerequisites

- Node.js 18+
- An Anypoint Platform account with access to an organization

---

## Setup & Installation

### 1. Clone / Navigate to the project

```bash
cd mulesoft-dashboard
```

### 2. Install Backend Dependencies

```bash
cd backend
npm install
```

### 3. Configure Backend Environment

```bash
cp .env.example .env
```

Edit `.env`:

```
PORT=5000
ANYPOINT_PLATFORM_URL=https://anypoint.mulesoft.com
SESSION_SECRET=change-this-to-a-random-string
```

### 4. Install Frontend Dependencies

```bash
cd ../frontend
npm install
```

---

## Running the Dashboard

### Start Backend (Terminal 1)

```bash
cd mulesoft-dashboard/backend
npm run dev
```

Backend runs on `http://localhost:5000`

### Start Frontend (Terminal 2)

```bash
cd mulesoft-dashboard/frontend
npm run dev
```

Frontend runs on `http://localhost:5173`

Open **http://localhost:5173** in your browser.

---

## Authentication

The dashboard supports two login methods:

### Option A — Username & Password
Use your Anypoint Platform username (email) and password.

### Option B — Access Token
1. Log in to [Anypoint Platform](https://anypoint.mulesoft.com)
2. Go to **Access Management → Your Profile → Access Tokens**
3. Generate a new token and paste it into the dashboard login

---

## API Endpoints (Backend)

| Route | Description |
|---|---|
| `POST /api/auth/login` | Login with credentials |
| `POST /api/auth/token-login` | Login with access token |
| `GET /api/auth/session` | Check current session |
| `GET /api/organizations/business-groups` | Get all business groups |
| `GET /api/environments/:orgId` | List environments |
| `GET /api/applications/summary/:orgId` | Applications across all environments |
| `GET /api/applications/cloudhub2/:orgId/:envId` | CloudHub 2.0 applications |
| `GET /api/applications/cloudhub1/:envId` | CloudHub 1.0 applications |
| `GET /api/apis/:orgId/:envId` | API Manager instances |
| `GET /api/apis/:orgId/:envId/:apiId/policies` | Applied policies |
| `GET /api/exchange/search` | Search Exchange assets |
| `GET /api/metrics/summary/:orgId` | Organization metrics |

---

## Project Structure

```
mulesoft-dashboard/
├── backend/
│   ├── src/
│   │   ├── middleware/authMiddleware.js
│   │   ├── routes/
│   │   │   ├── auth.js
│   │   │   ├── organizations.js
│   │   │   ├── environments.js
│   │   │   ├── applications.js
│   │   │   ├── apis.js
│   │   │   ├── exchange.js
│   │   │   └── metrics.js
│   │   ├── utils/anypointClient.js
│   │   └── server.js
│   ├── .env.example
│   └── package.json
└── frontend/
    ├── src/
    │   ├── components/
    │   │   ├── Layout.jsx
    │   │   ├── Sidebar.jsx
    │   │   ├── Header.jsx
    │   │   ├── StatCard.jsx
    │   │   └── StatusBadge.jsx
    │   ├── context/AuthContext.jsx
    │   ├── pages/
    │   │   ├── LoginPage.jsx
    │   │   ├── DashboardPage.jsx
    │   │   ├── ApplicationsPage.jsx
    │   │   ├── ApplicationDetailPage.jsx
    │   │   ├── EnvironmentsPage.jsx
    │   │   ├── BusinessGroupsPage.jsx
    │   │   ├── ApiManagerPage.jsx
    │   │   └── ExchangePage.jsx
    │   ├── services/api.js
    │   ├── App.jsx
    │   └── main.jsx
    ├── index.html
    ├── vite.config.js
    ├── tailwind.config.js
    └── package.json
```

---

## Documentation

- [Anypoint Platform Documentation](https://docs.mulesoft.com/general/)
- [Runtime Manager API](https://docs.mulesoft.com/runtime-manager/runtime-manager-api)
- [API Manager API](https://docs.mulesoft.com/api-manager/latest/api-manager-api)
- [Exchange API](https://docs.mulesoft.com/exchange/)