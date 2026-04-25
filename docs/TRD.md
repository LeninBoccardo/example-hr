# Time-Off Microservice — Technical Requirements Document

**Version:** 1.0  
**Status:** Implemented (take-home assessment)  
**Author:** Lenin Boccardo  
**Date:** 2026-04-24

---

## 1. Problem Statement

ExampleHR provides the employee-facing UI for time-off requests, but the
authoritative employee data — including leave balances — lives in an external
**Human Capital Management (HCM)** system such as Workday or SAP. Two
challenges arise from this split:

1. **Source-of-truth divergence.** ExampleHR cannot satisfy a request without
   eventually convincing HCM to debit the same days. Any system that lets the
   employee believe a request is approved before HCM agrees risks "approving
   a debit that never lands," producing silent overdrafts.
2. **Independent writers to HCM.** HCM is also written to by yearly refreshes,
   work-anniversary bonuses, and other line-of-business systems. Our local
   view of the balance can become stale without any signal from us, so we
   need a way to notice and reconcile drift.

Layered on top: HCM "usually" rejects bad debits with structured errors (e.g.,
`INSUFFICIENT_BALANCE`, `INVALID_DIMENSION`), but **this is not guaranteed**.
The service must be defensive — never assume HCM is right or wrong without
evidence.

## 2. Goals & Non-Goals

### Goals

- Single source-of-truth contract: HCM "wins" on conflicts; ExampleHR's view
  is a projection that is reconciled when drift is detected.
- A clean lifecycle for time-off requests with explicit, auditable state
  transitions.
- Hard reservation of balance at request creation so two overlapping requests
  cannot both succeed against the same days.
- Idempotent, retryable HCM writes with a durable outbox to survive HCM
  outages without user-visible lifecycle stalls.
- Defensive handling of every HCM failure mode: 5xx, timeout, terminal
  business errors, undocumented payloads.
- Observability: structured logs, an audit trail of every balance-affecting
  event, an outbox inspection endpoint, and a health probe.

### Non-Goals (explicitly out of scope for this TRD)

- Multi-tenant isolation (single tenant assumed).
- Multiple leave types (vacation/sick/personal). The brief specifies
  per-employee per-location balances; we deliver a single generic balance.
- Accrual engine. HCM owns accruals; we ingest the result.
- Notifications, calendaring, holiday calendars, FMLA/jurisdictional rules.
- Real authentication backend; we use a JWT stub with a `role` claim.

## 3. System Context

```
                ┌──────────────────────┐
                │   Employee / Manager │
                └──────────┬───────────┘
                           │ HTTPS + JWT
                           ▼
       ┌───────────────────────────────────────┐
       │   Time-Off Microservice (NestJS)      │
       │  ┌────────────┐   ┌────────────────┐  │
       │  │  Requests  │   │   Reconcile    │  │
       │  │  Lifecycle │   │   Job + Batch  │  │
       │  └─────┬──────┘   └───────┬────────┘  │
       │        │                  │           │
       │   ┌────▼─────┐    ┌───────▼──────┐    │
       │   │ Balance  │    │   Outbox     │    │
       │   │ Snapshot │    │   Worker     │    │
       │   └────┬─────┘    └───────┬──────┘    │
       │        │                  │           │
       │   ┌────▼─────┐    ┌───────▼──────┐    │
       │   │ Ledger   │    │  HCM Client  │    │
       │   │ (append) │    │  + retry +   │    │
       │   └──────────┘    │   circuit    │    │
       │                   └───────┬──────┘    │
       └───────────────────────────┼───────────┘
                                   │
                  realtime API     │ batch ingest
                                   ▼
                         ┌─────────────────────┐
                         │   HCM (Workday/SAP) │
                         └─────────────────────┘
```

The service exposes a REST API over HTTP, persists to SQLite via TypeORM, and
talks to HCM over HTTP. A standalone Express **HCM mock** in the same
repository serves both local development and the E2E test suite.

## 4. Key Challenges

| # | Challenge | How we address it |
|---|-----------|-------------------|
| C1 | HCM and ExampleHR can both modify balance independently | Treat HCM as authoritative; reconcile drift via batch ingest + manual job; record every adjustment as a ledger event |
| C2 | HCM might silently lie (return success but inconsistent state) | Idempotency keys on HCM writes; dedupe local commit on idempotency key; defensive ledger entries even when HCM call appears to succeed |
| C3 | HCM realtime can be slow / down | Per-call timeout, exponential backoff retry, circuit breaker that fast-fails when upstream is unhealthy |
| C4 | Two overlapping employee requests against the same balance | Hard reservation at request creation (`available = balance - reserved`); insufficient-balance failure short-circuits the second request |
| C5 | HCM rejects a debit *after* we approved locally | Approval is provisional — only `COMMITTED` once HCM acknowledges. Retryable failures route to an outbox; terminal failures move to `FAILED` and release the reservation |
| C6 | HCM batch lowers balance below currently-pending reservations | We flag the newest pending requests as `FAILED` with a reason explaining the cap; older pending requests retain their reservations |
| C7 | Duplicate user submissions | `Idempotency-Key` header on `POST /requests`; same key returns same request id and never re-reserves balance |
| C8 | Ledger integrity | Append-only ledger with a unique index on `hcm_idempotency_key` so the same HCM debit never produces two ledger lines |

## 5. Proposed Design

### 5.1 Two-layer balance representation

- **Append-only ledger** (`balance_ledger`) records every event that changes
  balance: `ACCRUAL`, `DEBIT`, `REFUND`, `HCM_SYNC_ADJUST`, `ANNIVERSARY`,
  `YEARLY_REFRESH`, `MANUAL_CORRECTION`. Each row carries source
  (`REQUEST`, `HCM_REALTIME`, `HCM_BATCH`, `ADMIN`, `SYSTEM`), actor,
  request id (when applicable), and an optional `hcm_idempotency_key`
  (uniquely indexed) so HCM-triggered writes can never duplicate.
- **Snapshot projection** (`balance_snapshots`) holds the current
  `balance_days`, `reserved_days`, `last_hcm_sync_at`, and an optimistic
  `version`. The snapshot is maintained inside the same transaction as the
  ledger insert; this keeps reads fast without sacrificing the ledger as
  the canonical source.

### 5.2 Request lifecycle

```
       create
         │
         ▼
     PENDING ──reject──▶ REJECTED
         │              
         ├─cancel──▶ CANCELLED
         │
         ▼
      APPROVED ──HCM ok──▶ COMMITTED
         │
         └──HCM terminal err──▶ FAILED
                  (or via outbox after exhausting retries)
```

- `PENDING → APPROVED` happens locally; the manager has signalled approval
  but the debit hasn't reached HCM yet.
- The HCM debit is attempted **synchronously** in the approve handler.
  - **Success:** the request moves to `COMMITTED`, the ledger gets a `DEBIT`
    line, and the snapshot reservation converts to a real debit.
  - **Retryable failure (5xx, timeout):** the request stays `APPROVED` and a
    record is enqueued in `outbox_events`. A background worker drains the
    outbox with exponential backoff. The local view shows `APPROVED` until
    drainage completes.
  - **Terminal failure (`INSUFFICIENT_BALANCE`, `INVALID_DIMENSION`):** the
    request moves to `FAILED`, reservation released, audit + ledger record
    the contradiction.

### 5.3 Hard reservation

`available = balance_days − reserved_days`. Creation:

1. Begin transaction.
2. Read snapshot for `(employee, location)`.
3. If `available < requested`, throw `InsufficientBalanceError` (HTTP 409).
4. Increment `reserved_days`.
5. Insert request row with status `PENDING`.
6. Commit.

This single transaction is enough on SQLite (single-writer); on Postgres we
would use `SELECT ... FOR UPDATE` or `UPDATE ... RETURNING` to obtain the
same guarantee.

### 5.4 Outbox + worker

`outbox_events`: `id`, `aggregate_type`, `aggregate_id`, `event_type`,
`payload`, `status (PENDING|PROCESSING|DONE|DEAD)`, `attempts`,
`next_attempt_at`, `last_error`, `idempotency_key (UNIQUE)`. The worker
polls every `OUTBOX_POLL_INTERVAL_MS`, picks `PENDING` events whose
`next_attempt_at` has elapsed, and re-runs the HCM debit. It supports:

- Exponential backoff (`backoff = min(60s, 500ms * 2^attempt)`).
- Idempotency: the HCM endpoint dedupes by `idempotency_key`, so a retry
  after the first request actually committed at HCM is safe.
- Dead-lettering: after `OUTBOX_MAX_ATTEMPTS` the row becomes `DEAD` for
  human review (visible at `GET /admin/outbox`).

### 5.5 Reconciliation

Two flavors:

1. **Push** — `POST /api/v1/hcm/batch-ingest` (signed via `x-hcm-secret`).
   HCM sends the full corpus periodically. We diff each `(employee, location)`
   entry against the local snapshot, write `HCM_SYNC_ADJUST` ledger entries
   for any delta, and re-validate pending reservations. If pending+approved
   reservations would exceed the new HCM balance, the newest such requests
   are marked `FAILED` until reservations fit.
2. **Pull** — `POST /api/v1/admin/reconcile` (admin only) and an optional
   cron (disabled by default; toggled via `RECONCILE_CRON_ENABLED`). For
   each known `(employee, location)` we call HCM realtime; on disagreement,
   apply the same adjustment+flag logic as the batch path.

### 5.6 Defensive HCM client

- `axios` with `validateStatus: () => true` so HTTP statuses don't crash the
  pipeline; we translate every status into either `HcmError.invalidDimension`,
  `HcmError.insufficientBalance`, `HcmError.upstream`, etc.
- **Retry** wraps the call with bounded exponential backoff for retryable
  errors only.
- **Circuit breaker** fast-fails after a configurable number of consecutive
  retryable failures (default 5) with a cooldown that auto-transitions to
  `HALF_OPEN` for a probe call. Crucially, **business errors do not trip the
  breaker** — they are signals about the request, not the upstream.

### 5.7 Security

- All write endpoints require a `Bearer <jwt>` with a `role` claim of
  `employee`, `manager`, or `admin`.
- Employees are scoped to their own balance/requests via the `employeeId`
  claim in the JWT and a per-controller authorization check.
- Manager-only endpoints (`approve`, `reject`, list-all) use a `RolesGuard`.
- Admin-only endpoints (`reconcile`, `outbox`) use the same guard.
- Batch ingest uses a separate symmetric secret in `x-hcm-secret`, so only
  the HCM batch tier can write to it. (In production: replace with mTLS or
  signed payloads; see §10.)
- Inputs are validated by `class-validator` DTOs with `whitelist` and
  `forbidNonWhitelisted` enabled.

## 6. Alternatives Considered

The decisions below were made consciously. The unselected options are
documented because reviewing them is part of the assessment criteria.

### 6.1 Sync vs async commit (D6)

- **A — Synchronous HCM-first.** Approve only succeeds when HCM agrees.
  Strongest correctness, worst UX during HCM degradation: every flap blocks
  approvals.
- **B — Optimistic local + always-async commit.** Best UX, most complex.
  Compensation logic on HCM rejection becomes a major surface area.
- **C — Hybrid (selected).** Sync attempt with outbox fallback, plus
  reconciliation as a safety net. Achieves correctness ≈ A and UX ≈ B for
  the common case where HCM is healthy, and degrades gracefully otherwise.

### 6.2 Snapshot vs ledger (D5)

- **Snapshot-only.** Smaller footprint; simpler for reads. But every "where
  did this number come from?" question becomes archaeology against logs.
- **Ledger + projection (selected).** Slight write amplification, but every
  balance change is explicit, sourced, and auditable. The brief explicitly
  flags multiple writers (anniversary, refresh, debits) — exactly the
  scenario a ledger is designed for.

### 6.3 Reservation strategy (D7)

- **Soft check at approval.** Simple, but two pending requests totalling
  more than the balance both look valid until one is approved, which surprises
  users.
- **Hard reservation (selected).** Reservation reduces "available" the
  moment a request is created. Race-free by construction.

### 6.4 Mock HCM placement (D3)

- **In-process nock interceptor.** Faster startup. Fails to test real
  network behavior — connection close handling, status parsing, content-type
  semantics, JSON marshaling.
- **Standalone Express app (selected).** The brief explicitly suggests this.
  The same mock is used by E2E tests *and* `npm run start:mock` for local
  development, so behaviors stay consistent between modes.

### 6.5 Concurrency model

- **Optimistic version column.** Best on Postgres; on SQLite the writer
  serialization renders this redundant and adds retry complexity.
- **Pessimistic per-transaction (selected).** SQLite's single-writer model
  serializes balance mutations naturally. We use TypeORM's `transaction()`
  helper.

### 6.6 Migration vs synchronize

- **Migrations.** Production-correct. Adds bootstrapping cost for a
  take-home.
- **`synchronize: true` (selected for dev/test).** The schema follows from
  entity decorators; reviewers can run the project with `npm install && npm
  start:dev`. Production deployment would flip this and run migrations; the
  knob is in `DATABASE_SYNCHRONIZE`.

## 7. API Contract

Base path: `/api/v1`. JWT required unless marked Public.

| Method | Path | Auth | Notes |
|--------|------|------|-------|
| `GET`  | `/balances/:employeeId/:locationId` | employee (self) / manager / admin | Returns balance + reservedDays + availableDays + lastHcmSyncAt |
| `POST` | `/balances/:employeeId/:locationId/refresh` | manager / admin | Forces a HCM realtime fetch and updates snapshot |
| `POST` | `/requests` | employee / manager / admin | Body: `{locationId, startDate, endDate, reason?}`. Header: `Idempotency-Key` (recommended) |
| `GET`  | `/requests/:id` | employee (self) / manager / admin | |
| `GET`  | `/requests?employeeId=&status=` | manager / admin | Filterable list |
| `POST` | `/requests/:id/approve` | manager / admin | Triggers HCM debit; returns final state (`COMMITTED` / `APPROVED` / `FAILED`) |
| `POST` | `/requests/:id/reject` | manager / admin | Body: `{reason?}` |
| `POST` | `/requests/:id/cancel` | employee (owner) / manager / admin | Body: `{reason?}` |
| `POST` | `/hcm/batch-ingest` | header `x-hcm-secret` | HCM-side caller; body: `{batchId, asOf, entries: [{employeeId, locationId, balance}]}` |
| `POST` | `/admin/reconcile` | admin | Manually triggers full drift reconciliation |
| `GET`  | `/admin/outbox` | admin | Inspect outbox events |
| `POST` | `/admin/outbox/drain` | admin | Process due events synchronously (used by tests and ops) |
| `GET`  | `/healthz` | Public | Liveness + HCM reachability |

Every domain or HCM error returns a structured body:
`{ statusCode, error, message }`. `error` is the symbolic code
(`INSUFFICIENT_BALANCE`, `INVALID_DIMENSION`, `HCM_TIMEOUT`, etc.) so clients
can branch on outcome without parsing free-text.

## 8. Data Model

```
balance_snapshots(employee_id, location_id, balance_days REAL, reserved_days REAL,
                  version INT, last_hcm_sync_at, updated_at,
                  PRIMARY KEY (employee_id, location_id))

balance_ledger(id UUID PK, employee_id, location_id, delta REAL, type, source,
               request_id NULLABLE, actor, reason, occurred_at,
               hcm_idempotency_key NULLABLE UNIQUE)

time_off_requests(id UUID PK, employee_id, location_id, start_date, end_date,
                  days_requested REAL, status, reason, created_by,
                  approved_by NULLABLE, rejected_reason NULLABLE,
                  hcm_commit_id NULLABLE, idempotency_key UNIQUE NULLABLE,
                  created_at, updated_at, version)

outbox_events(id UUID PK, aggregate_type, aggregate_id, event_type, payload TEXT,
              status, attempts INT, next_attempt_at, last_error,
              idempotency_key UNIQUE, created_at, updated_at)

audit_log(id UUID PK, actor, action, entity_type, entity_id,
          before_json NULLABLE, after_json NULLABLE, occurred_at)

idempotency_records(key PK, method, path, request_hash, response_status,
                    response_body, created_at)
```

### Invariants

1. `balance_days >= 0` and `reserved_days >= 0` at all times.
2. `reserved_days = SUM(days_requested)` over PENDING + APPROVED requests for
   the same `(employee_id, location_id)`. Maintained transactionally.
3. The ledger is append-only at the application layer. There is no UPDATE
   path; corrections are new entries.
4. `balance_snapshots.balance_days = SUM(balance_ledger.delta)` for the same
   `(employee_id, location_id)`. Verified by reconciliation tests.
5. HCM-driven writes carry a non-null `hcm_idempotency_key` and are unique by
   that key.

### Balance precision

All arithmetic is performed in *tenths of a day* (integer multiples of
`SCALE = 10`). 0.1-day precision is enough for half-day leave and prevents
floating-point drift across long ledger sequences. See `apps/timeoff/src/domain/balance.ts`.

## 9. Failure Modes & Recovery

| Scenario | Response |
|----------|----------|
| HCM 5xx during approve | Sync attempt fails with retryable error → outbox enqueue → request stays `APPROVED`. Worker drains when HCM recovers. |
| HCM timeout | Same as 5xx; circuit breaker may fast-fail subsequent calls until cooldown elapses. |
| HCM `INSUFFICIENT_BALANCE` (terminal) | Request → `FAILED`, reservation released, ledger records the contradiction (`HCM_SYNC_ADJUST`). |
| HCM `INVALID_DIMENSION` (terminal) | Same as above; rejected reason stored on the request for manager review. |
| HCM idempotency key replay | HCM mock and contract: same key returns the original commit id without double-debiting. |
| Outbox poison message | After `OUTBOX_MAX_ATTEMPTS` the row becomes `DEAD`; `last_error` is preserved; admin sees it via `GET /admin/outbox`. |
| Batch ingest with secret missing/wrong | 401, batch ignored. |
| Batch ingest where new balance < currently-reserved days | Newest pending requests are flagged `FAILED` with `rejected_reason` explaining the override; older requests are preserved. |
| Drift detected outside batch | `POST /admin/reconcile` performs the same recovery; cron hook available but disabled by default. |
| Crash mid-transaction | Atomic — TypeORM transaction rolls back; nothing partially committed. |
| Crash between HCM debit and local commit | Outbox + idempotency key make the next worker tick re-issue the same debit; HCM dedupes; local state advances to `COMMITTED`. |

## 10. Security Considerations

- **Authentication.** A `Bearer` JWT signed with `JWT_SECRET`. The token
  carries `sub` (user id), `employeeId`, and `role`. In production, replace
  with a real IdP integration (Auth0, Cognito, SAML).
- **Authorization.** A `JwtAuthGuard` validates the token; a `RolesGuard`
  enforces `@Roles(...)` metadata. Per-controller logic enforces
  ownership where the role alone isn't enough (employees scoped to their
  own employeeId, request cancel restricted to owner).
- **Inbound validation.** `class-validator` + `whitelist: true` rejects
  unknown fields. `IsDateString`, `IsString`, `MinLength`, etc., are applied
  to every public DTO.
- **Batch ingest.** Uses a shared symmetric secret today. Future: rotate
  via secrets manager, sign payloads with HCM's key, accept only mTLS-
  authenticated callers.
- **Rate limiting.** Out of scope here; in production, gate via API gateway.
- **PII.** No SSN/financials are stored. Audit log stores actor identifiers
  and entity changes; no free-text PII is logged at info level.
- **Idempotency.** Both HCM-side (via `idempotency_key`) and client-side
  (`Idempotency-Key` header on `POST /requests`).

## 11. Observability

- **Structured logs** through NestJS's logger (`@nestjs/common` + console).
  In production, swap the transport for JSON to ship to a log aggregator.
- **Audit trail** in `audit_log` for every balance/request mutation.
- **Outbox visibility** via `GET /admin/outbox`; depth + dead-letter count
  are inspectable.
- **Health probe** at `GET /healthz` — returns `degraded` when HCM is
  unreachable so a load balancer can drain the instance.
- **Metrics hooks.** Counter increments are co-located with state
  transitions; in production, wire `@willsoto/nestjs-prometheus` to expose
  request count, outbox depth, reconciliation drift count, circuit state.

## 12. Testing Strategy

The deliverable is graded on test rigor. We layered the tests intentionally:

### 12.1 Unit (pure, fast)

- `domain/balance` — toUnits/toDays round-trip, available, reserve, release,
  commit, applyDelta, setAbsolute. Validates 0.1-day precision and edge
  cases (over-reservation, going negative, exact-boundary reservations).
- `domain/request` — every valid and every invalid state transition; date
  range validity; reservation invariant per status.
- `domain/ledger` — projection from event stream; integrity violation when
  events would project negative.
- `hcm/retry` — exponential backoff math; jitter envelope; retry policy
  respects `retryable` flag.
- `hcm/circuit-breaker` — CLOSED → OPEN → HALF_OPEN → CLOSED transitions;
  business errors do not trip the breaker.
- `auth/guards` — JWT bearer extraction, role enforcement, public bypass.

### 12.2 Integration (real SQLite, NestJS testing module)

- `persistence/balance-repository` — round-trip writes; idempotency unique
  index; serialized back-to-back transaction semantics.
- `requests-lifecycle` — full lifecycle through HTTP using `supertest` with
  the testing module: happy path, insufficient balance, double-booking,
  cancel/reject reservation release, idempotent create with header,
  outbox enqueue on retryable HCM failure, terminal HCM failure.

### 12.3 E2E (NestJS HTTP ↔ Express HCM mock over real HTTP)

- `happy-path` — end-to-end flow with HCM, ledger, and audit assertions.
- `hcm-failures` — outbox enqueue on 5xx, drain to COMMITTED, terminal
  errors, idempotent debit replay, dead-lettering after exhausted retries.
- `hcm-batch-and-drift` — anniversary bonus via batch, over-reservation
  override, missing/wrong batch secret, manual reconcile detecting drift.
- `auth-and-access` — unauthenticated rejected, employee/manager/admin
  authorization boundaries.
- `health` — degraded when HCM down.

### 12.4 Coverage

`jest --coverage` produces an HTML report under `coverage/`. The bar:
≥ 85% statements, ≥ 80% branches, ≥ 85% functions, enforced by
`coverageThreshold` in `jest.config.ts`. The submission zip includes the
HTML output as proof of coverage.

## 13. Future Work

- **Multiple leave types** (vacation, sick, personal) — schema multiplies by
  type, but the logic and controllers stay structurally identical.
- **Postgres migration** — replace SQLite for production-scale concurrency,
  enable optimistic locking with `version` column, and use
  `LISTEN`/`NOTIFY` for outbox notification instead of polling.
- **Real auth backend** — IdP integration; service-to-service mTLS for HCM.
- **Webhooks** — push request lifecycle events to ExampleHR's web app.
- **Event bus** instead of an outbox — once the org has Kafka/SNS, the
  outbox becomes a guaranteed-delivery wrapper around it.
- **Metrics + tracing** — Prometheus + OpenTelemetry.
- **Holiday calendar / business-day counting** — separate service or HCM
  dimension.

---

**Appendices**

- API code: [apps/timeoff/src/](../apps/timeoff/src/)
- HCM mock: [apps/hcm-mock/src/](../apps/hcm-mock/src/)
- Tests: [test/](../test/)
- README with run/test/coverage instructions: [README.md](../README.md)
