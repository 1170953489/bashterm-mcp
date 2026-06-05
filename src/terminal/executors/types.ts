export interface TerminalExecutionResult {
  commandId: string;
  output: string;
  exitCode: number | null;
  timedOut: boolean;
  durationMs: number;
}

export interface TerminalCommandExecutor {
  execute(command: string, timeoutMs: number): Promise<TerminalExecutionResult>;
  readonly isBusy: boolean;
  dispose(): void;
}
