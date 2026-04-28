variable "resource_group_name" { type = string }
variable "location" { type = string }
variable "tenant_id" { type = string }

variable "name_prefix" { type = string }
variable "region_tag" { type = string }

variable "log_analytics_retention_days" {
  type    = number
  default = 30
}

variable "container_image" { type = string }

variable "enable_postgres_flex" {
  type    = bool
  default = false
}

variable "postgres_admin_login" {
  type    = string
  default = "pairup_admin"
}

variable "postgres_sku" {
  type    = string
  default = "B_Standard_B2s"
}

variable "tags" {
  type    = map(string)
  default = {}
}
