"use client";

import { useEffect, useMemo, useState } from "react";

import { createSession, type EngineEvent } from "@packetforge/engine";

export default function Home() {
  const session = useMemo(() => createSession(), []);
  const [lastEvent, setLastEvent] = useState<string>("no engine events yet");

  useEffect(() => {
    const unsubscribe = session.subscribeEvents((event: EngineEvent) => {
      if (event.type === "output/text" || event.type === "output/error") {
        setLastEvent(event.text);
        return;
      }

      setLastEvent(event.type);
    });

    session.processInput("help");

    return unsubscribe;
  }, [session]);

  return (
    <div>
      <h1 style={{ fontSize: "2rem", fontWeight: 700 }}>PacketForge</h1>
      <p style={{ marginTop: "0.5rem", color: "#555" }}>
        CCNA training simulator — train like an engineer.
      </p>
      <p style={{ marginTop: "1rem" }}>Prompt: {session.getPrompt()}</p>
      <p style={{ marginTop: "0.5rem" }}>Latest engine event: {lastEvent}</p>
      <p style={{ marginTop: "0.5rem" }}>Action log length: {session.getActionLog().length}</p>
    </div>
  );
}
