variable "region" {
  type    = string
  default = "us-east-1"
}

variable "project" {
  type    = string
  default = "bench"
}

variable "db_password" {
  type      = string
  sensitive = true
  default   = "changeme"
}
