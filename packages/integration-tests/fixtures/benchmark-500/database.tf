resource "aws_db_instance" "rds_001" {
  identifier        = "bench-rds-001"
  engine            = "postgres"
  engine_version    = "15.4"
  instance_class    = "db.t3.micro"
  allocated_storage = 20
  db_name           = "benchdb001"
  username          = "admin"
  password          = var.db_password
  db_subnet_group_name = "${aws_subnet.subnet_001.id}"
  skip_final_snapshot = true
  tags = { Name = "bench-rds-001", Project = var.project }
}

resource "aws_db_instance" "rds_002" {
  identifier        = "bench-rds-002"
  engine            = "postgres"
  engine_version    = "15.4"
  instance_class    = "db.t3.micro"
  allocated_storage = 20
  db_name           = "benchdb002"
  username          = "admin"
  password          = var.db_password
  db_subnet_group_name = "${aws_subnet.subnet_002.id}"
  skip_final_snapshot = true
  tags = { Name = "bench-rds-002", Project = var.project }
}

resource "aws_db_instance" "rds_003" {
  identifier        = "bench-rds-003"
  engine            = "postgres"
  engine_version    = "15.4"
  instance_class    = "db.t3.micro"
  allocated_storage = 20
  db_name           = "benchdb003"
  username          = "admin"
  password          = var.db_password
  db_subnet_group_name = "${aws_subnet.subnet_003.id}"
  skip_final_snapshot = true
  tags = { Name = "bench-rds-003", Project = var.project }
}

resource "aws_db_instance" "rds_004" {
  identifier        = "bench-rds-004"
  engine            = "postgres"
  engine_version    = "15.4"
  instance_class    = "db.t3.micro"
  allocated_storage = 20
  db_name           = "benchdb004"
  username          = "admin"
  password          = var.db_password
  db_subnet_group_name = "${aws_subnet.subnet_004.id}"
  skip_final_snapshot = true
  tags = { Name = "bench-rds-004", Project = var.project }
}

resource "aws_db_instance" "rds_005" {
  identifier        = "bench-rds-005"
  engine            = "postgres"
  engine_version    = "15.4"
  instance_class    = "db.t3.micro"
  allocated_storage = 20
  db_name           = "benchdb005"
  username          = "admin"
  password          = var.db_password
  db_subnet_group_name = "${aws_subnet.subnet_005.id}"
  skip_final_snapshot = true
  tags = { Name = "bench-rds-005", Project = var.project }
}

resource "aws_db_instance" "rds_006" {
  identifier        = "bench-rds-006"
  engine            = "postgres"
  engine_version    = "15.4"
  instance_class    = "db.t3.micro"
  allocated_storage = 20
  db_name           = "benchdb006"
  username          = "admin"
  password          = var.db_password
  db_subnet_group_name = "${aws_subnet.subnet_006.id}"
  skip_final_snapshot = true
  tags = { Name = "bench-rds-006", Project = var.project }
}

resource "aws_db_instance" "rds_007" {
  identifier        = "bench-rds-007"
  engine            = "postgres"
  engine_version    = "15.4"
  instance_class    = "db.t3.micro"
  allocated_storage = 20
  db_name           = "benchdb007"
  username          = "admin"
  password          = var.db_password
  db_subnet_group_name = "${aws_subnet.subnet_007.id}"
  skip_final_snapshot = true
  tags = { Name = "bench-rds-007", Project = var.project }
}

resource "aws_db_instance" "rds_008" {
  identifier        = "bench-rds-008"
  engine            = "postgres"
  engine_version    = "15.4"
  instance_class    = "db.t3.micro"
  allocated_storage = 20
  db_name           = "benchdb008"
  username          = "admin"
  password          = var.db_password
  db_subnet_group_name = "${aws_subnet.subnet_008.id}"
  skip_final_snapshot = true
  tags = { Name = "bench-rds-008", Project = var.project }
}

resource "aws_db_instance" "rds_009" {
  identifier        = "bench-rds-009"
  engine            = "postgres"
  engine_version    = "15.4"
  instance_class    = "db.t3.micro"
  allocated_storage = 20
  db_name           = "benchdb009"
  username          = "admin"
  password          = var.db_password
  db_subnet_group_name = "${aws_subnet.subnet_009.id}"
  skip_final_snapshot = true
  tags = { Name = "bench-rds-009", Project = var.project }
}

resource "aws_db_instance" "rds_010" {
  identifier        = "bench-rds-010"
  engine            = "postgres"
  engine_version    = "15.4"
  instance_class    = "db.t3.micro"
  allocated_storage = 20
  db_name           = "benchdb010"
  username          = "admin"
  password          = var.db_password
  db_subnet_group_name = "${aws_subnet.subnet_010.id}"
  skip_final_snapshot = true
  tags = { Name = "bench-rds-010", Project = var.project }
}

resource "aws_db_instance" "rds_011" {
  identifier        = "bench-rds-011"
  engine            = "postgres"
  engine_version    = "15.4"
  instance_class    = "db.t3.micro"
  allocated_storage = 20
  db_name           = "benchdb011"
  username          = "admin"
  password          = var.db_password
  db_subnet_group_name = "${aws_subnet.subnet_011.id}"
  skip_final_snapshot = true
  tags = { Name = "bench-rds-011", Project = var.project }
}

resource "aws_db_instance" "rds_012" {
  identifier        = "bench-rds-012"
  engine            = "postgres"
  engine_version    = "15.4"
  instance_class    = "db.t3.micro"
  allocated_storage = 20
  db_name           = "benchdb012"
  username          = "admin"
  password          = var.db_password
  db_subnet_group_name = "${aws_subnet.subnet_012.id}"
  skip_final_snapshot = true
  tags = { Name = "bench-rds-012", Project = var.project }
}

resource "aws_db_instance" "rds_013" {
  identifier        = "bench-rds-013"
  engine            = "postgres"
  engine_version    = "15.4"
  instance_class    = "db.t3.micro"
  allocated_storage = 20
  db_name           = "benchdb013"
  username          = "admin"
  password          = var.db_password
  db_subnet_group_name = "${aws_subnet.subnet_013.id}"
  skip_final_snapshot = true
  tags = { Name = "bench-rds-013", Project = var.project }
}

resource "aws_db_instance" "rds_014" {
  identifier        = "bench-rds-014"
  engine            = "postgres"
  engine_version    = "15.4"
  instance_class    = "db.t3.micro"
  allocated_storage = 20
  db_name           = "benchdb014"
  username          = "admin"
  password          = var.db_password
  db_subnet_group_name = "${aws_subnet.subnet_014.id}"
  skip_final_snapshot = true
  tags = { Name = "bench-rds-014", Project = var.project }
}

resource "aws_db_instance" "rds_015" {
  identifier        = "bench-rds-015"
  engine            = "postgres"
  engine_version    = "15.4"
  instance_class    = "db.t3.micro"
  allocated_storage = 20
  db_name           = "benchdb015"
  username          = "admin"
  password          = var.db_password
  db_subnet_group_name = "${aws_subnet.subnet_015.id}"
  skip_final_snapshot = true
  tags = { Name = "bench-rds-015", Project = var.project }
}

resource "aws_db_instance" "rds_016" {
  identifier        = "bench-rds-016"
  engine            = "postgres"
  engine_version    = "15.4"
  instance_class    = "db.t3.micro"
  allocated_storage = 20
  db_name           = "benchdb016"
  username          = "admin"
  password          = var.db_password
  db_subnet_group_name = "${aws_subnet.subnet_016.id}"
  skip_final_snapshot = true
  tags = { Name = "bench-rds-016", Project = var.project }
}

resource "aws_db_instance" "rds_017" {
  identifier        = "bench-rds-017"
  engine            = "postgres"
  engine_version    = "15.4"
  instance_class    = "db.t3.micro"
  allocated_storage = 20
  db_name           = "benchdb017"
  username          = "admin"
  password          = var.db_password
  db_subnet_group_name = "${aws_subnet.subnet_017.id}"
  skip_final_snapshot = true
  tags = { Name = "bench-rds-017", Project = var.project }
}

resource "aws_db_instance" "rds_018" {
  identifier        = "bench-rds-018"
  engine            = "postgres"
  engine_version    = "15.4"
  instance_class    = "db.t3.micro"
  allocated_storage = 20
  db_name           = "benchdb018"
  username          = "admin"
  password          = var.db_password
  db_subnet_group_name = "${aws_subnet.subnet_018.id}"
  skip_final_snapshot = true
  tags = { Name = "bench-rds-018", Project = var.project }
}

resource "aws_db_instance" "rds_019" {
  identifier        = "bench-rds-019"
  engine            = "postgres"
  engine_version    = "15.4"
  instance_class    = "db.t3.micro"
  allocated_storage = 20
  db_name           = "benchdb019"
  username          = "admin"
  password          = var.db_password
  db_subnet_group_name = "${aws_subnet.subnet_019.id}"
  skip_final_snapshot = true
  tags = { Name = "bench-rds-019", Project = var.project }
}

resource "aws_db_instance" "rds_020" {
  identifier        = "bench-rds-020"
  engine            = "postgres"
  engine_version    = "15.4"
  instance_class    = "db.t3.micro"
  allocated_storage = 20
  db_name           = "benchdb020"
  username          = "admin"
  password          = var.db_password
  db_subnet_group_name = "${aws_subnet.subnet_020.id}"
  skip_final_snapshot = true
  tags = { Name = "bench-rds-020", Project = var.project }
}

resource "aws_db_instance" "rds_021" {
  identifier        = "bench-rds-021"
  engine            = "postgres"
  engine_version    = "15.4"
  instance_class    = "db.t3.micro"
  allocated_storage = 20
  db_name           = "benchdb021"
  username          = "admin"
  password          = var.db_password
  db_subnet_group_name = "${aws_subnet.subnet_021.id}"
  skip_final_snapshot = true
  tags = { Name = "bench-rds-021", Project = var.project }
}

resource "aws_db_instance" "rds_022" {
  identifier        = "bench-rds-022"
  engine            = "postgres"
  engine_version    = "15.4"
  instance_class    = "db.t3.micro"
  allocated_storage = 20
  db_name           = "benchdb022"
  username          = "admin"
  password          = var.db_password
  db_subnet_group_name = "${aws_subnet.subnet_022.id}"
  skip_final_snapshot = true
  tags = { Name = "bench-rds-022", Project = var.project }
}

resource "aws_db_instance" "rds_023" {
  identifier        = "bench-rds-023"
  engine            = "postgres"
  engine_version    = "15.4"
  instance_class    = "db.t3.micro"
  allocated_storage = 20
  db_name           = "benchdb023"
  username          = "admin"
  password          = var.db_password
  db_subnet_group_name = "${aws_subnet.subnet_023.id}"
  skip_final_snapshot = true
  tags = { Name = "bench-rds-023", Project = var.project }
}

resource "aws_db_instance" "rds_024" {
  identifier        = "bench-rds-024"
  engine            = "postgres"
  engine_version    = "15.4"
  instance_class    = "db.t3.micro"
  allocated_storage = 20
  db_name           = "benchdb024"
  username          = "admin"
  password          = var.db_password
  db_subnet_group_name = "${aws_subnet.subnet_024.id}"
  skip_final_snapshot = true
  tags = { Name = "bench-rds-024", Project = var.project }
}

resource "aws_db_instance" "rds_025" {
  identifier        = "bench-rds-025"
  engine            = "postgres"
  engine_version    = "15.4"
  instance_class    = "db.t3.micro"
  allocated_storage = 20
  db_name           = "benchdb025"
  username          = "admin"
  password          = var.db_password
  db_subnet_group_name = "${aws_subnet.subnet_025.id}"
  skip_final_snapshot = true
  tags = { Name = "bench-rds-025", Project = var.project }
}

resource "aws_db_instance" "rds_026" {
  identifier        = "bench-rds-026"
  engine            = "postgres"
  engine_version    = "15.4"
  instance_class    = "db.t3.micro"
  allocated_storage = 20
  db_name           = "benchdb026"
  username          = "admin"
  password          = var.db_password
  db_subnet_group_name = "${aws_subnet.subnet_026.id}"
  skip_final_snapshot = true
  tags = { Name = "bench-rds-026", Project = var.project }
}

resource "aws_db_instance" "rds_027" {
  identifier        = "bench-rds-027"
  engine            = "postgres"
  engine_version    = "15.4"
  instance_class    = "db.t3.micro"
  allocated_storage = 20
  db_name           = "benchdb027"
  username          = "admin"
  password          = var.db_password
  db_subnet_group_name = "${aws_subnet.subnet_027.id}"
  skip_final_snapshot = true
  tags = { Name = "bench-rds-027", Project = var.project }
}

resource "aws_db_instance" "rds_028" {
  identifier        = "bench-rds-028"
  engine            = "postgres"
  engine_version    = "15.4"
  instance_class    = "db.t3.micro"
  allocated_storage = 20
  db_name           = "benchdb028"
  username          = "admin"
  password          = var.db_password
  db_subnet_group_name = "${aws_subnet.subnet_028.id}"
  skip_final_snapshot = true
  tags = { Name = "bench-rds-028", Project = var.project }
}

resource "aws_db_instance" "rds_029" {
  identifier        = "bench-rds-029"
  engine            = "postgres"
  engine_version    = "15.4"
  instance_class    = "db.t3.micro"
  allocated_storage = 20
  db_name           = "benchdb029"
  username          = "admin"
  password          = var.db_password
  db_subnet_group_name = "${aws_subnet.subnet_029.id}"
  skip_final_snapshot = true
  tags = { Name = "bench-rds-029", Project = var.project }
}

resource "aws_db_instance" "rds_030" {
  identifier        = "bench-rds-030"
  engine            = "postgres"
  engine_version    = "15.4"
  instance_class    = "db.t3.micro"
  allocated_storage = 20
  db_name           = "benchdb030"
  username          = "admin"
  password          = var.db_password
  db_subnet_group_name = "${aws_subnet.subnet_030.id}"
  skip_final_snapshot = true
  tags = { Name = "bench-rds-030", Project = var.project }
}

resource "aws_dynamodb_table" "dynamo_001" {
  name         = "bench-dynamo-001"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "id"
  attribute {
    name = "id"
    type = "S"
  }
  tags = { Name = "bench-dynamo-001", Project = var.project }
}

resource "aws_dynamodb_table" "dynamo_002" {
  name         = "bench-dynamo-002"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "id"
  attribute {
    name = "id"
    type = "S"
  }
  tags = { Name = "bench-dynamo-002", Project = var.project }
}

resource "aws_dynamodb_table" "dynamo_003" {
  name         = "bench-dynamo-003"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "id"
  attribute {
    name = "id"
    type = "S"
  }
  tags = { Name = "bench-dynamo-003", Project = var.project }
}

resource "aws_dynamodb_table" "dynamo_004" {
  name         = "bench-dynamo-004"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "id"
  attribute {
    name = "id"
    type = "S"
  }
  tags = { Name = "bench-dynamo-004", Project = var.project }
}

resource "aws_dynamodb_table" "dynamo_005" {
  name         = "bench-dynamo-005"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "id"
  attribute {
    name = "id"
    type = "S"
  }
  tags = { Name = "bench-dynamo-005", Project = var.project }
}

resource "aws_dynamodb_table" "dynamo_006" {
  name         = "bench-dynamo-006"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "id"
  attribute {
    name = "id"
    type = "S"
  }
  tags = { Name = "bench-dynamo-006", Project = var.project }
}

resource "aws_dynamodb_table" "dynamo_007" {
  name         = "bench-dynamo-007"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "id"
  attribute {
    name = "id"
    type = "S"
  }
  tags = { Name = "bench-dynamo-007", Project = var.project }
}

resource "aws_dynamodb_table" "dynamo_008" {
  name         = "bench-dynamo-008"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "id"
  attribute {
    name = "id"
    type = "S"
  }
  tags = { Name = "bench-dynamo-008", Project = var.project }
}

resource "aws_dynamodb_table" "dynamo_009" {
  name         = "bench-dynamo-009"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "id"
  attribute {
    name = "id"
    type = "S"
  }
  tags = { Name = "bench-dynamo-009", Project = var.project }
}

resource "aws_dynamodb_table" "dynamo_010" {
  name         = "bench-dynamo-010"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "id"
  attribute {
    name = "id"
    type = "S"
  }
  tags = { Name = "bench-dynamo-010", Project = var.project }
}

resource "aws_dynamodb_table" "dynamo_011" {
  name         = "bench-dynamo-011"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "id"
  attribute {
    name = "id"
    type = "S"
  }
  tags = { Name = "bench-dynamo-011", Project = var.project }
}

resource "aws_dynamodb_table" "dynamo_012" {
  name         = "bench-dynamo-012"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "id"
  attribute {
    name = "id"
    type = "S"
  }
  tags = { Name = "bench-dynamo-012", Project = var.project }
}

resource "aws_dynamodb_table" "dynamo_013" {
  name         = "bench-dynamo-013"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "id"
  attribute {
    name = "id"
    type = "S"
  }
  tags = { Name = "bench-dynamo-013", Project = var.project }
}

resource "aws_dynamodb_table" "dynamo_014" {
  name         = "bench-dynamo-014"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "id"
  attribute {
    name = "id"
    type = "S"
  }
  tags = { Name = "bench-dynamo-014", Project = var.project }
}

resource "aws_dynamodb_table" "dynamo_015" {
  name         = "bench-dynamo-015"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "id"
  attribute {
    name = "id"
    type = "S"
  }
  tags = { Name = "bench-dynamo-015", Project = var.project }
}

resource "aws_dynamodb_table" "dynamo_016" {
  name         = "bench-dynamo-016"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "id"
  attribute {
    name = "id"
    type = "S"
  }
  tags = { Name = "bench-dynamo-016", Project = var.project }
}

resource "aws_dynamodb_table" "dynamo_017" {
  name         = "bench-dynamo-017"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "id"
  attribute {
    name = "id"
    type = "S"
  }
  tags = { Name = "bench-dynamo-017", Project = var.project }
}

resource "aws_dynamodb_table" "dynamo_018" {
  name         = "bench-dynamo-018"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "id"
  attribute {
    name = "id"
    type = "S"
  }
  tags = { Name = "bench-dynamo-018", Project = var.project }
}

resource "aws_dynamodb_table" "dynamo_019" {
  name         = "bench-dynamo-019"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "id"
  attribute {
    name = "id"
    type = "S"
  }
  tags = { Name = "bench-dynamo-019", Project = var.project }
}

resource "aws_dynamodb_table" "dynamo_020" {
  name         = "bench-dynamo-020"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "id"
  attribute {
    name = "id"
    type = "S"
  }
  tags = { Name = "bench-dynamo-020", Project = var.project }
}
