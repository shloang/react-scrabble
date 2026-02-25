import type { Express } from "express";
import net from 'net';
import { createServer, type Server } from "http";
import { WebSocketServer, WebSocket } from 'ws';
import { storage } from "./storage";
import { BOARD_SIZE, TILE_DISTRIBUTION, MOVE_TIME, type GameState, type Player, gameStateSchema } from "@shared/schema";
import { extractWordsFromBoard, calculateScore, checkGameEnd } from "./gameLogic";
import { loadWordDictionary, isWordValid } from "./wordDictionary";
import os from 'os';
import fs from 'fs';
import path from 'path';

// Load word dictionary on server startup
const USE_WORD_FILE = process.env.USE_WORD_FILE !== 'false'; // Default to true, set USE_WORD_FILE=false to use wiki API
if (USE_WORD_FILE) {
  loadWordDictionary();
}

export async function registerRoutes(app: Express): Promise<Server> {
  function createEmptyGameState(): GameState {
    const bag: string[] = [];
    Object.entries(TILE_DISTRIBUTION).forEach(([letter, count]) => {
      for (let i = 0; i < count; i++) {
        bag.push(letter);
      }
    });

    for (let i = bag.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [bag[i], bag[j]] = [bag[j], bag[i]];
    }

    return {
      board: Array(BOARD_SIZE).fill(null).map(() => Array(BOARD_SIZE).fill(null)),
      tileBag: bag,
      players: [],
      currentPlayer: null,
      turn: 0,
      moves: [],
      paused: false,
      pausedBy: null,
      turnStart: null,
      pausedAt: null,
      gameEnded: false,
      winnerId: undefined,
      endReason: undefined,
      previews: {},
    };
  }

  // Get current game state
  app.get("/api/game", async (req, res) => {
    try {
      const gameState = await storage.getGameState();
      res.json(gameState || null);
    } catch (error) {
      res.status(500).json({ error: "Failed to get game state" });
    }
  });

  // Validate a playerId: returns minimal player info if present
  app.get('/api/player/:id', async (req, res) => {
    try {
      const id = String(req.params.id || '');
      if (!id || typeof id !== 'string') return res.status(400).json({ error: 'Invalid player id' });
      const state = await storage.getGameState();
      if (!state || !Array.isArray(state.players)) return res.status(404).json({ error: 'Player not found' });
      const p = state.players.find(pl => pl.id === id);
      if (!p) return res.status(404).json({ error: 'Player not found' });
      // return only minimal public information
      const out: any = { id: p.id, name: p.name, score: p.score };
      if ((p as any).avatarUrl) out.avatarUrl = (p as any).avatarUrl;
      return res.json(out);
    } catch (err) {
      console.error('[PlayerValidate] failed', err);
      return res.status(500).json({ error: 'Failed to validate player' });
    }
  });

  // Initialize or reset game
  app.post("/api/game/init", async (req, res) => {
    try {
      const bag: string[] = [];
      Object.entries(TILE_DISTRIBUTION).forEach(([letter, count]) => {
        for (let i = 0; i < count; i++) {
          bag.push(letter);
        }
      });
      
      // Shuffle the bag
      for (let i = bag.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [bag[i], bag[j]] = [bag[j], bag[i]];
      }

      const newGameState: GameState = {
        board: Array(BOARD_SIZE).fill(null).map(() => Array(BOARD_SIZE).fill(null)),
        tileBag: bag,
        players: [],
        currentPlayer: null,
        turn: 0,
        moves: []
        , paused: false,
        pausedBy: null,
        turnStart: null,
        pausedAt: null
      };

      await storage.saveGameState(newGameState);
      res.json(newGameState);
    } catch (error) {
      res.status(500).json({ error: "Failed to initialize game" });
    }
  });

  // Join game
  app.post("/api/game/join", async (req, res) => {
    try {
      const { playerName, password } = req.body;

      if (!playerName || typeof playerName !== 'string' || !playerName.trim()) {
        return res.status(400).json({ error: "Player name is required" });
      }

      if (!password || typeof password !== 'string' || !password.trim()) {
        return res.status(400).json({ error: "Password is required" });
      }

      let gameState = await storage.getGameState();
      
      // Initialize game if it doesn't exist
      if (!gameState) {
        const bag: string[] = [];
        Object.entries(TILE_DISTRIBUTION).forEach(([letter, count]) => {
          for (let i = 0; i < count; i++) {
            bag.push(letter);
          }
        });
        
        for (let i = bag.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [bag[i], bag[j]] = [bag[j], bag[i]];
        }

        gameState = {
          board: Array(BOARD_SIZE).fill(null).map(() => Array(BOARD_SIZE).fill(null)),
          tileBag: bag,
          players: [],
          currentPlayer: null,
          turn: 0,
          moves: []
          , paused: false,
          pausedBy: null,
          turnStart: null,
          pausedAt: null
        };
      }

      // Check for existing player by name (case-insensitive)
      const normalized = playerName.trim().toLowerCase();
      const existing = gameState.players.find(p => p.name.trim().toLowerCase() === normalized);

      if (existing) {
        // Verify password
        const ok = await storage.verifyPlayerPassword(existing.id, password);
        if (!ok) {
          return res.status(403).json({ error: 'Name already taken with different password' });
        }

        // Good: return existing player id and current game state
        return res.json({ playerId: existing.id, gameState });
      }

      // Create new player
      if (gameState.players.length >= 3) {
        return res.status(400).json({ error: "Game is full (max 3 players)" });
      }

      const playerId = `player_${Date.now()}_${Math.random()}`;
      const rack: (string | null)[] = gameState.tileBag.splice(0, 7);
      while (rack.length < 7) rack.push(null);

      const newPlayer: Player = {
        id: playerId,
        name: playerName.trim(),
        rack,
        score: 0
      };

      gameState.players.push(newPlayer);

      // Save password for new player
      await storage.setPlayerPassword(playerId, password);

      // Do not auto-start or set current player here; game start is explicit

      await storage.saveGameState(gameState);
      res.json({ playerId, gameState });
    } catch (error) {
      res.status(500).json({ error: "Failed to join game" });
    }
  });

  // Leave game: remove player from current session; if last player leaves, reset session
  app.post('/api/game/leave', async (req, res) => {
    try {
      const playerId = String(req.body?.playerId || '').trim();
      if (!playerId) return res.status(400).json({ error: 'playerId is required' });

      const state = await storage.getGameState();
      if (!state || !Array.isArray(state.players)) {
        return res.json({ success: true, gameState: state || null });
      }

      const existingIndex = state.players.findIndex(p => p.id === playerId);
      if (existingIndex === -1) {
        return res.json({ success: true, gameState: state });
      }

      const wasCurrentPlayer = state.currentPlayer === playerId;
      state.players.splice(existingIndex, 1);

      // Remove preview data for this player
      try {
        if (state.previews && typeof state.previews === 'object') {
          delete (state.previews as any)[playerId];
        }
      } catch {}

      // If no players remain, terminate/reset session to empty initialized state
      if (state.players.length === 0) {
        const resetState = createEmptyGameState();
        await storage.saveGameState(resetState);
        return res.json({ success: true, gameState: resetState });
      }

      // If removed player had the turn, pass turn to next valid player
      if (wasCurrentPlayer) {
        const nextIndex = Math.min(existingIndex, state.players.length - 1);
        state.currentPlayer = state.players[nextIndex]?.id ?? state.players[0]?.id ?? null;
        state.turnStart = Date.now();
      } else if (!state.currentPlayer || !state.players.some(p => p.id === state.currentPlayer)) {
        // Defensive: ensure currentPlayer always references an existing player
        state.currentPlayer = state.players[0]?.id ?? null;
        state.turnStart = state.currentPlayer ? Date.now() : null;
      }

      await storage.saveGameState(state);
      return res.json({ success: true, gameState: state });
    } catch (err) {
      console.error('[Leave] failed', err);
      return res.status(500).json({ error: 'Failed to leave game' });
    }
  });

  // Update game state (for moves)
  app.post("/api/game/update", async (req, res) => {
    try {
      const updates = req.body;
      const result = gameStateSchema.safeParse(updates);
      
      if (!result.success) {
        console.error("Invalid game state data:", result.error);
        return res.status(400).json({ error: "Invalid game state data", details: result.error });
      }

      // If there is an existing saved state, perform scoring validation
      const previous = await storage.getGameState();
      // Enforce server-side: reject updates if the saved game already ended
      if (previous && previous.gameEnded) {
        console.warn('[Update] rejected update: game already ended');
        return res.status(400).json({ error: 'Game has already ended' });
      }
      const incoming = result.data as GameState;

      // If there are more moves in the incoming state, inspect the last move
      const prevMoves = previous?.moves?.length || 0;
      const newMoves = incoming.moves?.length || 0;

      // Enforce pause: if the saved state is paused, reject any incoming new moves
      if (previous && previous.paused && newMoves > prevMoves) {
        console.warn('[Update] rejected update: game is paused (incoming contained new moves)');
        return res.status(400).json({ error: 'Game is paused' });
      }

      if (previous && newMoves > prevMoves && incoming.moves) {
        const lastMove = incoming.moves[incoming.moves.length - 1];
        // Only validate scoring for 'play' moves
        if (lastMove.type !== 'skip' && lastMove.type !== 'exchange') {
          // Prefer placedTiles provided by the client in move.meta. Fallback to board diff.
          let placedTiles: { row: number; col: number; letter: string }[] = [];
          if (lastMove.meta && Array.isArray(lastMove.meta.placedTiles)) {
            placedTiles = lastMove.meta.placedTiles as any;
            } else {
            for (let r = 0; r < BOARD_SIZE; r++) {
              for (let c = 0; c < BOARD_SIZE; c++) {
                const prevCell = previous.board[r][c];
                const newCell = incoming.board[r][c];
                if ((prevCell === null || prevCell === undefined) && newCell !== null && newCell !== undefined) {
                  // newCell may be a BoardCell object; extract letter if present
                  const letter = (newCell as any)?.letter ?? newCell;
                  placedTiles.push({ row: r, col: c, letter });
                }
              }
            }
          }

          // Derive words and expected score
          const words = extractWordsFromBoard(incoming.board, placedTiles as any);
          const expectedScore = calculateScore(words, incoming.board, placedTiles as any);

          // Find the player whose score increased (should be the player in lastMove.playerId)
          const prevPlayer = previous.players.find(p => p.id === lastMove.playerId);
          const newPlayer = incoming.players.find(p => p.id === lastMove.playerId);
          const prevScore = prevPlayer?.score ?? 0;
          const newScore = newPlayer?.score ?? 0;
          const delta = newScore - prevScore;

          // Overwrite the client's reported move score with the server-computed expected score
          lastMove.score = expectedScore;

          // Update the incoming player's score to be previous + expectedScore so server is authoritative
          if (newPlayer) {
            newPlayer.score = (prevPlayer?.score ?? 0) + expectedScore;
          }
        }
      }

      // Reconcile tile bag to ensure counts match the canonical distribution
      // This prevents accidental duplication or loss of tiles caused by clients
      // or race conditions. We compute expected remaining tiles as: distribution
      // minus tiles currently on board and tiles in players' racks, then
      // rebuild and shuffle the bag accordingly.
      const incomingState = result.data as GameState;
      // Adjust server-authoritative timestamps and pause transitions.
      try {
        if (previous) {
          const prevPaused = !!previous.paused;
          const incPaused = !!incomingState.paused;

          // If we're transitioning to paused, record pausedAt if not set
          if (!prevPaused && incPaused) {
            incomingState.pausedAt = incomingState.pausedAt ?? Date.now();
          }

          // If we're resuming from pause, advance turnStart by pause duration
          if (prevPaused && !incPaused) {
            const pausedAt = previous.pausedAt ?? incomingState.pausedAt ?? Date.now();
            const delta = Date.now() - pausedAt;
            if (incomingState.turnStart) incomingState.turnStart = (incomingState.turnStart || Date.now()) + delta;
            else incomingState.turnStart = Date.now();
            incomingState.pausedAt = null;
          }

          // When turn advances, reset turnStart to now
          if (incomingState.currentPlayer !== previous.currentPlayer || (incomingState.turn || 0) > (previous.turn || 0)) {
            incomingState.turnStart = Date.now();
          }
        } else {
          // No previous state: ensure turnStart exists if there is a current player
          if (incomingState.currentPlayer && !incomingState.turnStart) incomingState.turnStart = Date.now();
        }
      } catch (err) {
        console.error('[Timestamps] failed to adjust turnStart/pausedAt', err);
      }
      try {
        const expected: Record<string, number> = {};
        Object.entries(TILE_DISTRIBUTION).forEach(([ltr, cnt]) => expected[ltr] = cnt);

        // Build a canonical board to use for counting remaining tiles. We prefer
        // to start from the previously saved board and then apply only the
        // validated last play (if any). This prevents clients from accidentally
        // sending an incoming state that omits tiles (for example during a
        // skip) and causing the server to think those tiles are back in the bag.
        const usedBoard = Array(BOARD_SIZE).fill(null).map(() => Array(BOARD_SIZE).fill(null)) as any[][];
        if (previous) {
          // clone previous board into usedBoard
          for (let r = 0; r < BOARD_SIZE; r++) for (let c = 0; c < BOARD_SIZE; c++) usedBoard[r][c] = previous.board[r][c];
        } else {
          // no previous state (rare) — fall back to incoming board
          for (let r = 0; r < BOARD_SIZE; r++) for (let c = 0; c < BOARD_SIZE; c++) usedBoard[r][c] = incomingState.board[r][c];
        }

        // If there is a new move and it's a 'play', apply the placed tiles from
        // that move onto usedBoard so the counts include them. Prefer explicit
        // meta.placedTiles provided by the client; otherwise fall back to a
        // diff between previous and incoming.
        let placedTilesForCount: { row: number; col: number; letter: string; blank?: boolean }[] = [];
        if (previous && newMoves > prevMoves && incoming.moves && incoming.moves.length > 0) {
          const lastMove = incoming.moves[incoming.moves.length - 1];
          if (lastMove && lastMove.type === 'play') {
            if (lastMove.meta && Array.isArray(lastMove.meta.placedTiles)) {
              placedTilesForCount = lastMove.meta.placedTiles as any;
            } else {
              // compute diff between previous.board and incoming.board
              for (let r = 0; r < BOARD_SIZE; r++) {
                for (let c = 0; c < BOARD_SIZE; c++) {
                  const prevCell = previous.board[r][c] as any;
                  const newCell = incomingState.board[r][c] as any;
                  if ((prevCell === null || prevCell === undefined) && newCell !== null && newCell !== undefined) {
                    const letter = (newCell as any)?.letter ?? newCell;
                    const blank = !!(newCell && (newCell as any).blank);
                    placedTilesForCount.push({ row: r, col: c, letter, blank });
                  }
                }
              }
            }

            // apply placed tiles onto usedBoard
            for (const t of placedTilesForCount) {
              usedBoard[t.row][t.col] = { letter: t.letter, blank: !!t.blank };
            }
          }
        }

        // Detect unexplained removals: tiles present in previous.board but missing
        // from incoming.board that are not accounted for by the validated last play.
        try {
          if (previous) {
            const unexplained: Array<{ row: number; col: number; letter: string } > = [];
            for (let r = 0; r < BOARD_SIZE; r++) {
              for (let c = 0; c < BOARD_SIZE; c++) {
                const prevCell = previous.board[r][c] as any;
                const newCell = incomingState.board[r][c] as any;
                if (prevCell && prevCell.letter) {
                  // previously had a tile but incoming has no tile here
                  if (!newCell || !newCell.letter) {
                    const wasExplained = placedTilesForCount.some(p => p.row === r && p.col === c);
                    if (!wasExplained) {
                      unexplained.push({ row: r, col: c, letter: prevCell.letter });
                    }
                  }
                }
              }
            }
            if (unexplained.length > 0) {
              console.warn('[UnexplainedBoardRemovals] incoming update removed tiles not accounted for by last validated play', {
                ip: req.ip || req.headers['x-forwarded-for'] || null,
                prevMoves,
                newMoves,
                removed: unexplained,
                lastMoveSummary: (incoming.moves && incoming.moves.length > 0) ? incoming.moves[incoming.moves.length - 1] : null,
                incomingTileBagLength: Array.isArray(incomingState.tileBag) ? incomingState.tileBag.length : null,
                incomingPlayerRacks: incomingState.players ? incomingState.players.map(p => ({ id: p.id, rack: p.rack })) : null
              });
            }
          }
        } catch (err) {
          console.error('[UnexplainedBoardRemovals] detection failed', err);
        }

        // subtract tiles found on the usedBoard
        for (let r = 0; r < BOARD_SIZE; r++) {
          for (let c = 0; c < BOARD_SIZE; c++) {
            const cell = usedBoard[r][c] as any;
            if (cell && cell.letter) {
              // If the cell was a blank (wildcard) assigned to a letter, it should
              // consume a '?' from the distribution, not the displayed letter.
              const L = cell.blank ? '?' : (cell.letter as string);
              if (expected[L] !== undefined) expected[L] = Math.max(0, expected[L] - 1);
            }
          }
        }

        // subtract tiles in player racks
        for (const p of incomingState.players) {
          for (const t of p.rack) {
            if (t !== null && expected[t] !== undefined) {
              expected[t] = Math.max(0, expected[t] - 1);
            }
          }
        }

        // build new bag from remaining counts
        const rebuilt: string[] = [];
        for (const [ltr, cnt] of Object.entries(expected)) {
          for (let i = 0; i < cnt; i++) rebuilt.push(ltr);
        }

        // If the incoming bag length differs from rebuilt, replace and shuffle.
        // Otherwise, if the multiset mismatches, replace but keep the client's
        // ordering where possible to avoid surprising reorders on clients.
        let replacedBag = false;
        if (!Array.isArray(incomingState.tileBag) || incomingState.tileBag.length !== rebuilt.length) {
          incomingState.tileBag = rebuilt;
          replacedBag = true;
        } else {
          // Quick sanity: check multiset equality; if mismatch, replace
          const countBag: Record<string, number> = {};
          for (const x of incomingState.tileBag || []) countBag[x] = (countBag[x] || 0) + 1;
          let mismatch = false;
          for (const [ltr, cnt] of Object.entries(expected)) {
            if ((countBag[ltr] || 0) !== cnt) { mismatch = true; break; }
          }
          if (mismatch) {
            incomingState.tileBag = rebuilt;
            replacedBag = true;
          }
        }

        // shuffle the rebuilt bag only when we replaced it; otherwise preserve order
        if (replacedBag) {
          for (let i = incomingState.tileBag.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [incomingState.tileBag[i], incomingState.tileBag[j]] = [incomingState.tileBag[j], incomingState.tileBag[i]];
          }
        }
      } catch (err) {
        console.error('[TileBag Reconcile] failed', err);
      }

      await storage.saveGameState(incomingState);

      // Verify save worked
      const saved = await storage.getGameState();
      console.log("Game state saved. Board center:", saved?.board[7]?.slice(6, 10));

      if (!saved) {
        // Shouldn't happen, but return the incoming state as fallback
        return res.json({ success: true, gameState: incomingState });
      }

      // Check for game end
      const endCheck = checkGameEnd(saved);
      if (endCheck.ended) {
        saved.gameEnded = true;
        saved.winnerId = endCheck.winnerId;
        saved.endReason = endCheck.reason;
        await storage.saveGameState(saved);
      }

      res.json({ success: true, gameState: saved });
    } catch (error) {
      console.error("Failed to update game state:", error);
      res.status(500).json({ error: "Failed to update game state" });
    }
  });

  // Validate word with Wiktionary or word file
  // Serve the local word list as plain text (one word per line)
  app.get('/api/wordlist', async (req, res) => {
    try {
      const filePath = path.resolve(__dirname, '..', 'attached_assets', 'russian-mnemonic-words.txt');
      try {
        const data = await fs.promises.readFile(filePath, 'utf8');
        res.type('text/plain').send(data);
      } catch (err: any) {
        if (err && err.code === 'ENOENT') return res.status(404).json({ error: 'Word list not found' });
        console.error('[wordlist] read error', err);
        return res.status(500).json({ error: 'Failed to read word list' });
      }
    } catch (err) {
      console.error('[wordlist] unexpected error', err);
      res.status(500).json({ error: 'Failed to serve word list' });
    }
  });

  // Return cached-ish player stats (basic server-side snapshot)
  app.get('/api/player-stats/:playerId', async (req, res) => {
    try {
      const playerId = String(req.params.playerId || '');
      if (!playerId) return res.status(400).json({ error: 'playerId required' });
      const state = await storage.getGameState();
      if (!state) return res.status(404).json({ error: 'No game state' });
      const p = state.players.find(x => x.id === playerId);
      if (!p) return res.status(404).json({ error: 'Player not found' });

      // Currently we only have per-game score info server-side. Return a
      // minimal cached snapshot. Later this can be replaced by a persistent
      // stats store that aggregates across games.
      const snapshot = {
        playerId: p.id,
        score: p.score || 0,
        wins: 0,
        losses: 0,
        games: 1,
        cachedAt: Date.now(),
        source: 'server-snapshot'
      };
      return res.json(snapshot);
    } catch (err) {
      console.error('[PlayerStats] failed', err);
      return res.status(500).json({ error: 'Failed to get player stats' });
    }
  });

  // Set or update a player's avatar URL (basic validation)
  app.post('/api/player/:playerId/avatar', async (req, res) => {
    try {
      const playerId = String(req.params.playerId || '');
      const { avatarUrl } = req.body || {};
      if (!playerId) return res.status(400).json({ error: 'playerId required' });
      if (!avatarUrl || typeof avatarUrl !== 'string') return res.status(400).json({ error: 'avatarUrl required' });

      // Basic validation: must be http(s) and reasonably short
      if (!/^https?:\/\//i.test(avatarUrl) || avatarUrl.length > 200) return res.status(400).json({ error: 'Invalid avatarUrl' });

      const state = await storage.getGameState();
      if (!state) return res.status(404).json({ error: 'No game state' });
      const p = state.players.find(x => x.id === playerId);
      if (!p) return res.status(404).json({ error: 'Player not found' });

      p.avatarUrl = avatarUrl;
      await storage.saveGameState(state);
      return res.json({ success: true, avatarUrl });
    } catch (err) {
      console.error('[Avatar] failed', err);
      return res.status(500).json({ error: 'Failed to set avatar' });
    }
  });

  app.get("/api/validate-word/:word", async (req, res) => {
    try {
      const word = req.params.word.toLowerCase();
      
      if (USE_WORD_FILE) {
        // Use text file lookup (fast, no API calls)
        const isValid = isWordValid(word);
        res.json({ word, isValid, extract: null });
      } else {
        // Use Wiktionary API (slower, requires internet, can get rate limited)
        const url = `https://ru.wiktionary.org/w/api.php?action=query&titles=${encodeURIComponent(word)}&prop=extracts&exintro=1&explaintext=1&format=json`;

        const response = await fetch(url);
        if (!response.ok) {
          throw new Error(`Wiki API returned ${response.status}: ${response.statusText}`);
        }
        const data = await response.json();

        const pages = data.query?.pages || {};
        const pageId = Object.keys(pages)[0];

        // If pageId is -1, the page doesn't exist
        const isValid = pageId !== '-1';

        let extract: string | null = null;
        if (isValid) {
          extract = pages[pageId]?.extract || null;
          // Debug log to help troubleshoot missing extracts
          console.log('[validate-word] fetched', { word, pageId, hasExtract: !!extract, pageKeys: Object.keys(pages).slice(0,5) });
          // Trim long extracts to a reasonable length for UI
          if (extract && extract.length > 1000) extract = extract.slice(0, 1000) + '…';
        }

        res.json({ word, isValid, extract });
      }
    } catch (error) {
      console.error('[validate-word] Error:', error);
      res.status(500).json({ error: "Failed to validate word", details: error instanceof Error ? error.message : String(error) });
    }
  });

  // Receive preview placements from the active player (non-authoritative preview only)
  app.post('/api/game/preview', async (req, res) => {
    try {
      const { playerId, placedTiles } = req.body || {};
      if (!playerId || !Array.isArray(placedTiles)) {
        return res.status(400).json({ error: 'Invalid preview payload' });
      }

      const state = await storage.getGameState();
      if (!state) return res.status(500).json({ error: 'No game state' });

      // attach previews map on state
      state.previews = state.previews || {};
      // sanitize placed tiles (row/col/letter)
      state.previews[playerId] = placedTiles.map((t: any) => ({ row: Number(t.row), col: Number(t.col), letter: String(t.letter), blank: !!t.blank }));

      await storage.saveGameState(state);
      const saved = await storage.getGameState();
      return res.json({ success: true, gameState: saved });
    } catch (err) {
      console.error('[Preview] failed', err);
      return res.status(500).json({ error: 'Failed to save preview' });
    }
  });

  // Provide ICE server configuration to clients. This allows the client
  // to use a locally-hosted TURN server if environment variables are set.
  app.get('/api/turn-config', async (req, res) => {
    try {
      // Environment-based TURN config. To run a local TURN server you can use
      // `node-turn` or `coturn`. Example (node-turn):
      //   npx node-turn --realm=myrealm --username=testuser --password=testpass --ports=3478
      // Then set TURN_HOST=127.0.0.1 TURN_PORT=3478 TURN_USER=testuser TURN_PASS=testpass
      const { TURN_HOST, TURN_PORT, TURN_USER, TURN_PASS } = process.env as any;
      const iceServers: any[] = [];
      // Always include a public STUN as a fallback
      iceServers.push({ urls: 'stun:stun.l.google.com:19302' });

      let forceRelay = false;
      if (TURN_HOST && TURN_PORT && TURN_USER && TURN_PASS) {
        const url = `turn:${TURN_HOST}:${TURN_PORT}`;
        iceServers.push({ urls: url, username: TURN_USER, credential: TURN_PASS });
        // also include secure TURN (turns) if available on a TLS-enabled TURN server
        const turnsUrl = `turns:${TURN_HOST}:${TURN_PORT}`;
        iceServers.push({ urls: turnsUrl, username: TURN_USER, credential: TURN_PASS });
        forceRelay = true;
      }

      res.json({ iceServers, forceRelay });
    } catch (err) {
      console.error('[TurnConfig] failed', err);
      res.status(500).json({ error: 'Failed to get TURN config' });
    }
  });

  // WebSocket health endpoint (info only)
  app.get('/api/ws-health', async (req, res) => {
    try {
      // best-effort: if ws server not started, return empty
      const info: any = (global as any).__wsHealth || { connected: 0, peers: [] };
      res.json(info);
    } catch (err) {
      res.status(500).json({ error: 'ws-health failed' });
    }
  });

  // Start game: shuffle player order, build tile bag, deal racks, and set initial turn
  app.post('/api/game/start', async (req, res) => {
    try {
      const state = await storage.getGameState();
      if (!state) return res.status(400).json({ error: 'No game to start' });
      if (!Array.isArray(state.players) || state.players.length === 0) return res.status(400).json({ error: 'No players to start game' });

      // Enforce readiness: all players in lobby must be marked ready.
      const notReadyPlayers = state.players.filter((p) => !p.ready).map((p) => p.name);
      if (notReadyPlayers.length > 0) {
        return res.status(400).json({
          error: 'Не все игроки готовы',
          notReadyPlayers,
        });
      }

      // Shuffle player order in-place (Fisher-Yates)
      for (let i = state.players.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [state.players[i], state.players[j]] = [state.players[j], state.players[i]];
      }

      // build full tile bag from distribution
      const bag: string[] = [];
      Object.entries(TILE_DISTRIBUTION).forEach(([letter, count]) => {
        for (let i = 0; i < count; i++) bag.push(letter);
      });
      // shuffle bag
      for (let i = bag.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [bag[i], bag[j]] = [bag[j], bag[i]];
      }

      state.tileBag = bag;
      // deal racks
      for (const p of state.players) {
        p.rack = state.tileBag.splice(0, 7);
        while (p.rack.length < 7) p.rack.push(null);
        p.score = p.score || 0;
        p.ready = false; // reset ready flag
      }

      // reset board/moves and set current player to first player
      state.board = Array(BOARD_SIZE).fill(null).map(() => Array(BOARD_SIZE).fill(null));
      state.moves = [];
      state.currentPlayer = state.players[0].id;
      state.turn = 1;
      state.turnStart = Date.now();
      state.paused = false;
      state.pausedAt = null;
      state.gameEnded = false;
      state.winnerId = undefined;
      state.endReason = undefined;

      await storage.saveGameState(state);
      const saved = await storage.getGameState();
      return res.json({ success: true, gameState: saved });
    } catch (err) {
      console.error('[Start] failed', err);
      return res.status(500).json({ error: 'Failed to start game' });
    }
  });

  // Health check for TURN server reachability (useful for CI)
  app.get('/api/turn-health', async (req, res) => {
    try {
      const host = process.env.TURN_HOST || '127.0.0.1';
      const port = parseInt(process.env.TURN_PORT || '3478', 10);
      const timeoutMs = parseInt(process.env.TURN_WAIT_MS || '2000', 10);

      const reachable = await new Promise<boolean>((resolve) => {
        const socket = new net.Socket();
        let done = false;
        const onFail = () => { if (done) return; done = true; try { socket.destroy(); } catch (e) {} resolve(false); };
        socket.setTimeout(Math.max(500, timeoutMs));
        socket.once('error', onFail);
        socket.once('timeout', onFail);
        socket.connect(port, host, () => { if (done) return; done = true; try { socket.end(); } catch (e) {} resolve(true); });
      });

      res.json({ host, port, reachable });
    } catch (err) {
      res.status(500).json({ error: 'turn-health failed', details: String(err) });
    }
  });

  const httpServer = createServer(app);

  // Simple WebSocket signaling server for voice chat with heartbeat and health
  try {
    const wss = new WebSocketServer({ server: httpServer, path: '/ws' });
    console.log('[WebSocket] server listening on /ws');

    type ClientRecord = { ws: WebSocket, lastSeen: number };
    const clients = new Map<string, ClientRecord>();

    const WS_HEARTBEAT_INTERVAL = parseInt(process.env.WS_HEARTBEAT_MS || '30000', 10);
    const WS_STALE_MS = parseInt(process.env.WS_STALE_MS || '60000', 10);

    // expose basic health info globally for the /api/ws-health route
    (global as any).__wsHealth = { connected: 0, peers: [] };

    wss.on('connection', (ws: WebSocket, req) => {
      console.log('[WebSocket] connection established', req.socket.remoteAddress);
      let registeredId: string | null = null;

      // Update lastSeen on pong
      ws.on('pong', () => {
        if (registeredId) {
          const rec = clients.get(registeredId);
          if (rec) rec.lastSeen = Date.now();
        }
      });

      ws.on('message', (raw) => {
        try {
          const msg = JSON.parse(raw.toString());
          const type = msg.type;
          if (type === 'join') {
            const playerId = String(msg.playerId || '');
            if (!playerId) return;
            registeredId = playerId;
            clients.set(playerId, { ws, lastSeen: Date.now() });

            // update health
            (global as any).__wsHealth.connected = clients.size;
            (global as any).__wsHealth.peers = Array.from(clients.keys()).map(id => ({ id, lastSeen: clients.get(id)!.lastSeen }));

            // inform the joining client of current peers
            const peers = Array.from(clients.keys()).filter(id => id !== playerId);
            console.log('[WebSocket] player joined', playerId, 'peers->', peers);
            ws.send(JSON.stringify({ type: 'peers', peers }));

            // notify existing peers of the new peer
            for (const id of Array.from(clients.keys())) {
              if (id === playerId) continue;
              const cws = clients.get(id)!.ws;
              try {
                console.log('[WebSocket] notifying existing peer', id, 'of new-peer', playerId);
                cws.send(JSON.stringify({ type: 'new-peer', playerId }));
              } catch (err) {
                console.warn('[WebSocket] failed notify existing peer', id, err);
              }
            }
          } else if (type === 'offer' || type === 'answer' || type === 'candidate') {
            const to = String(msg.to || '');
            if (!to) return;
            const targetRec = clients.get(to);
            console.log('[WebSocket] forwarding', type, 'from', msg.from, 'to', to);
            if (targetRec) {
              try {
                if (targetRec.ws.readyState === WebSocket.OPEN) {
                  targetRec.ws.send(JSON.stringify(msg));
                } else {
                  console.warn('[WebSocket] target not open for', to, 'state=', targetRec.ws.readyState);
                }
              } catch (err) {
                console.error('[WebSocket] failed forwarding', type, 'to', to, err);
              }
            } else {
              console.warn('[WebSocket] no target client found for', to);
            }
          } else if (type === 'leave') {
            const pid = String(msg.playerId || '');
            if (pid && clients.has(pid)) {
              clients.delete(pid);
              // notify others
              console.log('[WebSocket] player left', pid);
              for (const id of Array.from(clients.keys())) {
                const crec = clients.get(id)!.ws;
                try {
                  crec.send(JSON.stringify({ type: 'peer-left', playerId: pid }));
                } catch (err) {
                  console.warn('[WebSocket] failed to notify peer-left to', id, err);
                }
              }
              (global as any).__wsHealth.connected = clients.size;
              (global as any).__wsHealth.peers = Array.from(clients.keys()).map(id => ({ id, lastSeen: clients.get(id)!.lastSeen }));
            }
          }
        } catch (err) {
          // ignore malformed messages
        }
      });

      ws.on('close', () => {
        if (registeredId && clients.has(registeredId)) {
          clients.delete(registeredId);
          for (const id of Array.from(clients.keys())) {
            const cws = clients.get(id)!.ws;
            try { cws.send(JSON.stringify({ type: 'peer-left', playerId: registeredId })); } catch (err) {}
          }
          (global as any).__wsHealth.connected = clients.size;
          (global as any).__wsHealth.peers = Array.from(clients.keys()).map(id => ({ id, lastSeen: clients.get(id)!.lastSeen }));
        }
      });
    });

    // Heartbeat interval: send pings and clean up stale peers
    setInterval(() => {
      try {
        const now = Date.now();
        for (const [id, rec] of Array.from(clients.entries())) {
          try {
            // attempt ping
            if (rec.ws.readyState === WebSocket.OPEN) {
              rec.ws.ping();
            }
          } catch (e) {}

          const age = now - rec.lastSeen;
          if (age > WS_STALE_MS) {
            console.warn('[WebSocket] stale connection, terminating', id, 'ageMs=', age);
            try { rec.ws.terminate(); } catch (e) {}
            clients.delete(id);
            // notify remaining peers
            for (const pid of Array.from(clients.keys())) {
              const cws = clients.get(pid)!.ws;
              try { cws.send(JSON.stringify({ type: 'peer-left', playerId: id })); } catch (e) {}
            }
          }
        }
        (global as any).__wsHealth.connected = clients.size;
        (global as any).__wsHealth.peers = Array.from(clients.keys()).map(id => ({ id, lastSeen: clients.get(id)!.lastSeen }));
      } catch (e) {
        // ignore heartbeat errors
      }
    }, WS_HEARTBEAT_INTERVAL);
  } catch (err) {
    console.error('[WebSocket] failed to start signaling server', err);
  }

  return httpServer;
}
