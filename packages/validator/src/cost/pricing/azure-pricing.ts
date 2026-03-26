// ---------------------------------------------------------------------------
// Azure static pricing tables (pay-as-you-go, East US, approximate)
// Last updated: 2024-10-01
// These are ESTIMATES ONLY — see STANDARD_CAVEATS in cost-estimator.ts
// ---------------------------------------------------------------------------

/** ISO date string of when these prices were last verified. */
export const AZURE_PRICING_LAST_UPDATED = '2024-10-01';

// ---------------------------------------------------------------------------
// Compute — Azure VM on-demand hourly prices (USD, East US, Linux)
// Mapped to approximate AWS equivalents for comparison
// ---------------------------------------------------------------------------

export interface AzureInstancePrice {
  readonly vcpu: number;
  readonly memoryGb: number;
  /** USD per hour */
  readonly hourlyUsd: number;
}

/** Key = equivalent AWS instance type for cross-mapping. */
export const AZURE_INSTANCE_PRICING: Readonly<Record<string, AzureInstancePrice>> = {
  // B-series (burstable) ~ t3
  't3.micro':    { vcpu: 2,  memoryGb: 1,   hourlyUsd: 0.0124  },  // B1ms
  't3.small':    { vcpu: 2,  memoryGb: 2,   hourlyUsd: 0.0248  },  // B1s x2
  't3.medium':   { vcpu: 2,  memoryGb: 4,   hourlyUsd: 0.0496  },  // B2s
  't3.large':    { vcpu: 2,  memoryGb: 8,   hourlyUsd: 0.0992  },  // B2ms
  't3.xlarge':   { vcpu: 4,  memoryGb: 16,  hourlyUsd: 0.1984  },  // B4ms
  't3.2xlarge':  { vcpu: 8,  memoryGb: 32,  hourlyUsd: 0.3968  },  // B8ms
  // D-series (general) ~ m5
  'm5.large':    { vcpu: 2,  memoryGb: 8,   hourlyUsd: 0.096   },  // D2s_v3
  'm5.xlarge':   { vcpu: 4,  memoryGb: 16,  hourlyUsd: 0.192   },  // D4s_v3
  'm5.2xlarge':  { vcpu: 8,  memoryGb: 32,  hourlyUsd: 0.384   },  // D8s_v3
  'm5.4xlarge':  { vcpu: 16, memoryGb: 64,  hourlyUsd: 0.768   },  // D16s_v3
  // F-series (compute) ~ c5
  'c5.large':    { vcpu: 2,  memoryGb: 4,   hourlyUsd: 0.094   },  // F2s_v2
  'c5.xlarge':   { vcpu: 4,  memoryGb: 8,   hourlyUsd: 0.188   },  // F4s_v2
  'c5.2xlarge':  { vcpu: 8,  memoryGb: 16,  hourlyUsd: 0.376   },  // F8s_v2
  'c5.4xlarge':  { vcpu: 16, memoryGb: 32,  hourlyUsd: 0.752   },  // F16s_v2
  // E-series (memory) ~ r5
  'r5.large':    { vcpu: 2,  memoryGb: 16,  hourlyUsd: 0.126   },  // E2s_v3
  'r5.xlarge':   { vcpu: 4,  memoryGb: 32,  hourlyUsd: 0.252   },  // E4s_v3
  'r5.2xlarge':  { vcpu: 8,  memoryGb: 64,  hourlyUsd: 0.504   },  // E8s_v3
  'r5.4xlarge':  { vcpu: 16, memoryGb: 128, hourlyUsd: 1.008   },  // E16s_v3
  // GPU ~ p3 / g4dn
  'p3.2xlarge':  { vcpu: 6,  memoryGb: 112, hourlyUsd: 3.168   },  // NC6s_v3
  'g4dn.xlarge': { vcpu: 4,  memoryGb: 16,  hourlyUsd: 0.602   },  // NV4as_v4
};

/** Fallback per-vCPU hourly rate. */
export const AZURE_DEFAULT_VCPU_HOURLY_USD = 0.052;
/** Fallback per-GB-RAM hourly rate. */
export const AZURE_DEFAULT_RAM_GB_HOURLY_USD = 0.007;

// ---------------------------------------------------------------------------
// Storage — Blob / Managed Disk (USD per GB-month, approximate)
// ---------------------------------------------------------------------------

export interface AzureStorageTierPrice {
  /** USD per GB per month */
  readonly gbMonthUsd: number;
  /** USD per 10 000 operations (0 if not applicable) */
  readonly opsPer10kUsd: number;
}

export const AZURE_STORAGE_PRICING: Readonly<Record<string, AzureStorageTierPrice>> = {
  // Blob Storage tiers
  's3_standard':             { gbMonthUsd: 0.018, opsPer10kUsd: 0.004 },
  's3_intelligent_tiering':  { gbMonthUsd: 0.018, opsPer10kUsd: 0.004 },
  's3_standard_ia':          { gbMonthUsd: 0.01,  opsPer10kUsd: 0.01  },
  's3_glacier':              { gbMonthUsd: 0.002, opsPer10kUsd: 0.05  },
  // Managed Disk tiers
  'ebs_gp2':                 { gbMonthUsd: 0.095, opsPer10kUsd: 0     },
  'ebs_gp3':                 { gbMonthUsd: 0.076, opsPer10kUsd: 0     },
  'ebs_io1':                 { gbMonthUsd: 0.117, opsPer10kUsd: 0.06  },
  'ebs_io2':                 { gbMonthUsd: 0.117, opsPer10kUsd: 0.06  },
  'ebs_st1':                 { gbMonthUsd: 0.043, opsPer10kUsd: 0     },
  'ebs_sc1':                 { gbMonthUsd: 0.015, opsPer10kUsd: 0     },
  // Azure Files ~ EFS
  'efs_standard':            { gbMonthUsd: 0.06,  opsPer10kUsd: 0     },
  'efs_infrequent':          { gbMonthUsd: 0.02,  opsPer10kUsd: 0     },
};

/** Default storage price when tier is not recognised. */
export const AZURE_DEFAULT_STORAGE_GB_MONTH_USD = 0.076;

// ---------------------------------------------------------------------------
// Database — Azure SQL / Flexible Server hourly prices (USD, East US)
// Keys match AWS RDS instance classes for cross-mapping
// ---------------------------------------------------------------------------

export interface AzureDatabaseInstancePrice {
  readonly vcpu: number;
  readonly memoryGb: number;
  /** USD per hour */
  readonly hourlyUsd: number;
}

export const AZURE_DATABASE_PRICING: Readonly<Record<string, AzureDatabaseInstancePrice>> = {
  'db.t3.micro':    { vcpu: 1,  memoryGb: 2,   hourlyUsd: 0.018  },
  'db.t3.small':    { vcpu: 2,  memoryGb: 4,   hourlyUsd: 0.036  },
  'db.t3.medium':   { vcpu: 2,  memoryGb: 8,   hourlyUsd: 0.072  },
  'db.m5.large':    { vcpu: 2,  memoryGb: 10.2, hourlyUsd: 0.19  },
  'db.m5.xlarge':   { vcpu: 4,  memoryGb: 20.4, hourlyUsd: 0.38  },
  'db.m5.2xlarge':  { vcpu: 8,  memoryGb: 40.8, hourlyUsd: 0.76  },
  'db.m5.4xlarge':  { vcpu: 16, memoryGb: 81.6, hourlyUsd: 1.52  },
  'db.r5.large':    { vcpu: 2,  memoryGb: 16,   hourlyUsd: 0.26  },
  'db.r5.xlarge':   { vcpu: 4,  memoryGb: 32,   hourlyUsd: 0.52  },
  'db.r5.2xlarge':  { vcpu: 8,  memoryGb: 64,   hourlyUsd: 1.04  },
  'db.r5.4xlarge':  { vcpu: 16, memoryGb: 128,  hourlyUsd: 2.08  },
  'aurora.serverless.v2': { vcpu: 2, memoryGb: 4, hourlyUsd: 0.14 },
};

/** Azure Database storage: USD per GB per month. */
export const AZURE_DB_STORAGE_GB_MONTH_USD = 0.115;
/** Default DB instance fallback hourly price. */
export const AZURE_DEFAULT_DB_HOURLY_USD = 0.12;

// ---------------------------------------------------------------------------
// Networking — NAT Gateway, Load Balancer, Data Transfer
// ---------------------------------------------------------------------------

/** NAT Gateway: USD per hour (Azure VNet NAT). */
export const AZURE_NAT_GATEWAY_HOURLY_USD = 0.044;
/** NAT Gateway: USD per GB of data processed. */
export const AZURE_NAT_GATEWAY_PER_GB_USD = 0.044;

/** Azure Load Balancer standard: USD per hour. */
export const AZURE_LB_HOURLY_USD = 0.008;

/** Data transfer out to internet: USD per GB. */
export const AZURE_DATA_TRANSFER_OUT_USD = 0.087;
/** Assumed monthly data transfer out (GB) for estimation when unknown. */
export const AZURE_ASSUMED_DATA_TRANSFER_GB = 100;
