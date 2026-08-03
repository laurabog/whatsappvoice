# Database Setup

## Recommendation

Use hosted Postgres for this project.

The app will soon need to receive WhatsApp webhooks from the public internet, so the database should be reachable from a deployed API service. A local-only database is useful for isolated development, but it creates extra setup work and does not help much with the upcoming WhatsApp test-number milestone.

Best first choice: Neon Postgres.

Why Neon fits this beta:

- It is real Postgres.
- It provides normal Postgres connection strings.
- It supports pooled connection strings through PgBouncer.
- It is lightweight for small, intermittent beta usage.
- It can later be used from Render, Railway, Fly.io, or another Node host.

Good alternatives:

- Supabase Postgres if you want a richer dashboard and may later want auth/storage.
- Railway Postgres if you deploy the API on Railway.
- Render Postgres if you deploy the API on Render, but note that Render's free Postgres databases currently expire after 30 days.

Avoid for this project:

- MongoDB, because the app relies on relational constraints and idempotency.
- Firebase/Firestore, because the job queue and uniqueness semantics are better in Postgres.
- SQLite, because the app will need a deployed multi-process API and worker.

## Required Environment Variables

Create a local `.env` file from `.env.example`:

```sh
cp .env.example .env
```

Then set:

```text
DATABASE_URL=postgresql://...
TEST_DATABASE_URL=postgresql://...
```

`DATABASE_URL` is used by the app and migration runner.

`TEST_DATABASE_URL` is optional but recommended. It lets `npm run test:db` run real repository tests without touching the main development database.

Do not commit `.env`.

## Neon Setup

1. Create a Neon project.
2. Create or select a database for development.
3. Copy the pooled connection string if available.
4. Paste it into `.env` as `DATABASE_URL`.
5. For local scripts, make sure the connection string includes SSL settings such as `sslmode=require` if Neon provides them.

Then run:

```sh
npm run db:check
npm run db:migrate
```

For integration tests, create a separate test database or branch and set:

```text
TEST_DATABASE_URL=postgresql://...
```

Then run:

```sh
npm run test:db
```

## Commands

Check connectivity:

```sh
npm run db:check
```

Apply migrations:

```sh
npm run db:migrate
```

Run normal tests:

```sh
npm test
```

Run real database integration tests:

```sh
npm run test:db
```

If `TEST_DATABASE_URL` is not set, the database integration test skips safely.

## References

- Neon connection pooling: https://neon.com/docs/connect/connection-pooling
- Render free database limitations: https://render.com/docs/free
- Railway Postgres `DATABASE_URL`: https://docs.railway.com/databases/postgresql
