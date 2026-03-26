resource "aws_instance" "bootstrap" {
  ami           = "ami-0c55b159cbfafe1f0"
  instance_type = "t3.micro"

  provisioner "local-exec" {
    command = "echo ${self.private_ip} >> inventory.txt"
  }

  tags = {
    Name = "ec-009-bootstrap"
  }
}
