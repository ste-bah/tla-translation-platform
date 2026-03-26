resource "aws_kinesis_stream" "events" {
  name             = "ec-012-events"
  shard_count      = 2
  retention_period = 48

  tags = {
    Name = "ec-012-events"
  }
}
