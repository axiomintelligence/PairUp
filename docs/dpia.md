# PairUp — Data Protection Impact Assessment (DPIA)

> **Status:** template — must be reviewed and signed by the **FCDO Data Protection Officer** before Phase 2 (private beta) admits live data.
> **Version:** 1.0 (template)
> **References:** HLD v1.0 §10 (GDPR & Privacy), §16.2 (Phase 2 gate).

## 1. Purpose

PairUp helps FCDO staff find compatible job-share partners by matching on grade, directorate, location, and complementary working-day patterns. The service is operated by AXIOM Intelligence Ltd on behalf of FCDO, hosted in the customer Azure tenant, for a planned ~6-month operating window.

## 2. Data controller / processor

- **Controller:** Foreign, Commonwealth & Development Office (FCDO).
- **Processor:** AXIOM Intelligence Ltd, building and operating the service in the FCDO Azure tenant under contract.
- **Sub-processors:** Microsoft Azure (UK South region only) — Container Apps, Postgres Flexible Server, Container Registry, Log Analytics, Entra ID. No other sub-processors.

## 3. Lawful basis

Per UK GDPR Art. 6:

- **Article 6(1)(f) — legitimate interests** for storing identity (name, work email) and matching gates (grade, directorate, location, days). Legitimate interest: an internal HR tool for the controller's staff.
- **Article 6(1)(a) — explicit consent** at publication. The user actively chooses "Publish" to enter the matching pool; profiles default to `draft` and are not visible to other users until published.

## 4. Data minimisation

| Field | Source | Necessary because |
|---|---|---|
| `entra_oid` | Entra ID `oid` claim | Stable account identifier; required for upsert / re-login. |
| `email` | Entra ID `email` claim | Display + admin-allowlist gating. |
| `display_name` | Entra ID `name` claim | Shown on match cards. |
| `is_admin` | Entra ID `roles` claim | Admin authorisation. |
| `last_seen_at` | Server timestamp | Recency factor in matching score. |
| `profile.*` (grade, directorates, location, days, FTE, availability, skills, free-text notes) | User-entered | Required to compute matches and present candidate cards. |
| `connection_requests` | User-initiated | Workflow state for connection requests. |
| `connections` | Server-derived | Resulting accepted pairs. |
| `audit_log` | Server-derived | Required for security review + GDPR right-of-access subject-access requests. |

**Not collected:** profile photos, IP addresses on profiles, organisational tree metadata, calendar / availability data, free-text mentioning third parties (validated at submit time). PII fields are redacted from logs at emission (HLD §9.2).

## 5. Data subject rights

| Right | Endpoint / mechanism |
|---|---|
| **Right of access** (UK GDPR Art. 15) | `GET /api/me/export` returns the user's full record + connections + audit summary as a JSON download. |
| **Right to erasure** (Art. 17) | `DELETE /api/me` cascades the user's row across `profiles`, `sessions`, `dismissals`, `search_prefs`, `connection_requests`, `connections`. `audit_log` survives with `actor_user_id = NULL` so security-incident traceability is preserved without persisting PII. |
| **Right to rectification** (Art. 16) | `PUT /api/profile/me` and the in-product profile editor. Identity fields (`entra_oid`, `email`, `name`) are re-synced from Entra ID at every sign-in. |
| **Right to data portability** (Art. 20) | Same `GET /api/me/export` JSON bundle. |
| **Right to object** (Art. 21) | Unpublish the profile (`POST /api/profile/me/unpublish`) — removes from matching pool but retains the draft. Or `DELETE /api/me`. |

## 6. Retention

- **Live data:** for the operating lifespan of the service (~6 months from Phase 4 go-live).
- **PITR backups:** 7 days (Postgres Flexible Server PITR window — HLD §11).
- **Logs:** Log Analytics retention 30 days (HLD §11).
- **Audit log:** retained until decommissioning at T+30; then a counts-only handover summary kept for 1 year per FCDO records-management policy.
- **Final snapshot:** taken at T-0; destroyed at T+30. See [decommission.md](decommission.md).

## 7. Security measures (HLD §9)

- **No long-lived secrets.** All credentials are either Azure managed identity (no value leaves Azure) or random opaque tokens in Postgres (session ids, CSRF tokens). Entra token exchange uses a federated credential on the ACA MI.
- **Server-side opaque session cookies** (HttpOnly, Secure, SameSite=Lax, 8h idle / 24h absolute). Authority is the `sessions` row; revocation = `DELETE`.
- **CSRF** double-submit token on all state-changing routes.
- **Strict CSP** — `default-src 'self'`, no inline scripts, no inline styles.
- **Postgres** reachable only via private endpoint in prod; AAD auth via the same MI (Phase 1+).
- **Per-user rate limits** + 50-open-pending-request hard cap mitigate bulk-contact abuse.
- **Admin blast radius.** Admins cannot impersonate, cannot edit other users' profiles, cannot read raw profile JSON. Allowlist + scoring weights only.
- **PII redaction at log emission.** `email`, `entra_oid`, `id_token`, session/CSRF tokens never reach Log Analytics.
- **Pre-Phase-2 security review** aligned with OWASP ASVS Level 1 (HLD §9.3).

## 8. Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| Profile content leaks via SSR / over-fetch | Low | Stage-1 SQL pre-filter strips fields the viewer isn't authorised to see. zod response schemas enforce shape. |
| Unauthorised access via stolen cookies | Low | Server-side sessions are revocable; `DELETE FROM sessions` is immediate. SameSite=Lax + Secure + HttpOnly on the session cookie. |
| Admin role grant abuse | Medium | Admin role grants are made in the FCDO Entra Enterprise Apps blade, audited by the customer. Admin actions are limited (HLD §5.4) and audit-logged. |
| Breach disclosure / notification | Low | Notifiable breach criteria documented; FCDO and AXIOM share a breach-response runbook (separate document). |
| Decommission retention breach | Low | T+30 hard destruction documented in [decommission.md](decommission.md); `terraform destroy` is the canonical step. |

## 9. Cross-border transfers

None. All data resides in **Azure UK South** (HLD §3 / §12 data residency requirement). Entra ID metadata may transit Microsoft's global identity services in the course of authentication; this is covered by FCDO's existing Microsoft 365 contractual safeguards.

## 10. Data Protection Officer sign-off

The DPO must review this DPIA before Phase 2 (private beta — first time live FCDO data is admitted) per HLD §15 / §16.2.

| Signature | Name | Date |
|---|---|---|
| __________________ | FCDO DPO | __________________ |
| __________________ | Service Owner | __________________ |
| __________________ | Lead Engineer (AXIOM) | __________________ |

## 11. Review

This DPIA is reviewed:
- Before each rollout phase (HLD §15).
- Whenever the data model changes materially (e.g. new fields, new sub-processor).
- At decommissioning, to confirm the destruction plan from [decommission.md](decommission.md) was executed.
