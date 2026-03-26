// ---------------------------------------------------------------------------
// AWS static pricing tables (on-demand, us-east-1, approximate)
// Last updated: 2024-10-01
// These are ESTIMATES ONLY — see STANDARD_CAVEATS in cost-estimator.ts
// ---------------------------------------------------------------------------

/** ISO date string of when these prices were last verified. */
export const AWS_PRICING_LAST_UPDATED = '2024-10-01';

// ---------------------------------------------------------------------------
// Compute — EC2 on-demand hourly prices (USD, us-east-1, Linux)
// Top 20 most-common instance types
// ---------------------------------------------------------------------------

export interface InstancePrice {
  readonly vcpu: number;
  readonly memoryGb: number;
  /** USD per hour */
  readonly hourlyUsd: number;
}

export const AWS_INSTANCE_PRICING: Readonly<Record<string, InstancePrice>> = {
  't3.micro':    { vcpu: 2,  memoryGb: 1,   hourlyUsd: 0.0104  },
  't3.small':    { vcpu: 2,  memoryGb: 2,   hourlyUsd: 0.0208  },
  't3.medium':   { vcpu: 2,  memoryGb: 4,   hourlyUsd: 0.0416  },
  't3.large':    { vcpu: 2,  memoryGb: 8,   hourlyUsd: 0.0832  },
  't3.xlarge':   { vcpu: 4,  memoryGb: 16,  hourlyUsd: 0.1664  },
  't3.2xlarge':  { vcpu: 8,  memoryGb: 32,  hourlyUsd: 0.3328  },
  'm5.large':    { vcpu: 2,  memoryGb: 8,   hourlyUsd: 0.096   },
  'm5.xlarge':   { vcpu: 4,  memoryGb: 16,  hourlyUsd: 0.192   },
  'm5.2xlarge':  { vcpu: 8,  memoryGb: 32,  hourlyUsd: 0.384   },
  'm5.4xlarge':  { vcpu: 16, memoryGb: 64,  hourlyUsd: 0.768   },
  'c5.large':    { vcpu: 2,  memoryGb: 4,   hourlyUsd: 0.085   },
  'c5.xlarge':   { vcpu: 4,  memoryGb: 8,   hourlyUsd: 0.170   },
  'c5.2xlarge':  { vcpu: 8,  memoryGb: 16,  hourlyUsd: 0.340   },
  'c5.4xlarge':  { vcpu: 16, memoryGb: 32,  hourlyUsd: 0.680   },
  'r5.large':    { vcpu: 2,  memoryGb: 16,  hourlyUsd: 0.126   },
  'r5.xlarge':   { vcpu: 4,  memoryGb: 32,  hourlyUsd: 0.252   },
  'r5.2xlarge':  { vcpu: 8,  memoryGb: 64,  hourlyUsd: 0.504   },
  'r5.4xlarge':  { vcpu: 16, memoryGb: 128, hourlyUsd: 1.008   },
  'p3.2xlarge':  { vcpu: 8,  memoryGb: 61,  hourlyUsd: 3.06    },
  'g4dn.xlarge': { vcpu: 4,  memoryGb: 16,  hourlyUsd: 0.526   },
};

/** Fallback per-vCPU hourly rate when instance type is not in the table. */
export const AWS_DEFAULT_VCPU_HOURLY_USD = 0.05;
/** Fallback per-GB-RAM hourly rate when instance type is not in the table. */
export const AWS_DEFAULT_RAM_GB_HOURLY_USD = 0.006;

// ---------------------------------------------------------------------------
// Storage — S3 / EBS / EFS  (USD per GB-month, approximate)
// ---------------------------------------------------------------------------

export interface StorageTierPrice {
  /** USD per GB per month */
  readonly gbMonthUsd: number;
  /** USD per million I/O operations (0 if not applicable) */
  readonly ioPerMillionUsd: number;
}

export const AWS_STORAGE_PRICING: Readonly<Record<string, StorageTierPrice>> = {
  's3_standard':          { gbMonthUsd: 0.023, ioPerMillionUsd: 0.005 },
  's3_intelligent_tiering': { gbMonthUsd: 0.023, ioPerMillionUsd: 0.005 },
  's3_standard_ia':       { gbMonthUsd: 0.0125, ioPerMillionUsd: 0.01  },
  's3_glacier':           { gbMonthUsd: 0.004,  ioPerMillionUsd: 0.05  },
  'ebs_gp2':              { gbMonthUsd: 0.10,  ioPerMillionUsd: 0      },
  'ebs_gp3':              { gbMonthUsd: 0.08,  ioPerMillionUsd: 0      },
  'ebs_io1':              { gbMonthUsd: 0.125, ioPerMillionUsd: 0.065  },
  'ebs_io2':              { gbMonthUsd: 0.125, ioPerMillionUsd: 0.065  },
  'ebs_st1':              { gbMonthUsd: 0.045, ioPerMillionUsd: 0      },
  'ebs_sc1':              { gbMonthUsd: 0.015, ioPerMillionUsd: 0      },
  'efs_standard':         { gbMonthUsd: 0.30,  ioPerMillionUsd: 0      },
  'efs_infrequent':       { gbMonthUsd: 0.025, ioPerMillionUsd: 0      },
};

/** Default storage price when tier is not recognised. */
export const AWS_DEFAULT_STORAGE_GB_MONTH_USD = 0.08;

// ---------------------------------------------------------------------------
// Database — RDS on-demand monthly prices (USD, us-east-1, single-AZ)
// ---------------------------------------------------------------------------

export interface DatabaseInstancePrice {
  readonly vcpu: number;
  readonly memoryGb: number;
  /** USD per hour */
  readonly hourlyUsd: number;
}

export const AWS_DATABASE_PRICING: Readonly<Record<string, DatabaseInstancePrice>> = {
  // MySQL / PostgreSQL / MariaDB
  'db.t3.micro':   { vcpu: 2,  memoryGb: 1,   hourlyUsd: 0.017  },
  'db.t3.small':   { vcpu: 2,  memoryGb: 2,   hourlyUsd: 0.034  },
  'db.t3.medium':  { vcpu: 2,  memoryGb: 4,   hourlyUsd: 0.068  },
  'db.m5.large':   { vcpu: 2,  memoryGb: 8,   hourlyUsd: 0.171  },
  'db.m5.xlarge':  { vcpu: 4,  memoryGb: 16,  hourlyUsd: 0.342  },
  'db.m5.2xlarge': { vcpu: 8,  memoryGb: 32,  hourlyUsd: 0.684  },
  'db.m5.4xlarge': { vcpu: 16, memoryGb: 64,  hourlyUsd: 1.368  },
  'db.r5.large':   { vcpu: 2,  memoryGb: 16,  hourlyUsd: 0.24   },
  'db.r5.xlarge':  { vcpu: 4,  memoryGb: 32,  hourlyUsd: 0.48   },
  'db.r5.2xlarge': { vcpu: 8,  memoryGb: 64,  hourlyUsd: 0.96   },
  'db.r5.4xlarge': { vcpu: 16, memoryGb: 128, hourlyUsd: 1.92   },
  // Aurora Serverless fallback
  'aurora.serverless.v2': { vcpu: 2, memoryGb: 4, hourlyUsd: 0.12 },
};

/** RDS storage: USD per GB per month (gp2). */
export const AWS_RDS_STORAGE_GB_MONTH_USD = 0.115;
/** Default DB instance fallback hourly price. */
export const AWS_DEFAULT_DB_HOURLY_USD = 0.10;

// ---------------------------------------------------------------------------
// Networking — NAT Gateway, Load Balancers, Data Transfer (approximate)
// ---------------------------------------------------------------------------

/** NAT Gateway: USD per hour. */
export const AWS_NAT_GATEWAY_HOURLY_USD = 0.045;
/** NAT Gateway: USD per GB of data processed. */
export const AWS_NAT_GATEWAY_PER_GB_USD = 0.045;

/** ALB: USD per hour. */
export const AWS_ALB_HOURLY_USD = 0.008;

/** NLB: USD per hour. */
export const AWS_NLB_HOURLY_USD = 0.006;

/** Data transfer out to internet: USD per GB (first 10 TB tier). */
export const AWS_DATA_TRANSFER_OUT_USD = 0.09;
/** Assumed monthly data transfer out (GB) for estimation when unknown. */
export const AWS_ASSUMED_DATA_TRANSFER_GB = 100;
