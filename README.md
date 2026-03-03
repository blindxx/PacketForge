# PacketForge

PacketForge is a mission-driven CCNA training simulator that replaces passive study with interactive CLI labs, structured skill campaigns, and real-world network configuration challenges. Train like an engineer. Not a test-taker.

---

## Monorepo Structure

```
PacketForge/
├── apps/
│   └── web/          # Next.js frontend (App Router at src/app)
├── packages/
│   └── shared/       # Shared types/utilities (placeholder)
├── package.json
└── pnpm-workspace.yaml
```

## Setup

### Prerequisites

- [Node.js](https://nodejs.org/) v18+
- [pnpm](https://pnpm.io/) v8+

### Install

From the repo root:

```bash
pnpm install
```

### Development

Run the Next.js dev server:

```bash
pnpm dev
```

This starts `apps/web` on [http://localhost:3000](http://localhost:3000) via the workspace filter.

### Build

```bash
pnpm build
```

### Lint

```bash
pnpm lint
```

---

> **Important:** NEVER run `next dev`, `next build`, or `next start` directly at the repo root.
> Always use the provided root scripts (`pnpm dev`, `pnpm build`) which scope commands to `apps/web`.
> If you need to run commands directly inside a workspace, `cd` into that package first.

---

## Packages

| Package | Path | Description |
|---|---|---|
| `@packetforge/web` | `apps/web` | Next.js frontend |
| `@packetforge/shared` | `packages/shared` | Shared types (placeholder) |
