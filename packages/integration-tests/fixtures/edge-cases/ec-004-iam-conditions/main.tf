resource "aws_iam_role" "app_role" {
  name = "ec-004-app-role"

  assume_role_policy = "{\"Version\":\"2012-10-17\",\"Statement\":[{\"Effect\":\"Allow\",\"Principal\":{\"Service\":\"ec2.amazonaws.com\"},\"Action\":\"sts:AssumeRole\"}]}"

  tags = {
    Name = "ec-004-app-role"
  }
}
