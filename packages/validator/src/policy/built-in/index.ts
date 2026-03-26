// ---------------------------------------------------------------------------
// Built-in policy registry
// ---------------------------------------------------------------------------

import type { PolicyDefinition } from '../types.js';
import { encryptionRequired } from './encryption-required.js';
import { ingressUnrestricted } from './ingress-unrestricted.js';
import { publicStorageBlocked } from './public-storage-blocked.js';
import { encryptionAtRest } from './encryption-at-rest.js';

export const BUILT_IN_POLICIES: readonly PolicyDefinition[] = [
  encryptionRequired,
  ingressUnrestricted,
  publicStorageBlocked,
  encryptionAtRest,
];
