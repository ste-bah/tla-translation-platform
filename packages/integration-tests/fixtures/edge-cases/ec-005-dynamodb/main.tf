resource "aws_dynamodb_table" "orders" {
  name         = "ec-005-orders"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "pk"
  range_key    = "sk"

  attribute {
    name = "pk"
    type = "S"
  }

  attribute {
    name = "sk"
    type = "S"
  }

  global_secondary_index {
    name            = "gsi-by-sk"
    hash_key        = "sk"
    projection_type = "ALL"
  }

  tags = {
    Name = "ec-005-orders"
  }
}
