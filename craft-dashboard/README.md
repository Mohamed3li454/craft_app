# Craft Command Center Dashboard V2 (`craft-dashboard`)

Mission control and operational control plane for the Craft AI platform, built with **Next.js 14.2 (App Router)**, **TypeScript**, **Tailwind CSS**, and **TanStack Query**.

---

## 1. Architecture & Security Model

```
Browser (Client JS)
  │
  │ [Credentials: same-origin, Zero Tokens Exposed]
  ▼
Next.js BFF Layer (/api/admin-proxy/*, /api/auth/*)
  │
  │ [Reads HttpOnly Session Cookie & Verifies HMAC-SHA256 Signature]
  ▼
Backend Admin Control Plane (Express on :3000)
  │
  │ [Constant-time Bearer Check & Server-Side RBAC Enforcement]
  ▼
Database & Operational Repositories
```

### Security Invariants:
1. **Zero Client Secret Exposure:** The browser NEVER holds `ADMIN_SECRET_KEY` in memory, `localStorage`, `sessionStorage`, or bundles. The BFF injects the token into backend requests.
2. **Cryptographic Session Integrity:** Session cookies are signed with HMAC-SHA256 and constant-time validated (`crypto.timingSafeEqual`). Any tampering immediately invalidates the session.
3. **Server-Authoritative Roles:** Roles are assigned exclusively by the server upon validating credentials. Client cannot pick or escalate roles.
4. **Strict Reasoning Redaction:** Chain-of-thought and internal thinking tokens are filtered before reaching the admin control plane.
5. **Safe Reminder Retries:** All reminder retries route strictly through the Admin API lifecycle (`POST /api/admin/reminders/:id/retry`), respecting `pg_cron` jobs and WhatsApp rate limits.

---

## 2. Legacy Dashboard Strategy

The single-file legacy dashboard (`backend/src/modules/analytics/dashboard.html`) is **fully preserved** on disk for complete backward compatibility.

- When `DASHBOARD_URL` (or `CRAFT_DASHBOARD_URL`) is defined in the backend environment, requests to `/dashboard` automatically issue a `302 Redirect` to this modern Next.js dashboard.
- Appending `?legacy=true` to `/dashboard` (or omitting `DASHBOARD_URL`) serves the original single-file dashboard fallback.
- The legacy dashboard does not duplicate Admin API logic and adheres to backend rate-limiting and authorization requirements.

---

## 3. Operational Modules (13 Pages)

1. `/overview`: High-level KPIs, token budgets, daily interaction trends, model breakdown, top users.
2. `/observability`: Subsystem health snapshots, uptime, latency percentiles (p50/p95/p99), event counters.
3. `/users`: User directory, VIP status toggles, enforcement ban/unban modals, and User 360° inspector drawer.
4. `/conversations`: WhatsApp threads, status filters, and rich message transcripts viewer.
5. `/memory`: User profile facts (confirmed memory items) and autonomous evidence candidates review queue (approve/reject).
6. `/reminders`: Complete lifecycle tracking (`pending`, `processing`, `delivered`, `failed`, `cancelled`), cancel, and safe retry.
7. `/knowledge`: FAQ knowledge base editor and semantic vector cache performance metrics.
8. `/agent-runs`: Execution trace inspector, tool call duration breakdown, and redacted reasoning banner.
9. `/tools`: Tool telemetry, duration histograms, and sanitized input/output payloads.
10. `/proactive`: Scheduled proactive check-ins, dispatch logs, and engagement response metrics.
11. `/search`: Recent production search queries and interactive dry-run search diagnostic probe.
12. `/audit`: Immutable, append-only administrative compliance trail with correlation ID tracking.
13. `/settings`: Safe runtime toggles (maintenance mode, debug logging, search/proactive enable), infrastructure topology, zero secret leakage.

---

## 4. Development & Running

```bash
# 1. Install dependencies
npm install

# 2. Configure environment
cp .env.example .env.local

# 3. Run development server (port 3001 if backend runs on 3000)
PORT=3001 npm run dev

# 4. Run tests
npm test

# 5. Production build
npm run build
```
