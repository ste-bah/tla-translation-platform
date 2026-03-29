/** AWS EC2 -> Azure VM / GCP Compute Instance (compound 1:N expansion). */

import type { TranslatedResource, TranslationFinding, TranslationContract } from '@tla/shared';
import type { TranslationContext, EngineResult } from '../mapping-engine.js';
import {
  transformTags,
  transformRegion,
  collectUnmappedAttrs,
  createFinding,
  makeTraceability,
  emitBehavioralGapFindings,
} from '../direct/attribute-transformer.js';

type Finding = TranslationFinding;
type SizeEntry = { azure: string; gcp: string };

const MAPPED_KEYS: readonly string[] = [
  'ami','associate_public_ip_address','availability_zone','ebs_block_device','instance_type','key_name','platform','root_block_device','subnet_id','tags','user_data','vpc_security_group_ids',
];

type OsFamily = 'linux' | 'windows' | 'unknown';
const LINUX_AMI_PATTERNS = ['ubuntu', 'amazon-linux', 'al2', 'debian', 'centos', 'rhel'];
const WINDOWS_AMI_PATTERNS = ['windows', 'win'];

export function detectOsFamily(attrs: Record<string, unknown>): OsFamily {
  const ami = ((attrs['ami'] as string | undefined) ?? '').toLowerCase();
  if (WINDOWS_AMI_PATTERNS.some((p) => ami.includes(p))) return 'windows';
  if (LINUX_AMI_PATTERNS.some((p) => ami.includes(p))) return 'linux';
  const platform = ((attrs['platform'] as string | undefined) ?? '').toLowerCase();
  if (platform === 'windows') return 'windows';
  return 'unknown';
}

const AZURE_IMAGE_LINUX = { publisher: 'Canonical', offer: '0001-com-ubuntu-server-jammy', sku: '22_04-lts-gen2', version: 'latest' } as const;
const AZURE_IMAGE_WINDOWS = { publisher: 'MicrosoftWindowsServer', offer: 'WindowsServer', sku: '2022-datacenter-g2', version: 'latest' } as const;
const GCP_IMAGE_LINUX = 'ubuntu-os-cloud/ubuntu-2204-lts';
const GCP_IMAGE_WINDOWS = 'windows-cloud/windows-2022';

const INSTANCE_TYPE_MAP: ReadonlyMap<string, { azure: string; gcp: string }> = new Map([
  ['t3.micro', { azure: 'Standard_B1s', gcp: 'e2-micro' }],
  ['t3.small', { azure: 'Standard_B1ms', gcp: 'e2-small' }],
  ['t3.medium', { azure: 'Standard_B2s', gcp: 'e2-medium' }],
  ['t3.large', { azure: 'Standard_B2ms', gcp: 'e2-standard-2' }],
  ['t3.xlarge', { azure: 'Standard_B4ms', gcp: 'e2-standard-4' }],
  ['m5.large', { azure: 'Standard_D2s_v5', gcp: 'n2-standard-2' }],
  ['m5.xlarge', { azure: 'Standard_D4s_v5', gcp: 'n2-standard-4' }],
  ['m5.2xlarge', { azure: 'Standard_D8s_v5', gcp: 'n2-standard-8' }],
  ['c5.large', { azure: 'Standard_F2s_v2', gcp: 'c2-standard-4' }],
  ['c5.xlarge', { azure: 'Standard_F4s_v2', gcp: 'c2-standard-8' }],
  ['r5.large', { azure: 'Standard_E2s_v5', gcp: 'n2-highmem-2' }],
  ['r5.xlarge', { azure: 'Standard_E4s_v5', gcp: 'n2-highmem-4' }],
]);

function resolveAzureImageRef(os: OsFamily): Record<string, string> { return os === 'windows' ? { ...AZURE_IMAGE_WINDOWS } : { ...AZURE_IMAGE_LINUX }; }
function resolveGcpImage(os: OsFamily): string { return os === 'windows' ? GCP_IMAGE_WINDOWS : GCP_IMAGE_LINUX; }
function emitImageResolutionFinding(resourceId: string, ami: string | undefined, os: OsFamily): Finding {
  const detail = ami ? `Source AMI: ${ami}` : 'No AMI specified';
  const level = os === 'unknown' ? 'warning' : 'info';
  return createFinding(resourceId, level, 'IMAGE_RESOLUTION_REQUIRED', `Image mapping requires verification; defaulting to ${os === 'windows' ? 'Windows' : 'Linux'}. ${detail}`);
}

function buildAzureNic(sourceName: string, attrs: Record<string, unknown>, location: string, tags: Record<string, string> | undefined, findings: Finding[], resourceId: string): Record<string, unknown> {
  const ipConfig: Record<string, unknown> = { name: 'internal', private_ip_address_allocation: 'Dynamic', subnet_id: typeof attrs['subnet_id'] === 'string' ? attrs['subnet_id'] : '${azurerm_subnet.main.id}' };
  if (attrs['associate_public_ip_address'] === true) {
    ipConfig['public_ip_address_id'] = `\${azurerm_public_ip.${sourceName}_pip.id}`;
    findings.push(createFinding(resourceId, 'warning', 'EC2_PUBLIC_IP_INTENT', 'Instance has public IP; review network exposure post-migration'));
  }
  const nicAttrs: Record<string, unknown> = { ip_configuration: ipConfig, location, name: `${sourceName}-nic`, resource_group_name: '${azurerm_resource_group.main.name}' };
  if (tags) nicAttrs['tags'] = transformTags('azure', tags);
  if (attrs['vpc_security_group_ids']) findings.push(createFinding(resourceId, 'info', 'EC2_SG_MANUAL_WIRING', 'Security group associations require manual network_security_group_id wiring on the NIC'));
  return nicAttrs;
}
function buildAzureSshKey(attrs: Record<string, unknown>, sourceName: string, findings: Finding[], resourceId: string): Record<string, unknown> | undefined {
  const keyName = attrs['key_name'] as string | undefined;
  if (!keyName) return undefined;
  findings.push(createFinding(resourceId, 'info', 'EC2_SSH_KEY_MANUAL', `SSH key '${keyName}' must be provided via variable var.ssh_public_key_${sourceName}`));
  return { public_key: `\${var.ssh_public_key_${sourceName}}`, username: 'adminuser' };
}
function buildAzureExtraDisks(attrs: Record<string, unknown>, sourceName: string, location: string, tags: Record<string, string> | undefined, traceability: ReturnType<typeof makeTraceability>, resourceId: string, findings: Finding[]): TranslatedResource[] {
  const ebsDevices = attrs['ebs_block_device'] as Record<string, unknown>[] | undefined;
  if (!Array.isArray(ebsDevices) || ebsDevices.length === 0) return [];
  findings.push(createFinding(resourceId, 'info', 'EC2_ADDITIONAL_VOLUMES', `${ebsDevices.length} additional EBS volume(s) translated to managed disks`));
  return ebsDevices.map((dev, idx) => {
    const size = (dev['volume_size'] as number | undefined) ?? 20;
    const type = (dev['volume_type'] as string | undefined) === 'gp3' ? 'Premium_LRS' : 'StandardSSD_LRS';
    const diskAttrs: Record<string, unknown> = { create_option: 'Empty', disk_size_gb: size, location, name: `${sourceName}-data-disk-${idx}`, resource_group_name: '${azurerm_resource_group.main.name}', storage_account_type: type };
    if (tags) diskAttrs['tags'] = transformTags('azure', tags);
    return { targetType: 'azurerm_managed_disk', targetName: `${sourceName}_data_disk_${idx}`, attributes: diskAttrs, sourceId: resourceId, traceability };
  });
}
function buildAzureVmAttrs(os: OsFamily, vmSize: string, storageType: string, location: string, sourceName: string, tags: Record<string, string> | undefined, attrs: Record<string, unknown>, findings: Finding[], resourceId: string): Record<string, unknown> {
  const vmAttrs: Record<string, unknown> = { admin_username: 'adminuser', location, name: sourceName, network_interface_ids: [`\${azurerm_network_interface.${sourceName}_nic.id}`], os_disk: { caching: 'ReadWrite', storage_account_type: storageType }, resource_group_name: '${azurerm_resource_group.main.name}', size: vmSize, source_image_reference: resolveAzureImageRef(os) };
  const sshKey = buildAzureSshKey(attrs, sourceName, findings, resourceId);
  if (sshKey) vmAttrs['admin_ssh_key'] = sshKey;
  if (attrs['user_data']) vmAttrs['custom_data'] = attrs['user_data'];
  if (tags) vmAttrs['tags'] = transformTags('azure', tags);
  return vmAttrs;
}
function buildAzureRootDisk(sourceName: string, diskSizeGb: number, storageType: string, location: string, tags: Record<string, string> | undefined): Record<string, unknown> {
  const diskAttrs: Record<string, unknown> = { create_option: 'Empty', disk_size_gb: diskSizeGb, location, name: `${sourceName}-disk`, resource_group_name: '${azurerm_resource_group.main.name}', storage_account_type: storageType };
  if (tags) diskAttrs['tags'] = transformTags('azure', tags);
  return diskAttrs;
}
function buildAzureFindings(ctx: TranslationContext, resourceId: string, attrs: Record<string, unknown>, sizeEntry: SizeEntry | undefined, os: OsFamily, instanceType: string, translatedCount: number): Finding[] {
  const findings: Finding[] = [
    ...collectUnmappedAttrs(resourceId, attrs, MAPPED_KEYS),
    ...emitBehavioralGapFindings(ctx),
    createFinding(resourceId, 'info', 'COMPOUND_EXPANSION', `1 aws_instance -> ${translatedCount} azure resources`),
    emitImageResolutionFinding(resourceId, attrs['ami'] as string | undefined, os),
  ];
  if (!sizeEntry) findings.push(createFinding(resourceId, 'warning', 'UNKNOWN_INSTANCE_TYPE', `Instance type '${instanceType}' has no known Azure mapping; defaulting to Standard_B1s`));
  return findings;
}
function translateToAzure(ctx: TranslationContext): EngineResult {
  const { resource } = ctx;
  const attrs = resource.attributes as Record<string, unknown>;
  const traceability = makeTraceability(ctx, 'compound/ec2', 'compound');
  const { sourceName } = resource;
  const tags = attrs['tags'] as Record<string, string> | undefined;
  const os = detectOsFamily(attrs);
  const instanceType = (attrs['instance_type'] as string | undefined) ?? 't3.micro';
  const sizeEntry = INSTANCE_TYPE_MAP.get(instanceType);
  const vmSize = sizeEntry?.azure ?? 'Standard_B1s';
  const rootBlock = attrs['root_block_device'] as Record<string, unknown> | undefined;
  const diskSizeGb = (rootBlock?.['volume_size'] as number | undefined) ?? 30;
  const storageType = (rootBlock?.['volume_type'] as string | undefined) === 'gp3' ? 'Premium_LRS' : 'StandardSSD_LRS';
  const region = attrs['availability_zone'] as string | undefined;
  const location = region ? transformRegion('azure', region.replace(/[a-z]$/, '')) : '${azurerm_resource_group.main.location}';
  const nicFindings: Finding[] = [];
  const nicAttrs = buildAzureNic(sourceName, attrs, location, tags, nicFindings, resource.id);
  const vmFindings: Finding[] = [];
  const vmTargetType = os === 'windows' ? 'azurerm_windows_virtual_machine' : 'azurerm_linux_virtual_machine';
  const vmAttrs = buildAzureVmAttrs(os, vmSize, storageType, location, sourceName, tags, attrs, vmFindings, resource.id);
  const diskAttrs = buildAzureRootDisk(sourceName, diskSizeGb, storageType, location, tags);
  const translated: TranslatedResource[] = [
    { targetType: 'azurerm_network_interface', targetName: `${sourceName}_nic`, attributes: nicAttrs, sourceId: resource.id, traceability },
    { targetType: vmTargetType, targetName: sourceName, attributes: vmAttrs, sourceId: resource.id, traceability },
    { targetType: 'azurerm_managed_disk', targetName: `${sourceName}_disk`, attributes: diskAttrs, sourceId: resource.id, traceability },
  ];
  const ebsFindings: Finding[] = [];
  translated.push(...buildAzureExtraDisks(attrs, sourceName, location, tags, traceability, resource.id, ebsFindings));
  const stdFindings = buildAzureFindings(ctx, resource.id, attrs, sizeEntry, os, instanceType, translated.length);
  return { translated, findings: [...nicFindings, ...vmFindings, ...ebsFindings, ...stdFindings] };
}
function buildGcpExtraDisks(attrs: Record<string, unknown>, sourceName: string, tags: Record<string, string> | undefined, traceability: ReturnType<typeof makeTraceability>, resourceId: string, findings: Finding[]): TranslatedResource[] {
  const ebsDevices = attrs['ebs_block_device'] as Record<string, unknown>[] | undefined;
  if (!Array.isArray(ebsDevices) || ebsDevices.length === 0) return [];
  findings.push(createFinding(resourceId, 'info', 'EC2_ADDITIONAL_VOLUMES', `${ebsDevices.length} additional EBS volume(s) translated to compute disks`));
  return ebsDevices.map((dev, idx) => {
    const size = (dev['volume_size'] as number | undefined) ?? 20;
    const type = (dev['volume_type'] as string | undefined) === 'gp3' ? 'pd-ssd' : 'pd-balanced';
    const diskAttrs: Record<string, unknown> = { name: `${sourceName}-data-disk-${idx}`, size, type, zone: '${var.zone}' };
    if (tags) diskAttrs['labels'] = transformTags('gcp', tags);
    return { targetType: 'google_compute_disk', targetName: `${sourceName}_data_disk_${idx}`, attributes: diskAttrs, sourceId: resourceId, traceability };
  });
}
function buildGcpInstanceAttrs(os: OsFamily, machineType: string, diskSizeGb: number, diskType: string, sourceName: string, tags: Record<string, string> | undefined, attrs: Record<string, unknown>, findings: Finding[], resourceId: string): Record<string, unknown> {
  const networkInterface: Record<string, unknown> = { network: '${google_compute_network.main.id}', subnetwork: typeof attrs['subnet_id'] === 'string' ? attrs['subnet_id'] : '${google_compute_subnetwork.main.id}' };
  if (attrs['associate_public_ip_address'] === true) {
    networkInterface['access_config'] = {};
    findings.push(createFinding(resourceId, 'warning', 'EC2_PUBLIC_IP_INTENT', 'Instance has public IP; review network exposure post-migration'));
  }
  const instanceAttrs: Record<string, unknown> = { boot_disk: { initialize_params: { image: resolveGcpImage(os), size: diskSizeGb, type: diskType } }, machine_type: machineType, name: sourceName, network_interface: networkInterface, zone: '${var.zone}' };
  if (attrs['user_data']) instanceAttrs['metadata_startup_script'] = attrs['user_data'];
  if (tags) instanceAttrs['labels'] = transformTags('gcp', tags);
  if (attrs['vpc_security_group_ids']) findings.push(createFinding(resourceId, 'info', 'EC2_SG_MANUAL_WIRING', 'Security group associations require manual firewall rule wiring'));
  return instanceAttrs;
}
function buildGcpRootDisk(sourceName: string, diskSizeGb: number, diskType: string, tags: Record<string, string> | undefined): Record<string, unknown> {
  const diskAttrs: Record<string, unknown> = { name: `${sourceName}-disk`, size: diskSizeGb, type: diskType, zone: '${var.zone}' };
  if (tags) diskAttrs['labels'] = transformTags('gcp', tags);
  return diskAttrs;
}
function buildGcpFindings(ctx: TranslationContext, resourceId: string, attrs: Record<string, unknown>, sizeEntry: SizeEntry | undefined, os: OsFamily, instanceType: string, translatedCount: number): Finding[] {
  const findings: Finding[] = [
    ...collectUnmappedAttrs(resourceId, attrs, MAPPED_KEYS),
    ...emitBehavioralGapFindings(ctx),
    createFinding(resourceId, 'info', 'COMPOUND_EXPANSION', `1 aws_instance -> ${translatedCount} gcp resources`),
    emitImageResolutionFinding(resourceId, attrs['ami'] as string | undefined, os),
  ];
  if (!sizeEntry) findings.push(createFinding(resourceId, 'warning', 'UNKNOWN_INSTANCE_TYPE', `Instance type '${instanceType}' has no known GCP mapping; defaulting to e2-micro`));
  return findings;
}
function translateToGcp(ctx: TranslationContext): EngineResult {
  const { resource } = ctx;
  const attrs = resource.attributes as Record<string, unknown>;
  const traceability = makeTraceability(ctx, 'compound/ec2', 'compound');
  const sourceName = resource.sourceName;
  const tags = attrs['tags'] as Record<string, string> | undefined;
  const os = detectOsFamily(attrs);
  const instanceType = (attrs['instance_type'] as string | undefined) ?? 't3.micro';
  const sizeEntry = INSTANCE_TYPE_MAP.get(instanceType);
  const machineType = sizeEntry?.gcp ?? 'e2-micro';
  const rootBlock = attrs['root_block_device'] as Record<string, unknown> | undefined;
  const diskSizeGb = (rootBlock?.['volume_size'] as number | undefined) ?? 30;
  const diskType = (rootBlock?.['volume_type'] as string | undefined) === 'gp3' ? 'pd-ssd' : 'pd-balanced';
  const instanceFindings: Finding[] = [];
  const instanceAttrs = buildGcpInstanceAttrs(os, machineType, diskSizeGb, diskType, sourceName, tags, attrs, instanceFindings, resource.id);
  const diskAttrs = buildGcpRootDisk(sourceName, diskSizeGb, diskType, tags);
  const translated: TranslatedResource[] = [
    { targetType: 'google_compute_instance', targetName: sourceName, attributes: instanceAttrs, sourceId: resource.id, traceability },
    { targetType: 'google_compute_disk', targetName: `${sourceName}_disk`, attributes: diskAttrs, sourceId: resource.id, traceability },
  ];
  const ebsFindings: Finding[] = [];
  translated.push(...buildGcpExtraDisks(attrs, sourceName, tags, traceability, resource.id, ebsFindings));
  const stdFindings = buildGcpFindings(ctx, resource.id, attrs, sizeEntry, os, instanceType, translated.length);
  return { translated, findings: [...instanceFindings, ...ebsFindings, ...stdFindings] };
}
function emitSecurityGateFindings(resourceId: string, attrs: Record<string, unknown>): { blockers: Finding[]; warnings: Finding[] } {
  const blockers: Finding[] = [];
  const warnings: Finding[] = [];
  const hasPublicIp = attrs['associate_public_ip_address'] === true;
  const sgIds = attrs['vpc_security_group_ids'];
  const hasSg = Array.isArray(sgIds) ? sgIds.length > 0 : !!sgIds;
  if (hasPublicIp && !hasSg) blockers.push(createFinding(resourceId, 'blocker', 'EC2_PUBLIC_NO_SG', 'Public IP assigned without security group — unprotected public compute exposure'));
  const rootBlock = attrs['root_block_device'] as Record<string, unknown> | undefined;
  if (rootBlock && rootBlock['encrypted'] !== true) warnings.push(createFinding(resourceId, 'warning', 'EC2_UNENCRYPTED_VOLUME', 'Root volume encryption not enabled — review encryption requirements'));
  return { blockers, warnings };
}

function buildEc2Contract(resourceId: string, attrs: Record<string, unknown>, translated: readonly TranslatedResource[], findings: readonly Finding[]): TranslationContract {
  const os = detectOsFamily(attrs);
  const preserved: string[] = ['compute instance runtime shape preserved as a single VM/instance abstraction'];
  const transformed: string[] = [];
  const degraded: string[] = [];
  const reviewRequired: string[] = [];
  const blockers: string[] = findings.filter((f) => f.severity === 'blocker').map((f) => f.message);
  const confidenceFactors: string[] = [];

  if (os !== 'unknown') preserved.push(`${os} guest OS family inferred and mapped`);
  else {
    transformed.push('AMI-to-image mapping replaced with default target image selection');
    reviewRequired.push('verify source AMI intent against selected target image');
    confidenceFactors.push('source image could not be resolved precisely');
  }
  if (translated.some((r) => r.targetType.includes('network_interface') || r.targetType.includes('compute_instance'))) {
    preserved.push('network attachment preserved through target instance networking resources');
  }
  if (attrs['user_data']) preserved.push('bootstrap/user-data intent carried into target startup/custom data field');
  if (attrs['associate_public_ip_address'] === true) {
    transformed.push('public IP exposure intent preserved through target provider networking semantics');
    reviewRequired.push('review public ingress posture after migration');
    confidenceFactors.push('public exposure requires environment-specific validation');
  }
  if (attrs['vpc_security_group_ids']) {
    degraded.push('security group associations require manual target-side wiring');
    reviewRequired.push('verify NIC/firewall/security-group equivalent attachments');
    confidenceFactors.push('security group semantics are only partially automated');
  }
  const ebs = attrs['ebs_block_device'];
  if (Array.isArray(ebs) && ebs.length > 0) {
    preserved.push(`additional attached volume intent preserved for ${ebs.length} extra disk(s)`);
    transformed.push('EBS volumes expanded into target managed disk resources');
  }
  if ((attrs['root_block_device'] as Record<string, unknown> | undefined)?.['encrypted'] !== true) {
    degraded.push('root volume encryption posture not preserved automatically from unencrypted source');
    reviewRequired.push('confirm encryption requirements for boot volume');
    confidenceFactors.push('storage encryption posture needs review');
  }

  return { sourceId: resourceId, targetIds: translated.map((r) => r.targetName), preserved, transformed, degraded, blockers, reviewRequired, confidenceFactors };
}

export function translateEc2(ctx: TranslationContext): EngineResult {
  const attrs = ctx.resource.attributes as Record<string, unknown>;
  const { blockers, warnings } = emitSecurityGateFindings(ctx.resource.id, attrs);
  if (blockers.length > 0) {
    return {
      translated: [],
      findings: [...blockers, ...warnings],
      contracts: [buildEc2Contract(ctx.resource.id, attrs, [], [...blockers, ...warnings])],
    };
  }
  const result = ctx.targetProvider === 'azure' ? translateToAzure(ctx) : translateToGcp(ctx);
  if (warnings.length > 0) result.findings.push(...warnings);
  return {
    translated: result.translated,
    findings: result.findings,
    contracts: [buildEc2Contract(ctx.resource.id, attrs, result.translated, result.findings)],
  };
}
