# React Scrabble (Эрудит) — Russian Scrabble Clone

Open-source Russian Scrabble (Эрудит) — a Scrabble clone and multiplayer board game project implemented with React, TypeScript and Node.js. Designed for Cyrillic alphabets.

Key topics: Russian Scrabble, Эрудит, Cyrillic Scrabble, Scrabble clone, React Scrabble, TypeScript game, multiplayer board game.

## What this project is

- A Scrabble-style word game for Russian (Cyrillic) words.
- Frontend built with React 18 + TypeScript and Vite.
- Backend in Node.js + Express with a pluggable storage layer (in-memory by default, Drizzle/Postgres prepared).
- Turn-based multiplayer flow with word validation and scoring.

## Why this repo is useful

- Learn how to build a board game UI with React and Tailwind CSS.
- See an example of client/server separation for game state and validation.
- Explore pluggable storage patterns and how to swap in a database (Drizzle ORM + PostgreSQL).

## Features

- 15×15 Cyrillic board with standard Scrabble scoring
- Tile racks, tile bag, turn timers, and move validation
- REST API endpoints for game operations and word validation
- In-memory storage with an `IStorage` abstraction for easy DB migration

## Tech stack

- Frontend: React 18, TypeScript, Vite, Tailwind CSS
- Backend: Node.js, Express, TypeScript
- Optional DB: Drizzle ORM + PostgreSQL (Neon-ready)
- Utilities: TanStack Query, nanoid, date-fns

## Quick start
Quickest:

Remix [this project on replit.com](https://replit.com/@GlucoseGuardian/react-scrabble) and run.

Slower option:

Install dependencies:

```bash
npm install
```

Run development server (frontend + backend):

```bash
npm run dev
```

Build for production:

```bash
npm run build
```

Preview production build:

```bash
npm run preview
```

## Repository layout

- `client/` — React application (components, hooks, pages)
- `server/` — Express server, game logic and API
- `shared/` — shared types and schema
- `attached_assets/` — word lists and auxiliary files

## SEO keywords (for discoverability)

Russian Scrabble, Эрудит, Скрэбл, Cyrillic Scrabble, Scrabble clone, React Scrabble, TypeScript Scrabble, multiplayer Scrabble, open-source scrabble game, scrabble game project, scrabble React Vite


## Usage & customization

- Swap storage: implement `IStorage` and wire Drizzle/Postgres for persistence.
- Add WebSocket support to replace polling for true real-time multiplayer.
- Replace or extend `attached_assets/` word lists for different dictionaries.

## Contributing

Contributions welcome. Please open an issue for proposals and submit pull requests for fixes or features. Include tests or manual reproduction steps for complex changes.

## License

MIT
