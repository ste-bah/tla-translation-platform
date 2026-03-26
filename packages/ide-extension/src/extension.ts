import * as vscode from 'vscode';
import { CloudCompletionProvider } from './completions';
import { activateDiagnostics } from './diagnostics';

export function activate(context: vscode.ExtensionContext): void {
  // Register cloud-agnostic completions for Terraform files
  const completionProvider = vscode.languages.registerCompletionItemProvider(
    { language: 'terraform', scheme: 'file' },
    new CloudCompletionProvider(),
    '"', // trigger on opening quote inside resource type
  );
  context.subscriptions.push(completionProvider);

  // Activate diagnostics (M1 warnings, N1 info, provisioner/region checks)
  activateDiagnostics(context);

  console.log('TLA Terraform Translation extension activated');
}

export function deactivate(): void {
  // Nothing to clean up — VS Code disposes subscriptions automatically
}
