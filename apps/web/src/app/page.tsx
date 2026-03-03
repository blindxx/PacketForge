"use client";

import { useEffect, useMemo, useState } from "react";

import type { EngineOutputEvent } from "@packetforge/engine";

import { createDemoSession } from "@/lib/engine-session-demo";

export default function Home() {
  const session = useMemo(() => createDemoSession(), []);
  const [lastMessage, setLastMessage] = useState<string>("no engine events yet");

  useEffect(() => {
    const unsubscribe = session.subscribeEvents((event: EngineOutputEvent) => {
      if (event.type === "stdout") {
        setLastMessage(event.message);
      }
    });

    session.processInput("show clock");

    return unsubscribe;
  }, [session]);

  return (
    <div>
      <h1 style={{ fontSize: "2rem", fontWeight: 700 }}>PacketForge</h1>
      <p style={{ marginTop: "0.5rem", color: "#555" }}>
        CCNA training simulator — train like an engineer.
      </p>
      <p style={{ marginTop: "1rem" }}>Prompt: {session.getPrompt()}</p>
      <p style={{ marginTop: "0.5rem" }}>Latest engine event: {lastMessage}</p>
    </div>
  );
}
