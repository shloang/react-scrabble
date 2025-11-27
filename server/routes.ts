import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { BOARD_SIZE, TILE_DISTRIBUTION, MOVE_TIME, type GameState, type Player, gameStateSchema } from "@shared/schema";
import { extractWordsFromBoard, calculateScore, checkGameEnd } from "./gameLogic";
import { loadWordDictionary, isWordValid } from "./wordDictionary";

// Load word dictionary on server startup
const USE_WORD_FILE = process.env.USE_WORD_FILE !== 'false'; // Default to true, set USE_WORD_FILE=false to use wiki API
if (USE_WORD_FILE) {
  loadWordDictionary();
}

export async function registerRoutes(app: Express): Promise<Server> {
  // Get current game state
  app.get("/api/game", async (req, res) => {
    try {
      const gameState = await storage.getGameState();
      res.json(gameState || null);
    } catch (error) {
      res.status(500).json({ error: "Failed to get game state" });
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

      // Set first player as current player
      if (gameState.players.length === 1) {
        gameState.currentPlayer = playerId;
      }

      await storage.saveGameState(gameState);
      res.json({ playerId, gameState });
    } catch (error) {
      res.status(500).json({ error: "Failed to join game" });
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
      const incoming = result.data as GameState;

      // If there are more moves in the incoming state, inspect the last move
      const prevMoves = previous?.moves?.length || 0;
      const newMoves = incoming.moves?.length || 0;

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

  const httpServer = createServer(app);

  return httpServer;
}
