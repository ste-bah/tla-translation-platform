// ---------------------------------------------------------------------------
// Compliance rule: network_open_ingress
// ---------------------------------------------------------------------------

import type { ComplianceRuleDefinition, ComplianceEvalContext, ComplianceResult } from '../types.js';
import { COMPLIANCE_CODES } from '../compliance-codes.js';

const RULE_ID = 'network_open_ingress';
const SEVERITY = 'blocker' as const;

type Checker = (ctx: ComplianceEvalContext) => ComplianceResult | null;

function fail(ctx: ComplianceEvalContext, message: string, detail?: string): ComplianceResult {
  return {
    ruleId: RULE_ID,
    resourceId: ctx.resource.sourceId,
    targetType: ctx.targetType,
    passed: false,
    severity: SEVERITY,
    code: COMPLIANCE_CODES.NETWORK_OPEN_INGRESS,
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
    code: COMPLIANCE_CODES.NETWORK_OPEN_INGRESS,
    message: 'No unrestricted ingress detected',
  };
}

// -- Helpers ----------------------------------------------------------------

const OPEN_CIDRS = new Set(['*', '0.0.0.0/0', '::/0']);

function isAllPorts(portRange: unknown): boolean {
  if (portRange === '*' || portRange === '0-65535') return true;
  if (typeof portRange === 'string' && portRange === '0') return true;
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
    const hasAllPorts = isAllPorts(destPortRange) ||
      (Array.isArray(destPortRanges) && destPortRanges.some(isAllPorts));

    if (hasOpenSource && hasAllPorts) {
      return fail(
        ctx,
        'Azure NSG allows unrestricted ingress on all ports from 0.0.0.0/0',
        `Rule: ${String(rule['name'] ?? 'unnamed')}`,
      );
    }
  }

  return pass(ctx);
};

// -- GCP firewall check -----------------------------------------------------

const checkGcpFirewall: Checker = (ctx) => {
  const direction = ctx.attributes['direction'];
  if (direction === 'EGRESS') return null; // egress rules not applicable

  const sourceRanges = ctx.attributes['source_ranges'] as string[] | undefined;
  const hasOpenSource = Array.isArray(sourceRanges) && sourceRanges.some((r) => OPEN_CIDRS.has(r));
  if (!hasOpenSource) return pass(ctx);

  const allowed = ctx.attributes['allow'] as Array<Record<string, unknown>> | undefined;
  if (!Array.isArray(allowed)) return pass(ctx);

  for (const rule of allowed) {
    const protocol = rule['protocol'];
    const ports = rule['ports'] as string[] | undefined;

    // protocol "all" means all ports
    if (protocol === 'all') {
      return fail(ctx, 'GCP firewall allows unrestricted ingress on all protocols from 0.0.0.0/0');
    }

    // No ports specified = all ports for that protocol
    if (!Array.isArray(ports) || ports.length === 0) {
      return fail(
        ctx,
        `GCP firewall allows unrestricted ingress on all ${String(protocol)} ports from 0.0.0.0/0`,
      );
    }

    if (ports.some(isAllPorts)) {
      return fail(
        ctx,
        `GCP firewall allows unrestricted ingress on all ${String(protocol)} ports from 0.0.0.0/0`,
      );
    }
  }

  return pass(ctx);
};

// -- Dispatch table ----------------------------------------------------------

const DISPATCH: Record<string, Checker> = {
  // Azure
  azurerm_network_security_group: checkAzureNsg,
  // GCP
  google_compute_firewall: checkGcpFirewall,
};

// -- Rule definition ---------------------------------------------------------

export const networkOpenIngress: ComplianceRuleDefinition = {
  id: RULE_ID,
  description: 'Blocks unrestricted ingress (0.0.0.0/0 on all ports)',
  severity: SEVERITY,
  evaluate(ctx: ComplianceEvalContext): ComplianceResult | null {
    const checker = DISPATCH[ctx.targetType];
    return checker ? checker(ctx) : null;
  },
};
