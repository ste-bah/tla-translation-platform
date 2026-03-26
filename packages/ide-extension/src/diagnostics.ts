import * as vscode from 'vscode';
import { lookupService } from './registry-data';

/**
 * Regex to detect `resource "aws_*" "name" {` blocks.
 * Captures the full resource type in group 1.
 */
const RESOURCE_BLOCK_RE = /resource\s+"(aws_[a-z0-9_]+)"\s+"[^"]+"\s*\{/g;

/** Patterns that indicate non-portable provisioner / data usage. */
const PROBLEMATIC_PATTERNS: Array<{
  pattern: RegExp;
  code: string;
  message: string;
  severity: vscode.DiagnosticSeverity;
}> = [
  {
    pattern: /provisioner\s+"local-exec"/g,
    code: 'TLA-PROV-LOCAL',
    message: 'local-exec provisioner is not portable across cloud providers.',
    severity: vscode.DiagnosticSeverity.Warning,
  },
  {
    pattern: /provisioner\s+"remote-exec"/g,
    code: 'TLA-PROV-REMOTE',
    message: 'remote-exec provisioner is not portable across cloud providers.',
    severity: vscode.DiagnosticSeverity.Warning,
  },
  {
    pattern: /data\s+"external"/g,
    code: 'TLA-DATA-EXT',
    message: 'external data source may not be portable across cloud providers.',
    severity: vscode.DiagnosticSeverity.Information,
  },
  {
    pattern:
      /region\s*=\s*"(us-east-1|us-west-2|eu-west-1|ap-southeast-1|us-east-2|eu-central-1|ap-northeast-1)/g,
    code: 'TLA-REGION-HARDCODED',
    message:
      'Hardcoded AWS region detected. Use a variable for portability.',
    severity: vscode.DiagnosticSeverity.Warning,
  },
];

/**
 * Scans a Terraform document and returns diagnostics for:
 * 1. AWS resource blocks whose registry band is M1 (manual/advisory) -> Warning
 * 2. AWS resource blocks whose registry band is N1 (needs attention) -> Information
 * 3. Problematic patterns (local-exec, remote-exec, external, hardcoded region)
 */
export function computeDiagnostics(document: vscode.TextDocument): vscode.Diagnostic[] {
  const diagnostics: vscode.Diagnostic[] = [];
  const text = document.getText();

  // --- Pass 1: resource "aws_*" blocks ---
  let match: RegExpExecArray | null;
  RESOURCE_BLOCK_RE.lastIndex = 0;
  while ((match = RESOURCE_BLOCK_RE.exec(text)) !== null) {
    const awsType = match[1];
    const entry = lookupService(awsType);
    const offset = match.index;
    const startPos = document.positionAt(offset);
    const endPos = document.positionAt(offset + match[0].length);
    const range = new vscode.Range(startPos, endPos);

    if (entry) {
      if (entry.band === 'M1') {
        const diag = new vscode.Diagnostic(
          range,
          `[TLA] "${awsType}" is band M1 (advisory/manual). ` +
            `No automated translation — manual migration required. ` +
            `Confidence: ${entry.confidence}.`,
          vscode.DiagnosticSeverity.Warning,
        );
        diag.code = 'TLA-M1';
        diag.source = 'TLA';
        diagnostics.push(diag);
      } else if (entry.band === 'N1') {
        const diag = new vscode.Diagnostic(
          range,
          `[TLA] "${awsType}" is band N1 (${entry.mapping_type} mapping). ` +
            `Translation available but may need review. ` +
            `Confidence: ${entry.confidence}.`,
          vscode.DiagnosticSeverity.Information,
        );
        diag.code = 'TLA-N1';
        diag.source = 'TLA';
        diagnostics.push(diag);
      }
      // P1/P2 bands are fine — no diagnostic needed
    } else {
      // Unknown AWS resource — informational
      const diag = new vscode.Diagnostic(
        range,
        `[TLA] "${awsType}" is not in the TLA registry. Translation unavailable.`,
        vscode.DiagnosticSeverity.Information,
      );
      diag.code = 'TLA-UNKNOWN';
      diag.source = 'TLA';
      diagnostics.push(diag);
    }
  }

  // --- Pass 2: problematic patterns ---
  for (const { pattern, code, message, severity } of PROBLEMATIC_PATTERNS) {
    pattern.lastIndex = 0;
    while ((match = pattern.exec(text)) !== null) {
      const offset = match.index;
      const startPos = document.positionAt(offset);
      const endPos = document.positionAt(offset + match[0].length);
      const range = new vscode.Range(startPos, endPos);

      const diag = new vscode.Diagnostic(range, `[TLA] ${message}`, severity);
      diag.code = code;
      diag.source = 'TLA';
      diagnostics.push(diag);
    }
  }

  return diagnostics;
}

/**
 * Creates and returns a DiagnosticCollection, wired to update on document open/save/change.
 */
export function activateDiagnostics(context: vscode.ExtensionContext): vscode.DiagnosticCollection {
  const collection = vscode.languages.createDiagnosticCollection('tla');

  const refreshDiagnostics = (document: vscode.TextDocument) => {
    if (document.languageId !== 'terraform' && !document.fileName.endsWith('.tf')) {
      return;
    }

    const config = vscode.workspace.getConfiguration('tla');
    if (!config.get<boolean>('enableDiagnostics', true)) {
      collection.delete(document.uri);
      return;
    }

    const diagnostics = computeDiagnostics(document);
    collection.set(document.uri, diagnostics);
  };

  // Refresh on open
  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument(refreshDiagnostics),
  );

  // Refresh on save
  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument(refreshDiagnostics),
  );

  // Refresh on change (debounced via VS Code internal)
  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument((e) => refreshDiagnostics(e.document)),
  );

  // Refresh all currently open documents
  vscode.workspace.textDocuments.forEach(refreshDiagnostics);

  context.subscriptions.push(collection);
  return collection;
}
