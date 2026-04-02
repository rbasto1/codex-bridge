import type {
  ReasoningEffort,
  SandboxPolicy,
  ThreadSessionConfig,
} from "../shared/codex.js";
import type {
  ComposerControlDraft,
  ModelChoice,
  ModelOption,
  PermissionBaseline,
  ThreadResponse,
  ThreadSessionResponse,
} from "../types";

export function extractThreadSessionConfig(
  response: ThreadResponse | ThreadSessionResponse,
): ThreadSessionConfig | null {
  if (!("approvalPolicy" in response) || !("cwd" in response) || !("model" in response) || !("sandbox" in response)) {
    return null;
  }

  return {
    cwd: response.cwd,
    model: response.model,
    reasoningEffort: response.reasoningEffort,
    approvalPolicy: response.approvalPolicy,
    sandbox: response.sandbox,
  };
}

export function createComposerControlDraft(
  sessionConfig: ThreadSessionConfig | null,
  models: ModelOption[],
): ComposerControlDraft | null {
  const fallbackModel = sessionConfig?.model ?? models.find((model) => model.isDefault)?.model ?? models[0]?.model;
  if (!fallbackModel) {
    return null;
  }

  const modelOption = findModelOption(models, fallbackModel);
  return {
    mode: "default",
    model: fallbackModel,
    effort: normalizeReasoningEffort(modelOption, sessionConfig?.reasoningEffort ?? null),
    fullAccess: isDangerFullAccess(sessionConfig?.sandbox),
  };
}

export function listModelChoices(models: ModelOption[], selectedModel: string): ModelChoice[] {
  if (models.some((model) => model.model === selectedModel)) {
    return models.map((model) => ({
      displayName: model.displayName,
      model: model.model,
    }));
  }

  return [
    {
      displayName: selectedModel,
      model: selectedModel,
    },
    ...models.map((model) => ({
      displayName: model.displayName,
      model: model.model,
    })),
  ];
}

export function findModelOption(models: ModelOption[], model: string | null | undefined): ModelOption | null {
  if (!model) {
    return null;
  }

  return models.find((entry) => entry.model === model) ?? null;
}

export function normalizeReasoningEffort(
  model: ModelOption | null,
  effort: ReasoningEffort | null,
): ReasoningEffort | null {
  if (!model) {
    return effort;
  }

  if (effort && model.supportedReasoningEfforts.some((option) => option.reasoningEffort === effort)) {
    return effort;
  }

  return model.defaultReasoningEffort;
}

export function resolvePermissionBaseline(
  baseline: PermissionBaseline | undefined,
  sessionConfig: ThreadSessionConfig | null,
): PermissionBaseline {
  if (baseline) {
    return baseline;
  }

  if (sessionConfig && !isDangerFullAccess(sessionConfig.sandbox)) {
    return {
      approvalPolicy: sessionConfig.approvalPolicy,
      sandbox: sessionConfig.sandbox,
    };
  }

  return {
    approvalPolicy: "on-request",
    sandbox: {
      type: "workspaceWrite",
      writableRoots: [],
      readOnlyAccess: {
        type: "fullAccess",
      },
      networkAccess: false,
      excludeTmpdirEnvVar: false,
      excludeSlashTmp: false,
    },
  };
}

export function buildThreadSessionConfig(
  cwd: string,
  controls: ComposerControlDraft,
  permissionBaseline: PermissionBaseline,
  model: ModelOption | null,
): ThreadSessionConfig {
  return {
    cwd,
    model: controls.model,
    reasoningEffort: normalizeReasoningEffort(model, controls.effort),
    approvalPolicy: controls.fullAccess ? "never" : permissionBaseline.approvalPolicy,
    sandbox: controls.fullAccess ? { type: "dangerFullAccess" } : permissionBaseline.sandbox,
  };
}

export function isDangerFullAccess(sandbox: SandboxPolicy | null | undefined): boolean {
  return sandbox?.type === "dangerFullAccess";
}

export function formatReasoningEffort(effort: ReasoningEffort): string {
  return effort === "xhigh" ? "X-High" : effort[0].toUpperCase() + effort.slice(1);
}
