import * as vscode from 'vscode';

/**
 * Cloud-agnostic completion items for Terraform resource blocks.
 * When a user types `cloud_` inside a resource block, these completions
 * offer portable abstract names that the TLA pipeline can translate.
 */

interface CloudCompletion {
  label: string;
  detail: string;
  documentation: string;
  awsEquivalent: string;
}

const CLOUD_COMPLETIONS: CloudCompletion[] = [
  {
    label: 'cloud_object_storage',
    detail: 'Portable object storage',
    documentation:
      'AWS S3 / Azure Blob Storage / GCP Cloud Storage. ' +
      'TLA translates to the target provider automatically.',
    awsEquivalent: 'aws_s3_bucket',
  },
  {
    label: 'cloud_container_registry',
    detail: 'Portable container registry',
    documentation:
      'AWS ECR / Azure Container Registry / GCP Artifact Registry. ' +
      'TLA translates to the target provider automatically.',
    awsEquivalent: 'aws_ecr_repository',
  },
  {
    label: 'cloud_cache_redis',
    detail: 'Portable Redis cache',
    documentation:
      'AWS ElastiCache Redis / Azure Cache for Redis / GCP Memorystore. ' +
      'TLA translates to the target provider automatically.',
    awsEquivalent: 'aws_elasticache_replication_group',
  },
];

export class CloudCompletionProvider implements vscode.CompletionItemProvider {
  provideCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
    _token: vscode.CancellationToken,
    _context: vscode.CompletionContext,
  ): vscode.CompletionItem[] | undefined {
    const lineText = document.lineAt(position.line).text;
    const textBeforeCursor = lineText.substring(0, position.character);

    // Only trigger when the user has typed `cloud_` or is inside a resource type position
    if (!textBeforeCursor.includes('cloud_') && !textBeforeCursor.match(/resource\s+"$/)) {
      return undefined;
    }

    return CLOUD_COMPLETIONS.map((c) => {
      const item = new vscode.CompletionItem(c.label, vscode.CompletionItemKind.Value);
      item.detail = c.detail;
      item.documentation = new vscode.MarkdownString(
        `${c.documentation}\n\n**AWS equivalent:** \`${c.awsEquivalent}\``,
      );
      item.insertText = c.label;
      return item;
    });
  }
}
