// ---------------------------------------------------------------------------
// Tests for TASK-GAP-008b: Network Topology Summary Generator
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { generateTopologySummary } from '../../src/report/topology-summary.js';
import type {
  CanonicalIR,
  IrResource,
  IrRelationship,
  TranslationManifest,
  ManifestEntry,
  TranslationFinding,
} from '@tla/shared';

// ---------------------------------------------------------------------------
// Factories
// ---------------------------------------------------------------------------

const SOURCE_LOCATION = { file: 'main.tf', line: 1, column: 1 };

function makeIrResource(overrides: Partial<IrResource> = {}): IrResource {
  return {
    id: 'aws_vpc.main',
    sourceType: 'aws_vpc',
    sourceName: 'main',
    sourceModule: null,
    category: 'networking',
    attributes: {},
    sourceAttributes: {},
    registryEntryId: null,
    translationStatus: 'translated',
    confidence: 0.9,
    tags: {},
    sourceLocation: SOURCE_LOCATION,
    ...overrides,
  };
}

function makeManifestEntry(overrides: Partial<ManifestEntry> = {}): ManifestEntry {
  return {
    sourceId: 'aws_vpc.main',
    sourceType: 'aws_vpc',
    status: 'translated',
    targetResources: [],
    confidence: 0.9,
    findings: [],
    ...overrides,
  };
}

function makeFinding(overrides: Partial<TranslationFinding> = {}): TranslationFinding {
  return {
    resourceId: 'aws_vpc.main',
    severity: 'info',
    code: 'INFO_001',
    message: 'Test finding',
    ...overrides,
  };
}

function makeManifest(overrides: Partial<TranslationManifest> = {}): TranslationManifest {
  return {
    version: '1.0.0',
    registryVersion: 'v2.1.0',
    target: 'azure',
    counts: { total: 0, translated: 0, expanded: 0, partial: 0, blocked: 0, advisory: 0 },
    entries: [],
    findings: [],
    confidenceOverall: 0.9,
    ...overrides,
  };
}

function makeIr(
  resources: IrResource[] = [],
  relationships: IrRelationship[] = [],
): CanonicalIR {
  return {
    version: '1.0.0',
    sourceProvider: 'aws',
    resources,
    relationships,
    modules: [],
    intents: [],
    metadata: {
      generatedAt: '2025-01-01T00:00:00.000Z',
      sourceFiles: ['main.tf'],
      toolVersion: '1.0.0',
      resourceCount: resources.length,
      relationshipCount: relationships.length,
    },
  };
}

// ---------------------------------------------------------------------------
// Full network stack helpers
// ---------------------------------------------------------------------------

function makeFullNetworkResources(): IrResource[] {
  return [
    makeIrResource({
      id: 'aws_vpc.main',
      sourceType: 'aws_vpc',
      sourceName: 'main',
      attributes: { cidr_block: '10.0.0.0/16' },
    }),
    makeIrResource({
      id: 'aws_subnet.public',
      sourceType: 'aws_subnet',
      sourceName: 'public',
      attributes: { vpc_id: 'aws_vpc.main', cidr_block: '10.0.1.0/24' },
    }),
    makeIrResource({
      id: 'aws_subnet.private',
      sourceType: 'aws_subnet',
      sourceName: 'private',
      attributes: { vpc_id: 'aws_vpc.main', cidr_block: '10.0.2.0/24' },
    }),
    makeIrResource({
      id: 'aws_security_group.web',
      sourceType: 'aws_security_group',
      sourceName: 'web',
    }),
    makeIrResource({
      id: 'aws_lb.frontend',
      sourceType: 'aws_lb',
      sourceName: 'frontend',
      attributes: { load_balancer_type: 'application' },
    }),
    makeIrResource({
      id: 'aws_nat_gateway.nat1',
      sourceType: 'aws_nat_gateway',
      sourceName: 'nat1',
    }),
    makeIrResource({
      id: 'aws_route53_zone.example',
      sourceType: 'aws_route53_zone',
      sourceName: 'example',
    }),
    makeIrResource({
      id: 'aws_route53_record.www',
      sourceType: 'aws_route53_record',
      sourceName: 'www',
    }),
  ];
}

// ---------------------------------------------------------------------------
// 1. Full network stack
// ---------------------------------------------------------------------------

describe('generateTopologySummary — full network stack', () => {
  const resources = makeFullNetworkResources();
  const ir = makeIr(resources, [
    { from: 'aws_vpc.main', to: 'aws_subnet.public', type: 'contains' },
    { from: 'aws_vpc.main', to: 'aws_subnet.private', type: 'contains' },
    { from: 'aws_security_group.web', to: 'aws_lb.frontend', type: 'secures' },
  ]);
  const manifest = makeManifest({
    entries: resources.map(r =>
      makeManifestEntry({ sourceId: r.id, sourceType: r.sourceType }),
    ),
  });

  it('returns a non-empty string', () => {
    const result = generateTopologySummary(manifest, ir);
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(100);
  });

  it('includes Network Overview section', () => {
    const result = generateTopologySummary(manifest, ir);
    expect(result).toContain('## Network Overview');
  });

  it('includes VPC/VNet Topology section', () => {
    const result = generateTopologySummary(manifest, ir);
    expect(result).toContain('## VPC/VNet Topology');
    expect(result).toContain('main');
    expect(result).toContain('10.0.0.0/16');
  });

  it('includes Security Boundaries section', () => {
    const result = generateTopologySummary(manifest, ir);
    expect(result).toContain('## Security Boundaries');
    expect(result).toContain('Security Groups');
  });

  it('includes Load Balancing section with LB entry', () => {
    const result = generateTopologySummary(manifest, ir);
    expect(result).toContain('## Load Balancing');
    expect(result).toContain('frontend');
  });

  it('includes Connectivity section', () => {
    const result = generateTopologySummary(manifest, ir);
    expect(result).toContain('## Connectivity');
  });

  it('includes DNS section with zone and record counts', () => {
    const result = generateTopologySummary(manifest, ir);
    expect(result).toContain('## DNS');
    expect(result).toContain('Zones');
    expect(result).toContain('Records');
  });

  it('includes Warnings section', () => {
    const result = generateTopologySummary(manifest, ir);
    expect(result).toContain('## Warnings');
  });

  it('includes h1 title', () => {
    const result = generateTopologySummary(manifest, ir);
    expect(result).toContain('# Network Topology Summary');
  });
});

// ---------------------------------------------------------------------------
// 2. No networking resources
// ---------------------------------------------------------------------------

describe('generateTopologySummary — no networking resources', () => {
  it('returns graceful no-networking message', () => {
    const ir = makeIr([
      makeIrResource({
        id: 'aws_instance.web',
        sourceType: 'aws_instance',
        sourceName: 'web',
        category: 'compute',
      }),
    ]);
    const manifest = makeManifest();
    const result = generateTopologySummary(manifest, ir);
    expect(result).toContain('No networking resources translated');
  });

  it('does not throw on empty IR', () => {
    expect(() => generateTopologySummary(makeManifest(), makeIr())).not.toThrow();
  });

  it('returns a string on empty IR', () => {
    const result = generateTopologySummary(makeManifest(), makeIr());
    expect(typeof result).toBe('string');
    expect(result).toContain('No networking resources translated');
  });
});

// ---------------------------------------------------------------------------
// 3. VPC-only stack
// ---------------------------------------------------------------------------

describe('generateTopologySummary — VPC only', () => {
  const resources = [
    makeIrResource({
      id: 'aws_vpc.prod',
      sourceType: 'aws_vpc',
      sourceName: 'prod',
      attributes: { cidr_block: '172.16.0.0/12' },
    }),
  ];
  const ir = makeIr(resources);
  const manifest = makeManifest({
    entries: [makeManifestEntry({ sourceId: 'aws_vpc.prod', sourceType: 'aws_vpc' })],
  });

  it('shows VPC in overview table', () => {
    const result = generateTopologySummary(manifest, ir);
    expect(result).toContain('VPC');
    expect(result).toContain('prod');
  });

  it('shows CIDR block in topology section', () => {
    const result = generateTopologySummary(manifest, ir);
    expect(result).toContain('172.16.0.0/12');
  });

  it('shows no-LB message', () => {
    const result = generateTopologySummary(manifest, ir);
    expect(result).toContain('No load balancer resources detected');
  });

  it('shows no-DNS message', () => {
    const result = generateTopologySummary(manifest, ir);
    expect(result).toContain('No Route 53');
  });
});

// ---------------------------------------------------------------------------
// 4. Mermaid diagram generated
// ---------------------------------------------------------------------------

describe('generateTopologySummary — Mermaid diagram', () => {
  it('includes a mermaid code block', () => {
    const resources = makeFullNetworkResources();
    const ir = makeIr(resources, [
      { from: 'aws_vpc.main', to: 'aws_subnet.public', type: 'contains' },
    ]);
    const manifest = makeManifest();
    const result = generateTopologySummary(manifest, ir);
    expect(result).toContain('```mermaid');
    expect(result).toContain('graph TD');
    expect(result).toContain('```');
  });

  it('includes node IDs from networking resources', () => {
    const resources = [
      makeIrResource({
        id: 'aws_vpc.my_vpc',
        sourceType: 'aws_vpc',
        sourceName: 'my_vpc',
      }),
    ];
    const ir = makeIr(resources);
    const manifest = makeManifest();
    const result = generateTopologySummary(manifest, ir);
    // Node ID uses safeMermaidId — underscores replace dots
    expect(result).toContain('aws_vpc_my_vpc');
  });

  it('emits edge arrows for relationships between networking nodes', () => {
    const resources = [
      makeIrResource({ id: 'aws_vpc.main', sourceType: 'aws_vpc', sourceName: 'main' }),
      makeIrResource({ id: 'aws_subnet.pub', sourceType: 'aws_subnet', sourceName: 'pub' }),
    ];
    const ir = makeIr(resources, [
      { from: 'aws_vpc.main', to: 'aws_subnet.pub', type: 'contains' },
    ]);
    const manifest = makeManifest();
    const result = generateTopologySummary(manifest, ir);
    expect(result).toContain('-->');
  });

  it('shows Topology Diagram section header', () => {
    const resources = makeFullNetworkResources();
    const ir = makeIr(resources);
    const manifest = makeManifest();
    const result = generateTopologySummary(manifest, ir);
    expect(result).toContain('## Topology Diagram');
  });
});

// ---------------------------------------------------------------------------
// 5. Mermaid node truncation at 50
// ---------------------------------------------------------------------------

describe('generateTopologySummary — node truncation at 50', () => {
  it('truncates nodes beyond 50 and shows overflow count', () => {
    // Build 55 networking resources
    const resources: IrResource[] = Array.from({ length: 55 }, (_, i) =>
      makeIrResource({
        id: `aws_subnet.sub${i}`,
        sourceType: 'aws_subnet',
        sourceName: `sub${i}`,
      }),
    );
    const ir = makeIr(resources);
    const manifest = makeManifest();
    const result = generateTopologySummary(manifest, ir);
    expect(result).toContain('and 5 more');
  });

  it('does not truncate when exactly 50 nodes', () => {
    const resources: IrResource[] = Array.from({ length: 50 }, (_, i) =>
      makeIrResource({
        id: `aws_subnet.sub${i}`,
        sourceType: 'aws_subnet',
        sourceName: `sub${i}`,
      }),
    );
    const ir = makeIr(resources);
    const manifest = makeManifest();
    const result = generateTopologySummary(manifest, ir);
    // Should not contain truncation note
    expect(result).not.toContain('and 0 more');
    expect(result).not.toMatch(/and \d+ more/);
  });

  it('does not truncate when fewer than 50 nodes', () => {
    const resources: IrResource[] = Array.from({ length: 10 }, (_, i) =>
      makeIrResource({
        id: `aws_vpc.vpc${i}`,
        sourceType: 'aws_vpc',
        sourceName: `vpc${i}`,
      }),
    );
    const ir = makeIr(resources);
    const manifest = makeManifest();
    const result = generateTopologySummary(manifest, ir);
    expect(result).not.toMatch(/and \d+ more/);
  });
});

// ---------------------------------------------------------------------------
// 6. BLOCKER findings surface in Security Boundaries
// ---------------------------------------------------------------------------

describe('generateTopologySummary — BLOCKER findings', () => {
  it('shows BLOCKER callout in security boundaries when blockers exist', () => {
    const resources = [
      makeIrResource({ id: 'aws_security_group.open', sourceType: 'aws_security_group', sourceName: 'open' }),
    ];
    const ir = makeIr(resources);
    const manifest = makeManifest({
      entries: [
        makeManifestEntry({
          sourceId: 'aws_security_group.open',
          sourceType: 'aws_security_group',
          status: 'blocked',
          findings: [
            makeFinding({
              resourceId: 'aws_security_group.open',
              severity: 'blocker',
              code: 'BLOCKER_EC007',
              message: 'Security group broadening detected',
            }),
          ],
        }),
      ],
    });
    const result = generateTopologySummary(manifest, ir);
    expect(result).toContain('BLOCKER');
    expect(result).toContain('BLOCKER_EC007');
  });

  it('does not show BLOCKER callout when no blockers', () => {
    const resources = [
      makeIrResource({ id: 'aws_security_group.safe', sourceType: 'aws_security_group', sourceName: 'safe' }),
    ];
    const ir = makeIr(resources);
    const manifest = makeManifest({
      entries: [
        makeManifestEntry({ sourceId: 'aws_security_group.safe', sourceType: 'aws_security_group' }),
      ],
    });
    const result = generateTopologySummary(manifest, ir);
    expect(result).not.toContain('BLOCKER findings');
  });
});

// ---------------------------------------------------------------------------
// 7. Warning findings surface in Warnings section
// ---------------------------------------------------------------------------

describe('generateTopologySummary — networking warnings', () => {
  it('shows warning findings related to networking resources', () => {
    const resources = [
      makeIrResource({ id: 'aws_lb.main', sourceType: 'aws_lb', sourceName: 'main' }),
    ];
    const ir = makeIr(resources);
    const manifest = makeManifest({
      entries: [
        makeManifestEntry({
          sourceId: 'aws_lb.main',
          sourceType: 'aws_lb',
          findings: [
            makeFinding({
              resourceId: 'aws_lb.main',
              severity: 'warning',
              code: 'LB_SSL_WARNING',
              message: 'SSL termination requires manual configuration',
            }),
          ],
        }),
      ],
    });
    const result = generateTopologySummary(manifest, ir);
    expect(result).toContain('LB_SSL_WARNING');
    expect(result).toContain('SSL termination requires manual configuration');
  });

  it('shows no warnings message when none exist', () => {
    const resources = [makeIrResource()];
    const ir = makeIr(resources);
    const manifest = makeManifest({
      entries: [makeManifestEntry()],
    });
    const result = generateTopologySummary(manifest, ir);
    expect(result).toContain('No networking warnings');
  });
});

// ---------------------------------------------------------------------------
// 8. Never-throw guarantee
// ---------------------------------------------------------------------------

describe('generateTopologySummary — never throws', () => {
  it('does not throw on full network stack', () => {
    const resources = makeFullNetworkResources();
    expect(() =>
      generateTopologySummary(makeManifest(), makeIr(resources)),
    ).not.toThrow();
  });

  it('does not throw on empty IR', () => {
    expect(() =>
      generateTopologySummary(makeManifest(), makeIr()),
    ).not.toThrow();
  });

  it('returns string on any input', () => {
    const result = generateTopologySummary(makeManifest(), makeIr(makeFullNetworkResources()));
    expect(typeof result).toBe('string');
  });
});

// ---------------------------------------------------------------------------
// 9. Peering / Transit / PrivateLink in Connectivity
// ---------------------------------------------------------------------------

describe('generateTopologySummary — connectivity resources', () => {
  it('shows peering connection in connectivity table', () => {
    const resources = [
      makeIrResource({
        id: 'aws_vpc_peering_connection.peer',
        sourceType: 'aws_vpc_peering_connection',
        sourceName: 'peer',
      }),
    ];
    const ir = makeIr(resources);
    const result = generateTopologySummary(makeManifest(), ir);
    expect(result).toContain('VPC Peering');
    expect(result).toContain('peer');
  });

  it('shows transit gateway in connectivity table', () => {
    const resources = [
      makeIrResource({
        id: 'aws_ec2_transit_gateway.hub',
        sourceType: 'aws_ec2_transit_gateway',
        sourceName: 'hub',
      }),
    ];
    const ir = makeIr(resources);
    const result = generateTopologySummary(makeManifest(), ir);
    expect(result).toContain('Transit Gateway');
    expect(result).toContain('hub');
  });

  it('shows PrivateLink / VPC Endpoint in connectivity table', () => {
    const resources = [
      makeIrResource({
        id: 'aws_vpc_endpoint.s3',
        sourceType: 'aws_vpc_endpoint',
        sourceName: 's3',
      }),
    ];
    const ir = makeIr(resources);
    const result = generateTopologySummary(makeManifest(), ir);
    expect(result).toContain('PrivateLink');
    expect(result).toContain('s3');
  });
});
