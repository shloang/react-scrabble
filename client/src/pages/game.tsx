import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { MOVE_TIME, Player, PlacedTile, GameState, TILE_VALUES } from '@shared/schema';
import { getGameState, joinGame as joinGameApi, updateGameState, validateWord, sendPreview, initializeGame, resetSession as resetSessionApi } from '@/lib/gameApi';
import { ensureWordListLoaded, isWordLocal } from '@/lib/wordLocal';
import { extractWordsFromBoard, calculateScore, validatePlacement } from '@/lib/gameLogic';
import GameBoard from '@/components/GameBoard';
import PlayerCard from '@/components/PlayerCard';
import TileRack from '@/components/TileRack';
import BlankAssignDialog from '@/components/BlankAssignDialog';
import GameTimer from '@/components/GameTimer';
import JoinGameDialog from '@/components/JoinGameDialog';
import ValidationMessage from '@/components/ValidationMessage';
import EndGameScreen from '@/components/EndGameScreen';
import VoiceChat from '@/components/VoiceChat_new';
import WordChecker from '@/components/WordChecker';
import { Button } from '@/components/ui/button';
import { CheckCircle, SkipForward, Sun, Moon } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useAudioKeepAlive } from '@/hooks/useAudioKeepAlive';
import { usePlayerTileOrder } from '@/hooks/usePlayerTileOrder';
import { useLocation } from 'wouter';
import { getStats, incrementWin, incrementLoss, incrementDraw, getAllStats } from '@/lib/playerStats';
import { shouldRouteGameToLobby } from '@/lib/sessionPhase';

const EMPTY_PREVIEWS: Record<string, PlacedTile[]> = {};

function useEventCallback<T extends (...args: any[]) => any>(handler: T): T {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  return useCallback(((...args: Parameters<T>) => handlerRef.current(...args)) as T, []);
}

export default function Game() {
  const [playerId, setPlayerId] = useState<string | null>(() => {
    try { return localStorage.getItem('playerId'); } catch { return null; }
  });
  const [isJoining, setIsJoining] = useState<boolean>(() => {
    try { return !localStorage.getItem('playerId'); } catch { return true; }
  });
  const [selectedTileIndex, setSelectedTileIndex] = useState<number | null>(null);
  const [discardMode, setDiscardMode] = useState(false);
  const [selectedDiscardIndices, setSelectedDiscardIndices] = useState<number[]>([]);
  type LocalPlacedTile = PlacedTile & { blank?: boolean };
  const [placedTiles, setPlacedTiles] = useState<LocalPlacedTile[]>([]);
  const [typingCursor, setTypingCursor] = useState<{ row: number; col: number; direction: 'right' | 'down' } | null>(null);
  const [typedSequence, setTypedSequence] = useState<Array<{ row: number; col: number; letter: string; fromRackIndex: number; blank: boolean }>>([]);
  const [blankAssign, setBlankAssign] = useState<null | { row: number; col: number; rackIndex?: number }>(null);
  const [isBlankDialogOpen, setIsBlankDialogOpen] = useState(false);
  const [placedWordStatuses, setPlacedWordStatuses] = useState<{
    word: string;
    positions: { row: number; col: number }[];
    status: 'valid' | 'invalid' | 'checking';
  }[]>([]);
  const [potentialScore, setPotentialScore] = useState<number | null>(null);
  const [isDark, setIsDark] = useState<boolean>(() => {
    try { return localStorage.getItem('dark') === '1'; } catch { return false; }
  });
  const [validationMessage, setValidationMessage] = useState('');
  const [isValidating, setIsValidating] = useState(false);
  const [isError, setIsError] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);
  const [previousCurrentPlayer, setPreviousCurrentPlayer] = useState<string | null>(null);
  const [hasPlayedEndGameSound, setHasPlayedEndGameSound] = useState(false);
  const { toast } = useToast();
  const [showEndScreen, setShowEndScreen] = useState(false);
  const [showEndScreenMinimized, setShowEndScreenMinimized] = useState<boolean>(() => {
    try { return localStorage.getItem('endScreenMinimized') === '1'; } catch { return false; }
  });
  const [, setLocation] = useLocation();
  const statsUpdatedRef = useRef<boolean>(false);
  const lastTurnStartRef = useRef<number | null>(null);
  const turnActionInFlightRef = useRef<'submit' | 'skip' | null>(null);
  const timerExpiryPendingRef = useRef(false);

  // Sync dark mode state to document and localStorage
  useEffect(() => {
    try {
      if (isDark) {
        document.documentElement.classList.add('dark');
        localStorage.setItem('dark', '1');
      } else {
        document.documentElement.classList.remove('dark');
        localStorage.setItem('dark', '0');
      }
    } catch (err) {
      // ignore
    }
  }, [isDark]);

  // Sound effects
  // Sound effects: reuse audio elements and debounce duplicate plays
  const audioCache = useRef<Record<string, HTMLAudioElement>>({});
  const lastSoundRef = useRef<{ key: string; ts: number } | null>(null);
  const [soundVolume, setSoundVolume] = useState<number>(0.5);
  const [voiceVolume, setVoiceVolume] = useState<number>(1);
  const [isPageVisible, setIsPageVisible] = useState(() => {
    if (typeof document === 'undefined') return true;
    return document.visibilityState === 'visible';
  });

  // Initialize AudioContext keepalive to prevent browser suspension after 30+ minutes
  const audioCacheMapRef = useRef<Map<string, HTMLAudioElement>>(new Map());
  const audioKeepAlive = useAudioKeepAlive(audioCacheMapRef.current, { checkInterval: 10000, debug: false });

  const playSound = useCallback((filename: string) => {
    try {
      const key = filename;
      const now = Date.now();
      // if same sound played very recently, skip to avoid duplicates
      if (lastSoundRef.current && lastSoundRef.current.key === key && (now - lastSoundRef.current.ts) < 400) return;
      lastSoundRef.current = { key, ts: now };

      let audio = audioCache.current[key];
      if (!audio) {
        audio = new Audio(`/${filename}`);
        audio.volume = soundVolume;
        audio.preload = 'auto';
        audioCache.current[key] = audio;
        // Keep Map in sync for AudioContext management
        audioCacheMapRef.current.set(key, audio);
      }
      // ensure volume matches current setting
      try { audio.volume = soundVolume; } catch (err) {}

      // Reset playback to start for short sounds
      try {
        audio.currentTime = 0;
      } catch (err) { /* ignore */ }

      // Ensure AudioContext is running before playing
      audioKeepAlive.ensureAudioContext();
      audioKeepAlive.resumeAudioContext();

      audio.play().catch(err => console.error('Failed to play sound:', err));
    } catch (err) {
      console.error('Failed to load sound:', err);
    }
  }, [audioKeepAlive, soundVolume]);

  // Update cached audio elements when soundVolume changes
  useEffect(() => {
    for (const k of Object.keys(audioCache.current)) {
      try { audioCache.current[k].volume = soundVolume; } catch (err) {}
      // Keep Map in sync
      audioCacheMapRef.current.set(k, audioCache.current[k]);
    }
  }, [soundVolume]);

  useEffect(() => {
    const onVisibilityChange = () => {
      setIsPageVisible(document.visibilityState === 'visible');
    };

    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => document.removeEventListener('visibilitychange', onVisibilityChange);
  }, []);

  // Poll for game state
  const { data: gameState, refetch } = useQuery<GameState | null>({
    queryKey: ['/api/game'],
    refetchInterval: (query) => {
      const latestGameState = query.state.data as GameState | null | undefined;
      if (latestGameState?.gameEnded) return false;
      return isPageVisible ? 2000 : 15000;
    },
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: false,
    enabled: !isJoining
  });

  // Defensive: if we have a locally-stored playerId but the authoritative
  // gameState doesn't include that player yet (e.g. during start transition),
  // show the Join dialog as a safe fallback to avoid dereferencing missing
  // player objects elsewhere in this component.
  useEffect(() => {
    if (!playerId) return;
    if (!gameState) return;
    const found = Array.isArray(gameState.players) && gameState.players.some(p => p.id === playerId);
    if (!found) {
      setIsJoining(true);
    } else {
      // only clear joining when server confirms presence
      setIsJoining(false);
    }
  }, [gameState, playerId]);

  // A host reload can reopen the app at `/` after a server restart. Respect
  // the persisted session phase instead of rendering a lobby as a new game.
  useEffect(() => {
    if (isJoining) return;
    if (shouldRouteGameToLobby(gameState, playerId)) setLocation('/lobby');
  }, [gameState, playerId, isJoining, setLocation]);

  const joinMutation = useMutation({
    mutationFn: (vars: { name: string; password: string }) => joinGameApi(vars.name, vars.password),
    onSuccess: (data, variables) => {
      const vars = variables as { name: string; password: string };
      const name = vars.name;
      setPlayerId(data.playerId);
      // persist to localStorage so user can reload and rejoin
      try {
        localStorage.setItem('playerId', data.playerId);
        localStorage.setItem('playerName', name);
        if (data.signalingToken) {
          localStorage.setItem('signalingToken', data.signalingToken);
        }
      } catch (err) {
        // ignore storage errors
      }
      setJoinError(null);
      setIsJoining(false);
      // do not navigate away after join; keep user on the Game page
      refetch();
    },
    onError: (error: any) => {
      const message = error?.message || 'Ошибка при подключении';
      setJoinError(message);
      toast({
        variant: "destructive",
        title: "Ошибка",
        description: message
      });
    }
  });

  const queryClient = useQueryClient();

  const updateMutation = useMutation({
    mutationFn: (state: GameState) => updateGameState(state),
    onSuccess: async (data) => {
      console.log('[Update] Mutation successful, received authoritative state');
      if (data && data.gameState) {
        queryClient.setQueryData(['/api/game'], data.gameState);
      } else {
        // fallback to refetch if no state returned
        await refetch();
      }
    },
    onError: async (error: any) => {
      const message = String(error?.message || '');
      if (message.toLowerCase().includes('stale')) {
        try { await refetch(); } catch {}
        toast({
          variant: "destructive",
          title: "Состояние обновилось",
          description: 'Данные устарели, синхронизировали серверное состояние'
        });
        return;
      }
      console.error('[Update] Mutation failed:', error);
      toast({
        variant: "destructive",
        title: "Ошибка обновления",
        description: error instanceof Error ? error.message : 'Не удалось обновить игру'
      });
    }
  });

  // Debounced/coalescing updater for rapid changes (typing/backspace)
  // Micro-batched patch scheduler for rapid changes (typing/backspace).
  // We accumulate small diffs (board cell writes and rack index writes)
  // and apply them to the latest known game state just before sending.
  const gameStateRef = useRef<GameState | null>(null);
  useEffect(() => { gameStateRef.current = gameState ?? null; }, [gameState]);

  const pendingPatchRef = useRef<{ board: Record<string, any>; rack: Record<number, any>; timer: number | null }>({ board: {}, rack: {}, timer: null });
  // keep a ref of placedTiles so schedulePatch can defensively ignore those keys
  const placedTilesRef = useRef<typeof placedTiles>(placedTiles);
  useEffect(() => { placedTilesRef.current = placedTiles; }, [placedTiles]);
  const submitMoveRef = useRef<(() => Promise<void>) | null>(null);

  useEffect(() => {
    return () => {
      if (pendingPatchRef.current.timer) {
        clearTimeout(pendingPatchRef.current.timer as number);
      }
      pendingPatchRef.current.board = {};
      pendingPatchRef.current.rack = {};
      pendingPatchRef.current.timer = null;
    };
  }, []);

  function schedulePatch(patch: { board?: Record<string, any>; rack?: Record<number, any> }) {
    // merge into pending patch
    if (patch.board) {
      for (const k of Object.keys(patch.board)) {
        // defensive: never include board keys that correspond to local placedTiles
        const [rStr, cStr] = k.split(',');
        const r = Number(rStr), c = Number(cStr);
        const isLocal = placedTilesRef.current.some(t => t.row === r && t.col === c);
        if (isLocal) continue; // skip local-only placed tiles
        pendingPatchRef.current.board[k] = patch.board[k];
      }
    }

    
    if (patch.rack) {
      for (const k of Object.keys(patch.rack)) pendingPatchRef.current.rack[Number(k)] = patch.rack[Number(k)];
    }

    if (pendingPatchRef.current.timer) {
      clearTimeout(pendingPatchRef.current.timer as number);
    }

    // short debounce to micro-batch rapid keystrokes
    pendingPatchRef.current.timer = window.setTimeout(() => {
      const base = structuredClone(gameStateRef.current || gameState) as GameState | null;
      if (!base) {
        // nothing to apply to
        pendingPatchRef.current.board = {};
        pendingPatchRef.current.rack = {};
        pendingPatchRef.current.timer = null;
        return;
      }

      // apply board patches (defensive: ensure board/rows exist)
      for (const key of Object.keys(pendingPatchRef.current.board)) {
        const [rStr, cStr] = key.split(',');
        const r = Number(rStr);
        const c = Number(cStr);
        if (!base || !Array.isArray(base.board) || !Array.isArray(base.board[r])) continue;
        base.board[r][c] = pendingPatchRef.current.board[key];
      }

      // apply rack patches for current player (defensive: players may be missing briefly)
      const player = Array.isArray(base.players) ? base.players.find(p => p.id === playerId) : undefined;
      if (player) {
        for (const idxStr of Object.keys(pendingPatchRef.current.rack)) {
          const idx = Number(idxStr);
          player.rack[idx] = pendingPatchRef.current.rack[idx];
        }
      }

      try {
        updateMutation.mutate(base as any);
      } catch (err) {
        console.error('[Scheduled Patch] failed', err);
      }

      // reset
      pendingPatchRef.current.board = {};
      pendingPatchRef.current.rack = {};
      pendingPatchRef.current.timer = null;
    }, 60);
  }

  function flushScheduledUpdate() {
    if (pendingPatchRef.current.timer) {
      clearTimeout(pendingPatchRef.current.timer as number);
      const base = structuredClone(gameStateRef.current || gameState) as GameState | null;
      if (base) {
        for (const key of Object.keys(pendingPatchRef.current.board)) {
          const [rStr, cStr] = key.split(',');
          const r = Number(rStr);
          const c = Number(cStr);
          const isLocal = placedTilesRef.current.some(t => t.row === r && t.col === c);
          if (isLocal) continue;
          if (!Array.isArray(base.board) || !Array.isArray(base.board[r])) continue;
          base.board[r][c] = pendingPatchRef.current.board[key];
        }
        const player = Array.isArray(base.players) ? base.players.find(p => p.id === playerId) : undefined;
        if (player) {
          for (const idxStr of Object.keys(pendingPatchRef.current.rack)) {
            const idx = Number(idxStr);
            player.rack[idx] = pendingPatchRef.current.rack[idx];
          }
        }
        try { updateMutation.mutate(base as any); } catch (err) { console.error('[Flush Patch] failed', err); }
      }
      pendingPatchRef.current.board = {};
      pendingPatchRef.current.rack = {};
      pendingPatchRef.current.timer = null;
    }
  }

  

    // Derived client-side preview state and helpers
    const getCurrentPlayer = useCallback(() => gameState?.players?.find(p => p.id === playerId) || null, [gameState?.players, playerId]);

    const serverBoard = gameState?.board ?? null;
    const clientBoardState = useMemo(() => {
      if (!serverBoard) return null;
      if (!placedTiles || placedTiles.length === 0) return serverBoard;

      const b = structuredClone(serverBoard);
      for (const t of placedTiles) {
        if (!Array.isArray(b)) continue;
        if (!Array.isArray(b[t.row])) continue;
        b[t.row][t.col] = { letter: t.letter, blank: !!t.blank } as any;
      }
      return b;
    }, [serverBoard, placedTiles]);

    const clientRackState = useMemo(() => {
      if (!gameState || !playerId) return null;
      const player = Array.isArray(gameState.players) ? gameState.players.find(p => p.id === playerId) : undefined;
      if (!player) return null;
      const rack = [...player.rack];

      // First, null out indices explicitly recorded by typedSequence (we know
      // exactly which slot the tile came from).
      for (const t of typedSequence) {
        if (typeof t.fromRackIndex === 'number' && t.fromRackIndex >= 0 && t.fromRackIndex < rack.length) {
          rack[t.fromRackIndex] = null;
        }
      }

      // Some placements may not have recorded a `fromRackIndex` (e.g. swaps or
      // programmatic placements). To visually reflect local placed tiles we
      // also consume matching letters from the rack by removing the first
      // occurrence that isn't already null. This ensures that server pushes
      // (which contain the server's idea of the rack) don't overwrite the
      // client's visible placements.
      const consumedIndexes = new Set<number>();
      for (const placed of placedTiles) {
        // If typedSequence already accounted for this placed tile, skip
        const typed = typedSequence.find(t => t.row === placed.row && t.col === placed.col && typeof t.fromRackIndex === 'number');
        if (typed && typeof typed.fromRackIndex === 'number') continue;

        // find the first matching letter in the rack that isn't already null/consumed
        const letterToConsume = placed.blank ? '?' : placed.letter;
        for (let i = 0; i < rack.length; i++) {
          if (consumedIndexes.has(i)) continue;
          if (rack[i] === letterToConsume) {
            rack[i] = null;
            consumedIndexes.add(i);
            break;
          }
        }
      }

      return rack;
    }, [gameState, playerId, placedTiles, typedSequence]);

    // Tile order management: preserves shuffle/reorder state across server syncs
    const tileOrder = usePlayerTileOrder(clientRackState, playerId ? `scrabble:tile-order:${playerId}` : undefined);
    const displayRackState = tileOrder.displayRack;
    const toServerRackIndex = useCallback((displayIndex: number) => tileOrder.displayIndexToServerIndex(displayIndex), [tileOrder]);

    // Periodically send previews to the server so other players can see our
    // planning placements without committing them.
    useEffect(() => {
      if (!playerId) return;
      let stopped = false;
      const payload = placedTiles.map(t => ({ row: t.row, col: t.col, letter: t.letter, blank: !!t.blank }));

      const send = async () => {
        try {
          const cp = getCurrentPlayer();
          if (!cp || stopped) return;
          await sendPreview(playerId, payload);
        } catch (err) {
          // ignore network errors for preview updates
        }
      };

      let interval: number | null = null;
      (async () => {
        await send();
        if (stopped) return;
        if (payload.length > 0) {
          interval = window.setInterval(() => { send(); }, 2000) as unknown as number;
        }
      })();

      return () => {
        stopped = true;
        if (interval) clearInterval(interval as number);
      };
    }, [playerId, placedTiles, getCurrentPlayer]);

    useEffect(() => {
      if (!playerId) return;
      return () => {
        (async () => {
          try { await sendPreview(playerId, []); } catch (err) { /* ignore */ }
        })();
      };
    }, [playerId]);

    // Compute last move positions (server authoritative) to highlight those tiles
    const lastMovePositions = useMemo(() => {
      if (!gameState || !gameState.moves || gameState.moves.length === 0) return [] as { row: number; col: number }[];
      const last = gameState.moves[gameState.moves.length - 1];
      if (!last || last.type !== 'play') return [] as { row: number; col: number }[];
      const meta = last.meta;
      if (meta && Array.isArray(meta.placedTiles)) {
        return meta.placedTiles.map((t: any) => ({ row: t.row, col: t.col }));
      }
      return [] as { row: number; col: number }[];
    }, [gameState?.moves]);

    const clearPlacedWordPreview = useCallback(() => {
      setPlacedWordStatuses(prev => prev.length === 0 ? prev : []);
      setPotentialScore(prev => prev === null ? prev : null);
    }, []);

    // When placedTiles or preview board changes, validate placed words and compute potential score
    useEffect(() => {
      const board = clientBoardState || serverBoard;
      if (!board) {
        clearPlacedWordPreview();
        return;
      }
      if (!placedTiles || placedTiles.length === 0) {
        clearPlacedWordPreview();
        return;
      }

      const words = extractWordsFromBoard(board, placedTiles);
      if (!words || words.length === 0) {
        clearPlacedWordPreview();
        return;
      }

      // set checking state
      setPlacedWordStatuses(words.map(w => ({ word: w.word, positions: w.positions, status: 'checking' } as any)));

      let cancelled = false;
      (async () => {
        try {
          await ensureWordListLoaded();
          const results = await Promise.all(words.map(async (w) => {
            const lw = w.word.toLowerCase();
            const local = isWordLocal(lw);
            if (local !== null) return local;
            try {
              const r = await validateWord(lw);
              return !!r.isValid;
            } catch {
              return false;
            }
          }));

          if (cancelled) return;
          const statuses = words.map((w, i) => ({ word: w.word, positions: w.positions, status: results[i] ? 'valid' : 'invalid' }));
          setPlacedWordStatuses(statuses as any);
          if (results.every(Boolean)) {
            const score = calculateScore(words, board, placedTiles);
            setPotentialScore(score);
          } else {
            setPotentialScore(null);
          }
        } catch (err) {
          if (cancelled) return;
          setPlacedWordStatuses(words.map(w => ({ word: w.word, positions: w.positions, status: 'checking' } as any)));
          setPotentialScore(null);
        }
      })();

      return () => { cancelled = true; };
    }, [placedTiles, clientBoardState, serverBoard, clearPlacedWordPreview]);

    // Play turn sound on all turn switches
  useEffect(() => {
    if (!gameState) return;

    // Play turn-change sound only when current player changed (avoid duplicate plays)
    if (previousCurrentPlayer !== null && gameState.currentPlayer !== previousCurrentPlayer) {
      timerExpiryPendingRef.current = false;
      if (!gameState.gameEnded) {
        playSound('turn.mp3');
      }
      // Clear any local planned placements when the turn rotates
      if (placedTiles.length > 0) {
        setPlacedTiles([]);
        setTypedSequence([]);
        setSelectedTileIndex(null);
        setTypingCursor(null);
      }
    }
    setPreviousCurrentPlayer(gameState.currentPlayer);
  }, [gameState?.currentPlayer, previousCurrentPlayer]);

  // Play win/lose sound when game ends
  useEffect(() => {
    if (!gameState || !playerId || !gameState.gameEnded || hasPlayedEndGameSound) return;

    const drawPlayerIds = Array.isArray(gameState.drawPlayerIds) ? gameState.drawPlayerIds : [];
    const isDraw = drawPlayerIds.length > 1;
    const isWinner = gameState.winnerId === playerId;
    const isDrawParticipant = isDraw && drawPlayerIds.includes(playerId);
    if (isWinner) {
      playSound('win.mp3');
    } else if (!isDrawParticipant) {
      playSound('lose.mp3');
    }
    setHasPlayedEndGameSound(true);

    // Update local player stats once per finished game
    try {
      if (!statsUpdatedRef.current) {
        if (isDraw) {
          const drawPlayerSet = new Set(drawPlayerIds);
          for (const player of (gameState.players || [])) {
            if (drawPlayerSet.has(player.id)) incrementDraw(player.id);
            else incrementLoss(player.id);
          }
        } else if (gameState.winnerId) {
          incrementWin(gameState.winnerId);
          for (const player of (gameState.players || [])) {
            if (player.id !== gameState.winnerId) incrementLoss(player.id);
          }
        }
        statsUpdatedRef.current = true;
      }
    } catch (err) {
      // ignore stats update errors
    }
  }, [gameState?.gameEnded, gameState?.winnerId, gameState?.drawPlayerIds, playerId, hasPlayedEndGameSound]);

  // Show end-screen overlay when game ends; allow local dismissal
  useEffect(() => {
    if (!gameState) return;
    if (gameState.gameEnded) setShowEndScreen(true);
    else {
      setShowEndScreen(false);
      // reset per-game stats update marker so next end will update stats again
      statsUpdatedRef.current = false;
    }
  }, [gameState?.gameEnded]);

  // Background auto-start removed: host should explicitly start from the Lobby page.

  // Persist and handle minimize state for the end-screen overlay.
  useEffect(() => {
    try { localStorage.setItem('endScreenMinimized', showEndScreenMinimized ? '1' : '0'); } catch {}
  }, [showEndScreenMinimized]);

  // When a game ends, honor the minimized preference: if minimized, keep overlay hidden.
  useEffect(() => {
    if (!gameState) return;
    if (gameState.gameEnded) {
      if (showEndScreenMinimized) setShowEndScreen(false);
      else setShowEndScreen(true);
    } else {
      setShowEndScreen(false);
      // reset minimized when a new game starts
      setShowEndScreenMinimized(false);
    }
  }, [gameState?.gameEnded, showEndScreenMinimized]);

  // Track a turn start timestamp derived from last move (server-side timestamp) so clients
  // can compute a shared countdown. Fallback to a client-side marker if no moves exist yet.
  useEffect(() => {
    if (!gameState) return;
    const moves = gameState.moves || [];
    // Prefer server-authoritative turnStart when available
    if (typeof gameState.turnStart === 'number' && gameState.turnStart) {
      lastTurnStartRef.current = gameState.turnStart;
    } else if (moves.length > 0) {
      // Fallback: use last move timestamp
      const last = moves[moves.length - 1];
      lastTurnStartRef.current = last.timestamp;
    } else {
      // No moves yet: initialize to now if not set
      if (!lastTurnStartRef.current) lastTurnStartRef.current = Date.now();
    }
  }, [gameState?.moves?.length, gameState?.currentPlayer, gameState?.turnStart]);

  const timerTurnStart = useMemo(() => {
    if (!gameState) return null;
    if (typeof gameState.turnStart === 'number' && gameState.turnStart) {
      return gameState.turnStart;
    }

    const moves = gameState.moves || [];
    if (moves.length > 0) {
      return moves[moves.length - 1].timestamp;
    }

    return lastTurnStartRef.current;
  }, [gameState?.moves, gameState?.turnStart]);

  const timerTurnKey = `${gameState?.currentPlayer ?? 'none'}:${timerTurnStart ?? 'none'}:${gameState?.turn ?? 0}`;

  const handleTimerWarning = useCallback(() => {
    if (gameState?.currentPlayer === playerId) {
      playSound('20sec.mp3');
    }
  }, [gameState?.currentPlayer, playerId, soundVolume]);

  const handleTimerExpired = useCallback(() => {
    if (gameState?.currentPlayer !== playerId) return;
    if (turnActionInFlightRef.current) {
      timerExpiryPendingRef.current = true;
      return;
    }
    void handleSkipTurn();
  }, [gameState?.currentPlayer, playerId]);

  // Note: server now manages `pausedAt` and `turnStart`; GameTimer renders the local countdown.

  // Keyboard shortcut: press 'E' to toggle the end-screen when a game has ended
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!gameState || !gameState.gameEnded) return;
      // Ignore when typing into inputs
      const active = document.activeElement as HTMLElement | null;
      if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable)) return;
      if (e.key.toLowerCase() === 'e') {
        e.preventDefault();
        if (showEndScreenMinimized) {
          setShowEndScreenMinimized(false);
          setShowEndScreen(true);
        } else {
          setShowEndScreen(false);
          setShowEndScreenMinimized(true);
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [gameState?.gameEnded, showEndScreenMinimized]);

  const shuffleArray = (array: string[]) => {
    for (let i = array.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [array[i], array[j]] = [array[j], array[i]];
    }
  };

  const handleJoinGame = (name: string, password: string) => {
    setJoinError(null);
    joinMutation.mutate({ name, password });
  };

  // Session routing/validation is owned by App-level guard.
  useEffect(() => {
    const onKeyDown = async (e: KeyboardEvent) => {
      // Ctrl+Enter (or Cmd+Enter) submits move when it's your turn
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        if (gameState && gameState.currentPlayer === playerId) {
          e.preventDefault();
          submitMoveRef.current && submitMoveRef.current();
        }
        return;
      }

      // If focus is on an input/textarea/contentEditable, don't intercept keys
      const active = document.activeElement as HTMLElement | null;
      if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable)) {
        return;
      }

      if (!typingCursor) return;
      if (!gameState) return;

      // Arrow keys -> move arrow position (do not clear at borders)
      if (e.key.startsWith('Arrow')) {
        e.preventDefault();
        if (!typingCursor) return;
        let { row, col } = typingCursor;
        if (e.key === 'ArrowLeft') col = Math.max(0, col - 1);
        if (e.key === 'ArrowRight') col = Math.min(14, col + 1);
        if (e.key === 'ArrowUp') row = Math.max(0, row - 1);
        if (e.key === 'ArrowDown') row = Math.min(14, row + 1);
        setTypingCursor({ row, col, direction: typingCursor.direction });
        return;
      }

      // Backspace -> if there's a placed tile at the arrow cell, remove it;
      // otherwise remove the nearest placed tile behind the arrow (client-side only)
      if (e.key === 'Backspace') {
        e.preventDefault();
        if (!typingCursor) return;
        // find nearest placed tile before the arrow depending on direction
        let target: { row: number; col: number } | null = null;
        if (typingCursor.direction === 'right') {
          const row = typingCursor.row;
          // prefer tile at the same cursor column
          const exact = placedTiles.find(t => t.row === row && t.col === typingCursor.col);
          if (exact) {
            target = { row: exact.row, col: exact.col };
          } else {
            let bestCol = -1;
            for (const t of placedTiles) {
              if (t.row === row && t.col < typingCursor.col && t.col > bestCol) {
                bestCol = t.col;
                target = { row: t.row, col: t.col };
              }
            }
          }
        } else {
          const col = typingCursor.col;
          // prefer tile at the same cursor row
          const exact = placedTiles.find(t => t.col === col && t.row === typingCursor.row);
          if (exact) {
            target = { row: exact.row, col: exact.col };
          } else {
            let bestRow = -1;
            for (const t of placedTiles) {
              if (t.col === col && t.row < typingCursor.row && t.row > bestRow) {
                bestRow = t.row;
                target = { row: t.row, col: t.col };
              }
            }
          }
        }

        if (!target) return;

        // remove the placed tile locally and remove any typedSequence entry for it
        setPlacedTiles(prev => prev.filter(t => !(t.row === target!.row && t.col === target!.col)));
        setTypedSequence(prev => prev.filter(t => !(t.row === target!.row && t.col === target!.col)));
        // move arrow to the removed tile's position
        setTypingCursor({ row: target.row, col: target.col, direction: typingCursor.direction });
        return;
      }

      if (e.key === 'Escape') {
        setTypingCursor(null);
        setTypedSequence([]);
        return;
      }

      const letterKey = e.key;
      // accept letters (Latin or Cyrillic)
      if (!letterKey || !/^[A-Za-zА-ЯЁа-яё]$/.test(letterKey)) return;
      e.preventDefault();
      const letter = letterKey.toUpperCase();

      // find next empty starting at cursor
      let r = typingCursor.row;
      let c = typingCursor.col;
      const advance = () => {
        if (typingCursor.direction === 'right') c += 1; else r += 1;
      };

      // Check client board state to see if cell is occupied
      const boardToCheck = clientBoardState || gameState.board;
      const currentPlayer = getCurrentPlayer();
      if (!currentPlayer) return;
      while (r >= 0 && r < 15 && c >= 0 && c < 15 && boardToCheck[r][c] !== null) {
        advance();
      }

      if (!(r >= 0 && r < 15 && c >= 0 && c < 15)) {
        // out of board -> clamp to nearest valid cell and keep arrow
        r = Math.min(Math.max(r, 0), 14);
        c = Math.min(Math.max(c, 0), 14);
        setTypingCursor({ row: r, col: c, direction: typingCursor.direction });
        return;
      }

      // find tile in rack matching letter or wildcard (use client rack state)
      const rackToCheck = clientRackState || currentPlayer.rack;
      const rackIndexExact = rackToCheck.findIndex((t: string | null) => t === letter);
      const rackIndexBlank = rackToCheck.findIndex((t: string | null) => t === '?');
      let useIndex = -1;
      let isBlank = false;
      if (rackIndexExact !== -1) {
        useIndex = rackIndexExact;
        isBlank = false;
      } else if (rackIndexBlank !== -1) {
        useIndex = rackIndexBlank;
        isBlank = true;
      } else {
        // no tile available
        return;
      }

      // mark placedTiles locally (client-side only)
      setPlacedTiles(prev => [...prev, { row: r, col: c, letter, blank: isBlank }]);
      setTypedSequence(prev => [...prev, { row: r, col: c, letter, fromRackIndex: useIndex, blank: isBlank }]);
      playSound('tile.mp3');

      // advance cursor to next empty cell (check client board state)
      let nr = r;
      let nc = c;
      do {
        if (typingCursor.direction === 'right') nc += 1; else nr += 1;
      } while (nr >= 0 && nr < 15 && nc >= 0 && nc < 15 && (clientBoardState?.[nr]?.[nc] !== null || placedTiles.some(t => t.row === nr && t.col === nc)));

      // clamp and keep arrow even if we hit the border
      nr = Math.min(Math.max(nr, 0), 14);
      nc = Math.min(Math.max(nc, 0), 14);
      setTypingCursor({ row: nr, col: nc, direction: typingCursor.direction });
    };

    const onKeyUp = (e: KeyboardEvent) => {
      // Rotate arrow on Control release (or Meta release on mac)
      if (e.key === 'Control' || e.key === 'Meta') {
        if (!typingCursor) return;
        setTypingCursor(prev => prev ? { ...prev, direction: prev.direction === 'right' ? 'down' : 'right' } : prev);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => { window.removeEventListener('keydown', onKeyDown); window.removeEventListener('keyup', onKeyUp); };
  }, [typingCursor, gameState, placedTiles, typedSequence, playerId, clientBoardState, clientRackState, submitMoveRef]);

  // Listen for rack reorder events dispatched from TileRack
  // (no global event usage now)

  const handleSquareClick = useCallback(async (row: number, col: number) => {
    if (!gameState || gameState.gameEnded || gameState.paused || isValidating) return;
    
    const currentPlayer = getCurrentPlayer();
    if (!currentPlayer) return;

    const boardToCheck = clientBoardState || gameState.board;

    // If a rack tile is selected, place it normally (client-side only)
    if (selectedTileIndex !== null && boardToCheck[row][col] === null) {
      const serverRackIndex = toServerRackIndex(selectedTileIndex);
      const rackToCheck = clientRackState || currentPlayer.rack;
      const letter = rackToCheck[serverRackIndex];
      if (!letter) return;

      // Handle blank tile assignment by opening modal
      if (letter === '?') {
        setBlankAssign({ row, col, rackIndex: serverRackIndex });
        setIsBlankDialogOpen(true);
        return;
      }

      console.log('[Placement] Placing tile', letter, 'at', row, col);
      setPlacedTiles([...placedTiles, { row, col, letter }]);
      // Track rack index for this placement
      setTypedSequence(prev => [...prev, { row, col, letter, fromRackIndex: serverRackIndex, blank: false }]);
      setSelectedTileIndex(null);
      playSound('tile.mp3');
      // No server update - client-side only
    }

    // If no rack tile selected -> cycle typing cursor states on empty squares
    if (selectedTileIndex === null && boardToCheck[row][col] === null) {
      if (!typingCursor || typingCursor.row !== row || typingCursor.col !== col) {
        // start typing at this square, default direction right
        setTypingCursor({ row, col, direction: 'right' });
        setTypedSequence([]);
      } else {
        // cycle: right -> down -> none
        setTypingCursor(prev => {
          if (!prev) return { row, col, direction: 'right' };
          if (prev.direction === 'right') return { ...prev, direction: 'down' };
          // was 'down' -> clear
          return null;
        });
      }
      return;
    }

    // Remove placed tile (client-side only)
    if (placedTiles.some(t => t.row === row && t.col === col)) {
      const tile = placedTiles.find(t => t.row === row && t.col === col);
      if (!tile) return;
      
      console.log('[Removal] Removing tile from', row, col);
      setPlacedTiles(placedTiles.filter(t => !(t.row === row && t.col === col)));
      // Also remove from typedSequence if it's there
      setTypedSequence(prev => prev.filter(t => !(t.row === row && t.col === col)));
      // No server update - client-side only
    }
  }, [clientBoardState, clientRackState, gameState, getCurrentPlayer, isValidating, placedTiles, playSound, selectedTileIndex, toServerRackIndex, typingCursor]);

  const handleTileClick = useCallback((index: number) => {
    if (discardMode) {
      setSelectedDiscardIndices(prev => {
        if (prev.includes(index)) return prev.filter(i => i !== index);
        return [...prev, index];
      });
      return;
    }

    setSelectedTileIndex(selectedTileIndex === index ? null : index);
  }, [discardMode, selectedTileIndex]);

  // Reorder rack indices (drag within rack) - client-side only, no server update
  const handleReorderRack = useCallback(async (from: number, to: number) => {
    if (from === to) return;

    // Use the hook to reorder tiles (preserves order across server syncs)
    tileOrder.reorderTiles(from, to);

    // Update local selected index mapping so selection follows the tile
    setSelectedTileIndex(prev => {
      if (prev === null) return null;
      if (prev === from) return to;
      if (from < to && prev > from && prev <= to) return prev - 1;
      if (from > to && prev >= to && prev < from) return prev + 1;
      return prev;
    });
  }, [tileOrder]);

  // Drop a placed board tile into a rack slot (or swap) - client-side only
  const handleDropFromBoard = useCallback(async (fromRow: number, fromCol: number, toIndex: number) => {
    if (!gameState || gameState.gameEnded || gameState.paused || isValidating) return;
    if (!Number.isInteger(fromRow) || !Number.isInteger(fromCol) || !Number.isInteger(toIndex)) return;

    const placedEntry = placedTiles.find(t => t.row === fromRow && t.col === fromCol) as any;
    if (!placedEntry || gameState.board[fromRow]?.[fromCol]) return;

    const currentPlayer = getCurrentPlayer();
    if (!currentPlayer) return;

    const boardToCheck = clientBoardState || gameState.board;
    const tileCell = boardToCheck[fromRow]?.[fromCol] as any;
    if (!tileCell) return;

    const serverRackIndex = toServerRackIndex(toIndex);
    const rackToCheck = clientRackState || currentPlayer.rack;
    if (serverRackIndex < 0 || serverRackIndex >= rackToCheck.length) return;
    const rackVal = rackToCheck[serverRackIndex];

    // If target rack slot is empty, move board tile into it (client-side only)
    if (rackVal === null) {
      // remove from placedTiles if it was a recent placement
      setPlacedTiles(prev => prev.filter(t => !(t.row === fromRow && t.col === fromCol)));
      // Also remove from typedSequence
      setTypedSequence(prev => prev.filter(t => !(t.row === fromRow && t.col === fromCol)));
      return;
    }

    // If target rack slot occupied -> swap between board and rack
    // If the rack tile is a blank placeholder, open blank dialog to assign
    if (rackVal === '?') {
      setBlankAssign({ row: fromRow, col: fromCol, rackIndex: serverRackIndex });
      setIsBlankDialogOpen(true);
      return;
    }

    // perform swap: rack tile -> board (fromRow,fromCol), board tile -> rack[toIndex] (client-side only)
    // update placedTiles: remove original placed tile (moved to rack), add new placed tile for rackVal
    setPlacedTiles(prev => {
      const without = prev.filter(t => !(t.row === fromRow && t.col === fromCol));
      return [...without, { row: fromRow, col: fromCol, letter: rackVal } as any];
    });
    // Also update typedSequence
    setTypedSequence(prev => {
      const without = prev.filter(t => !(t.row === fromRow && t.col === fromCol));
      if (serverRackIndex >= 0 && serverRackIndex < currentPlayer.rack.length) {
        return [...without, { row: fromRow, col: fromCol, letter: rackVal, fromRackIndex: serverRackIndex, blank: false }];
      }
      return without;
    });
  }, [clientBoardState, clientRackState, gameState, getCurrentPlayer, isValidating, placedTiles, toServerRackIndex]);

  const handleBoardTileDrop = useCallback(async (row: number, col: number, data: any) => {
    if (!gameState || gameState.gameEnded || gameState.paused || isValidating) return;

    const currentPlayer = getCurrentPlayer();
    if (!currentPlayer) return;

    const boardToCheck = clientBoardState || gameState.board;
    const rackToCheck = clientRackState || currentPlayer.rack;

    try {
      if (data?.source === 'rack') {
        const displayIndex = data.index as number;
        const index = toServerRackIndex(displayIndex);
        const letter = rackToCheck[index];
        if (!letter) return;

        const targetLetter = boardToCheck[row][col];

        // If target is empty -> normal placement (or blank dialog) - client-side only
        if (targetLetter === null) {
          if (letter === '?') {
            setBlankAssign({ row, col, rackIndex: index });
            setIsBlankDialogOpen(true);
            return;
          }
          setPlacedTiles([...placedTiles, { row, col, letter }]);
          setTypedSequence(prev => [...prev, { row, col, letter, fromRackIndex: index, blank: false }]);
          setSelectedTileIndex(null);
          if (gameState.currentPlayer === playerId) playSound('tile.mp3');
          return;
        }

        // If target occupied -> check if it's a tile placed this turn (can swap) or old tile (cannot replace)
        const replacedPlaced = placedTiles.find(t => t.row === row && t.col === col);
        if (!replacedPlaced) {
          // Target has an old tile from previous turns - cannot replace it
          return;
        }

        // Target has a tile placed this turn -> swap: place rack tile on board, move replaced tile into rack slot (client-side only)
        // update placedTiles: remove replaced placed entry if existed, and add new placed tile for the rack tile
        setPlacedTiles(prev => {
          const next = prev.filter(t => !(t.row === row && t.col === col));
          // if placing a non-blank from rack, mark it as placed
          const isBlankPlaced = letter === '?';
          next.push({ row, col, letter: isBlankPlaced ? (letter as string) : letter } as any);
          return next;
        });

        // Update typedSequence
        setTypedSequence(prev => {
          const next = prev.filter(t => !(t.row === row && t.col === col));
          if (letter !== '?') {
            next.push({ row, col, letter, fromRackIndex: index, blank: false });
          }
          return next;
        });

        // If rack tile was '?' we should open blank dialog to assign letter at this position
        if (letter === '?') {
          setBlankAssign({ row, col, rackIndex: index });
          setIsBlankDialogOpen(true);
          return;
        }

        setSelectedTileIndex(null);
        return;
      }

      if (data?.source === 'board') {
        const fromRow = data.fromRow as number;
        const fromCol = data.fromCol as number;

        const tile = boardToCheck[fromRow][fromCol];
        if (!tile) return;

        const targetTile = boardToCheck[row][col];

        // Check if the source tile was placed this turn
        const movingPlaced = placedTiles.find(t => t.row === fromRow && t.col === fromCol);
        if (!movingPlaced) {
          // Cannot move tiles that were placed in previous turns
          return;
        }

        // If target is empty => move (only if tile was placed this turn) - client-side only
        if (targetTile === null) {
          const newPlaced = placedTiles.map(t => t.row === fromRow && t.col === fromCol ? { ...t, row, col } : t);
          setPlacedTiles(newPlaced as any);
          // Update typedSequence
          setTypedSequence(prev => prev.map(t => t.row === fromRow && t.col === fromCol ? { ...t, row, col } : t));
          return;
        }

        // target occupied -> check if target tile was also placed this turn (can swap)
        const targetPlaced = placedTiles.find(t => t.row === row && t.col === col);
        if (!targetPlaced) {
          // Target has an old tile from previous turns - cannot swap with it
          return;
        }

        // Both tiles were placed this turn -> swap both on field (client-side only)
        setPlacedTiles(prev => {
          const next = prev.map(t => {
            if (t.row === fromRow && t.col === fromCol) return { ...t, row: row, col: col };
            if (t.row === row && t.col === col) return { ...t, row: fromRow, col: fromCol };
            return t;
          });
          return next as any;
        });

        // Update typedSequence
        setTypedSequence(prev => {
          return prev.map(t => {
            if (t.row === fromRow && t.col === fromCol) return { ...t, row: row, col: col };
            if (t.row === row && t.col === col) return { ...t, row: fromRow, col: fromCol };
            return t;
          });
        });
      }
    } catch (err) {
      console.error('[Drop] error', err);
    }
  }, [clientBoardState, clientRackState, gameState, getCurrentPlayer, isValidating, placedTiles, playerId, playSound, toServerRackIndex]);

  const handleConfirmBlank = async (assigned: string) => {
    if (!blankAssign || !gameState) {
      setIsBlankDialogOpen(false);
      setBlankAssign(null);
      return;
    }
    const { row, col, rackIndex } = blankAssign;
    const boardToCheck = clientBoardState || gameState.board;
    const currentAtCell = boardToCheck[row][col];

    if (!currentAtCell) {
      // Empty cell: place assigned letter (client-side only)
      setPlacedTiles(prev => [...prev, { row, col, letter: assigned, blank: true }]);
      // Add to typedSequence if there's a rackIndex
      if (typeof rackIndex === 'number') {
        setTypedSequence(prev => [...prev, { row, col, letter: assigned, fromRackIndex: rackIndex, blank: true }]);
      }
      playSound('tile.mp3');
    } else {
      // Cell occupied -> swap: assigned replaces existing (client-side only)
      // Update placedTiles: remove any old entry at this cell and add assigned blank
      setPlacedTiles(prev => {
        const next = prev.filter(t => !(t.row === row && t.col === col));
        next.push({ row, col, letter: assigned, blank: true } as any);
        return next;
      });
      // Update typedSequence
      setTypedSequence(prev => {
        const next = prev.filter(t => !(t.row === row && t.col === col));
        if (typeof rackIndex === 'number') {
          next.push({ row, col, letter: assigned, fromRackIndex: rackIndex, blank: true });
        }
        return next;
      });
    }

    setSelectedTileIndex(null);
    setIsBlankDialogOpen(false);
    setBlankAssign(null);
    // No server update - client-side only
  };

  const handleCancelBlank = () => {
    setIsBlankDialogOpen(false);
    setBlankAssign(null);
  };

  const handleShuffle = useCallback(async () => {
    if (!gameState || gameState.gameEnded || gameState.paused) return;
    const currentPlayer = getCurrentPlayer();
    if (!currentPlayer) return;

    tileOrder.shuffle();
    setSelectedTileIndex(null);
    setSelectedDiscardIndices([]);
  }, [gameState, getCurrentPlayer, tileOrder]);

  const handleRecall = useCallback(() => {
    if (!gameState || placedTiles.length === 0) return;
    if (gameState.paused) {
      toast({ variant: 'destructive', title: 'Игра приостановлена', description: 'Нельзя изменять состояние во время паузы' });
      return;
    }
    // Placements do not touch server state until a play is accepted. Clearing
    // the local overlay restores the authoritative rack without a state write.
    setPlacedTiles([]);
    setTypedSequence([]);
    setSelectedTileIndex(null);
  }, [gameState, placedTiles.length, toast]);

  const handleSubmitMove = async () => {
    if (!gameState || gameState.currentPlayer !== playerId || placedTiles.length === 0) return;
    if (turnActionInFlightRef.current) return;
    if (gameState.paused) {
      toast({ variant: 'destructive', title: 'Игра приостановлена', description: 'Нельзя сделать ход во время паузы' });
      return;
    }
    const pid = playerId;
    if (!pid) return;

    // Validate placement using client board state
    const boardForValidation = clientBoardState || gameState.board;
    const placementValidation = validatePlacement(boardForValidation, placedTiles);
    if (!placementValidation.valid) {
      setValidationMessage(placementValidation.error || 'Недопустимое размещение');
      setIsError(true);
      setTimeout(() => {
        setValidationMessage('');
        setIsError(false);
      }, 3000);
      return;
    }

    turnActionInFlightRef.current = 'submit';
    let submitAccepted = false;
    setIsValidating(true);
    setValidationMessage('');
    setIsError(false);

    try {
      // Extract all words formed using client board state (which includes placed tiles)
      const boardForWords = clientBoardState || gameState.board;
      const words = extractWordsFromBoard(boardForWords, placedTiles);
      
      if (words.length === 0) {
        setValidationMessage('Не найдено слов!');
        setIsError(true);
        setIsValidating(false);
        setTimeout(() => {
          setValidationMessage('');
          setIsError(false);
        }, 3000);
        return;
      }

      // Validate all words
      const validationResults = await Promise.all(
        words.map(async ({ word }) => {
          const r = await validateWord(word.toLowerCase());
          return { word, valid: r.isValid };
        })
      );

      const invalidWords = validationResults.filter(r => !r.valid);

      if (invalidWords.length > 0) {
        setValidationMessage(`Недопустимые слова: ${invalidWords.map(w => w.word).join(', ')}`);
        setIsError(true);
        setIsValidating(false);
        
        // Return tiles to rack after a delay
        setTimeout(() => {
          handleRecall();
          setValidationMessage('');
          setIsError(false);
        }, 3000);
        
        return;
      }

      setValidationMessage(`Валидные слова: ${validationResults.map(r => r.word).join(', ')}`);

      // Calculate score using client board state
      const boardForScore = clientBoardState || gameState.board;
      const score = calculateScore(words, boardForScore, placedTiles);
      
      const freshState = await getGameState();
      const baseState = freshState || gameState;
      if (!baseState || baseState.currentPlayer !== playerId) {
        toast({ variant: 'destructive', title: 'Ход уже изменился', description: 'Обновите состояние и попробуйте снова' });
        await refetch();
        setIsValidating(false);
        return;
      }

      const newState = structuredClone(baseState);
      const currentPlayer = Array.isArray(newState.players) ? newState.players.find(p => p.id === playerId) : undefined;
      if (!currentPlayer) return;

      // Apply placed tiles to board state before sending to server
      placedTiles.forEach(tile => {
        newState.board[tile.row][tile.col] = { letter: tile.letter, blank: !!tile.blank } as any;
      });

      // Remove placed tiles from rack
      typedSequence.forEach(t => {
        if (t.fromRackIndex >= 0 && t.fromRackIndex < currentPlayer.rack.length) {
          currentPlayer.rack[t.fromRackIndex] = null;
        }
      });

      currentPlayer.score += score;

      // Refill rack
      for (let i = 0; i < currentPlayer.rack.length; i++) {
        if (currentPlayer.rack[i] === null && newState.tileBag.length > 0) {
          currentPlayer.rack[i] = newState.tileBag.shift() || null;
        }
      }

      // Move to next player (defensive around players array)
      const currentIndex = Array.isArray(newState.players) ? newState.players.findIndex(p => p.id === playerId) : -1;
      const playersLen = Array.isArray(newState.players) ? newState.players.length : 0;
      if (playersLen === 0) {
        newState.currentPlayer = null;
      } else {
        const nextIndex = (currentIndex + 1) % playersLen;
        newState.currentPlayer = (Array.isArray(newState.players) ? newState.players[nextIndex] : undefined)?.id ?? null;
        newState.turn += 1;
      }

      // Append move to history
      newState.moves = newState.moves || [];
      newState.moves.push({
        playerId: pid,
        playerName: currentPlayer.name,
        words: validationResults.map(r => r.word),
        score,
        turn: newState.turn,
        timestamp: Date.now(),
        type: 'play',
        meta: { placedTiles }
      });

      await updateMutation.mutateAsync(newState);
      submitAccepted = true;

      setPlacedTiles([]);
      setTypedSequence([]);
      setSelectedTileIndex(null);
      setIsValidating(false);

      setTimeout(() => {
        setValidationMessage('');
        setIsError(false);
      }, 3000);
    } catch (error) {
      setValidationMessage('Ошибка при проверке слов');
      setIsError(true);
      setIsValidating(false);
      setTimeout(() => {
        setValidationMessage('');
        setIsError(false);
      }, 3000);
    } finally {
      setIsValidating(false);
      if (turnActionInFlightRef.current === 'submit') {
        turnActionInFlightRef.current = null;
      }
      if (timerExpiryPendingRef.current) {
        timerExpiryPendingRef.current = false;
        if (!submitAccepted) void handleSkipTurn();
      }
    }
  };

  // expose submit handler to keyboard shortcut handler
  submitMoveRef.current = handleSubmitMove;

  const handleSkipTurn = async () => {
    if (!gameState || gameState.currentPlayer !== playerId) return;
    if (turnActionInFlightRef.current) return;
    if (gameState.paused) {
      toast({ variant: 'destructive', title: 'Игра приостановлена', description: 'Нельзя пропустить ход во время паузы' });
      return;
    }
    const pid = playerId;
    if (!pid) return;

    turnActionInFlightRef.current = 'skip';
    setIsValidating(true);
    setPlacedTiles([]);
    setTypedSequence([]);
    setSelectedTileIndex(null);

    try {
      const freshState = await getGameState();
      if (!freshState || freshState.currentPlayer !== pid) {
        await refetch();
        return;
      }

      const newState = structuredClone(freshState);
      const currentIndex = newState.players.findIndex(p => p.id === pid);
      if (currentIndex < 0 || newState.players.length === 0) return;

      const nextIndex = (currentIndex + 1) % newState.players.length;
      newState.currentPlayer = newState.players[nextIndex]?.id ?? null;
      newState.turn += 1;
      newState.moves = newState.moves || [];
      const skipPlayer = newState.players[currentIndex];
      newState.moves.push({
        playerId: pid,
        playerName: skipPlayer?.name || '',
        words: [],
        score: 0,
        turn: newState.turn,
        timestamp: Date.now(),
        type: 'skip',
        meta: null
      });

      await updateMutation.mutateAsync(newState);
    } catch (error) {
      console.error('[Skip] failed', error);
      try { await refetch(); } catch {}
    } finally {
      setIsValidating(false);
      timerExpiryPendingRef.current = false;
      if (turnActionInFlightRef.current === 'skip') {
        turnActionInFlightRef.current = null;
      }
    }
  };

  const handleStartDiscard = () => {
    setDiscardMode(true);
    setSelectedDiscardIndices([]);
    setSelectedTileIndex(null);
  };

  const handleCancelDiscard = () => {
    setDiscardMode(false);
    setSelectedDiscardIndices([]);
  };

  const handleConfirmDiscard = async () => {
    // If tiles were placed this turn, recall them first so the exchange acts on rack tiles
    if (placedTiles.length > 0) {
      await handleRecall();
      // refetch to ensure we operate on fresh state
      const refreshed = await refetch();
      if (!refreshed.data) return;
    }

    if (!gameState || gameState.currentPlayer !== playerId) return;
    if (gameState.paused) {
      toast({ variant: 'destructive', title: 'Игра приостановлена', description: 'Нельзя обменивать плитки во время паузы' });
      return;
    }
    const pid = playerId;
    if (!pid) return;
    const currentPlayer = getCurrentPlayer();
    if (!currentPlayer) return;
    if (selectedDiscardIndices.length === 0) return;

    // Work on the latest state snapshot
    const fresh = await getGameState();
    const newState = structuredClone(fresh || gameState);
    const newPlayer = Array.isArray(newState.players) ? newState.players.find(p => p.id === playerId) : undefined;
    if (!newPlayer) return;

    // Collect discarded letters and empty the selected slots
    const discarded: string[] = [];
    // sort indices so assignment is deterministic
    const indices = Array.from(new Set(selectedDiscardIndices.map(toServerRackIndex))).sort((a, b) => a - b);
    for (const idx of indices) {
      const letter = newPlayer.rack[idx];
      if (letter !== null) {
        discarded.push(letter);
        newPlayer.rack[idx] = null;
      }
    }

    // Draw replacements first (so discarded tiles are not immediately drawn back)
    for (const idx of indices) {
      if (newState.tileBag.length > 0) {
        newPlayer.rack[idx] = newState.tileBag.shift() || null;
      } else {
        newPlayer.rack[idx] = null;
      }
    }

    // Now return discarded tiles to the bag and shuffle for future draws
    if (discarded.length > 0) {
      newState.tileBag.push(...discarded);
      shuffleArray(newState.tileBag);
    }

    // Advance turn
    const currentIndex = Array.isArray(newState.players) ? newState.players.findIndex(p => p.id === playerId) : -1;
    const playersLen = Array.isArray(newState.players) ? newState.players.length : 0;
    if (playersLen === 0) {
      newState.currentPlayer = null;
    } else {
      const nextIndex = (currentIndex + 1) % playersLen;
      newState.currentPlayer = (Array.isArray(newState.players) ? newState.players[nextIndex] : undefined)?.id ?? null;
      newState.turn += 1;
    }

    try {
      // Append exchange entry to history
      newState.moves = newState.moves || [];
      const exchPlayer = Array.isArray(newState.players) ? newState.players.find(p => p.id === playerId) : undefined;
      newState.moves.push({
        playerId: pid,
        playerName: exchPlayer?.name || '',
        words: [],
        score: 0,
        turn: newState.turn,
        timestamp: Date.now(),
        type: 'exchange',
        meta: { discarded }
      });

      await updateMutation.mutateAsync(newState);
      setDiscardMode(false);
      setSelectedDiscardIndices([]);
      setSelectedTileIndex(null);
      setPlacedTiles([]);
      setTypedSequence([]);
    } catch (err) {
      // keep discard mode open on error
      console.error('[Discard] failed', err);
    }
  };

  // Pause / Resume game handler
  const handleTogglePause = async () => {
    if (!playerId || !gameState) return;
    try {
      const fresh = await getGameState();
      const newState = structuredClone(fresh || gameState) as GameState;
      const wasPaused = !!newState.paused;
      // Toggle pause and set server-side pausedAt timestamp when pausing.
      newState.paused = !wasPaused;
      newState.pausedBy = newState.paused ? playerId : null;
      if (newState.paused) {
        newState.pausedAt = Date.now();
      } else {
        // server will adjust turnStart when processing resume; clear pausedAt
        newState.pausedAt = null;
      }

      await updateMutation.mutateAsync(newState);
      toast({ title: newState.paused ? 'Игра приостановлена' : 'Игра возобновлена' });
    } catch (err) {
      toast({ variant: 'destructive', title: 'Ошибка', description: 'Не удалось изменить состояние паузы' });
      console.error('[Pause] failed', err);
    }
  };

  const resetEndedSessionAndGoLobby = async () => {
    if (!playerId || !gameState?.gameEnded) {
      try { setLocation('/lobby'); } catch {}
      return;
    }

    try {
      const resp = await resetSessionApi(playerId, { preservePlayers: true });
      if (resp?.gameState) {
        queryClient.setQueryData(['/api/game'], resp.gameState);
      } else {
        queryClient.invalidateQueries({ queryKey: ['/api/game'] });
      }
      setShowEndScreen(false);
      setShowEndScreenMinimized(false);
      setHasPlayedEndGameSound(false);
      setPlacedTiles([]);
      setTypedSequence([]);
      setSelectedTileIndex(null);
      setSelectedDiscardIndices([]);
      setDiscardMode(false);
      lastTurnStartRef.current = Date.now();
      try { setLocation('/lobby'); } catch {}
      toast({ title: 'Новая сессия готова', description: 'Прошлая партия сброшена, можно собрать лобби заново' });
    } catch (err: any) {
      toast({
        variant: 'destructive',
        title: 'Не удалось сбросить сессию',
        description: err?.message || 'Откройте лобби и попробуйте кнопку сброса сессии',
      });
    }
  };

  const handleBackToLobby = async () => {
    if (pendingPatchRef.current.timer) {
      clearTimeout(pendingPatchRef.current.timer as number);
    }
    pendingPatchRef.current.board = {};
    pendingPatchRef.current.rack = {};
    pendingPatchRef.current.timer = null;
    if (gameState?.gameEnded) {
      await resetEndedSessionAndGoLobby();
      return;
    }
    try { setLocation('/lobby'); } catch {}
    toast({ title: 'Вы вернулись в лобби' });
  };

  const isCurrentPlayer = gameState?.currentPlayer === playerId;
  const canEditLocalPlacement = !isJoining && !gameState?.gameEnded && !gameState?.paused && !isValidating;
  const allPlayersVoiceEnabled = useMemo(
    () => !!gameState?.players?.length && gameState.players.every((player) => !!player.voiceEnabled),
    [gameState?.players]
  );
  const voicePlayerNames = useMemo(
    () => Object.fromEntries((gameState?.players || []).map(p => [p.id, p.name])),
    [gameState?.players]
  );
  const stableHandleSquareClick = useEventCallback(handleSquareClick);
  const stableHandleBoardTileDrop = useEventCallback(handleBoardTileDrop);
  const stableHandleTileClick = useEventCallback(handleTileClick);
  const stableHandleShuffle = useEventCallback(handleShuffle);
  const stableHandleRecall = useEventCallback(handleRecall);
  const stableHandleReorderRack = useEventCallback(handleReorderRack);
  const stableHandleDropFromBoard = useEventCallback(handleDropFromBoard);

  return (
    <div className="min-h-[100svh] bg-background">
      {gameState?.paused && (
        <div className="fixed top-0 left-0 right-0 bg-yellow-100 border-b border-yellow-300 text-yellow-900 p-3 z-40 flex items-center justify-center">
          <div className="text-sm font-medium">Приостановлено {gameState.pausedBy ? `пользователем ${ (gameState.players || []).find(p => p.id === gameState.pausedBy)?.name ?? '' }` : ''}</div>
        </div>
      )}
      <JoinGameDialog
        open={isJoining}
        playerCount={gameState?.players.length || 0}
        onJoin={handleJoinGame}
        defaultName={typeof window !== 'undefined' ? localStorage.getItem('playerName') || undefined : undefined}
        error={joinError}
        isLoading={(joinMutation as any).isLoading}
      />
      <BlankAssignDialog open={isBlankDialogOpen} defaultValue={''} onConfirm={handleConfirmBlank} onCancel={handleCancelBlank} />

      {!isJoining && gameState && (
        <>
          {gameState.gameEnded && showEndScreen && (
            <EndGameScreen
              gameState={gameState}
              currentPlayerId={playerId}
              onClose={() => {
                setShowEndScreen(false);
                setShowEndScreenMinimized(true);
              }}
              onMinimize={() => {
                setShowEndScreen(false);
                setShowEndScreenMinimized(true);
              }}
              onNewGame={resetEndedSessionAndGoLobby}
            />
          )}

          {/* floating reopen button when minimized */}
          {gameState.gameEnded && showEndScreenMinimized && (
            <button
              aria-label="Open end game"
              title="Открыть результаты (E)"
              onClick={() => { setShowEndScreenMinimized(false); setShowEndScreen(true); }}
              className="fixed right-6 bottom-6 z-50 bg-primary text-primary-foreground rounded-full w-12 h-12 flex items-center justify-center shadow-lg"
            >
              🏆
            </button>
          )}

          {/* keyboard shortcut to toggle the end screen when the game has ended */}
          {/** NOTE: attaches on mount/unmount below via effect */}

          {/* Lobby moved to a separate page at /lobby */}

          <div className="min-h-[100svh] lg:h-[100dvh] flex flex-col lg:flex-row gap-4 p-4 overflow-x-hidden lg:overflow-hidden">
          <aside className="lg:w-72 lg:flex-none flex flex-col gap-3 min-w-0 lg:min-h-0 lg:h-full">
            <h1 className="text-2xl font-bold">Игроки</h1>
            <div className="flex flex-row gap-2 overflow-x-auto shrink-0">
              {(gameState?.players || []).map((player, index) => (
                <PlayerCard
                  key={player.id}
                  player={player}
                  isCurrentPlayer={player.id === gameState.currentPlayer}
                  playerIndex={index}
                />
              ))}
            </div>
            {/* Voice chat controls (global + background component) */}
            {playerId && allPlayersVoiceEnabled && <div className="mt-1 shrink-0"><VoiceChat playerId={playerId} voiceVolume={voiceVolume} playerNames={voicePlayerNames} /></div>}
            {/* Global sound & voice controls */}
            <div className="mt-1 shrink-0 rounded-md border bg-card/40 p-2">
              <div className="grid grid-cols-2 gap-x-3 gap-y-2">
                <div>
                  <div className="flex items-center justify-between gap-2 text-sm font-medium">
                    <span>Sound</span>
                    <span className="text-xs tabular-nums text-muted-foreground">{Math.round(soundVolume * 100)}%</span>
                  </div>
                  <div className="mt-1">
                    <input
                      type="range"
                      min={0}
                      max={100}
                      value={Math.round(soundVolume * 100)}
                      onChange={(e) => setSoundVolume(Math.max(0, Math.min(100, Number(e.target.value))) / 100)}
                      className="w-full h-2 accent-primary bg-transparent"
                    />
                  </div>
                </div>

                <div>
                  <div className="flex items-center justify-between gap-2 text-sm font-medium">
                    <span>Voice</span>
                    <span className="text-xs tabular-nums text-muted-foreground">{Math.round(voiceVolume * 100)}%</span>
                  </div>
                  <div className="mt-1">
                    <input
                      type="range"
                      min={0}
                      max={100}
                      value={Math.round(voiceVolume * 100)}
                      onChange={(e) => setVoiceVolume(Math.max(0, Math.min(100, Number(e.target.value))) / 100)}
                      className="w-full h-2 accent-primary bg-transparent"
                    />
                  </div>
                </div>
                <div className="col-span-2 grid grid-cols-2 gap-2">
                  <button
                    onClick={handleTogglePause}
                    disabled={!!gameState?.gameEnded}
                    className={`px-3 py-1 rounded border hover:bg-muted/10 ${gameState?.paused ? 'bg-yellow-500 text-white' : 'bg-transparent'}`}
                    aria-pressed={!!gameState?.paused}
                    title={gameState?.paused ? `Resume (paused by ${gameState.pausedBy ?? 'someone'})` : 'Pause game'}
                  >
                    {gameState?.paused ? 'Resume' : 'Pause'}
                  </button>
                  <button
                    onClick={handleBackToLobby}
                    className="px-3 py-1 rounded border hover:bg-muted/10"
                    title="Вернуться в лобби без выхода из текущей сессии"
                  >
                    В лобби
                  </button>
                </div>
              </div>
            </div>
            <div className="mt-2 flex flex-col min-h-0 lg:flex-1">
              <h2 className="text-lg font-semibold">История ходов</h2>
              <div className="mt-2 flex flex-col gap-2 max-h-[30vh] lg:max-h-none lg:flex-1 lg:min-h-0 overflow-auto history-scroll pr-1">
                {(gameState.moves || []).slice().reverse().map((m, idx) => (
                  <div key={`${m.playerId}-${m.timestamp}-${idx}`} className="p-2 rounded border bg-card">
                    <div className="flex items-center justify-between">
                      <div className="font-medium">{m.playerName}</div>
                      <div className="text-xs text-muted-foreground">{new Date(m.timestamp).toLocaleTimeString()}</div>
                    </div>
                    <div className="text-sm text-muted-foreground">
                      {m.type === 'skip' ? (
                        <span className="italic">Пропуск хода</span>
                      ) : m.type === 'exchange' ? (
                        <span>Обмен фишек: {(m.meta?.discarded || []).join(', ')}</span>
                      ) : (
                        <span>
                          {m.words.map((word, wordIdx) => (
                            <span key={wordIdx}>
                              <a
                                href={`https://ru.wiktionary.org/wiki/${encodeURIComponent(word.toLowerCase())}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-primary underline hover:text-primary/80 cursor-pointer"
                              >
                                {word}
                              </a>
                              {wordIdx < m.words.length - 1 && ', '}
                            </span>
                          ))}
                        </span>
                      )}
                    </div>
                    <div className="text-sm font-semibold mt-1">{m.type === 'play' ? `+${m.score} очков` : m.type === 'exchange' ? `Обмен (${(m.meta?.discarded || []).length} ф.)` : 'Пропуск'}</div>
                  </div>
                ))}
              </div>
            </div>
          </aside>

          <main className="flex-1 min-w-0 min-h-0 flex flex-col items-center justify-start lg:justify-center gap-3 relative overflow-hidden">
            <ValidationMessage
              message={validationMessage}
              isValidating={isValidating}
              isError={isError}
            />
            {/* placedWordStatuses moved to sidebar below timer */}
            <div className="w-full flex-1 min-h-0 flex items-center justify-center">
              <GameBoard
                board={clientBoardState || gameState.board}
                committedBoard={gameState.board}
                placedTiles={placedTiles}
                canEditPlacedTiles={canEditLocalPlacement}
                typingCursor={typingCursor}
                placedWordStatuses={placedWordStatuses}
                lastMovePositions={lastMovePositions}
                previews={gameState?.previews || EMPTY_PREVIEWS}
                onSquareClick={stableHandleSquareClick}
                onTileDrop={stableHandleBoardTileDrop}
              />
            </div>
              
          </main>

          <aside className="lg:w-80 lg:flex-none flex flex-col gap-3 min-w-0 lg:min-h-0 lg:h-full lg:overflow-y-auto pr-1">
            {(//isCurrentPlayer && (
              <>
                <div className="flex items-center justify-between gap-2">
                  <GameTimer
                    totalTime={MOVE_TIME}
                    turnStart={timerTurnStart}
                    paused={!!gameState?.paused}
                    pausedAt={gameState?.pausedAt ?? null}
                    gameEnded={!!gameState?.gameEnded}
                    turnKey={timerTurnKey}
                    onWarning={handleTimerWarning}
                    onExpired={handleTimerExpired}
                  />
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setIsDark(prev => !prev)}
                      className="p-2 rounded hover:bg-muted/10"
                      aria-label="Toggle dark mode"
                    >
                      {isDark ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
                    </button>
                    {/* Planning mode hint when it's not your turn */}
                    {gameState && gameState.currentPlayer !== playerId && (
                      <div className="ml-2 px-2 py-1 text-sm rounded bg-muted/10 text-muted-foreground">Planning</div>
                    )}
                  </div>
                </div>
                {gameState && (
                  <div className="text-sm text-muted-foreground">
                    Фишек в мешке: <span className="font-semibold">{gameState?.tileBag?.length ?? 0}</span>
                  </div>
                )}

                {/* Active placed-word status */}
                <div className={placedWordStatuses.length > 0 ? '' : 'hidden'}>
                {placedWordStatuses.length > 0 && (
                  <div className="flex gap-2 mt-2 flex-wrap">
                    {placedWordStatuses.map((p, i) => (
                      <div
                        key={`${p.word}-${i}`}
                        className={
                          `px-2 py-1 rounded font-semibold text-sm ` +
                          (p.status === 'valid'
                            ? 'bg-green-100 text-green-800'
                            : p.status === 'invalid'
                            ? 'bg-red-100 text-red-800'
                            : 'bg-yellow-100 text-yellow-800')
                        }
                      >
                        {p.word}
                      </div>
                    ))}
                    {/* potential score for the full placement when valid */}
                    {potentialScore !== null && placedWordStatuses.length > 0 && placedWordStatuses.every(p => p.status === 'valid') && (
                      <div className="px-2 py-1 rounded font-semibold text-sm bg-green-100 text-green-800">+{potentialScore} очков</div>
                    )}
                  </div>
                )}
                </div>

                <WordChecker disabled={!!gameState?.gameEnded} />

                <div>
                  <h2 className="text-lg font-semibold mb-4">Ваши фишки</h2>
                  <TileRack
                    rack={displayRackState.length > 0 ? displayRackState : clientRackState || getCurrentPlayer()?.rack || []}
                    selectedTileIndex={selectedTileIndex}
                    selectedIndices={discardMode ? selectedDiscardIndices : undefined}
                    onTileClick={stableHandleTileClick}
                    onShuffle={stableHandleShuffle}
                    onRecall={stableHandleRecall}
                    onReorder={stableHandleReorderRack}
                    onDropFromBoard={stableHandleDropFromBoard}
                    // Disable interactions when the game has ended
                    canInteract={canEditLocalPlacement}
                    canShuffle={!isJoining && !gameState?.gameEnded && !gameState?.paused}
                    isPaused={!!gameState?.paused}
                  />
                </div>
                  <div className="flex flex-col gap-2">
                    {!discardMode ? (
                      <>
                        <Button
                          size="lg"
                          onClick={handleSubmitMove}
                          disabled={placedTiles.length === 0 || isValidating || !!gameState?.gameEnded}
                          className="w-full"
                          data-testid="button-submit"
                        >
                          <CheckCircle className="w-5 h-5 mr-2" />
                          Подтвердить ход
                        </Button>
                        <Button
                          variant="outline"
                          size="lg"
                          onClick={handleSkipTurn}
                          disabled={isValidating || !!gameState?.gameEnded}
                          className="w-full"
                          data-testid="button-skip"
                        >
                          <SkipForward className="w-5 h-5 mr-2" />
                          Пропустить ход
                        </Button>
                        <Button
                          variant="outline"
                          size="lg"
                          onClick={handleStartDiscard}
                          disabled={isValidating || !!gameState?.gameEnded || (gameState && gameState.tileBag.length === 0)}
                          className="w-full"
                          data-testid="button-swap"
                          title={gameState && gameState.tileBag.length === 0 ? 'Нельзя обменивать фишки: мешок пуст' : ''}
                        >
                          Обменять фишки и пропустить
                        </Button>
                      </>
                    ) : (
                      <>
                        <div className="text-sm text-muted-foreground">Выберите фишки для обмена</div>
                        <div className="flex gap-2">
                            <Button
                              size="lg"
                              onClick={handleConfirmDiscard}
                              disabled={selectedDiscardIndices.length === 0 || isValidating || !!gameState?.gameEnded}
                              className="flex-1"
                              data-testid="button-confirm-swap"
                            >
                            Подтвердить обмен
                          </Button>
                          <Button
                            variant="outline"
                            size="lg"
                            onClick={handleCancelDiscard}
                            disabled={isValidating || !!gameState?.gameEnded}
                            className="flex-1"
                            data-testid="button-cancel-swap"
                          >
                            Отмена
                          </Button>
                        </div>
                      </>
                    )}
                  </div>
              </>
            )}
            {/* {!isCurrentPlayer && (
              <div className="text-center text-muted-foreground p-8">
                <p>Ожидание хода другого игрока...</p>
              </div>
            )} */}
          </aside>
        </div>
        </>
      )}
    </div>
  );
}

