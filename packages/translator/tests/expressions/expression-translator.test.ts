import { describe, it, expect } from 'vitest';
import { translateExpression } from '../../src/expressions/expression-translator.js';
import { buildReferenceMap } from '../../src/expressions/reference-rewriter.js';
import type { ExpressionContext, ReferenceMap } from '../../src/expressions/types.js';
import type { CloudProvider } from '@tla/shared';

// ---------------------------------------------------------------------------
// Factory helpers
// ---------------------------------------------------------------------------

function makeCtx(target: CloudProvider = 'azure', refMap?: ReferenceMap): ExpressionContext {
  return {
    referenceMap: refMap ?? buildReferenceMap(),
    target,
  };
}

// ---------------------------------------------------------------------------
// translateExpression
// ---------------------------------------------------------------------------

describe('translateExpression', () => {
  // --- 1. Empty string ---------------------------------------------------

  it('returns empty string as-is with no findings', () => {
    const result = translateExpression('', makeCtx());
    expect(result.rewritten).toBe('');
    expect(result.findings).toHaveLength(0);
  });

  // --- 2. Plain literal (no dots) ----------------------------------------

  it('short-circuits plain literal without dots', () => {
    const result = translateExpression('some_value', makeCtx());
    expect(result.rewritten).toBe('some_value');
    expect(result.findings).toHaveLength(0);
  });

  // --- 3. Simple resource ref — Azure ------------------------------------

  it('rewrites aws_instance.web.id to Azure target type', () => {
    const result = translateExpression('aws_instance.web.id', makeCtx('azure'));
    expect(result.rewritten).toBe('azurerm_linux_virtual_machine.web.id');
    expect(result.findings).toHaveLength(0);
  });

  // --- 4. Simple resource ref — GCP --------------------------------------

  it('rewrites aws_instance.web.id to GCP target type', () => {
    const result = translateExpression('aws_instance.web.id', makeCtx('gcp'));
    expect(result.rewritten).toBe('google_compute_instance.web.id');
    expect(result.findings).toHaveLength(0);
  });

  // --- 5. Attribute rename -----------------------------------------------

  it('rewrites aws_instance attribute private_ip to Azure private_ip_address', () => {
    const result = translateExpression('aws_instance.web.private_ip', makeCtx('azure'));
    expect(result.rewritten).toBe('azurerm_linux_virtual_machine.web.private_ip_address');
  });

  // --- 6. Indexed ref preserves index ------------------------------------

  it('preserves bracket index in rewritten reference', () => {
    const result = translateExpression('aws_instance.web[0].id', makeCtx('azure'));
    expect(result.rewritten).toBe('azurerm_linux_virtual_machine.web[0].id');
  });

  // --- 7. Splat ref preserves splat --------------------------------------

  it('preserves splat [*] in rewritten reference', () => {
    const result = translateExpression('aws_instance.web[*].id', makeCtx('azure'));
    expect(result.rewritten).toBe('azurerm_linux_virtual_machine.web[*].id');
  });

  // --- 8. Module ref — Azure ---------------------------------------------

  it('rewrites module output vpc_id to Azure vnet_id', () => {
    const result = translateExpression('module.vpc.vpc_id', makeCtx('azure'));
    expect(result.rewritten).toBe('module.vpc.vnet_id');
    expect(result.findings).toHaveLength(0);
  });

  // --- 9. Data source — account_id Azure ---------------------------------

  it('maps data.aws_caller_identity.current.account_id to var.subscription_id for Azure', () => {
    const result = translateExpression(
      'data.aws_caller_identity.current.account_id',
      makeCtx('azure'),
    );
    expect(result.rewritten).toBe('var.subscription_id');
    expect(result.findings).toHaveLength(0);
  });

  // --- 10. Data source — account_id GCP ----------------------------------

  it('maps data.aws_caller_identity.current.account_id to var.project_id for GCP', () => {
    const result = translateExpression(
      'data.aws_caller_identity.current.account_id',
      makeCtx('gcp'),
    );
    expect(result.rewritten).toBe('var.project_id');
  });

  // --- 11. Data source — region ------------------------------------------

  it('maps data.aws_region.current.name to var.location for Azure', () => {
    const result = translateExpression(
      'data.aws_region.current.name',
      makeCtx('azure'),
    );
    expect(result.rewritten).toBe('var.location');
  });

  it('maps data.aws_region.current.name to var.region for GCP', () => {
    const result = translateExpression(
      'data.aws_region.current.name',
      makeCtx('gcp'),
    );
    expect(result.rewritten).toBe('var.region');
  });

  // --- 12. Interpolation wrapper -----------------------------------------

  it('rewrites reference inside ${...} interpolation wrapper', () => {
    const result = translateExpression(
      '${aws_instance.web.id}',
      makeCtx('azure'),
    );
    expect(result.rewritten).toBe('${azurerm_linux_virtual_machine.web.id}');
    expect(result.findings).toHaveLength(0);
  });

  // --- 13. Unknown resource type -----------------------------------------

  it('preserves original and emits warning for unknown resource type', () => {
    const result = translateExpression(
      'aws_unknown_thing.foo.bar',
      makeCtx('azure'),
    );
    expect(result.rewritten).toBe('aws_unknown_thing.foo.bar');
    expect(result.findings.length).toBeGreaterThanOrEqual(1);
    const warning = result.findings.find((f) => f.code === 'UNKNOWN_REF_TYPE');
    expect(warning).toBeDefined();
    expect(warning!.severity).toBe('warning');
  });

  // --- 14. Unknown data source -------------------------------------------

  it('preserves original and emits warning for unknown data source', () => {
    const result = translateExpression(
      'data.aws_unknown_source.thing.attr',
      makeCtx('azure'),
    );
    expect(result.rewritten).toBe('data.aws_unknown_source.thing.attr');
    const warning = result.findings.find((f) => f.code === 'UNKNOWN_DATA_SOURCE');
    expect(warning).toBeDefined();
    expect(warning!.severity).toBe('warning');
  });

  // --- 15. Nested expression — inner refs rewritten ----------------------

  it('rewrites inner reference inside cidrsubnet function call', () => {
    const result = translateExpression(
      'cidrsubnet(aws_vpc.main.cidr_block, 8, 1)',
      makeCtx('azure'),
    );
    expect(result.rewritten).toContain('azurerm_virtual_network.main.address_space');
    // cidrsubnet is a builtin — no function finding
    const funcFindings = result.findings.filter((f) => f.code === 'UNKNOWN_FUNCTION');
    expect(funcFindings).toHaveLength(0);
  });

  // --- 16. Ternary — both branches rewritten -----------------------------

  it('rewrites both branches of a ternary expression', () => {
    const result = translateExpression(
      'var.enabled ? aws_instance.a.id : aws_instance.b.id',
      makeCtx('azure'),
    );
    expect(result.rewritten).toContain('azurerm_linux_virtual_machine.a.id');
    expect(result.rewritten).toContain('azurerm_linux_virtual_machine.b.id');
  });

  // --- 17. Multiple refs in one expression -------------------------------

  it('rewrites all references when multiple appear in one expression', () => {
    const expr = 'join(",", [aws_instance.a.id, aws_subnet.main.id])';
    const result = translateExpression(expr, makeCtx('azure'));
    expect(result.rewritten).toContain('azurerm_linux_virtual_machine.a.id');
    expect(result.rewritten).toContain('azurerm_subnet.main.id');
  });

  // --- 18. No findings for known refs ------------------------------------

  it('produces no findings for fully-known resource references', () => {
    const result = translateExpression(
      'aws_s3_bucket.data.bucket',
      makeCtx('azure'),
    );
    expect(result.findings).toHaveLength(0);
    expect(result.rewritten).toBe('azurerm_storage_account.data.name');
  });

  // --- 19. mapDataSource: known data source -> provider variable ---------

  it('maps known data source via expression translator pipeline', () => {
    const result = translateExpression(
      'data.aws_partition.current.partition',
      makeCtx('azure'),
    );
    expect(result.rewritten).toBe('"azure"');
    expect(result.findings).toHaveLength(0);
  });

  // --- 20. mapDataSource: unknown data source -> null (caller handles) ---

  it('unknown data source returns original with warning (not null) at expression level', () => {
    const result = translateExpression(
      'data.aws_fancy_thing.x.y',
      makeCtx('gcp'),
    );
    expect(result.rewritten).toBe('data.aws_fancy_thing.x.y');
    expect(result.findings.some((f) => f.code === 'UNKNOWN_DATA_SOURCE')).toBe(true);
  });

  // --- 21. mapDataSource: non-data ref -> null ---------------------------

  it('non-data reference is not handled as data source', () => {
    // aws_vpc.main.cidr_block is not a data ref — should go through rewriteReference
    const result = translateExpression('aws_vpc.main.cidr_block', makeCtx('azure'));
    expect(result.rewritten).toBe('azurerm_virtual_network.main.address_space');
    expect(result.findings).toHaveLength(0);
  });

  // --- 22. mapFunction: known builtin -> null (pass through) -------------

  it('known builtin function produces no function findings', () => {
    const result = translateExpression(
      'join(",", aws_instance.web.id)',
      makeCtx('azure'),
    );
    const funcFindings = result.findings.filter((f) => f.code === 'UNKNOWN_FUNCTION');
    expect(funcFindings).toHaveLength(0);
  });

  // --- 23. mapFunction: unknown function -> info finding -----------------

  it('unknown function produces info finding', () => {
    const result = translateExpression(
      'my_custom_func(aws_instance.web.id)',
      makeCtx('azure'),
    );
    const funcFindings = result.findings.filter((f) => f.code === 'UNKNOWN_FUNCTION');
    expect(funcFindings).toHaveLength(1);
    expect(funcFindings[0]!.severity).toBe('info');
    expect(funcFindings[0]!.message).toContain('my_custom_func');
  });

  // --- Additional edge cases ---------------------------------------------

  it('handles prefix-matched data source (aws_ami)', () => {
    const result = translateExpression(
      'data.aws_ami.latest.id',
      makeCtx('azure'),
    );
    expect(result.rewritten).toBe('var.vm_image_id');
    expect(result.findings).toHaveLength(0);
  });

  it('handles prefix-matched data source for GCP', () => {
    const result = translateExpression(
      'data.aws_availability_zones.available.names',
      makeCtx('gcp'),
    );
    expect(result.rewritten).toBe('var.zones');
  });

  it('module ref with unknown output preserves original', () => {
    const result = translateExpression(
      'module.custom.my_output',
      makeCtx('azure'),
    );
    expect(result.rewritten).toBe('module.custom.my_output');
    expect(result.findings).toHaveLength(0);
  });

  it('rewrites interpolation with data source inside', () => {
    const result = translateExpression(
      '${data.aws_region.current.name}',
      makeCtx('azure'),
    );
    expect(result.rewritten).toBe('${var.location}');
  });

  it('rewrites aws_s3_bucket attribute acl to Azure access_tier', () => {
    const result = translateExpression(
      'aws_s3_bucket.logs.acl',
      makeCtx('azure'),
    );
    expect(result.rewritten).toBe('azurerm_storage_account.logs.access_tier');
  });

  it('rewrites GCP instance attribute private_ip', () => {
    const result = translateExpression(
      'aws_instance.web.private_ip',
      makeCtx('gcp'),
    );
    expect(result.rewritten).toBe('google_compute_instance.web.network_interface.network_ip');
  });

  it('non-string input returns as-is', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = translateExpression(undefined as any, makeCtx());
    expect(result.rewritten).toBe(undefined);
    expect(result.findings).toHaveLength(0);
  });
});
