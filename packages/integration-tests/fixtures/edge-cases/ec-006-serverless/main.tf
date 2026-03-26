resource "aws_lambda_function" "handler" {
  function_name = "ec-006-handler"
  runtime       = "nodejs20.x"
  handler       = "index.handler"
  role          = "arn:aws:iam::123456789012:role/lambda-role"
  filename      = "handler.zip"

  tags = {
    Name = "ec-006-handler"
  }
}
