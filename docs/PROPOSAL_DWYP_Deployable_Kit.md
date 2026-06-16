# PROPOSAL — DWYP Deployable Kit (Lane A)
STATUS: exploring

**Premise (locked inputs, hub 2026-06-12):**

| Input | Value |
|---|---|
| Model | Clone-per-client kit. "One step from bespoke." Not self-serve SaaS. |
| Operator | Audra (+ assistant, eventually). Audra + Claude build instance 1; Audra does per-client customization. |
| Codebase | Master codebase lives in Audra's Drive. |
| Scale | 2–5 instances over years 1–2. |
| Client account | Google Workspace required. |
| AI costs | Client brings own keys (Claude/Gemini/GCP). |

**Companion doc:** `PROPOSAL_DWYP_Schema_Reckoning.md` — its Phases 0–2 are a hard prerequisite (W1).

---

## 1. Product Definition

**In the box:** the GAS pipeline (Secretary → Herald → Vert/Bridge → Pulse → Mending → Filing), the web app (Tasks home, Studio, Episode Review, Schedule), the Master Sheet schema, the Drive folder taxonomy, the Master Template prompt architecture, the GCS review-playback path, Make posting integration.

**Not in the box (stays human):** recording (Riverside), editing (DaVinci), reel cutting, proxy export. The kit assumes a producer-shaped human exists per show. Content authoring per client (brand voice, slot recipes) is a guided service step, not software.

**Good bones already in place:** the bootstrap pattern (`getGovernance()` → `MASTER_SHEET_ID` from Script Properties) means each cloned script project resolves its own instance by construction — no multi-tenancy code needed. No-hardcoded-strings + Master Template `extractPrompt` sections mean per-client behavior is data, not code. These two decisions are why Lane A is viable at all.

---

## 2. The Unresolved Fork: Hosting Posture

"Codebase in my Drive" is decided. Where each instance's *data and execution* live is not.

| | (a) Agency-hosted | (b) Client-hosted clone |
|---|---|---|
| What | Everything (script, sheet, Drive tree, GCS) in Audra's Workspace; client users access the web app as external/added users. Today's JT model, replicated. | Script project copy + sheet + Drive tree provisioned inside the client's Workspace. Master code stays in Audra's Drive; pushed to client copies. |
| Data ownership | Audra's. Offboarding = export project. | Client's. Offboarding = revoke Audra's access. Selling point. |
| OAuth verification | Likely required — external Google accounts hitting a web app with broad scopes. | Avoided — app is internal to client org. |
| Quota pooling | All instances share Audra's account quotas (trigger runtime, UrlFetch). Fine at 2–5; a ceiling later. | Per-client quotas. Clean. |
| Customization | Trivial — it's all hers. | Push discipline required (W7). |
| BYO keys fit | Awkward — client's keys in Audra's Script Properties. Workable. | Natural. |
| Ops burden | Lowest. One account, one console. | Higher — N consoles, N GCP projects, access management. |

**Lean:** (a) for instance 1–2 — it's literally the existing architecture, zero new work. Re-decide at instance 3 with real client data-ownership and verification pressure in hand. The kit's provisioning work (W2) should be written posture-neutral where cheap.

---

## 3. Workstreams

Effort: S / M / L. Order ≈ dependency order.

### W1 — Schema freeze (prerequisite) — M
Reckoning Phases 0–2 complete before instance 2 exists. Every shipped clone freezes the schema; post-deploy schema fixes are N-way migrations by hand. Includes: status-axis consolidation (D1), enum hygiene (D6), closed Workflow_Step vocabulary (D7), sentinel removal (D12).

### W2 — Provisioning automation — M
A `provisionInstance()` runbook (script + checklist hybrid) that produces:

| Artifact | Source | Automatable? |
|---|---|---|
| Master Sheet | **Sanitized template sheet** — built from reckoned schema, never cloned from the live sheet (live sheet contains keys, PII, PINs, real episodes) | Yes |
| Drive root tree (RAW_PRODUCTION, STAGING_DRAFTS, Contact Library, corpus, image libraries, archives…) | Folder-taxonomy spec | Yes |
| Governance_Config seeding | Guided wizard: per-instance IDs auto-filled as artifacts are created; client-specific values (calendar ID, host email, podcast name) prompted | Mostly |
| Script Properties (`MASTER_SHEET_ID`, keys) | Wizard | Yes |
| Master Template copy | Template doc + W9 content pass | Copy yes; content no |
| Calendar + trigger installs (Daily Pulse, nightly housekeeping) | Checklist | Partial (trigger install is manual UI or scripted) |
| GCS bucket + signBlob + CORS, Vertex corpus, Make scenarios | W6 checklist | No — documented manual steps |

### W3 — Identity & auth — S/M
PIN-in-sheet retired → Google identity (`Session.getActiveUser()` within the hosting org). User_Registry keeps roles/buckets, drops PINs. Execute-as decision rides the hosting posture: (a) keeps execute-as-me; (b) wants execute-as-user-accessing examined. Touches `validatePin()` and login flow only — small if done after reckoning, before instance 2.

### W4 — Secrets & key plumbing — S
**Corrected 2026-06-14:** Reckoning D5 **declined** moving keys to Script Properties — keys stay in Governance_Config. Rotation was decided separately (rotate now). So the BYO-key slot is **not** Script Properties; it is the **Model Control Layer Governance role rows** (`role → provider + model + key-ref`) per `PROPOSAL_DWYP_Model_Control_Layer.md`. Re-base this work item on MCL when it scopes; the lines below referencing "keys in Script Properties" (comparison table, W-sequencing) need the same correction. Plus: BYO-key failure UX. A client's exhausted Anthropic credit must surface as "Your Claude account needs attention" on the affected surface — not a silent fallback or an Audit_Trail-only stack trace. One error-mapping pass over `callClaude`/`callGeminiAPI` paths.

### W5 — Quota profile — S (because Workspace is required)
Workspace requirement preserves the 30-min execution ceiling — the 20-min reel-analysis guard survives. Remaining items: document per-instance trigger schedule; if posture (a), note that 2–5 Daily Pulses share one account's daily trigger-runtime budget (fine at this scale; named ceiling). Consumer-account support is explicitly **out of scope** — record as a non-goal so it doesn't creep.

### W6 — External services per instance — L (heaviest; partially non-automatable)

| Service | Per-instance work | Notes |
|---|---|---|
| GCP project | Create/designate project, enable `iamcredentials`, bucket, signBlob grant on SA, CORS pin | AD #122 pain was wiseonewithin-org-specific; client orgs have *different* org policies — expect variance every time. Posture (a) dodges this entirely (reuse existing project; per-instance bucket paths). |
| Vertex RAG corpus | Create corpus (us-south1/Spanner per AD #93), wire `STUDIO_CORPUS_ID` | Per-show cost; client GCP billing under BYO. |
| Make.com | Clone scenarios, rebind connections, posting targets | Client's Make account or Audra's? Sub-decision of posture. |
| Riverside | Link in Governance_Config | No integration; config only. |

### W7 — Update distribution & customization boundary — S engineering, M discipline
At 2–5 instances: clasp multi-push (one script, N `scriptId`s). GAS library refactor is the ~5+ crossover; don't pay it now. The load-bearing rule is the **customization boundary**: core `.js`/`.html` files are never edited per-client; per-client deltas live *only* in Governance_Config values and Master Template sections. Any client need that can't be expressed there is a feature request against the core, not a fork. Without this rule, instance 3 is unmergeable within a quarter.

### W8 — OAuth verification & scopes — S to assess, M if triggered
Posture (b): app is internal to client org — no Google verification. Posture (a) with external client accounts: verification likely, restricted-scope review possible (Drive + Calendar + Gmail scopes). Assess precisely when posture is decided; budget calendar time, not just work.

### W9 — Content onboarding (the bespoke step, productized as process) — M, recurring per client
Per client: brand-voice interview → Master Template sections (`# Host Voice`, `# Voice Prohibitions`, `# Caption Mechanics`, `# Show Philosophy`, `# Pillars`…), Posting_Schedule slot recipes with `Why` cells, Content Sensitivity doc. Deliverable of this workstream: an interview script + a guided Claude session that drafts the sections from the interview, Audra edits. This is where "one step from bespoke" lives — keep it a craft step; do not attempt to automate voice.

### W10 — Commercial & ops — out of engineering scope, listed for completeness
Pricing, ToS, data-ownership statement (writes itself under posture (b)), support expectations, offboarding/export procedure, assistant-facing runbook (the operator one day isn't Audra — W2's checklist is also the assistant's training doc).

---

## 4. Decision Queue

| # | Decision | Lean |
|---|---|---|
| K1 | Hosting posture: agency-hosted (a) vs client-hosted clone (b) | (a) for instances 1–2; re-decide at 3 |
| K2 | Make scenarios: client's Make account or Audra's | Rides K1 |
| K3 | Consumer-account support | No — record as non-goal |
| K4 | Auth replacement shape (Google identity mechanics, execute-as) | After K1 |
| K5 | Template-sheet build: hand-built from reckoned schema vs scripted generator | Hand-built once, script later if churn |
| K6 | Customization boundary rule — adopt as cardinal rule? | Yes — candidate for CLAUDE.md/Reference when kit work opens |

## 5. Sequencing

| Stage | Contents | Gate |
|---|---|---|
| 0 | Reckoning Phases 0–2 (W1) + D5 secrets | Decisions D1–D12 |
| 1 | K1 posture decision; W3 auth; W4 key plumbing | Reckoning landed |
| 2 | W2 provisioning runbook + sanitized template sheet; W6 checklist written | — |
| 3 | W9 onboarding process authored; W7 boundary rule adopted | — |
| 4 | Instance 2 (first real client) — run the runbook, time every step, fix the runbook | Stages 1–3 |
| 5 | W8 verification if K1=(a); W10 commercial | Before client 2 onboards |

Instance 2 is the validation event: the runbook is the product; the client is the test.

---

*Relationship to current build: none of this blocks Phase 3.1 shell re-layout or in-flight spokes. The only ordering constraint is reckoning-before-instance-2.*
