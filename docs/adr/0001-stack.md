# ADR 0001: TypeScript monorepo, Postgres queue, Cloud Run, RunPod GPUs

**Status.** Accepted, September 2026.

**Context.** The only reusable code was the geothermal project's chat edge function (TypeScript, OpenAI wire format through the Lovable gateway). The team runs TypeScript and Supabase. Volume for the first year is under 10k listings a month.

**Decision.**
- Node 22 + TypeScript strict in a pnpm monorepo; packages export source, apps run with `tsx` and bundle with `tsup`.
- pg-boss on the same Postgres instead of Redis-backed queues: one datastore, transactional enqueue, retries and dead-letter built in.
- Supabase Postgres and Storage for data; Cloud Run for the stateless API and worker; RunPod Serverless for GPUs (AMALIA and VoxCPM2).
- Every provider behind an interface with a fake adapter so the pipeline runs offline in CI.

**Consequences.** No Redis to operate. Queue throughput is bounded by Postgres, which is fine below about 50 jobs a second. GPU latency depends on RunPod cold starts, mitigated by FlashBoot, network volumes and optional minimum workers.
