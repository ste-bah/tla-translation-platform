resource "aws_cloudwatch_metric_alarm" "cpu_high" {
  alarm_name          = "ec-010-cpu-high"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 2
  metric_name         = "CPUUtilization"
  namespace           = "AWS/EC2"
  period              = 120
  statistic           = "Average"
  threshold           = 80

  tags = {
    Name = "ec-010-cpu-high"
  }
}
