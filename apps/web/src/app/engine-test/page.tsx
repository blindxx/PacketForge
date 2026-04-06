"use client";

import { FormEvent, useEffect, useRef, useState } from "react";

import { createSession, type EngineEvent, type EngineSession } from "@packetforge/engine";

export default function EngineTestPage() {
  const sessionRef = useRef<EngineSession | null>(null);

  if (!sessionRef.current) {
    sessionRef.current = createSession();
  }

  const session = sessionRef.current;
  const [command, setCommand] = useState("");
  const [prompt, setPrompt] = useState(session.getPrompt());
  const [latestEvent, setLatestEvent] = useState<EngineEvent | null>(null);
  const [actionCount, setActionCount] = useState(session.getActionLog().length);

  useEffect(() => {
    const unsubscribe = session.subscribeEvents((event) => {
      setLatestEvent(event);
      setPrompt(session.getPrompt());
      setActionCount(session.getActionLog().length);
    });

    return unsubscribe;
  }, [session]);

  const submitCommand = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const nextCommand = command.trim();
    if (!nextCommand) {
      return;
    }

    await session.processInput(nextCommand);
    setPrompt(session.getPrompt());
    setActionCount(session.getActionLog().length);
    setCommand("");
  };

  const latestOutputText =
    latestEvent?.type === "output/text" || latestEvent?.type === "output/error"
      ? latestEvent.text
      : latestEvent
        ? JSON.stringify(latestEvent, null, 2)
        : "No events yet";

  return (
    <main style={{ padding: "2rem", display: "grid", gap: "1rem", maxWidth: "48rem" }}>
      <h1 style={{ fontSize: "1.75rem", fontWeight: 700 }}>Engine Harness Test</h1>

      <section>
        <strong>Current prompt:</strong> <code>{prompt}</code>
      </section>

      <form onSubmit={submitCommand} style={{ display: "flex", gap: "0.5rem" }}>
        <input
          value={command}
          onChange={(event) => setCommand(event.target.value)}
          placeholder="Type a command"
          aria-label="Engine command"
          style={{ flex: 1, padding: "0.5rem" }}
        />
        <button type="submit" style={{ padding: "0.5rem 0.75rem" }}>
          Submit
        </button>
      </form>

      <section>
        <strong>Latest event/output:</strong>
        <pre style={{ marginTop: "0.5rem", whiteSpace: "pre-wrap" }}>
          {latestOutputText}
        </pre>
      </section>

      <section>
        <strong>Action log count:</strong> {actionCount}
      </section>
    </main>
  );
}
