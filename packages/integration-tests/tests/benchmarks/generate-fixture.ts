/**
 * TASK-NFR-001: Synthetic HCL Fixture Generator
 *
 * Generates valid HCL containing N aws_* resource blocks with an even
 * distribution across 10 resource types from the registry.
 *
 * Usage:
 *   import { generateFixture } from './generate-fixture.js';
 *   const hcl = generateFixture(500);
 */

// ---------------------------------------------------------------------------
// Resource type templates
// ---------------------------------------------------------------------------

/**
 * Each template is a function that takes an index (1-based) and returns
 * a complete HCL resource block string.
 */
const RESOURCE_TEMPLATES: ReadonlyArray<{
  type: string;
  generate: (index: number) => string;
}> = [
  {
    type: 'aws_s3_bucket',
    generate: (i) => `resource "aws_s3_bucket" "bucket_${pad(i)}" {
  bucket = "bench-bucket-${pad(i)}"
  tags   = { Name = "bench-s3-${pad(i)}" }
}`,
  },
  {
    type: 'aws_instance',
    generate: (i) => `resource "aws_instance" "instance_${pad(i)}" {
  ami           = "ami-0c02fb55956c7d316"
  instance_type = "t3.micro"
  tags          = { Name = "bench-ec2-${pad(i)}" }
}`,
  },
  {
    type: 'aws_vpc',
    generate: (i) => `resource "aws_vpc" "vpc_${pad(i)}" {
  cidr_block           = "10.${(i % 255) + 1}.0.0/16"
  enable_dns_hostnames = true
  tags                 = { Name = "bench-vpc-${pad(i)}" }
}`,
  },
  {
    type: 'aws_subnet',
    generate: (i) => `resource "aws_subnet" "subnet_${pad(i)}" {
  vpc_id            = "vpc-placeholder"
  cidr_block        = "10.0.${(i % 255) + 1}.0/24"
  availability_zone = "us-east-1a"
  tags              = { Name = "bench-subnet-${pad(i)}" }
}`,
  },
  {
    type: 'aws_security_group',
    generate: (i) => `resource "aws_security_group" "sg_${pad(i)}" {
  name   = "bench-sg-${pad(i)}"
  vpc_id = "vpc-placeholder"

  ingress {
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["10.0.0.0/8"]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["10.0.0.0/8"]
  }

  tags = { Name = "bench-sg-${pad(i)}" }
}`,
  },
  {
    type: 'aws_lb',
    generate: (i) => `resource "aws_lb" "lb_${pad(i)}" {
  name               = "bench-lb-${pad(i)}"
  internal           = false
  load_balancer_type = "application"
  subnets            = ["subnet-placeholder"]
  tags               = { Name = "bench-lb-${pad(i)}" }
}`,
  },
  {
    type: 'aws_ecs_service',
    generate: (i) => `resource "aws_ecs_service" "ecs_${pad(i)}" {
  name            = "bench-ecs-${pad(i)}"
  cluster         = "arn:aws:ecs:us-east-1:123456789012:cluster/bench"
  task_definition = "bench-task:1"
  desired_count   = 1
  launch_type     = "FARGATE"

  network_configuration {
    subnets = ["subnet-placeholder"]
  }

  tags = { Name = "bench-ecs-${pad(i)}" }
}`,
  },
  {
    type: 'aws_rds_cluster',
    generate: (i) => `resource "aws_rds_cluster" "rds_${pad(i)}" {
  cluster_identifier = "bench-rds-${pad(i)}"
  engine             = "aurora-postgresql"
  engine_version     = "15.4"
  master_username    = "admin"
  master_password    = "changeme"
  skip_final_snapshot = true
  tags               = { Name = "bench-rds-${pad(i)}" }
}`,
  },
  {
    type: 'aws_lambda_function',
    generate: (i) => `resource "aws_lambda_function" "lambda_${pad(i)}" {
  function_name = "bench-lambda-${pad(i)}"
  runtime       = "nodejs20.x"
  handler       = "index.handler"
  role          = "arn:aws:iam::123456789012:role/lambda-role"
  filename      = "lambda.zip"
  tags          = { Name = "bench-lambda-${pad(i)}" }
}`,
  },
  {
    type: 'aws_sqs_queue',
    generate: (i) => `resource "aws_sqs_queue" "sqs_${pad(i)}" {
  name                      = "bench-sqs-${pad(i)}"
  delay_seconds             = 0
  max_message_size          = 262144
  message_retention_seconds = 86400
  tags                      = { Name = "bench-sqs-${pad(i)}" }
}`,
  },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function pad(n: number, width = 3): string {
  return String(n).padStart(width, '0');
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Generates a string of valid HCL containing `count` aws_* resource blocks.
 *
 * Resources are distributed evenly across 10 types:
 *   aws_s3_bucket, aws_instance, aws_vpc, aws_subnet, aws_security_group,
 *   aws_lb, aws_ecs_service, aws_rds_cluster, aws_lambda_function, aws_sqs_queue
 *
 * Each resource gets a unique name like `bucket_001`, `instance_002`, etc.
 *
 * @param count - Number of resource blocks to generate (must be >= 1)
 * @returns A single HCL string with all resource blocks
 */
export function generateFixture(count: number): string {
  if (count < 1) {
    throw new Error(`generateFixture: count must be >= 1, got ${count}`);
  }

  const preamble = `terraform {
  required_version = ">= 1.5.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

provider "aws" {
  region = "us-east-1"
}

variable "project" {
  type    = string
  default = "bench"
}
`;

  const blocks: string[] = [preamble];
  const typeCount = RESOURCE_TEMPLATES.length;

  // Per-type counters so names stay unique within each type
  const counters = new Array<number>(typeCount).fill(0);

  for (let i = 0; i < count; i++) {
    const templateIdx = i % typeCount;
    const counter = counters[templateIdx]! + 1;
    counters[templateIdx] = counter;
    const template = RESOURCE_TEMPLATES[templateIdx]!;
    blocks.push(template.generate(counter));
  }

  return blocks.join('\n\n') + '\n';
}

/**
 * Returns the set of AWS resource types that the fixture generator uses.
 * Useful for building a mock registry with entries for exactly these types.
 */
export function getFixtureResourceTypes(): readonly string[] {
  return RESOURCE_TEMPLATES.map((t) => t.type);
}
