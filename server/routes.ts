import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { BOARD_SIZE, TILE_DISTRIBUTION, MOVE_TIME, type GameState, type Player, gameStateSchema } from "@shared/schema";

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
        turn: 0
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
      const { playerName } = req.body;
      
      if (!playerName || typeof playerName !== 'string' || !playerName.trim()) {
        return res.status(400).json({ error: "Player name is required" });
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
          turn: 0
        };
      }

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

      await storage.saveGameState(result.data);
      
      // Verify save worked
      const saved = await storage.getGameState();
      console.log("Game state saved. Board center:", saved?.board[7]?.slice(6, 10));
      
      res.json({ success: true });
    } catch (error) {
      console.error("Failed to update game state:", error);
      res.status(500).json({ error: "Failed to update game state" });
    }
  });

  // Validate word with Wiktionary
  app.get("/api/validate-word/:word", async (req, res) => {
    try {
      const word = req.params.word.toLowerCase();
      const url = `https://ru.wiktionary.org/w/api.php?action=query&titles=${encodeURIComponent(word)}&format=json&origin=*`;
      
      const response = await fetch(url);
      const data = await response.json();
      
      const pages = data.query.pages;
      const pageId = Object.keys(pages)[0];
      
      // If pageId is -1, the page doesn't exist
      const isValid = pageId !== '-1';
      
      res.json({ word, isValid });
    } catch (error) {
      res.status(500).json({ error: "Failed to validate word" });
    }
  });

  const httpServer = createServer(app);

  return httpServer;
}
