import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('vscode', () => {
  const _DiagnosticSeverity = {
    Error: 0,
    Warning: 1,
    Information: 2,
    Hint: 3,
  };

  class _Position {
    constructor(public line: number, public character: number) {}
  }

  class _Range {
    constructor(public start: _Position, public end: _Position) {}
  }

  class _Diagnostic {
    code: string | undefined;
    source: string | undefined;
    constructor(
      public range: _Range,
      public message: string,
      public severity: number,
    ) {}
  }

  return {
    DiagnosticSeverity: _DiagnosticSeverity,
    Diagnostic: _Diagnostic,
    Position: _Position,
    Range: _Range,
    languages: {
      registerCompletionItemProvider: vi.fn(),
      createDiagnosticCollection: vi.fn().mockReturnValue({
        set: vi.fn(),
        delete: vi.fn(),
        dispose: vi.fn(),
      }),
    },
    workspace: {
      getConfiguration: vi.fn().mockReturnValue({ get: vi.fn().mockReturnValue(true) }),
      onDidOpenTextDocument: vi.fn().mockReturnValue({ dispose: vi.fn() }),
      onDidSaveTextDocument: vi.fn().mockReturnValue({ dispose: vi.fn() }),
      onDidChangeTextDocument: vi.fn().mockReturnValue({ dispose: vi.fn() }),
      textDocuments: [],
    },
    CompletionItem: vi.fn(),
    CompletionItemKind: { Value: 12 },
    MarkdownString: vi.fn(),
  };
});

import { computeDiagnostics } from '../src/diagnostics';

function makeDocument(text: string) {
  return {
    getText: () => text,
    positionAt: (offset: number) => {
      const before = text.substring(0, offset);
      const lines = before.split('\n');
      return { line: lines.length - 1, character: lines[lines.length - 1].length };
    },
    lineAt: (line: number) => ({ text: text.split('\n')[line] || '' }),
    languageId: 'terraform',
    fileName: 'main.tf',
    uri: { toString: () => 'file:///main.tf' },
  } as any;
}

describe('computeDiagnostics', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // --- M1 band detection ---
  it('should emit Warning for M1 band resource (aws_dynamodb_table)', () => {
    const doc = makeDocument('resource "aws_dynamodb_table" "my_table" {\n}');
    const diags = computeDiagnostics(doc);

    const m1 = diags.find((d: any) => d.code === 'TLA-M1');
    expect(m1).toBeDefined();
    expect(m1!.severity).toBe(1); // Warning
    expect(m1!.message).toContain('M1');
    expect(m1!.message).toContain('manual migration');
  });

  // --- N1 band detection ---
  it('should emit Information for N1 band resource (aws_lambda_function)', () => {
    const doc = makeDocument('resource "aws_lambda_function" "fn" {\n}');
    const diags = computeDiagnostics(doc);

    const n1 = diags.find((d: any) => d.code === 'TLA-N1');
    expect(n1).toBeDefined();
    expect(n1!.severity).toBe(2); // Information
    expect(n1!.message).toContain('N1');
  });

  it('should emit Information for N1 band resource (aws_security_group)', () => {
    const doc = makeDocument('resource "aws_security_group" "sg" {\n}');
    const diags = computeDiagnostics(doc);

    const n1 = diags.find((d: any) => d.code === 'TLA-N1');
    expect(n1).toBeDefined();
    expect(n1!.severity).toBe(2); // Information
  });

  // --- P1/P2 no diagnostic ---
  it('should NOT emit diagnostics for P1 band resource (aws_s3_bucket)', () => {
    const doc = makeDocument('resource "aws_s3_bucket" "bucket" {\n}');
    const diags = computeDiagnostics(doc);

    const bandDiags = diags.filter(
      (d: any) => d.code === 'TLA-M1' || d.code === 'TLA-N1' || d.code === 'TLA-UNKNOWN',
    );
    expect(bandDiags.length).toBe(0);
  });

  it('should NOT emit diagnostics for P2 band resource (aws_vpc)', () => {
    const doc = makeDocument('resource "aws_vpc" "main" {\n}');
    const diags = computeDiagnostics(doc);

    const bandDiags = diags.filter(
      (d: any) => d.code === 'TLA-M1' || d.code === 'TLA-N1' || d.code === 'TLA-UNKNOWN',
    );
    expect(bandDiags.length).toBe(0);
  });

  // --- Unknown resource ---
  it('should emit Information for unknown AWS resource', () => {
    const doc = makeDocument('resource "aws_foobar_widget" "x" {\n}');
    const diags = computeDiagnostics(doc);

    const unknown = diags.find((d: any) => d.code === 'TLA-UNKNOWN');
    expect(unknown).toBeDefined();
    expect(unknown!.severity).toBe(2); // Information
    expect(unknown!.message).toContain('not in the TLA registry');
  });

  // --- local-exec detection ---
  it('should detect local-exec provisioner', () => {
    const doc = makeDocument(
      'resource "aws_instance" "web" {\n  provisioner "local-exec" {\n    command = "echo hi"\n  }\n}',
    );
    const diags = computeDiagnostics(doc);

    const localExec = diags.find((d: any) => d.code === 'TLA-PROV-LOCAL');
    expect(localExec).toBeDefined();
    expect(localExec!.severity).toBe(1); // Warning
    expect(localExec!.message).toContain('local-exec');
  });

  // --- remote-exec detection ---
  it('should detect remote-exec provisioner', () => {
    const doc = makeDocument(
      'resource "aws_instance" "web" {\n  provisioner "remote-exec" {\n    inline = ["echo hi"]\n  }\n}',
    );
    const diags = computeDiagnostics(doc);

    const remoteExec = diags.find((d: any) => d.code === 'TLA-PROV-REMOTE');
    expect(remoteExec).toBeDefined();
    expect(remoteExec!.severity).toBe(1); // Warning
    expect(remoteExec!.message).toContain('remote-exec');
  });

  // --- external data source ---
  it('should detect external data source', () => {
    const doc = makeDocument('data "external" "get_ip" {\n  program = ["bash"]\n}');
    const diags = computeDiagnostics(doc);

    const ext = diags.find((d: any) => d.code === 'TLA-DATA-EXT');
    expect(ext).toBeDefined();
    expect(ext!.severity).toBe(2); // Information
  });

  // --- hardcoded region ---
  it('should detect hardcoded AWS region', () => {
    const doc = makeDocument('provider "aws" {\n  region = "us-east-1"\n}');
    const diags = computeDiagnostics(doc);

    const region = diags.find((d: any) => d.code === 'TLA-REGION-HARDCODED');
    expect(region).toBeDefined();
    expect(region!.severity).toBe(1); // Warning
    expect(region!.message).toContain('Hardcoded AWS region');
  });

  it('should detect eu-west-1 as hardcoded region', () => {
    const doc = makeDocument('  region = "eu-west-1"');
    const diags = computeDiagnostics(doc);

    const region = diags.find((d: any) => d.code === 'TLA-REGION-HARDCODED');
    expect(region).toBeDefined();
  });

  // --- Multiple resources in one file ---
  it('should report multiple diagnostics for multiple resources', () => {
    const doc = makeDocument(
      'resource "aws_dynamodb_table" "a" {\n}\n\n' +
        'resource "aws_lambda_function" "b" {\n}\n\n' +
        'resource "aws_s3_bucket" "c" {\n}\n',
    );
    const diags = computeDiagnostics(doc);

    expect(diags.find((d: any) => d.code === 'TLA-M1')).toBeDefined();
    expect(diags.find((d: any) => d.code === 'TLA-N1')).toBeDefined();
    expect(diags.filter((d: any) => d.code === 'TLA-M1').length).toBe(1);
    expect(diags.filter((d: any) => d.code === 'TLA-N1').length).toBe(1);
  });

  // --- Clean file ---
  it('should return empty array for file with no AWS resources or patterns', () => {
    const doc = makeDocument('variable "name" {\n  type = string\n}\n');
    const diags = computeDiagnostics(doc);

    expect(diags.length).toBe(0);
  });

  // --- All diagnostics have source TLA ---
  it('should set source to TLA on all diagnostics', () => {
    const doc = makeDocument(
      'resource "aws_dynamodb_table" "t" {\n}\n' +
        'provisioner "local-exec" {\n  command = "x"\n}\n',
    );
    const diags = computeDiagnostics(doc);

    for (const d of diags) {
      expect((d as any).source).toBe('TLA');
    }
  });
});
