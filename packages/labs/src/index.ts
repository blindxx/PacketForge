import type { EngineAction, EngineSnapshot } from "@packetforge/engine";

export type LabId = string;

export interface LabObjective<TState = unknown> {
  id: string;
  description: string;
  validate: (context: LabValidationContext<TState>) => LabValidationMessage[];
}

export interface LabDefinition<TState = unknown> {
  id: LabId;
  title: string;
  description: string;
  initialState: TState;
  objectives: LabObjective<TState>[];
}

export interface LabValidationContext<TState = unknown> {
  snapshot: EngineSnapshot<TState>;
  actionLog: EngineAction[];
}

export interface LabValidationMessage {
  level: "info" | "warning" | "error";
  message: string;
}

export interface LabValidationResult {
  passed: boolean;
  messages: LabValidationMessage[];
}

export type LabValidator<TState = unknown> = (
  context: LabValidationContext<TState>,
) => LabValidationResult;
