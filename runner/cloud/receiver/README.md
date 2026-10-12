# Stage-1 receiver (temporary test harness)

A stand-in for the app used to prove the production runner in the cloud without the app's database. It serves RunSpecs
for a fixed plan of public queries (`PLAN_JSON`), verifies **every** callback with the real `@voidaccess/engine-client`
code (`verifyCallback`, the `ProgressEvent` zod schema, the `RunSpec` schema) and keeps the event stream per run so
`GET /report` can show gaps, duplicates, ordering and terminal events.

Deployed as the private Cloud Run service `va-r0-receiver` for the R0 proof and **deleted afterwards**. Not part of the
product. Build context: this directory + `packages/engine-client` copied to `./engine-client` (see `build.sh`).
