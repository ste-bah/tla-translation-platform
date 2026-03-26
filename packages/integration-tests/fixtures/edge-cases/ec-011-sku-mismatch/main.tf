resource "aws_instance" "gpu_cluster" {
  ami           = "ami-0c55b159cbfafe1f0"
  instance_type = "p3.16xlarge"

  tags = {
    Name = "ec-011-gpu-cluster"
  }
}
