# Exercise: Sync vs async boundary

Read: `notes/00-setup/02-sync-vs-async-boundary.md`

## Tasks

1. `POST /orders` in a food delivery app does all of this. Mark each step **sync** or **async**:
   - a. Validate cart items and prices
   - b. Charge the card via the payment provider
   - c. Insert the order row
   - d. Notify the restaurant’s tablet
   - e. Send the customer an SMS confirmation
   - f. Update the “popular dishes” ranking
2. Which HTTP status should `POST /exports` return if it only *starts* a CSV export that takes 2 minutes? What should the body contain?
3. A teammate writes this. List three things that can go wrong in production:

   ```js
   app.post('/invite', async (req) => {
     const invite = await db.createInvite(req.body);
     sendInviteEmail(invite);
     return invite;
   });
   ```

4. Why do we want the worker in a **separate process** from the Fastify API, instead of running jobs inside the API process?

## Stretch

Design the endpoints (method, path, status codes, response bodies) for a “generate yearly tax PDF” feature using the `202` pattern with polling.

---

## Solutions

1. a **sync**, b **sync** (usually — the user must know the payment worked before you promise food), c **sync**, d **async** (but fast — seconds), e **async**, f **async**.
   Note on b: some systems authorize the card sync and capture it later async. The rule is the same: whatever the response *promises* must already be true.
2. `202 Accepted`, with an id and a way to check progress, e.g. `{ "exportId": "e_9", "status": "queued", "statusUrl": "/exports/e_9" }`.
3. Any three:
   - The process restarts (deploy/crash) before the email sends → invite email lost forever.
   - The email provider fails → no retry.
   - The un-awaited promise rejects → unhandled rejection, which can crash Node.
   - Under load, thousands of pending email calls pile up in API memory.
4. Slow or CPU-heavy jobs would block the event loop and slow every HTTP request; you couldn’t scale API and workers independently; and deploying the API would interrupt running jobs.

Stretch (one reasonable design):

```
POST /tax-reports            { "year": 2025 }
→ 202 { "reportId": "t_1", "status": "queued", "statusUrl": "/tax-reports/t_1" }

GET /tax-reports/t_1
→ 200 { "status": "queued" | "processing" | "failed", ... }
→ 200 { "status": "done", "downloadUrl": "/tax-reports/t_1/file" }

GET /tax-reports/t_1/file
→ 200 application/pdf   (404 if not ready, 409 if failed)
```
