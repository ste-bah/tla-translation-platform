import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('vscode', () => {
  const _CompletionItem = vi.fn().mockImplementation(function (this: any, label: string, kind: number) {
    this.label = label;
    this.kind = kind;
    this.detail = '';
    this.documentation = undefined;
    this.insertText = '';
  });

  const _MarkdownString = vi.fn().mockImplementation(function (this: any, value: string) {
    this.value = value;
  });

  return {
    CompletionItem: _CompletionItem,
    CompletionItemKind: {
      Value: 12,
      Text: 0,
      Method: 1,
      Function: 2,
      Class: 5,
    },
    MarkdownString: _MarkdownString,
    languages: {
      registerCompletionItemProvider: vi.fn(),
      createDiagnosticCollection: vi.fn(),
    },
    workspace: {
      getConfiguration: vi.fn().mockReturnValue({ get: vi.fn().mockReturnValue(true) }),
      onDidOpenTextDocument: vi.fn(),
      onDidSaveTextDocument: vi.fn(),
      onDidChangeTextDocument: vi.fn(),
      textDocuments: [],
    },
  };
});

import { CloudCompletionProvider } from '../src/completions';

describe('CloudCompletionProvider', () => {
  let provider: CloudCompletionProvider;

  beforeEach(() => {
    provider = new CloudCompletionProvider();
  });

  function makeDocument(lineText: string) {
    return {
      lineAt: (_line: number) => ({ text: lineText }),
    } as any;
  }

  function makePosition(line: number, character: number) {
    return { line, character } as any;
  }

  it('should return completions when cursor is after cloud_', () => {
    const doc = makeDocument('  resource "cloud_"');
    const pos = makePosition(0, 18);

    const result = provider.provideCompletionItems(doc, pos, {} as any, {} as any);

    expect(result).toBeDefined();
    expect(result!.length).toBe(3);
  });

  it('should include cloud_object_storage', () => {
    const doc = makeDocument('  resource "cloud_"');
    const pos = makePosition(0, 18);

    const result = provider.provideCompletionItems(doc, pos, {} as any, {} as any);

    const labels = result!.map((item: any) => item.label);
    expect(labels).toContain('cloud_object_storage');
  });

  it('should include cloud_container_registry', () => {
    const doc = makeDocument('  resource "cloud_"');
    const pos = makePosition(0, 18);

    const result = provider.provideCompletionItems(doc, pos, {} as any, {} as any);

    const labels = result!.map((item: any) => item.label);
    expect(labels).toContain('cloud_container_registry');
  });

  it('should include cloud_cache_redis', () => {
    const doc = makeDocument('  resource "cloud_"');
    const pos = makePosition(0, 18);

    const result = provider.provideCompletionItems(doc, pos, {} as any, {} as any);

    const labels = result!.map((item: any) => item.label);
    expect(labels).toContain('cloud_cache_redis');
  });

  it('should return completions when cursor is after resource quote', () => {
    const doc = makeDocument('resource "');
    const pos = makePosition(0, 10);

    const result = provider.provideCompletionItems(doc, pos, {} as any, {} as any);

    expect(result).toBeDefined();
    expect(result!.length).toBe(3);
  });

  it('should return undefined when no trigger context', () => {
    const doc = makeDocument('  variable "name" {');
    const pos = makePosition(0, 19);

    const result = provider.provideCompletionItems(doc, pos, {} as any, {} as any);

    expect(result).toBeUndefined();
  });

  it('should set CompletionItemKind.Value on all items', () => {
    const doc = makeDocument('resource "cloud_"');
    const pos = makePosition(0, 17);

    const result = provider.provideCompletionItems(doc, pos, {} as any, {} as any);

    for (const item of result!) {
      expect((item as any).kind).toBe(12);
    }
  });

  it('should set detail on each item', () => {
    const doc = makeDocument('resource "cloud_"');
    const pos = makePosition(0, 17);

    const result = provider.provideCompletionItems(doc, pos, {} as any, {} as any);

    for (const item of result!) {
      expect((item as any).detail).toBeTruthy();
    }
  });

  it('should set insertText equal to label', () => {
    const doc = makeDocument('resource "cloud_"');
    const pos = makePosition(0, 17);

    const result = provider.provideCompletionItems(doc, pos, {} as any, {} as any);

    for (const item of result!) {
      expect((item as any).insertText).toBe((item as any).label);
    }
  });
});
