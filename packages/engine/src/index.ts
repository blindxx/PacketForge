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
  | { type: "output/clear"; timestamp: number }
  | {
      type: "mode/changed";
      from: EngineModeId[];
      to: EngineModeId[];
      timestamp: number;
    };

export interface EngineAction {
  type: string;
  timestamp: number;
  payload?: Record<string, string>;
}

export interface EngineState {
  schemaVersion: 1;
  mode: ModeStackState;
  modeStack: EngineModeId[];
  lastInput?: string;
  lastEvent?: EngineEvent;
}

export interface EngineSnapshot<TState = unknown> {
  schemaVersion: 1;
  mode: ModeStackState;
  modeStack: EngineModeId[];
  state: TState;
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
  getSnapshot(): EngineSnapshot<EngineState>;
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
  const getActiveMode = (stack: EngineModeId[]) => stack[stack.length - 1] ?? "exec";
  const renderPromptFromMode = (activeMode: EngineModeId) => {
    if (activeMode === "privileged") {
      return "packetforge# ";
    }
    if (activeMode === "config") {
      return "packetforge(config)# ";
    }
    return "packetforge> ";
  };

  const promptOverride = options?.prompt?.trim().length ? options.prompt : undefined;

  const mode: ModeStackState = {
    activeModeId: options?.modeId ?? "exec",
    stack: [options?.modeId ?? "exec"],
  };
  const actionLog: EngineAction[] = [];
  const listeners = new Set<(event: EngineEvent) => void>();

  const state: EngineState = {
    schemaVersion: 1,
    mode,
    modeStack: [...mode.stack],
  };
  let tick = 0;

  const nextTimestamp = () => {
    tick += 1;
    return tick;
  };

  const emit = (event: EngineEvent) => {
    state.lastEvent = event;
    listeners.forEach((listener) => listener(event));
  };

  const appendAction = (action: EngineAction) => {
    actionLog.push(action);
  };

  const syncModeState = () => {
    mode.activeModeId = getActiveMode(mode.stack);
    state.modeStack = [...mode.stack];
  };

  const toPayloadStack = (stack: EngineModeId[]) => stack.join(" > ");

  const applyModeChange = (
    type: "MODE_PUSH" | "MODE_POP" | "MODE_RESET",
    command: string,
    nextStack: EngineModeId[],
    timestamp: number,
  ) => {
    const previousStack = [...mode.stack];
    mode.stack = nextStack;
    syncModeState();

    appendAction({
      type,
      timestamp,
      payload: {
        command,
        from: toPayloadStack(previousStack),
        to: toPayloadStack(nextStack),
      },
    });

    emit({ type: "mode/changed", from: previousStack, to: [...nextStack], timestamp });
  };

  const emitModeAwareUnknownCommand = (timestamp: number, command: string) => {
    const activeMode = getActiveMode(mode.stack);
    const errorText = `% Unknown command (${activeMode} mode)`;
    appendAction({
      type: "command/unknown",
      timestamp,
      payload: { input: command, mode: activeMode },
    });
    emit({ type: "output/error", text: errorText, timestamp });
  };

  const emitModeUnavailable = (timestamp: number, command: string) => {
    appendAction({ type: "command/invalid-mode", timestamp, payload: { input: command } });
    emit({ type: "output/error", text: "% Command not available in this mode", timestamp });
  };

  return {
    async processInput(input: string): Promise<void> {
      const normalizedInput = input.trim();
      state.lastInput = normalizedInput;

      if (!normalizedInput) {
        return;
      }

      const timestamp = nextTimestamp();

      if (normalizedInput === "help") {
        appendAction({ type: "command/help", timestamp });
        emit({
          type: "output/text",
          text:
            "Available commands: help, echo <text>, clear, mode, enable, disable, configure terminal, exit, end",
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

      const activeMode = getActiveMode(mode.stack);

      if (normalizedInput === "enable") {
        if (activeMode !== "exec") {
          emitModeUnavailable(timestamp, normalizedInput);
          return;
        }

        applyModeChange("MODE_PUSH", normalizedInput, [...mode.stack, "privileged"], timestamp);
        return;
      }

      if (normalizedInput === "disable") {
        if (activeMode !== "privileged") {
          emitModeUnavailable(timestamp, normalizedInput);
          return;
        }

        applyModeChange("MODE_RESET", normalizedInput, ["exec"], timestamp);
        return;
      }

      if (normalizedInput === "configure terminal") {
        if (activeMode !== "privileged") {
          emitModeUnavailable(timestamp, normalizedInput);
          return;
        }

        applyModeChange("MODE_PUSH", normalizedInput, [...mode.stack, "config"], timestamp);
        return;
      }

      if (normalizedInput === "exit") {
        if (mode.stack.length === 1) {
          return;
        }

        applyModeChange("MODE_POP", normalizedInput, mode.stack.slice(0, -1), timestamp);
        return;
      }

      if (normalizedInput === "end") {
        if (activeMode !== "config") {
          emitModeUnavailable(timestamp, normalizedInput);
          return;
        }

        if (mode.stack.length > 1) {
          applyModeChange("MODE_POP", normalizedInput, mode.stack.slice(0, -1), timestamp);
        }
        return;
      }

      emitModeAwareUnknownCommand(timestamp, normalizedInput);
    },
    getPrompt() {
      return promptOverride ?? renderPromptFromMode(getActiveMode(mode.stack));
    },
    getState() {
      return {
        ...state,
        mode: { ...state.mode, stack: [...state.mode.stack] },
        modeStack: [...state.modeStack],
      };
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
        modeStack: [...mode.stack],
        state: { ...state, mode: { ...state.mode, stack: [...state.mode.stack] }, modeStack: [...state.modeStack] },
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
