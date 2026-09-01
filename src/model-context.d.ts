interface WebMcpTool {
  name: string;
  description: string;
  inputSchema?: Record<string, unknown>;
  annotations?: { readOnlyHint?: boolean; untrustedContentHint?: boolean };
  execute(input: unknown): Promise<unknown> | unknown;
}

interface WebModelContext {
  registerTool(tool: WebMcpTool, options?: { signal?: AbortSignal }): Promise<void>;
  getTools?(options?: { fromOrigins?: string[] }): Promise<unknown[]>;
}

interface Document {
  readonly modelContext?: WebModelContext;
}

interface Navigator {
  readonly modelContext?: WebModelContext;
}
