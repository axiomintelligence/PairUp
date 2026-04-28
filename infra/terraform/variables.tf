variable "subscription_id" {
  description = "Azure subscription ID (Microsoft Azure Sponsorship for dev; customer subscription for prod)."
  type        = string
}

variable "tenant_id" {
  description = "Azure tenant ID."
  type        = string
}

variable "location" {
  description = "Azure region — HLD §3 mandates UK only."
  type        = string
  default     = "uksouth"
}

variable "name_prefix" {
  description = "Short name used in every resource name."
  type        = string
  default     = "pairup"
}

variable "region_tag" {
  description = "Region tag used in resource names."
  type        = string
  default     = "uksouth"
}

variable "resource_group_name" {
  description = "Resource group hosting the deployment."
  type        = string
}

variable "log_analytics_retention_days" {
  description = "Retention for the Log Analytics workspace."
  type        = number
  default     = 30
}

variable "container_image" {
  description = "Image deployed to the Container App. Defaults to the public ACA quickstart so the first apply doesn't fail when ACR is empty; PR 13 swaps to the apps/web Fastify image."
  type        = string
  default     = "mcr.microsoft.com/k8se/quickstart:latest"
}

variable "tags" {
  description = "Tags applied to every resource."
  type        = map(string)
  default = {
    app         = "pairup"
    environment = "dev"
  }
}

# ─── Phase 1 toggles (defaults match Phase 0 — flip when their PRs land) ────

variable "enable_postgres_flex" {
  description = "Provision Postgres Flexible Server (HLD §11). PR 15 / AXI-124."
  type        = bool
  default     = false
}

variable "postgres_admin_login" {
  description = "Postgres Flexible Server admin login (only used when enable_postgres_flex)."
  type        = string
  default     = "pairup_admin"
}

variable "postgres_sku" {
  description = "Postgres Flexible Server SKU (B2s for dev, D2s_v3 for prod)."
  type        = string
  default     = "B_Standard_B2s"
}
