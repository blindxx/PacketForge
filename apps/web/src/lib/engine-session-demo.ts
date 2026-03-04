import { createSession, type EngineSession } from "@packetforge/engine";

export function createDemoSession(): EngineSession {
  return createSession({ prompt: "PacketForge> " });
}
