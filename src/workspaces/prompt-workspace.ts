import type { WorkspaceController } from '../workspace-controller';

/** Owns stable output fragments updated by prompt editor and weight actions. */
export class PromptWorkspaceModule {
  updateOutputs(controller: WorkspaceController | null, fullPrompt: string): void {
    controller?.patch({ kind: 'text', selector: '#full-prompt-output', value: fullPrompt });
  }
}
