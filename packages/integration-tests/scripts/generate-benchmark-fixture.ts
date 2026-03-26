/**
 * generate-benchmark-fixture.ts
 *
 * Generates 500 AWS resources into fixtures/benchmark-500/ split across
 * category .tf files. Run with:
 *   npx tsx scripts/generate-benchmark-fixture.ts
 */

import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const OUT_DIR = resolve(__dirname, '../fixtures/benchmark-500');

// ---------------------------------------------------------------------------
// Distribution: 500 total
//   compute:  50 EC2 + 20 ASG = 70
//   network:  30 VPC + 60 subnet + 40 SG + 20 LB = 150
//   storage:  60 S3 + 40 EBS = 100
//   database: 30 RDS + 20 DynamoDB = 50
//   other:    30 Lambda + 20 SQS + 20 Route53 + 30 Secrets = 100
//   misc:     30 misc (SSM parameter)
//   providers/variables: metadata files
// ---------------------------------------------------------------------------

function pad(n: number, width = 3): string {
  return String(n).padStart(width, '0');
}

// ---------------------------------------------------------------------------
// providers.tf
// ---------------------------------------------------------------------------

const PROVIDERS_TF = `terraform {
  required_version = ">= 1.5.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

provider "aws" {
  region = var.region
}
`;

// ---------------------------------------------------------------------------
// variables.tf
// ---------------------------------------------------------------------------

const VARIABLES_TF = `variable "region" {
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
`;

// ---------------------------------------------------------------------------
// compute.tf — 50 EC2 + 20 ASG
// ---------------------------------------------------------------------------

function generateComputeTf(): string {
  const lines: string[] = [];

  // VPC reference for security groups (uses vpc_001 from network.tf)
  for (let i = 1; i <= 50; i++) {
    const n = pad(i);
    lines.push(`resource "aws_instance" "ec2_${n}" {`);
    lines.push(`  ami           = "ami-0c02fb55956c7d316"`);
    lines.push(`  instance_type = "t3.micro"`);
    lines.push(`  subnet_id     = "\${aws_subnet.subnet_${n}.id}"`);
    lines.push(`  tags = { Name = "bench-ec2-${n}", Project = var.project }`);
    lines.push(`}`);
    lines.push('');
  }

  for (let i = 1; i <= 20; i++) {
    const n = pad(i);
    lines.push(`resource "aws_autoscaling_group" "asg_${n}" {`);
    lines.push(`  name               = "bench-asg-${n}"`);
    lines.push(`  min_size           = 1`);
    lines.push(`  max_size           = 4`);
    lines.push(`  desired_capacity   = 2`);
    lines.push(`  vpc_zone_identifier = ["\${aws_subnet.subnet_${n}.id}"]`);
    lines.push(`  launch_template {`);
    lines.push(`    id      = "lt-placeholder-${n}"`);
    lines.push(`    version = "$Latest"`);
    lines.push(`  }`);
    lines.push(`  tags = [{ key = "Name", value = "bench-asg-${n}", propagate_at_launch = true }]`);
    lines.push(`}`);
    lines.push('');
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// network.tf — 30 VPC + 60 subnet + 40 SG + 20 LB
// ---------------------------------------------------------------------------

function generateNetworkTf(): string {
  const lines: string[] = [];

  for (let i = 1; i <= 30; i++) {
    const n = pad(i);
    lines.push(`resource "aws_vpc" "vpc_${n}" {`);
    lines.push(`  cidr_block           = "10.${i}.0.0/16"`);
    lines.push(`  enable_dns_hostnames = true`);
    lines.push(`  tags = { Name = "bench-vpc-${n}", Project = var.project }`);
    lines.push(`}`);
    lines.push('');
  }

  for (let i = 1; i <= 60; i++) {
    const n = pad(i);
    const vpcIdx = pad(((i - 1) % 30) + 1);
    lines.push(`resource "aws_subnet" "subnet_${n}" {`);
    lines.push(`  vpc_id            = "\${aws_vpc.vpc_${vpcIdx}.id}"`);
    lines.push(`  cidr_block        = "10.${((i - 1) % 30) + 1}.${i}.0/24"`);
    lines.push(`  availability_zone = "us-east-1a"`);
    lines.push(`  tags = { Name = "bench-subnet-${n}", Project = var.project }`);
    lines.push(`}`);
    lines.push('');
  }

  for (let i = 1; i <= 40; i++) {
    const n = pad(i);
    const vpcIdx = pad(((i - 1) % 30) + 1);
    lines.push(`resource "aws_security_group" "sg_${n}" {`);
    lines.push(`  name   = "bench-sg-${n}"`);
    lines.push(`  vpc_id = "\${aws_vpc.vpc_${vpcIdx}.id}"`);
    lines.push(`  ingress {`);
    lines.push(`    from_port   = 443`);
    lines.push(`    to_port     = 443`);
    lines.push(`    protocol    = "tcp"`);
    lines.push(`    cidr_blocks = ["10.0.0.0/8"]`);
    lines.push(`  }`);
    lines.push(`  egress {`);
    lines.push(`    from_port   = 0`);
    lines.push(`    to_port     = 0`);
    lines.push(`    protocol    = "-1"`);
    lines.push(`    cidr_blocks = ["10.0.0.0/8"]`);
    lines.push(`  }`);
    lines.push(`  tags = { Name = "bench-sg-${n}", Project = var.project }`);
    lines.push(`}`);
    lines.push('');
  }

  for (let i = 1; i <= 20; i++) {
    const n = pad(i);
    const subnetIdx = pad(i);
    lines.push(`resource "aws_lb" "lb_${n}" {`);
    lines.push(`  name               = "bench-lb-${n}"`);
    lines.push(`  internal           = false`);
    lines.push(`  load_balancer_type = "application"`);
    lines.push(`  subnets            = ["\${aws_subnet.subnet_${subnetIdx}.id}"]`);
    lines.push(`  tags = { Name = "bench-lb-${n}", Project = var.project }`);
    lines.push(`}`);
    lines.push('');
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// storage.tf — 60 S3 + 40 EBS
// ---------------------------------------------------------------------------

function generateStorageTf(): string {
  const lines: string[] = [];

  for (let i = 1; i <= 60; i++) {
    const n = pad(i);
    lines.push(`resource "aws_s3_bucket" "s3_${n}" {`);
    lines.push(`  bucket = "bench-bucket-${n}-\${var.project}"`);
    lines.push(`  tags   = { Name = "bench-s3-${n}", Project = var.project }`);
    lines.push(`}`);
    lines.push('');
  }

  for (let i = 1; i <= 40; i++) {
    const n = pad(i);
    lines.push(`resource "aws_ebs_volume" "ebs_${n}" {`);
    lines.push(`  availability_zone = "us-east-1a"`);
    lines.push(`  size              = 20`);
    lines.push(`  type              = "gp3"`);
    lines.push(`  tags = { Name = "bench-ebs-${n}", Project = var.project }`);
    lines.push(`}`);
    lines.push('');
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// database.tf — 30 RDS + 20 DynamoDB
// ---------------------------------------------------------------------------

function generateDatabaseTf(): string {
  const lines: string[] = [];

  for (let i = 1; i <= 30; i++) {
    const n = pad(i);
    const subnetIdx = pad(i % 60 || 60);
    lines.push(`resource "aws_db_instance" "rds_${n}" {`);
    lines.push(`  identifier        = "bench-rds-${n}"`);
    lines.push(`  engine            = "postgres"`);
    lines.push(`  engine_version    = "15.4"`);
    lines.push(`  instance_class    = "db.t3.micro"`);
    lines.push(`  allocated_storage = 20`);
    lines.push(`  db_name           = "benchdb${n}"`);
    lines.push(`  username          = "admin"`);
    lines.push(`  password          = var.db_password`);
    lines.push(`  db_subnet_group_name = "\${aws_subnet.subnet_${subnetIdx}.id}"`);
    lines.push(`  skip_final_snapshot = true`);
    lines.push(`  tags = { Name = "bench-rds-${n}", Project = var.project }`);
    lines.push(`}`);
    lines.push('');
  }

  for (let i = 1; i <= 20; i++) {
    const n = pad(i);
    lines.push(`resource "aws_dynamodb_table" "dynamo_${n}" {`);
    lines.push(`  name         = "bench-dynamo-${n}"`);
    lines.push(`  billing_mode = "PAY_PER_REQUEST"`);
    lines.push(`  hash_key     = "id"`);
    lines.push(`  attribute {`);
    lines.push(`    name = "id"`);
    lines.push(`    type = "S"`);
    lines.push(`  }`);
    lines.push(`  tags = { Name = "bench-dynamo-${n}", Project = var.project }`);
    lines.push(`}`);
    lines.push('');
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// other.tf — 30 Lambda + 20 SQS + 20 Route53 + 30 Secrets
// ---------------------------------------------------------------------------

function generateOtherTf(): string {
  const lines: string[] = [];

  for (let i = 1; i <= 30; i++) {
    const n = pad(i);
    lines.push(`resource "aws_lambda_function" "lambda_${n}" {`);
    lines.push(`  function_name = "bench-lambda-${n}"`);
    lines.push(`  runtime       = "nodejs20.x"`);
    lines.push(`  handler       = "index.handler"`);
    lines.push(`  role          = "arn:aws:iam::123456789012:role/lambda-role"`);
    lines.push(`  filename      = "lambda-${n}.zip"`);
    lines.push(`  tags = { Name = "bench-lambda-${n}", Project = var.project }`);
    lines.push(`}`);
    lines.push('');
  }

  for (let i = 1; i <= 20; i++) {
    const n = pad(i);
    lines.push(`resource "aws_sqs_queue" "sqs_${n}" {`);
    lines.push(`  name                      = "bench-sqs-${n}"`);
    lines.push(`  delay_seconds             = 0`);
    lines.push(`  max_message_size          = 262144`);
    lines.push(`  message_retention_seconds = 86400`);
    lines.push(`  tags = { Name = "bench-sqs-${n}", Project = var.project }`);
    lines.push(`}`);
    lines.push('');
  }

  for (let i = 1; i <= 20; i++) {
    const n = pad(i);
    lines.push(`resource "aws_route53_zone" "zone_${n}" {`);
    lines.push(`  name = "bench-${n}.example.com"`);
    lines.push(`  tags = { Name = "bench-zone-${n}", Project = var.project }`);
    lines.push(`}`);
    lines.push('');
  }

  for (let i = 1; i <= 30; i++) {
    const n = pad(i);
    lines.push(`resource "aws_secretsmanager_secret" "secret_${n}" {`);
    lines.push(`  name        = "bench/secret-${n}"`);
    lines.push(`  description = "Benchmark secret ${n}"`);
    lines.push(`  tags = { Name = "bench-secret-${n}", Project = var.project }`);
    lines.push(`}`);
    lines.push('');
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// misc.tf — 30 SSM parameters (misc category)
// ---------------------------------------------------------------------------

function generateMiscTf(): string {
  const lines: string[] = [];

  for (let i = 1; i <= 30; i++) {
    const n = pad(i);
    lines.push(`resource "aws_ssm_parameter" "param_${n}" {`);
    lines.push(`  name  = "/bench/param-${n}"`);
    lines.push(`  type  = "String"`);
    lines.push(`  value = "bench-value-${n}"`);
    lines.push(`  tags = { Name = "bench-param-${n}", Project = var.project }`);
    lines.push(`}`);
    lines.push('');
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main(): void {
  if (!existsSync(OUT_DIR)) {
    mkdirSync(OUT_DIR, { recursive: true });
  }

  const files: Record<string, string> = {
    'providers.tf': PROVIDERS_TF,
    'variables.tf': VARIABLES_TF,
    'compute.tf': generateComputeTf(),
    'network.tf': generateNetworkTf(),
    'storage.tf': generateStorageTf(),
    'database.tf': generateDatabaseTf(),
    'other.tf': generateOtherTf(),
    'misc.tf': generateMiscTf(),
  };

  for (const [filename, content] of Object.entries(files)) {
    const filePath = resolve(OUT_DIR, filename);
    writeFileSync(filePath, content, 'utf8');
    console.log(`  wrote ${filename}`);
  }

  // Resource count summary
  const counts = {
    EC2: 50,
    ASG: 20,
    VPC: 30,
    Subnet: 60,
    'Security Group': 40,
    'Load Balancer': 20,
    S3: 60,
    EBS: 40,
    RDS: 30,
    DynamoDB: 20,
    Lambda: 30,
    SQS: 20,
    'Route53 Zone': 20,
    'Secrets Manager': 30,
    'SSM Parameter': 30,
  };

  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  console.log('\nResource distribution:');
  for (const [type, count] of Object.entries(counts)) {
    console.log(`  ${type.padEnd(20)} ${count}`);
  }
  console.log(`  ${'TOTAL'.padEnd(20)} ${total}`);
  console.log(`\nFixture generated at: ${OUT_DIR}`);
}

main();
