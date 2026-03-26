// ---------------------------------------------------------------------------
// Built-in policy: ingress_unrestricted
// ---------------------------------------------------------------------------

import type { PolicyDefinition, PolicyEvalContext, PolicyResult } from '../types.js';
import { POLICY_CODES } from '../policy-codes.js';

const POLICY_ID = 'ingress_unrestricted';
const SEVERITY = 'blocker' as const;

const OPEN_CIDRS = new Set(['0.0.0.0/0', '::/0']);

function isAllProtocol(protocol: unknown): boolean {
  return protocol === '-1' || protocol === 'all';
}

function isAllPorts(fromPort: unknown, toPort: unknown): boolean {
  return (fromPort === 0 || fromPort === '0') && (toPort === 65535 || toPort === '65535');
}

function isOpenIngress(rule: Record<string, unknown>): boolean {
  const cidr = rule['cidr_blocks'] ?? rule['cidr_block'];
  const cidrs = Array.isArray(cidr) ? cidr : cidr != null ? [cidr] : [];

  const hasOpenCidr = cidrs.some((c) => typeof c === 'string' && OPEN_CIDRS.has(c));
  if (!hasOpenCidr) return false;

  const protocol = rule['protocol'];
  if (isAllProtocol(protocol)) return true;

  const fromPort = rule['from_port'];
  const toPort = rule['to_port'];
  return isAllPorts(fromPort, toPort);
}

export const ingressUnrestricted: PolicyDefinition = {
  id: POLICY_ID,
  description: 'Blocks security groups with unrestricted ingress (0.0.0.0/0 + all ports/protocol)',
  severity: SEVERITY,

  evaluate(ctx: PolicyEvalContext): PolicyResult | null {
    if (ctx.sourceType !== 'aws_security_group') return null;

    const ingress = ctx.attributes['ingress'];
    const rules: Record<string, unknown>[] = Array.isArray(ingress) ? ingress : [];

    for (const rule of rules) {
      if (rule && typeof rule === 'object' && isOpenIngress(rule as Record<string, unknown>)) {
        return {
          policyId: POLICY_ID,
          resourceId: ctx.resourceId,
          passed: false,
          severity: SEVERITY,
          code: POLICY_CODES.INGRESS_UNRESTRICTED,
          message: 'Security group has unrestricted ingress (0.0.0.0/0 with all ports or all protocol)',
        };
      }
    }

    return {
      policyId: POLICY_ID,
      resourceId: ctx.resourceId,
      passed: true,
      severity: SEVERITY,
      code: POLICY_CODES.INGRESS_UNRESTRICTED,
      message: 'Security group ingress rules are restricted',
    };
  },
};
