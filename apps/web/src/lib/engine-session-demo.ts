import type {
  CompletionRequest,
  CompletionResponse,
  EngineAction,
  EngineOutputEvent,
  EngineSession,
  EngineSnapshot,
  ModeStackState,
} from "@packetforge/engine";

interface DemoState {
  hostname: string;
}

const defaultMode: ModeStackState = {
  activeModeId: "exec",
  stack: ["exec"],
};

export function createDemoSession(): EngineSession<DemoState> {
  const state: DemoState = { hostname: "PacketForge" };
  const mode = defaultMode;
  const actionLog: EngineAction[] = [];
  const listeners = new Set<(event: EngineOutputEvent) => void>();

  const emit = (event: EngineOutputEvent) => {
    listeners.forEach((listener) => listener(event));
  };

  return {
    async processInput(input: string) {
      actionLog.push({ command: input, timestamp: Date.now(), modeId: mode.activeModeId });
      emit({ type: "stdout", message: `received input: ${input}`, timestamp: Date.now() });
    },
    getPrompt() {
      return `${state.hostname}>`;
    },
    getState() {
      return state;
    },
    getModeStack() {
      return mode;
    },
    getActionLog() {
      return [...actionLog];
    },
    getSnapshot() {
      const snapshot: EngineSnapshot<DemoState> = {
        mode,
        state,
        actionLog: [...actionLog],
      };
      return snapshot;
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
