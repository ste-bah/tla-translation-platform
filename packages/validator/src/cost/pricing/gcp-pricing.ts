// ---------------------------------------------------------------------------
// GCP static pricing tables (on-demand, us-east1, approximate)
// Last updated: 2024-10-01
// These are ESTIMATES ONLY — see STANDARD_CAVEATS in cost-estimator.ts
// ---------------------------------------------------------------------------

/** ISO date string of when these prices were last verified. */
export const GCP_PRICING_LAST_UPDATED = '2024-10-01';

// ---------------------------------------------------------------------------
// Compute — Compute Engine on-demand hourly prices (USD, us-east1, Linux)
// Keys match AWS instance types for cross-mapping
// ---------------------------------------------------------------------------

export interface GcpInstancePrice {
  readonly vcpu: number;
  readonly memoryGb: number;
  /** USD per hour */
  readonly hourlyUsd: number;
}

/** Key = equivalent AWS instance type for cross-mapping. */
export const GCP_INSTANCE_PRICING: Readonly<Record<string, GcpInstancePrice>> = {
  // e2 (cost-optimised) ~ t3
  't3.micro':    { vcpu: 2,  memoryGb: 1,   hourlyUsd: 0.0084  },  // e2-micro
  't3.small':    { vcpu: 2,  memoryGb: 2,   hourlyUsd: 0.0168  },  // e2-small
  't3.medium':   { vcpu: 2,  memoryGb: 4,   hourlyUsd: 0.0335  },  // e2-medium
  't3.large':    { vcpu: 2,  memoryGb: 8,   hourlyUsd: 0.067   },  // e2-standard-2
  't3.xlarge':   { vcpu: 4,  memoryGb: 16,  hourlyUsd: 0.134   },  // e2-standard-4
  't3.2xlarge':  { vcpu: 8,  memoryGb: 32,  hourlyUsd: 0.268   },  // e2-standard-8
  // n2 (balanced) ~ m5
  'm5.large':    { vcpu: 2,  memoryGb: 8,   hourlyUsd: 0.097   },  // n2-standard-2
  'm5.xlarge':   { vcpu: 4,  memoryGb: 16,  hourlyUsd: 0.194   },  // n2-standard-4
  'm5.2xlarge':  { vcpu: 8,  memoryGb: 32,  hourlyUsd: 0.388   },  // n2-standard-8
  'm5.4xlarge':  { vcpu: 16, memoryGb: 64,  hourlyUsd: 0.776   },  // n2-standard-16
  // c2 (compute) ~ c5
  'c5.large':    { vcpu: 2,  memoryGb: 8,   hourlyUsd: 0.100   },  // c2-standard-4 /2
  'c5.xlarge':   { vcpu: 4,  memoryGb: 16,  hourlyUsd: 0.200   },  // c2-standard-4
  'c5.2xlarge':  { vcpu: 8,  memoryGb: 32,  hourlyUsd: 0.400   },  // c2-standard-8
  'c5.4xlarge':  { vcpu: 16, memoryGb: 64,  hourlyUsd: 0.800   },  // c2-standard-16
  // n2-highmem (memory) ~ r5
  'r5.large':    { vcpu: 2,  memoryGb: 16,  hourlyUsd: 0.131   },  // n2-highmem-2
  'r5.xlarge':   { vcpu: 4,  memoryGb: 32,  hourlyUsd: 0.262   },  // n2-highmem-4
  'r5.2xlarge':  { vcpu: 8,  memoryGb: 64,  hourlyUsd: 0.524   },  // n2-highmem-8
  'r5.4xlarge':  { vcpu: 16, memoryGb: 128, hourlyUsd: 1.048   },  // n2-highmem-16
  // A2 / N1-GPU ~ p3 / g4dn
  'p3.2xlarge':  { vcpu: 8,  memoryGb: 52,  hourlyUsd: 2.933   },  // a2-highgpu-1g
  'g4dn.xlarge': { vcpu: 4,  memoryGb: 15,  hourlyUsd: 0.556   },  // n1-standard-4 + T4
};

/** Fallback per-vCPU hourly rate. */
export const GCP_DEFAULT_VCPU_HOURLY_USD = 0.048;
/** Fallback per-GB-RAM hourly rate. */
export const GCP_DEFAULT_RAM_GB_HOURLY_USD = 0.0065;

// ---------------------------------------------------------------------------
// Storage — GCS / Persistent Disk (USD per GB-month, approximate)
// Keys match AWS storage tier names for cross-mapping
// ---------------------------------------------------------------------------

export interface GcpStorageTierPrice {
  /** USD per GB per month */
  readonly gbMonthUsd: number;
  /** USD per 10 000 class-A operations (0 if not applicable) */
  readonly opsPer10kUsd: number;
}

export const GCP_STORAGE_PRICING: Readonly<Record<string, GcpStorageTierPrice>> = {
  's3_standard':             { gbMonthUsd: 0.02,  opsPer10kUsd: 0.005 },
  's3_intelligent_tiering':  { gbMonthUsd: 0.02,  opsPer10kUsd: 0.005 },
  's3_standard_ia':          { gbMonthUsd: 0.01,  opsPer10kUsd: 0.01  },
  's3_glacier':              { gbMonthUsd: 0.004, opsPer10kUsd: 0.05  },
  // Persistent Disk
  'ebs_gp2':                 { gbMonthUsd: 0.04,  opsPer10kUsd: 0     },
  'ebs_gp3':                 { gbMonthUsd: 0.04,  opsPer10kUsd: 0     },
  'ebs_io1':                 { gbMonthUsd: 0.17,  opsPer10kUsd: 0     },
  'ebs_io2':                 { gbMonthUsd: 0.17,  opsPer10kUsd: 0     },
  'ebs_st1':                 { gbMonthUsd: 0.04,  opsPer10kUsd: 0     },
  'ebs_sc1':                 { gbMonthUsd: 0.02,  opsPer10kUsd: 0     },
  // Filestore ~ EFS
  'efs_standard':            { gbMonthUsd: 0.20,  opsPer10kUsd: 0     },
  'efs_infrequent':          { gbMonthUsd: 0.07,  opsPer10kUsd: 0     },
};

/** Default storage price when tier is not recognised. */
export const GCP_DEFAULT_STORAGE_GB_MONTH_USD = 0.04;

// ---------------------------------------------------------------------------
// Database — Cloud SQL on-demand hourly prices (USD, us-east1)
// Keys match AWS RDS instance classes for cross-mapping
// ---------------------------------------------------------------------------

export interface GcpDatabaseInstancePrice {
  readonly vcpu: number;
  readonly memoryGb: number;
  /** USD per hour */
  readonly hourlyUsd: number;
}

export const GCP_DATABASE_PRICING: Readonly<Record<string, GcpDatabaseInstancePrice>> = {
  'db.t3.micro':    { vcpu: 1,  memoryGb: 0.6, hourlyUsd: 0.015  },
  'db.t3.small':    { vcpu: 1,  memoryGb: 1.7, hourlyUsd: 0.030  },
  'db.t3.medium':   { vcpu: 2,  memoryGb: 4,   hourlyUsd: 0.063  },
  'db.m5.large':    { vcpu: 2,  memoryGb: 7.5, hourlyUsd: 0.153  },
  'db.m5.xlarge':   { vcpu: 4,  memoryGb: 15,  hourlyUsd: 0.306  },
  'db.m5.2xlarge':  { vcpu: 8,  memoryGb: 30,  hourlyUsd: 0.612  },
  'db.m5.4xlarge':  { vcpu: 16, memoryGb: 60,  hourlyUsd: 1.224  },
  'db.r5.large':    { vcpu: 2,  memoryGb: 16,  hourlyUsd: 0.215  },
  'db.r5.xlarge':   { vcpu: 4,  memoryGb: 32,  hourlyUsd: 0.430  },
  'db.r5.2xlarge':  { vcpu: 8,  memoryGb: 64,  hourlyUsd: 0.860  },
  'db.r5.4xlarge':  { vcpu: 16, memoryGb: 128, hourlyUsd: 1.720  },
  'aurora.serverless.v2': { vcpu: 2, memoryGb: 4, hourlyUsd: 0.13 },
};

/** Cloud SQL storage: USD per GB per month (SSD). */
export const GCP_DB_STORAGE_GB_MONTH_USD = 0.17;
/** Default DB instance fallback hourly price. */
export const GCP_DEFAULT_DB_HOURLY_USD = 0.09;

// ---------------------------------------------------------------------------
// Networking — Cloud NAT, Load Balancer, Data Transfer
// ---------------------------------------------------------------------------

/** Cloud NAT: USD per hour per gateway. */
export const GCP_NAT_GATEWAY_HOURLY_USD = 0.044;
/** Cloud NAT: USD per GB of data processed. */
export const GCP_NAT_GATEWAY_PER_GB_USD = 0.044;

/** HTTP(S) Load Balancer: USD per hour (forwarding rule). */
export const GCP_LB_HOURLY_USD = 0.008;

/** Data transfer out to internet: USD per GB. */
export const GCP_DATA_TRANSFER_OUT_USD = 0.085;
/** Assumed monthly data transfer out (GB) for estimation when unknown. */
export const GCP_ASSUMED_DATA_TRANSFER_GB = 100;
