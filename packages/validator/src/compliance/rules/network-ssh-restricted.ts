// ---------------------------------------------------------------------------
// Compliance rule: network_ssh_restricted
// ---------------------------------------------------------------------------

import type { ComplianceRuleDefinition, ComplianceEvalContext, ComplianceResult } from '../types.js';
import { COMPLIANCE_CODES } from '../compliance-codes.js';

const RULE_ID = 'network_ssh_restricted';
const SEVERITY = 'blocker' as const;

type Checker = (ctx: ComplianceEvalContext) => ComplianceResult | null;

function fail(ctx: ComplianceEvalContext, message: string, detail?: string): ComplianceResult {
  return {
    ruleId: RULE_ID,
    resourceId: ctx.resource.sourceId,
    targetType: ctx.targetType,
    passed: false,
    severity: SEVERITY,
    code: COMPLIANCE_CODES.NETWORK_SSH_RESTRICTED,
    message,
    detail,
  };
}

function pass(ctx: ComplianceEvalContext): ComplianceResult {
  return {
    ruleId: RULE_ID,
    resourceId: ctx.resource.sourceId,
    targetType: ctx.targetType,
    passed: true,
    severity: SEVERITY,
    code: COMPLIANCE_CODES.NETWORK_SSH_RESTRICTED,
    message: 'SSH port 22 is not open to the world',
  };
}

// -- Helpers ----------------------------------------------------------------

const OPEN_CIDRS = new Set(['*', '0.0.0.0/0', '::/0']);

function portRangeIncludesSSH(portRange: unknown): boolean {
  if (portRange === '*' || portRange === '22' || portRange === '0-65535') return true;
  if (typeof portRange !== 'string') return false;
  const parts = portRange.split('-');
  if (parts.length === 2) {
    const low = parseInt(parts[0]!, 10);
    const high = parseInt(parts[1]!, 10);
    if (!isNaN(low) && !isNaN(high) && low <= 22 && high >= 22) return true;
  }
  return false;
}

// -- Azure NSG check --------------------------------------------------------

const checkAzureNsg: Checker = (ctx) => {
  const rules = ctx.attributes['security_rule'] as Array<Record<string, unknown>> | undefined;
  if (!Array.isArray(rules)) return pass(ctx);

  for (const rule of rules) {
    const direction = rule['direction'];
    const access = rule['access'];
    if (direction !== 'Inbound' || access !== 'Allow') continue;

    const srcPrefix = rule['source_address_prefix'];
    const srcPrefixes = rule['source_address_prefixes'] as string[] | undefined;
    const destPortRange = rule['destination_port_range'];
    const destPortRanges = rule['destination_port_ranges'] as string[] | undefined;

    const hasOpenSource = OPEN_CIDRS.has(String(srcPrefix)) ||
      (Array.isArray(srcPrefixes) && srcPrefixes.some((p) => OPEN_CIDRS.has(p)));

    const hasSSH = portRangeIncludesSSH(destPortRange) ||
      (Array.isArray(destPortRanges) && destPortRanges.some(portRangeIncludesSSH));

    if (hasOpenSource && hasSSH) {
      return fail(
        ctx,
        'Azure NSG allows SSH (port 22) from 0.0.0.0/0',
        `Rule: ${String(rule['name'] ?? 'unnamed')}`,
      );
    }
  }

  return pass(ctx);
};

// -- GCP firewall check -----------------------------------------------------

const checkGcpFirewall: Checker = (ctx) => {
  const direction = ctx.attributes['direction'];
  if (direction === 'EGRESS') return null;

  const sourceRanges = ctx.attributes['source_ranges'] as string[] | undefined;
  const hasOpenSource = Array.isArray(sourceRanges) && sourceRanges.some((r) => OPEN_CIDRS.has(r));
  if (!hasOpenSource) return pass(ctx);

  const allowed = ctx.attributes['allow'] as Array<Record<string, unknown>> | undefined;
  if (!Array.isArray(allowed)) return pass(ctx);

  for (const rule of allowed) {
    const protocol = rule['protocol'];
    if (protocol === 'all') {
      return fail(ctx, 'GCP firewall allows SSH (port 22) from 0.0.0.0/0 via protocol "all"');
    }
    if (protocol !== 'tcp') continue;

    const ports = rule['ports'] as string[] | undefined;
    // No ports = all ports for tcp
    if (!Array.isArray(ports) || ports.length === 0) {
      return fail(ctx, 'GCP firewall allows all TCP ports (including SSH 22) from 0.0.0.0/0');
    }
    if (ports.some(portRangeIncludesSSH)) {
      return fail(ctx, 'GCP firewall allows SSH (port 22) from 0.0.0.0/0');
    }
  }

  return pass(ctx);
};

// -- Dispatch table ----------------------------------------------------------

const DISPATCH: Record<string, Checker> = {
  azurerm_network_security_group: checkAzureNsg,
  google_compute_firewall: checkGcpFirewall,
};

// -- Rule definition ---------------------------------------------------------

export const networkSshRestricted: ComplianceRuleDefinition = {
  id: RULE_ID,
  description: 'Blocks SSH (port 22) open to the world (0.0.0.0/0)',
  severity: SEVERITY,
  evaluate(ctx: ComplianceEvalContext): ComplianceResult | null {
    const checker = DISPATCH[ctx.targetType];
    return checker ? checker(ctx) : null;
  },
};
