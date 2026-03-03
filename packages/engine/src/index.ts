export type EngineModeId = string;

export interface EngineMode {
  id: EngineModeId;
  promptLabel: string;
  parentModeId?: EngineModeId;
}

export interface ModeStackState {
  activeModeId: EngineModeId;
  stack: EngineModeId[];
}

export interface CommandExecutionContext<TState = unknown> {
  state: TState;
  mode: ModeStackState;
}

export interface CommandNode<TState = unknown> {
  token: string;
  description: string;
  children?: CommandNode<TState>[];
  execute?: (context: CommandExecutionContext<TState>) => void | Promise<void>;
}

export interface CompletionItem {
  value: string;
  description?: string;
}

export interface CompletionRequest {
  input: string;
  cursor: number;
}

export interface CompletionResponse {
  items: CompletionItem[];
  replaceRange: [start: number, end: number];
}

export type EngineOutputEvent =
  | { type: "stdout"; message: string; timestamp: number }
  | { type: "stderr"; message: string; timestamp: number }
  | { type: "system"; code: "PROMPT_CHANGED" | "MODE_CHANGED"; timestamp: number };

export interface EngineSnapshot<TState = unknown> {
  mode: ModeStackState;
  state: TState;
  actionLog: EngineAction[];
}

export interface EngineAction {
  command: string;
  timestamp: number;
  modeId: EngineModeId;
}

export interface EngineSession<TState = unknown> {
  processInput(input: string): Promise<void>;
  getPrompt(): string;
  getState(): TState;
  getModeStack(): ModeStackState;
  getActionLog(): EngineAction[];
  getSnapshot(): EngineSnapshot<TState>;
  subscribeEvents(listener: (event: EngineOutputEvent) => void): () => void;
  getCompletions(request: CompletionRequest): Promise<CompletionResponse>;
}

export interface EngineSessionFactory<TState = unknown> {
  createSession(initialState?: TState): EngineSession<TState>;
}
