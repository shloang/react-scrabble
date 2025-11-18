# Russian Scrabble (Эрудит) Game

## Overview

This is a multiplayer Russian Scrabble (Эрудит) game built as a full-stack web application. The game supports up to 3 players who compete by forming words using Cyrillic letter tiles on a 15×15 game board. Players take turns placing tiles, with special squares providing scoring multipliers (triple word, double word, triple letter, double letter). The application features real-time game state synchronization, turn-based gameplay with timers, and word validation.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend Architecture

**Framework & Build System**
- React 18 with TypeScript for type-safe component development
- Vite as the build tool and development server with hot module replacement
- Wouter for lightweight client-side routing

**UI Component System**
- Shadcn/ui component library (New York style) built on Radix UI primitives
- Tailwind CSS for utility-first styling with custom design tokens
- Material Design principles adapted for board game clarity
- Custom CSS variables for theme customization (light/dark mode support)

**State Management & Data Fetching**
- TanStack Query (React Query) for server state management with 2-second polling intervals
- Local React state for UI interactions (tile selection, placement tracking)
- Client-side game logic for move validation and score calculation

**Layout Strategy**
- Responsive three-column desktop layout: player info sidebar | game board | tile rack sidebar
- Mobile-first stacked vertical layout
- Board constrained to 800px maximum width with 1:1 aspect ratio
- Full viewport height application (no scroll)

**Typography & Internationalization**
- Inter/Roboto for Latin UI text
- Noto Sans for optimal Cyrillic character rendering on game tiles
- Roboto Mono for timer display

### Backend Architecture

**Server Framework**
- Express.js REST API with TypeScript
- HTTP server (not WebSocket-based despite real-time requirements)
- Client polling pattern for game state synchronization

**API Design**
- RESTful endpoints for game operations:
  - `GET /api/game` - Retrieve current game state
  - `POST /api/game/init` - Initialize/reset game
  - `POST /api/game/join` - Player joins game
  - `POST /api/game/update` - Submit move and update state
  - `GET /api/validate-word/:word` - Validate Russian word

**Request Handling**
- JSON request/response format
- Raw body capture for potential webhook integrations
- Request logging middleware with duration tracking
- Error handling with structured error responses

### Data Storage

**Current Implementation**
- In-memory storage via `MemStorage` class
- Single game state object stored in application memory
- No persistence between server restarts

**Schema Structure**
- Game state includes: 15×15 board array, tile bag, player list, current player ID, turn counter
- Player objects contain: unique ID, name, 7-tile rack, score
- Placed tile tracking with row/column coordinates
- Special square definitions (TW, DW, TL, DL, START) hardcoded as coordinate arrays

**Database Readiness**
- Drizzle ORM configured with PostgreSQL dialect
- Schema file structure prepared (`shared/schema.ts`)
- Migration directory configured but no migrations created yet
- Neon serverless PostgreSQL driver included in dependencies
- Database abstraction through `IStorage` interface allows easy swap from memory to database

### Game Logic & Rules

**Core Mechanics**
- Russian Scrabble (Эрудит) tile distribution with Cyrillic alphabet
- Tile point values: common letters (1-2 points), rare letters (up to 10 points), blank tiles (0 points)
- 131 total tiles distributed across 33 Cyrillic letters plus 2 wildcards
- Turn-based gameplay with 180-second (3-minute) timer per turn
- Move validation: words must be contiguous, connected to existing tiles, form valid dictionary words

**Scoring System**
- Base score from letter values
- Special square multipliers applied to newly placed tiles
- Triple Word (TW), Double Word (DW), Triple Letter (TL), Double Letter (DL)
- Center square (START) acts as double word bonus

**Word Validation**
- Client-side word extraction from board (horizontal and vertical)
- Server-side validation endpoint (implementation not shown in files)
- Words must include at least one newly placed tile

## External Dependencies

**UI Component Libraries**
- Radix UI primitives (accordion, dialog, dropdown, popover, tabs, toast, etc.) for accessible unstyled components
- Lucide React for icon components
- Embla Carousel for potential carousel implementations
- Class Variance Authority (CVA) for variant-based component styling
- CLSX and Tailwind Merge for conditional className management

**Form & Validation**
- React Hook Form for form state management
- Zod for schema validation and TypeScript type inference
- Drizzle-Zod for database schema to Zod schema conversion
- @hookform/resolvers for integrating Zod with React Hook Form

**Database & ORM**
- Drizzle ORM for type-safe database queries
- @neondatabase/serverless for PostgreSQL connection
- Drizzle-kit for schema management and migrations
- Note: Database not yet actively used; application currently uses in-memory storage

**Development Tools**
- Vite plugins: runtime error overlay, Replit cartographer, dev banner
- TSX for running TypeScript in development
- ESBuild for production builds
- PostCSS with Tailwind and Autoprefixer

**Utilities**
- date-fns for date manipulation
- nanoid for unique ID generation
- cmdk for command palette functionality
- wouter for lightweight routing

**Session Management**
- connect-pg-simple for PostgreSQL-backed session store (prepared but not implemented)
- Express session middleware expected for player authentication

**Missing/External Services**
- Russian dictionary API for word validation (endpoint exists but implementation not shown)
- No authentication system currently implemented
- No WebSocket server for real-time updates (relies on polling)
- No deployment configuration or environment management shown
