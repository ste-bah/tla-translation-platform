/**
 * Registers all 10 MCP tools on the server instance.
 *
 * Each tool has:
 *  - A Zod parameter schema (JSON Schema is derived by the SDK)
 *  - A description explaining its purpose
 *  - A handler that either executes the operation or returns a
 *    structured "not implemented" / error response
 *
 * Tool implementations are stubs here; full logic lands in
 * TASK-MCP-002 through TASK-MCP-005.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { AwsServiceFamily, TranslationBand } from '@tla/shared';
import type { RegistryManager } from '../registry-manager.js';
import type { McpServerConfig } from '../config.js';
// terraformNotFoundError reserved for hclValidation (TASK-MCP-005)
import { handleTranslate } from './translate.js';
import { handleEquivalenceLookup } from './equivalence-lookup.js';
import { handleValidate } from './validate.js';
import { handleMigrateState } from './migrate-state.js';
import { handleAssess } from './assess.js';
import { buildCoverageMatrix } from '@tla/translator';

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function errorResponse(message: string): { content: Array<{ type: 'text'; text: string }>; isError: true } {
  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify({ error: 'tool_error', message }),
      },
    ],
    isError: true,
  };
}

// ---------------------------------------------------------------------------
// Parameter schemas
// ---------------------------------------------------------------------------

const TranslateSchema = z.object({
  source: z.string().describe('Absolute path to a .tf file or directory, or raw HCL content when sourceType is "inline".'),
  sourceType: z.enum(['file', 'directory', 'inline']).describe('Whether source is a file path, directory path, or inline HCL string.'),
  target: z.enum(['azure', 'gcp']).describe('Target cloud provider.'),
  scope: z.enum(['full', 'assessment', 'selected']).describe('Translation scope: full translation, assessment-only inventory, or scoped to selected resources.'),
  selectedResources: z.array(z.string()).optional().describe('Resource addresses to include when scope is "selected" (e.g. "aws_instance.web").'),
  outputDir: z.string().optional().describe('Directory to write translated files. Defaults to a unique temp directory.'),
});

const EquivalenceLookupSchema = z.object({
  service: z.string().optional().describe('Single AWS resource type to look up, e.g. "aws_s3_bucket".'),
  services: z.array(z.string()).optional().describe('Bulk lookup: array of AWS resource types.'),
  target: z.enum(['azure', 'gcp', 'both']).describe('Target cloud provider(s).'),
  detail: z.enum(['summary', 'full']).describe(
    'summary = band/confidence/target types; full = adds behavioral_gaps and related_edge_cases.',
  ),
});

const ValidateSchema = z.object({
  translated_dir: z.string().describe('Path to the directory containing translated Terraform files.'),
  provider: z.enum(['azure', 'gcp']).describe('Provider whose validation rules to apply.'),
  strict: z.boolean().optional().default(false).describe('When true, treat warnings as failures.'),
  irFile: z.string().optional().describe('Optional path to a CanonicalIR JSON file (enables semantic diff, confidence, and cost checks).'),
  checks: z.array(
    z.enum(['syntax', 'policy', 'compliance', 'semantic', 'confidence', 'cost']),
  ).optional().describe('Subset of checks to run. Defaults to all six checks.'),
  complianceProfile: z.enum(['cis-basic', 'cis-advanced', 'none']).optional().describe('CIS compliance profile to apply. Defaults to cis-basic.'),
  policyDir: z.string().optional().describe('Custom OPA policy directory (reserved for future use).'),
});

const MigrateStateSchema = z.object({
  stateFile: z.string().optional().describe('Optional path to the AWS Terraform state file (.tfstate). When omitted, returns a manifest-only plan without state commands.'),
  translationResultDir: z.string().describe('Path to the translated output directory (must contain manifest.json).'),
  target: z.enum(['azure', 'gcp']).describe('Target cloud provider.'),
  scope: z.enum(['full', 'stack']).describe('Migration scope: full migrates all resources; stack scopes to selected module prefixes.'),
  selectedStacks: z.array(z.string()).optional().describe('Module name prefixes to include when scope is "stack" (e.g. "networking", "app").'),
  generateBackend: z.boolean().default(false).describe('When true, include a target-provider backend configuration HCL snippet in the result.'),
  generateRollback: z.boolean().default(false).describe('When true, include a rollback manifest with inverse operations in the result.'),
});

const AssessSchema = z.object({
  source_path: z.string().describe('Absolute path to a .tf file or directory to assess.'),
  target_provider: z.enum(['azure', 'gcp']).describe('Target cloud provider.'),
});

const RegistrySearchSchema = z.object({
  family: z.enum(['compute', 'storage', 'database', 'networking', 'security', 'serverless', 'messaging', 'observability', 'containers', 'identity']).optional().describe('Filter by AWS service family.'),
  band: z.enum(['P1', 'P2', 'N1', 'M1']).optional().describe('Filter by translation band.'),
  mapping_type: z.enum(['direct', 'parametric', 'compound', 'structural', 'none']).optional().describe('Filter by mapping type.'),
  min_confidence: z.number().min(0).max(1).optional().describe('Minimum confidence score (0–1).'),
  limit: z.number().int().positive().optional().describe('Maximum number of results to return.'),
});

const RegistryStatsSchema = z.object({
  // No parameters — returns aggregate statistics.
});

const ExplainMappingSchema = z.object({
  aws_resource_type: z.string().describe('AWS resource type to explain, e.g. "aws_instance".'),
  target_provider: z.enum(['azure', 'gcp']).describe('Target cloud provider.'),
});

const ListGapsSchema = z.object({
  aws_resource_type: z.string().optional().describe('Filter by a specific AWS resource type.'),
  severity: z.enum(['minor', 'major', 'blocker']).optional().describe('Filter by gap severity.'),
  target_provider: z.enum(['azure', 'gcp']).optional().describe('Filter gaps relevant to a target provider.'),
});

const ConfidenceCheckSchema = z.object({
  aws_resource_type: z.string().describe('AWS resource type to score.'),
  target_provider: z.enum(['azure', 'gcp']).describe('Target cloud provider.'),
});

// ---------------------------------------------------------------------------
// Tool registration
// ---------------------------------------------------------------------------

export function registerTools(
  server: McpServer,
  registry: RegistryManager,
  config: McpServerConfig,
): void {
  // 1. translate
  server.tool(
    'translate',
    'Translate a Terraform file or directory from AWS to the target cloud provider.',
    TranslateSchema.shape,
    async (args) => {
      const result = await handleTranslate(
        {
          source: args.source,
          sourceType: args.sourceType,
          target: args.target,
          scope: args.scope,
          selectedResources: args.selectedResources,
          outputDir: args.outputDir,
        },
        config,
        registry,
      );
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(result),
          },
        ],
        isError: result.success ? undefined : (true as const),
      };
    },
  );

  // 2. equivalence-lookup
  server.tool(
    'equivalence-lookup',
    'Look up the cloud-provider equivalent(s) for one or more AWS resource types. ' +
    'Supports single (service) and bulk (services[]) lookups. ' +
    'Returns band, confidence, target types; full detail adds behavioral gaps and edge cases. ' +
    'Not-found results include prefix-based nearest-match suggestions.',
    EquivalenceLookupSchema.shape,
    async (args) => {
      return handleEquivalenceLookup(
        {
          service: args.service,
          services: args.services,
          target: args.target,
          detail: args.detail,
        },
        registry,
      );
    },
  );

  // 3. validate
  server.tool(
    'validate',
    'Run validation checks on translated Terraform output. ' +
    'Executes up to six check types in dependency order: ' +
    'syntax, policy, compliance, semanticDiff, confidence, cost. ' +
    'Gracefully skips HCL validation when Terraform is not configured, ' +
    'and skips semantic/cost when no IR file is provided.',
    ValidateSchema.shape,
    async (args) => {
      const result = await handleValidate({
        translated_dir: args.translated_dir,
        provider: args.provider,
        strict: args.strict,
        irFile: args.irFile,
        checks: args.checks,
        complianceProfile: args.complianceProfile,
        policyDir: args.policyDir,
      });
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(result),
          },
        ],
        isError: result.success ? undefined : (true as const),
      };
    },
  );

  // 4. migrate-state
  server.tool(
    'migrate-state',
    'Generate a Terraform state migration plan for moving AWS state to the translated target cloud infrastructure. ' +
    'Produces move, import, and remove commands; detects orphan resources and cross-stack dependencies. ' +
    'Optionally generates target-provider backend configuration and a rollback manifest.',
    MigrateStateSchema.shape,
    async (args) => {
      const result = await handleMigrateState({
        stateFile: args.stateFile,
        translationResultDir: args.translationResultDir,
        target: args.target,
        scope: args.scope,
        selectedStacks: args.selectedStacks,
        generateBackend: args.generateBackend,
        generateRollback: args.generateRollback,
      });
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(result),
          },
        ],
        isError: result.success ? undefined : (true as const),
      };
    },
  );

  // 5. assess
  server.tool(
    'assess',
    'Assess a Terraform configuration — produce an inventory and confidence report without translating.',
    AssessSchema.shape,
    async (args) => {
      return handleAssess(
        { source_path: args.source_path, target_provider: args.target_provider },
        registry,
      );
    },
  );

  // 6. registry-search
  server.tool(
    'registry-search',
    'Search the registry with filters on family, band, mapping type, and confidence.',
    RegistrySearchSchema.shape,
    async (args) => {
      const result = await registry.getRegistry();
      if (!result.ok) return errorResponse(result.error);

      const parsedFamily = args.family !== undefined
        ? AwsServiceFamily.parse(args.family)
        : undefined;
      const parsedBand = args.band !== undefined
        ? TranslationBand.parse(args.band)
        : undefined;

      const entries = result.api.search({
        family: parsedFamily,
        band: parsedBand,
        mappingType: args.mapping_type,
        minConfidence: args.min_confidence,
      });

      const limit = args.limit ?? config.searchLimit;
      const sliced = entries.slice(0, limit);

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({
              total: entries.length,
              returned: sliced.length,
              entries: sliced,
            }),
          },
        ],
      };
    },
  );

  // 7. registry-stats
  server.tool(
    'registry-stats',
    'Return completeness metrics for the registry: entry counts by family, band, mapping type, and average confidence.',
    RegistryStatsSchema.shape,
    async () => {
      const result = await registry.getRegistry();
      if (!result.ok) return errorResponse(result.error);

      const completeness = result.api.getCompleteness();
      const allEntries = result.api.search({});
      const handlerCoverage = buildCoverageMatrix(allEntries);
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({ completeness, handlerCoverage }),
          },
        ],
      };
    },
  );

  // 8. explain-mapping
  server.tool(
    'explain-mapping',
    'Get a detailed explanation of how an AWS resource type maps to the target provider, including gaps and notes.',
    ExplainMappingSchema.shape,
    async (args) => {
      const result = await registry.getRegistry();
      if (!result.ok) return errorResponse(result.error);

      const entry = result.api.lookup(args.aws_resource_type);
      if (!entry) {
        return errorResponse(
          `No registry entry found for '${args.aws_resource_type}'. ` +
          `Use registry-search to browse available mappings.`,
        );
      }

      const targets =
        args.target_provider === 'azure' ? entry.azure_targets : entry.gcp_targets;

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({
              registry_entry_id: entry.registry_entry_id,
              aws_service: entry.aws_service,
              target_provider: args.target_provider,
              targets,
              mapping_type: entry.mapping_type,
              band: entry.band,
              confidence: entry.confidence,
              behavioral_gaps: entry.behavioral_gaps,
              manual_review_required: entry.manual_review_required,
              review_domains: entry.review_domains,
            }),
          },
        ],
      };
    },
  );

  // 9. list-gaps
  server.tool(
    'list-gaps',
    'List behavioral gaps — features, topology, or compliance — for AWS services.',
    ListGapsSchema.shape,
    async (args) => {
      const result = await registry.getRegistry();
      if (!result.ok) return errorResponse(result.error);

      let entryIds: string[] = [];

      if (args.aws_resource_type) {
        const entry = result.api.lookup(args.aws_resource_type);
        if (!entry) {
          return errorResponse(
            `No registry entry found for '${args.aws_resource_type}'.`,
          );
        }
        entryIds = [entry.registry_entry_id];
      }

      const allEntries = result.api.search({});
      const targetEntries =
        entryIds.length > 0
          ? allEntries.filter((e) => entryIds.includes(e.registry_entry_id))
          : allEntries;

      const gaps = targetEntries.flatMap((e) =>
        e.behavioral_gaps
          .filter((g) =>
            args.severity ? g.severity === args.severity : true,
          )
          .filter((g) =>
            args.target_provider
              ? g.affected_targets.includes(args.target_provider)
              : true,
          )
          .map((g) => ({ ...g, registry_entry_id: e.registry_entry_id, aws_service: e.aws_service })),
      );

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({ total: gaps.length, gaps }),
          },
        ],
      };
    },
  );

  // 10. confidence-check
  server.tool(
    'confidence-check',
    'Return the confidence score and contributing factors for translating a specific AWS resource.',
    ConfidenceCheckSchema.shape,
    async (args) => {
      const result = await registry.getRegistry();
      if (!result.ok) return errorResponse(result.error);

      const entry = result.api.lookup(args.aws_resource_type);
      if (!entry) {
        return errorResponse(
          `No registry entry found for '${args.aws_resource_type}'.`,
        );
      }

      const blockers = entry.behavioral_gaps.filter((g) => g.severity === 'blocker').length;
      const majors = entry.behavioral_gaps.filter((g) => g.severity === 'major').length;
      const minors = entry.behavioral_gaps.filter((g) => g.severity === 'minor').length;

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({
              registry_entry_id: entry.registry_entry_id,
              aws_resource_type: args.aws_resource_type,
              target_provider: args.target_provider,
              confidence: entry.confidence,
              band: entry.band,
              mapping_type: entry.mapping_type,
              manual_review_required: entry.manual_review_required,
              gap_summary: { blockers, majors, minors },
            }),
          },
        ],
      };
    },
  );
}
