variable "region" {
  type        = string
  description = "AWS region for deployment"
  default     = "us-east-1"
}

variable "project_name" {
  type        = string
  description = "Name prefix for all resources"
  default     = "tla-ref"
}

variable "db_password" {
  type        = string
  description = "Password for the RDS instance"
  sensitive   = true
}
