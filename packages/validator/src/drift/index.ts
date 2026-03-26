// ---------------------------------------------------------------------------
// Drift module barrel  (TASK-GAP-007)
// ---------------------------------------------------------------------------

export { detectDrift } from './drift-detector.js';
export { saveSnapshot, loadSnapshot } from './snapshot-manager.js';
export type {
  DriftEntry,
  AttributeChange,
  DriftModification,
  DriftSummary,
  DriftReport,
} from './drift-types.js';
