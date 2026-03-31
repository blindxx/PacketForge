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

export interface InterfaceConfig {
  name: string;
  description: string;
  isShutdown: boolean;
}

export interface EngineState {
  schemaVersion: 1;
  mode: ModeStackState;
  modeStack: EngineModeId[];
  deviceConfig: {
    hostname: string;
  };
  interfaces: Partial<Record<string, InterfaceConfig>>;
  activeInterface?: string;
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

interface RegisteredCommand {
  key: string;
  helpLabel: string;
  match: (input: string) => boolean;
  run: (timestamp: number, input: string) => void;
}

export function createSession(options?: CreateSessionOptions): EngineSession {
  const getActiveMode = (stack: EngineModeId[]) => stack[stack.length - 1] ?? "exec";
  const renderPromptFromMode = (hostname: string, activeMode: EngineModeId) => {
    if (activeMode === "privileged") {
      return `${hostname}# `;
    }
    if (activeMode === "config") {
      return `${hostname}(config)# `;
    }
    if (activeMode === "config-if") {
      return `${hostname}(config-if)# `;
    }
    return `${hostname}> `;
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
    deviceConfig: {
      hostname: "packetforge",
    },
    interfaces: {},
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

  const emitAmbiguousCommand = (timestamp: number, command: string) => {
    appendAction({ type: "command/ambiguous", timestamp, payload: { input: command } });
    emit({ type: "output/error", text: "% Ambiguous command", timestamp });
  };

  const getActiveInterface = () => {
    if (!state.activeInterface) {
      return undefined;
    }

    return state.interfaces[state.activeInterface];
  };

  type ResolvedInterface = {
    key: string;
    canonicalName?: string;
    iface?: InterfaceConfig;
  };

  const INVALID_INTERFACE_NAME_ERROR = "% Invalid interface name";

  const sanitizeInterfaceInput = (interfaceName: string) => interfaceName.trim().replace(/\s+/g, " ").toLowerCase();

  const collapseInterfaceKey = (interfaceName: string) => sanitizeInterfaceInput(interfaceName).replace(/\s+/g, "");

  const parseInterfaceFamilyAndSuffix = (interfaceName: string) => {
    const sanitizedInput = sanitizeInterfaceInput(interfaceName);
    const shortFormMatch = /^(gi|fa|te)\s?(\d+(?:\/\d+)+)$/.exec(sanitizedInput);

    if (shortFormMatch) {
      return {
        family: shortFormMatch[1] as "gi" | "fa" | "te",
        suffix: shortFormMatch[2],
      };
    }

    const longFormMatch = /^(gigabitethernet|fastethernet|tengigabitethernet)(?: ?)(\d+(?:\/\d+)+)$/.exec(
      sanitizedInput,
    );

    if (!longFormMatch) {
      return undefined;
    }

    const longFamilyToShort: Record<string, "gi" | "fa" | "te"> = {
      gigabitethernet: "gi",
      fastethernet: "fa",
      tengigabitethernet: "te",
    };

    return {
      family: longFamilyToShort[longFormMatch[1]],
      suffix: longFormMatch[2],
    };
  };

  const isInterfaceNameValid = (interfaceName: string) =>
    /^(?:gi|fa|te)\d+(?:\/\d+)+$/.test(interfaceName);

  const formatInterfaceDisplayName = (interfaceName: string) => {
    const gigabitMatch = /^gi(\d+(?:\/\d+)+)$/i.exec(interfaceName);

    if (gigabitMatch) {
      return `GigabitEthernet${gigabitMatch[1]}`;
    }

    const fastEthernetMatch = /^fa(\d+(?:\/\d+)+)$/i.exec(interfaceName);

    if (fastEthernetMatch) {
      return `FastEthernet${fastEthernetMatch[1]}`;
    }

    const tenGigabitMatch = /^te(\d+(?:\/\d+)+)$/i.exec(interfaceName);

    if (tenGigabitMatch) {
      return `TenGigabitEthernet${tenGigabitMatch[1]}`;
    }

    return interfaceName;
  };

  const normalizeInterfaceName = (interfaceName: string) => {
    const parsed = parseInterfaceFamilyAndSuffix(interfaceName);

    if (!parsed) {
      return undefined;
    }

    return `${parsed.family}${parsed.suffix}`;
  };

  const resolveInterface = (interfaceName: string): ResolvedInterface | undefined => {
    const exactName = sanitizeInterfaceInput(interfaceName);
    const collapsedFallbackKey = collapseInterfaceKey(interfaceName);

    if (!exactName) {
      return undefined;
    }

    const exactMatch = state.interfaces[exactName];

    if (exactMatch) {
      return { key: exactName, iface: exactMatch, canonicalName: normalizeInterfaceName(exactName) };
    }

    const canonicalName = normalizeInterfaceName(exactName);

    if (!canonicalName) {
      const fallbackMatch = state.interfaces[collapsedFallbackKey];

      if (fallbackMatch) {
        return { key: collapsedFallbackKey, iface: fallbackMatch };
      }

      return { key: collapsedFallbackKey };
    }

    const canonicalMatch = state.interfaces[canonicalName];

    if (canonicalMatch) {
      return { key: canonicalName, iface: canonicalMatch, canonicalName };
    }

    let normalizedEquivalentMatch: [string, InterfaceConfig] | undefined;

    Object.entries(state.interfaces).forEach((entry) => {
      if (entry[1] == null || normalizeInterfaceName(entry[0]) !== canonicalName) {
        return;
      }

      if (!normalizedEquivalentMatch) {
        normalizedEquivalentMatch = [entry[0], entry[1]];
        return;
      }

      const [bestName] = normalizedEquivalentMatch;
      const comparison = entry[0] < bestName ? -1 : entry[0] > bestName ? 1 : 0;

      if (comparison < 0) {
        normalizedEquivalentMatch = [entry[0], entry[1]];
      }
    });

    if (normalizedEquivalentMatch) {
      return {
        key: normalizedEquivalentMatch[0],
        iface: normalizedEquivalentMatch[1],
        canonicalName,
      };
    }

    return { key: canonicalName, canonicalName };
  };

  const getConfiguredInterfaces = () =>
    Object.entries(state.interfaces)
      .filter((entry): entry is [string, InterfaceConfig] => entry[1] != null)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));

  const renderInterfaceBlock = (iface: InterfaceConfig) => {
    const description = (iface.description ?? "").trim();
    const status = iface.isShutdown ? "down" : "up";
    return [
      `Interface ${formatInterfaceDisplayName(iface.name)}`,
      `  Description: ${description.length > 0 ? description : "--"}`,
      `  Status: ${status}`,
    ].join("\n");
  };

  const commandRegistry: Record<EngineModeId, RegisteredCommand[]> = {
    exec: [
      {
        key: "help",
        helpLabel: "help",
        match: (input) => input === "help",
        run: (timestamp) => {
          const activeMode = getActiveMode(mode.stack);
          const commands = commandRegistry[activeMode] ?? [];
          appendAction({ type: "command/help", timestamp });
          emit({
            type: "output/text",
            text: `Available commands: ${commands.map((command) => command.helpLabel).join(", ")}`,
            timestamp,
          });
        },
      },
      {
        key: "echo",
        helpLabel: "echo <text>",
        match: (input) => input.startsWith("echo "),
        run: (timestamp, input) => {
          const text = input.slice(5);
          appendAction({ type: "command/echo", timestamp, payload: { text } });
          emit({ type: "output/text", text, timestamp });
        },
      },
      {
        key: "clear",
        helpLabel: "clear",
        match: (input) => input === "clear",
        run: (timestamp) => {
          appendAction({ type: "command/clear", timestamp });
          emit({ type: "output/clear", timestamp });
        },
      },
      {
        key: "mode",
        helpLabel: "mode",
        match: (input) => input === "mode",
        run: (timestamp) => {
          appendAction({ type: "command/mode", timestamp });
          emit({
            type: "output/text",
            text: `Mode stack: ${mode.stack.join(" > ")}`,
            timestamp,
          });
        },
      },
      {
        key: "enable",
        helpLabel: "enable",
        match: (input) => input === "enable",
        run: (timestamp, input) => {
          applyModeChange("MODE_PUSH", input, [...mode.stack, "privileged"], timestamp);
        },
      },
      {
        key: "exit",
        helpLabel: "exit",
        match: (input) => input === "exit",
        run: () => {
          return;
        },
      },
    ],
    privileged: [
      {
        key: "help",
        helpLabel: "help",
        match: (input) => input === "help",
        run: (timestamp) => {
          const activeMode = getActiveMode(mode.stack);
          const commands = commandRegistry[activeMode] ?? [];
          appendAction({ type: "command/help", timestamp });
          emit({
            type: "output/text",
            text: `Available commands: ${commands.map((command) => command.helpLabel).join(", ")}`,
            timestamp,
          });
        },
      },
      {
        key: "echo",
        helpLabel: "echo <text>",
        match: (input) => input.startsWith("echo "),
        run: (timestamp, input) => {
          const text = input.slice(5);
          appendAction({ type: "command/echo", timestamp, payload: { text } });
          emit({ type: "output/text", text, timestamp });
        },
      },
      {
        key: "clear",
        helpLabel: "clear",
        match: (input) => input === "clear",
        run: (timestamp) => {
          appendAction({ type: "command/clear", timestamp });
          emit({ type: "output/clear", timestamp });
        },
      },
      {
        key: "mode",
        helpLabel: "mode",
        match: (input) => input === "mode",
        run: (timestamp) => {
          appendAction({ type: "command/mode", timestamp });
          emit({
            type: "output/text",
            text: `Mode stack: ${mode.stack.join(" > ")}`,
            timestamp,
          });
        },
      },
      {
        key: "disable",
        helpLabel: "disable",
        match: (input) => input === "disable",
        run: (timestamp, input) => {
          applyModeChange("MODE_RESET", input, ["exec"], timestamp);
        },
      },
      {
        key: "configure terminal",
        helpLabel: "configure terminal",
        match: (input) => input === "configure terminal",
        run: (timestamp, input) => {
          applyModeChange("MODE_PUSH", input, [...mode.stack, "config"], timestamp);
        },
      },
      {
        key: "show running-config",
        helpLabel: "show running-config",
        match: (input) => input === "show running-config",
        run: (timestamp) => {
          appendAction({ type: "command/show-running-config", timestamp });
          const interfaceBlocks = Object.entries(state.interfaces)
            .filter((entry): entry is [string, InterfaceConfig] => entry[1] != null)
            .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
            .map(([, iface]) => {
              const lines = [`interface ${formatInterfaceDisplayName(iface.name)}`];
              const description = (iface.description ?? "").trim();

              if (description.length > 0) {
                lines.push(` description ${description}`);
              }

              lines.push(iface.isShutdown ? " shutdown" : " no shutdown");
              return lines.join("\n");
            });

          emit({
            type: "output/text",
            text: [`hostname ${state.deviceConfig.hostname}`, ...interfaceBlocks].join("\n"),
            timestamp,
          });
        },
      },
      {
        key: "show interfaces",
        helpLabel: "show interfaces [<name>]",
        match: (input) => {
          if (input === "show interfaces") {
            return true;
          }

          return input.startsWith("show interfaces ");
        },
        run: (timestamp, input) => {
          appendAction({ type: "command/show-interfaces", timestamp });
          const interfaceName = input.slice("show interfaces".length).trim();

          if (interfaceName) {
            const canonicalInterfaceName = normalizeInterfaceName(interfaceName);

            if (!canonicalInterfaceName || !isInterfaceNameValid(canonicalInterfaceName)) {
              emit({
                type: "output/error",
                text: INVALID_INTERFACE_NAME_ERROR,
                timestamp,
              });
              return;
            }

            const resolvedInterface = resolveInterface(canonicalInterfaceName);

            if (!resolvedInterface?.iface) {
              emit({
                type: "output/error",
                text: "% Interface not found",
                timestamp,
              });
              return;
            }

            emit({
              type: "output/text",
              text: renderInterfaceBlock(resolvedInterface.iface),
              timestamp,
            });
            return;
          }

          emit({
            type: "output/text",
            text: getConfiguredInterfaces()
              .map(([, iface]) => renderInterfaceBlock(iface))
              .join("\n\n"),
            timestamp,
          });
        },
      },
      {
        key: "exit",
        helpLabel: "exit",
        match: (input) => input === "exit",
        run: (timestamp, input) => {
          if (mode.stack.length === 1) {
            return;
          }

          applyModeChange("MODE_POP", input, mode.stack.slice(0, -1), timestamp);
        },
      },
    ],
    config: [
      {
        key: "help",
        helpLabel: "help",
        match: (input) => input === "help",
        run: (timestamp) => {
          const activeMode = getActiveMode(mode.stack);
          const commands = commandRegistry[activeMode] ?? [];
          appendAction({ type: "command/help", timestamp });
          emit({
            type: "output/text",
            text: `Available commands: ${commands.map((command) => command.helpLabel).join(", ")}`,
            timestamp,
          });
        },
      },
      {
        key: "echo",
        helpLabel: "echo <text>",
        match: (input) => input.startsWith("echo "),
        run: (timestamp, input) => {
          const text = input.slice(5);
          appendAction({ type: "command/echo", timestamp, payload: { text } });
          emit({ type: "output/text", text, timestamp });
        },
      },
      {
        key: "clear",
        helpLabel: "clear",
        match: (input) => input === "clear",
        run: (timestamp) => {
          appendAction({ type: "command/clear", timestamp });
          emit({ type: "output/clear", timestamp });
        },
      },
      {
        key: "mode",
        helpLabel: "mode",
        match: (input) => input === "mode",
        run: (timestamp) => {
          appendAction({ type: "command/mode", timestamp });
          emit({
            type: "output/text",
            text: `Mode stack: ${mode.stack.join(" > ")}`,
            timestamp,
          });
        },
      },
      {
        key: "hostname",
        helpLabel: "hostname <name>",
        match: (input) => /^hostname\s+\S+$/.test(input),
        run: (timestamp, input) => {
          const hostname = input.split(/\s+/, 2)[1];
          state.deviceConfig.hostname = hostname;
          appendAction({
            type: "config/hostname",
            timestamp,
            payload: { hostname },
          });
        },
      },
      {
        key: "exit",
        helpLabel: "exit",
        match: (input) => input === "exit",
        run: (timestamp, input) => {
          if (mode.stack.length === 1) {
            return;
          }

          applyModeChange("MODE_POP", input, mode.stack.slice(0, -1), timestamp);
        },
      },
      {
        key: "interface",
        helpLabel: "interface <name>",
        match: (input) => {
          return input.startsWith("interface ");
        },
        run: (timestamp, input) => {
          const interfaceName = input.slice("interface".length).trim();
          const canonicalInterfaceName = normalizeInterfaceName(interfaceName);

          if (!canonicalInterfaceName || !isInterfaceNameValid(canonicalInterfaceName)) {
            emit({
              type: "output/error",
              text: INVALID_INTERFACE_NAME_ERROR,
              timestamp,
            });
            return;
          }

          const resolvedInterface = resolveInterface(canonicalInterfaceName);
          const interfaceKey = resolvedInterface?.iface
            ? resolvedInterface.key
            : resolvedInterface?.canonicalName ?? resolvedInterface?.key;

          if (!interfaceKey) {
            emit({
              type: "output/error",
              text: "% Interface not found",
              timestamp,
            });
            return;
          }

          if (!state.interfaces[interfaceKey]) {
            state.interfaces[interfaceKey] = {
              name: interfaceKey,
              description: "",
              isShutdown: false,
            };
          }

          state.activeInterface = interfaceKey;
          appendAction({
            type: "config/interface-select",
            timestamp,
            payload: { interface: interfaceKey },
          });
          applyModeChange("MODE_PUSH", input, [...mode.stack, "config-if"], timestamp);
        },
      },
      {
        key: "end",
        helpLabel: "end",
        match: (input) => input === "end",
        run: (timestamp, input) => {
          if (mode.stack.length > 1) {
            applyModeChange("MODE_POP", input, mode.stack.slice(0, -1), timestamp);
          } else {
            applyModeChange("MODE_RESET", input, ["exec"], timestamp);
          }
        },
      },
    ],
    "config-if": [
      {
        key: "help",
        helpLabel: "help",
        match: (input) => input === "help",
        run: (timestamp) => {
          const activeMode = getActiveMode(mode.stack);
          const commands = commandRegistry[activeMode] ?? [];
          appendAction({ type: "command/help", timestamp });
          emit({
            type: "output/text",
            text: `Available commands: ${commands.map((command) => command.helpLabel).join(", ")}`,
            timestamp,
          });
        },
      },
      {
        key: "echo",
        helpLabel: "echo <text>",
        match: (input) => input.startsWith("echo "),
        run: (timestamp, input) => {
          const text = input.slice(5);
          appendAction({ type: "command/echo", timestamp, payload: { text } });
          emit({ type: "output/text", text, timestamp });
        },
      },
      {
        key: "clear",
        helpLabel: "clear",
        match: (input) => input === "clear",
        run: (timestamp) => {
          appendAction({ type: "command/clear", timestamp });
          emit({ type: "output/clear", timestamp });
        },
      },
      {
        key: "mode",
        helpLabel: "mode",
        match: (input) => input === "mode",
        run: (timestamp) => {
          appendAction({ type: "command/mode", timestamp });
          emit({
            type: "output/text",
            text: `Mode stack: ${mode.stack.join(" > ")}`,
            timestamp,
          });
        },
      },
      {
        key: "description",
        helpLabel: "description <text>",
        match: (input) => /^description\s+\S.*$/.test(input),
        run: (timestamp, input) => {
          const iface = getActiveInterface();
          if (!iface || !state.activeInterface) {
            appendAction({ type: "config/interface-context-missing", timestamp, payload: { input } });
            emit({ type: "output/error", text: "% Active interface context missing", timestamp });
            return;
          }

          const description = input.slice("description ".length).trim();
          iface.description = description;
          appendAction({
            type: "config/interface-description",
            timestamp,
            payload: { interface: state.activeInterface, description },
          });
        },
      },
      {
        key: "shutdown",
        helpLabel: "shutdown",
        match: (input) => input === "shutdown",
        run: (timestamp) => {
          const iface = getActiveInterface();
          if (!iface || !state.activeInterface) {
            appendAction({ type: "config/interface-context-missing", timestamp, payload: { input: "shutdown" } });
            emit({ type: "output/error", text: "% Active interface context missing", timestamp });
            return;
          }

          iface.isShutdown = true;
          appendAction({
            type: "config/interface-shutdown",
            timestamp,
            payload: { interface: state.activeInterface, shutdown: "true" },
          });
        },
      },
      {
        key: "no shutdown",
        helpLabel: "no shutdown",
        match: (input) => input === "no shutdown",
        run: (timestamp) => {
          const iface = getActiveInterface();
          if (!iface || !state.activeInterface) {
            appendAction({
              type: "config/interface-context-missing",
              timestamp,
              payload: { input: "no shutdown" },
            });
            emit({ type: "output/error", text: "% Active interface context missing", timestamp });
            return;
          }

          iface.isShutdown = false;
          appendAction({
            type: "config/interface-shutdown",
            timestamp,
            payload: { interface: state.activeInterface, shutdown: "false" },
          });
        },
      },
      {
        key: "exit",
        helpLabel: "exit",
        match: (input) => input === "exit",
        run: (timestamp, input) => {
          if (mode.stack.length === 1) {
            return;
          }

          state.activeInterface = undefined;
          applyModeChange("MODE_POP", input, mode.stack.slice(0, -1), timestamp);
        },
      },
      {
        key: "end",
        helpLabel: "end",
        match: (input) => input === "end",
        run: (timestamp, input) => {
          state.activeInterface = undefined;
          if (mode.stack.length > 2) {
            applyModeChange("MODE_RESET", input, mode.stack.slice(0, -2), timestamp);
          } else {
            applyModeChange("MODE_RESET", input, ["exec"], timestamp);
          }
        },
      },
    ],
  };

  const allRegisteredCommands = Object.values(commandRegistry).flat();

  const resolveAbbreviatedInput = (input: string, modeCommands: RegisteredCommand[]) => {
    const inputTokenMatches: RegExpMatchArray[] = [];
    const tokenRegex = /\S+/g;
    let match: RegExpMatchArray | null;

    while ((match = tokenRegex.exec(input)) !== null) {
      inputTokenMatches.push(match);
    }

    if (inputTokenMatches.length === 0) {
      return { type: "unresolved" as const };
    }

    const commandPaths = modeCommands
      .map((command) => ({ tokens: command.key.split(/\s+/), key: command.key }))
      .sort((left, right) => (left.key < right.key ? -1 : left.key > right.key ? 1 : 0));

    let candidates = commandPaths;
    let resolvedCommandTokens: string[] = [];
    let consumedInputTokens = 0;
    let lastCompletedMatch:
      | {
          expandedTokens: string[];
          consumedInputTokens: number;
        }
      | undefined;

    for (let tokenIndex = 0; tokenIndex < inputTokenMatches.length; tokenIndex += 1) {
      const inputToken = inputTokenMatches[tokenIndex][0];
      const tokenValues = Array.from(new Set(candidates.filter((path) => path.tokens.length > tokenIndex).map((path) => path.tokens[tokenIndex])));

      if (tokenValues.length === 0) {
        break;
      }

      const exactMatches = tokenValues.filter((token) => token === inputToken);

      if (exactMatches.length === 1) {
        const matchedToken = exactMatches[0];
        candidates = candidates.filter((path) => path.tokens[tokenIndex] === matchedToken);
        resolvedCommandTokens = [...resolvedCommandTokens, matchedToken];
        consumedInputTokens += 1;
      } else {
        const prefixMatches = tokenValues.filter((token) => token.startsWith(inputToken));

        if (prefixMatches.length === 0) {
          break;
        }

        if (prefixMatches.length > 1) {
          return { type: "ambiguous" as const };
        }

        const matchedToken = prefixMatches[0];
        candidates = candidates.filter((path) => path.tokens[tokenIndex] === matchedToken);
        resolvedCommandTokens = [...resolvedCommandTokens, matchedToken];
        consumedInputTokens += 1;
      }

      const completedCandidates = candidates.filter((path) => path.tokens.length === consumedInputTokens);

      if (completedCandidates.length > 0) {
        lastCompletedMatch = {
          expandedTokens: [...resolvedCommandTokens],
          consumedInputTokens,
        };

        const canContinueToNextCommandToken =
          tokenIndex + 1 < inputTokenMatches.length &&
          candidates.some((path) => path.tokens.length > consumedInputTokens);

        if (!canContinueToNextCommandToken) {
          break;
        }
      }
    }

    if (!lastCompletedMatch || lastCompletedMatch.expandedTokens.length === 0) {
      return { type: "unresolved" as const };
    }

    const lastCommandToken = inputTokenMatches[lastCompletedMatch.consumedInputTokens - 1];
    const remainderStartIndex =
      lastCommandToken && typeof lastCommandToken.index === "number"
        ? lastCommandToken.index + lastCommandToken[0].length
        : undefined;
    const inputRemainder = remainderStartIndex === undefined ? "" : input.slice(remainderStartIndex);
    const expandedCommand = lastCompletedMatch.expandedTokens.join(" ");

    return {
      type: "resolved" as const,
      input: `${expandedCommand}${inputRemainder}`,
    };
  };

  const cloneInterfaces = (
    src: Partial<Record<string, InterfaceConfig>>,
  ): Record<string, InterfaceConfig> =>
    Object.fromEntries(
      Object.entries(src)
        .filter((entry): entry is [string, InterfaceConfig] => entry[1] !== undefined)
        .map(([name, iface]) => [name, { ...iface }]),
    );

  return {
    async processInput(input: string): Promise<void> {
      const normalizedInput = input.trim();
      state.lastInput = normalizedInput;

      if (!normalizedInput) {
        return;
      }

      const timestamp = nextTimestamp();
      const activeMode = getActiveMode(mode.stack);
      const modeCommands = commandRegistry[activeMode] ?? [];
      const matchedModeCommand = modeCommands.find((command) => command.match(normalizedInput));

      if (matchedModeCommand) {
        matchedModeCommand.run(timestamp, normalizedInput);
        return;
      }

      const abbreviationResolution = resolveAbbreviatedInput(normalizedInput, modeCommands);

      if (abbreviationResolution.type === "ambiguous") {
        emitAmbiguousCommand(timestamp, normalizedInput);
        return;
      }

      if (abbreviationResolution.type === "resolved" && abbreviationResolution.input !== normalizedInput) {
        const abbreviatedMatch = modeCommands.find((command) => command.match(abbreviationResolution.input));

        if (abbreviatedMatch) {
          abbreviatedMatch.run(timestamp, abbreviationResolution.input);
          return;
        }
      }

      if (allRegisteredCommands.some((command) => command.match(normalizedInput))) {
        emitModeUnavailable(timestamp, normalizedInput);
        return;
      }

      emitModeAwareUnknownCommand(timestamp, normalizedInput);
    },
    getPrompt() {
      return promptOverride ?? renderPromptFromMode(state.deviceConfig.hostname, getActiveMode(mode.stack));
    },
    getState() {
      return {
        ...state,
        mode: { ...state.mode, stack: [...state.mode.stack] },
        modeStack: [...state.modeStack],
        deviceConfig: { ...state.deviceConfig },
        interfaces: cloneInterfaces(state.interfaces),
        activeInterface: state.activeInterface,
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
        state: {
          ...state,
          mode: { ...state.mode, stack: [...state.mode.stack] },
          modeStack: [...state.modeStack],
          deviceConfig: { ...state.deviceConfig },
          interfaces: cloneInterfaces(state.interfaces),
          activeInterface: state.activeInterface,
        },
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
