# PairUp — Decommissioning runbook

> **Status:** template, finalised during Phase 3.
> **Owner:** Service Owner (Jon Buckley) + FCDO DPO sign-off at T-30.
> **HLD references:** §10 (GDPR / data minimisation / retention), §15 (Phase 5 wind-down), §16.1 (Decommission slips → mitigated by this runbook).

The service is provisioned with a planned ~6-month operating window from go-live (Phase 4). Decommissioning is a first-class design step (HLD §3 "Planned decommissioning"), not an afterthought. This runbook documents the exact sequence so retention obligations, snapshot destruction, and Terraform teardown all happen in order.

## Timeline

| Day | Action | Owner |
|---|---|---|
| **T-30** | In-app banner announcing shutdown date; service-owner email to all `users.email`. | Service Owner |
| **T-14** | "Export my data" prompt rendered prominently on every page load. | Service Owner |
| **T-7** | Final reminder email; confirm DPO is aware of T-0. | Service Owner |
| **T-0** | Ingress removed (Container App `ca-pairup-web` → `min_replicas=0`, ingress disabled). Final Postgres snapshot taken via `az postgres flexible-server backup create`. | Engineering |
| **T+30** | Final snapshot destroyed per FCDO retention policy. `terraform destroy` for the prod stack. ACR repo + Log Analytics workspace retained per customer policy if requested; otherwise also destroyed. | Engineering + DPO |

## Runbook — T-0 (cutover)

```bash
# Pre-flight: confirm we're talking to the right environment.
az account set --subscription "$AZURE_SUBSCRIPTION_ID"
az configure --defaults group=$RESOURCE_GROUP

# 1. Take the final Postgres snapshot. Reference its name in the audit
#    record so it can be destroyed at T+30.
SNAPSHOT_NAME="pairup-final-$(date +%Y%m%d)"
az postgres flexible-server backup create \
  --resource-group "$RESOURCE_GROUP" \
  --name "$POSTGRES_FLEX_NAME" \
  --backup-name "$SNAPSHOT_NAME"

# 2. Disable ingress so no further traffic reaches the app.
az containerapp ingress disable \
  -n ca-pairup-web -g "$RESOURCE_GROUP"

# 3. Scale to zero so the app no longer accepts requests internally.
az containerapp update -n ca-pairup-web -g "$RESOURCE_GROUP" \
  --min-replicas 0 --max-replicas 0

# 4. Audit-log the cutover (run this against the still-bootable DB before
#    destroying it, via psql + the migrate-cli).
psql "$DATABASE_URL" \
  -c "INSERT INTO audit_log (action, target, metadata) VALUES \
      ('decommission.cutover', '$SNAPSHOT_NAME', '{\"phase\":\"T-0\"}');"

# 5. Capture the final state of the audit log + a sanitised user count for
#    the handover record (no PII).
psql "$DATABASE_URL" -c "SELECT count(*) FROM users" > /tmp/handover-counts.txt
psql "$DATABASE_URL" -c "SELECT action, count(*) FROM audit_log GROUP BY action ORDER BY 1" \
  > /tmp/handover-audit.txt
```

## Runbook — T+30 (final destruction)

```bash
# 1. Destroy the final snapshot.
az postgres flexible-server backup delete \
  --resource-group "$RESOURCE_GROUP" \
  --name "$POSTGRES_FLEX_NAME" \
  --backup-name "$SNAPSHOT_NAME" --yes

# 2. Terraform destroy. Run plan first to confirm the blast radius.
cd infra/terraform
terraform plan -destroy -var-file=envs/prod.tfvars
terraform apply -destroy -var-file=envs/prod.tfvars

# 3. Purge soft-deleted Key Vault if needed (HLD note: tenant policy
#    requires purge_protection_enabled, so KV survives 90 days regardless).
#    Document the KV name + soft-delete date in handover.

# 4. Archive Terraform state (no PII; safe to retain) to long-term blob
#    storage outside the project's RG.
```

## What survives the wind-down

- **Audit log handover summary** (counts only, no PII) — kept by Service Owner for 1 year per FCDO records-management policy.
- **DPIA** ([docs/dpia.md](dpia.md)) — kept indefinitely.
- **This runbook** + Terraform state archive — kept by Engineering for post-mortem reference.

## What is irrevocably destroyed

- Postgres Flexible Server (database + PITR backups + final snapshot at T+30).
- Container App revisions + image history in ACR.
- Log Analytics retention rolls off naturally (30 days).
- Session cookies become unusable the moment ingress is disabled (PITR has no value once auth is gone).

## Risks the runbook mitigates

| HLD §16.1 risk | Mitigation here |
|---|---|
| Decommission slips (retention breach) | Hard T+30 destruction step with explicit `--backup-delete` and `terraform destroy` commands. |
| User data still accessible after T-0 | Ingress disabled before any further reads possible. |
| Backup persists after final wind-down | Snapshot name captured at T-0, destroyed by name at T+30. |
| Audit history lost | Counts + grouped action log archived to Service Owner before DB destruction. |

## Sign-off chain

- **T-30** — Service Owner notifies users.
- **T-14** — DPO acknowledges retention plan.
- **T-0** — Engineering + Service Owner pair on cutover; DPO observes.
- **T+30** — Engineering + DPO pair on final destruction; Service Owner archives the handover summary.
