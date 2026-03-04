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

export type EngineEvent =
  | { type: "output/text"; text: string; timestamp: number }
  | { type: "output/error"; text: string; timestamp: number }
  | { type: "output/clear"; timestamp: number };

export interface EngineAction {
  type: string;
  timestamp: number;
  payload?: Record<string, string>;
}

export interface EngineState {
  schemaVersion: 1;
  mode: ModeStackState;
  lastInput?: string;
  lastEvent?: EngineEvent;
}

export interface EngineSnapshot {
  schemaVersion: 1;
  mode: ModeStackState;
  lastInput?: string;
  lastEvent?: EngineEvent;
  actionLog: EngineAction[];
}

export interface EngineSession {
  processInput(input: string): Promise<void>;
  getPrompt(): string;
  getState(): EngineState;
  getModeStack(): ModeStackState;
  getActionLog(): EngineAction[];
  getSnapshot(): EngineSnapshot;
  subscribeEvents(listener: (event: EngineEvent) => void): () => void;
  getCompletions(request: CompletionRequest): Promise<CompletionResponse>;
}

export interface CreateSessionOptions {
  prompt?: string;
  modeId?: string;
}

export interface EngineSessionFactory {
  createSession(options?: CreateSessionOptions): EngineSession;
}

export function createSession(options?: CreateSessionOptions): EngineSession {
  const mode: ModeStackState = {
    activeModeId: options?.modeId ?? "exec",
    stack: [options?.modeId ?? "exec"],
  };
  const prompt = options?.prompt ?? "packetforge> ";
  const actionLog: EngineAction[] = [];
  const listeners = new Set<(event: EngineEvent) => void>();

  const state: EngineState = {
    schemaVersion: 1,
    mode,
  };

  const emit = (event: EngineEvent) => {
    state.lastEvent = event;
    listeners.forEach((listener) => listener(event));
  };

  const appendAction = (action: EngineAction) => {
    actionLog.push(action);
  };

  return {
    async processInput(input: string): Promise<void> {
      const normalizedInput = input.trim();
      state.lastInput = normalizedInput;

      if (!normalizedInput) {
        return;
      }

      const timestamp = Date.now();

      if (normalizedInput === "help") {
        appendAction({ type: "command/help", timestamp });
        emit({
          type: "output/text",
          text: "Available commands: help, echo <text>, clear, mode",
          timestamp,
        });
        return;
      }

      if (normalizedInput.startsWith("echo ")) {
        const text = normalizedInput.slice(5);
        appendAction({ type: "command/echo", timestamp, payload: { text } });
        emit({ type: "output/text", text, timestamp });
        return;
      }

      if (normalizedInput === "clear") {
        appendAction({ type: "command/clear", timestamp });
        emit({ type: "output/clear", timestamp });
        return;
      }

      if (normalizedInput === "mode") {
        appendAction({ type: "command/mode", timestamp });
        emit({
          type: "output/text",
          text: `Mode stack: ${mode.stack.join(" > ")}`,
          timestamp,
        });
        return;
      }

      appendAction({ type: "command/unknown", timestamp, payload: { input: normalizedInput } });
      emit({
        type: "output/error",
        text: `Unknown command: ${normalizedInput}`,
        timestamp,
      });
    },
    getPrompt() {
      return prompt;
    },
    getState() {
      return { ...state, mode: { ...state.mode, stack: [...state.mode.stack] } };
    },
    getModeStack() {
      return { ...mode, stack: [...mode.stack] };
    },
    getActionLog() {
      return [...actionLog];
    },
    getSnapshot() {
      return {
        schemaVersion: 1,
        mode: { ...mode, stack: [...mode.stack] },
        lastInput: state.lastInput,
        lastEvent: state.lastEvent,
        actionLog: [...actionLog],
      };
    },
    subscribeEvents(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async getCompletions(_request: CompletionRequest): Promise<CompletionResponse> {
      return { items: [], replaceRange: [0, 0] };
    },
  };
}
