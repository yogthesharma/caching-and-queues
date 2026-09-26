# Sync vs async boundary

## Goal

For any endpoint, decide which work must finish **before** the response and which can happen **after** it — and do the “after” part safely.

## The question to ask

> What is the minimum the user must know has happened when they get a response?

Everything else is a candidate for background work.

## Example: signup

| Step | Sync or async | Why |
|------|---------------|-----|
| Validate input | Sync | User needs errors now |
| Insert user row in Postgres | Sync | The account must exist before we say “success” |
| Send welcome email | **Async** | Slow third party; user doesn’t wait for it |
| Add to analytics / CRM | **Async** | Nobody is waiting; retry if it fails |
| Generate avatar thumbnail | **Async** | CPU work |

The handler inserts the user, enqueues two or three jobs, and responds in milliseconds.

## The `202 Accepted` pattern

When the *main* work of a request is slow (a report, a video export), respond before it’s done:

```http
POST /reports
→ 202 Accepted
  { "reportId": "r_123", "status": "queued" }

GET /reports/r_123
→ 200 { "status": "processing" }   ...later...   { "status": "done", "url": "..." }
```

How the client finds out it’s done:

| Approach | When |
|----------|------|
| Polling `GET /reports/:id` | Simplest; fine for most apps |
| Server push (SSE / WebSocket) | Live dashboards, chat — Module 9 |
| Email / notification | Long jobs (minutes to hours) |

Use `201 Created` when the thing exists now; `202 Accepted` when you’ve only promised to do it.

## Anti-patterns (why we need a real queue)

These “work” in development and lose data in production:

```js
// 1. Fire-and-forget promise
app.post('/signup', async (req) => {
  const user = await createUser(req.body);
  sendWelcomeEmail(user); // not awaited
  return user;
});
```

- If the process restarts (deploy, crash), the email is **lost** — nothing remembers it was pending.
- If it fails, nobody **retries**.
- An unhandled rejection can crash the process.

```js
// 2. setTimeout "later"
setTimeout(() => generateReport(id), 0);
```

Same problems, plus the CPU work still runs **inside your API process** and slows every other request.

A queue fixes all three: the job is **stored** (in Redis for us), a **worker** process picks it up, and failures are **retried**.

## API process vs worker process

```
 client ──HTTP──▶ Fastify API ──enqueue──▶ Redis (queue) ──▶ Worker process
                     │                                         │
                     └────────── Postgres (source of truth) ◀──┘
```

- The **API** stays fast: validate, write, enqueue, respond.
- The **worker** does slow work and can be scaled separately (1 API, 5 workers is normal).
- A deploy or crash of either one doesn’t lose queued jobs.

We build the worker side in Modules 6–7.

## Takeaway

Respond with what must be true now; enqueue everything else. Never rely on an un-awaited promise or `setTimeout` for work that matters.
