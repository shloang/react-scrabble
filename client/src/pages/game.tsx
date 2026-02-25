import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { MOVE_TIME, Player, PlacedTile, GameState, TILE_VALUES } from '@shared/schema';
import { getGameState, joinGame as joinGameApi, updateGameState, validateWord, sendPreview, initializeGame } from '@/lib/gameApi';
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
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { CheckCircle, SkipForward, Sun, Moon } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useLocation } from 'wouter';
import { getStats, incrementWin, incrementLoss, getAllStats } from '@/lib/playerStats';

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
  // visual-only rack view to support drag-reorder in the UI during planning
  const [rackView, setRackView] = useState<(string | null)[] | null>(null);
  const [timeLeft, setTimeLeft] = useState(MOVE_TIME);
  const [isDark, setIsDark] = useState<boolean>(() => {
    try { return localStorage.getItem('dark') === '1'; } catch { return false; }
  });
  const [validationMessage, setValidationMessage] = useState('');
  const [isValidating, setIsValidating] = useState(false);
  const [isError, setIsError] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);
  const [wordToCheck, setWordToCheck] = useState('');
  const [isCheckingWord, setIsCheckingWord] = useState(false);
  const [wordCheckResult, setWordCheckResult] = useState<null | { word: string; valid: boolean; extract?: string | null }>(null);
  const [hasPlayed20SecSound, setHasPlayed20SecSound] = useState(false);
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
  const [voicePeerState, setVoicePeerState] = useState<{ peerVolumes: Record<string, number>; peerMuted: Record<string, boolean>; peerStatuses: Record<string, string>; levels: Record<string, number> }>({ peerVolumes: {}, peerMuted: {}, peerStatuses: {}, levels: {} });

  const handleVoiceStateUpdate = useCallback((s: { peerVolumes: Record<string, number>; peerMuted: Record<string, boolean>; peerStatuses: Record<string, string>; levels: Record<string, number> }) => {
    setVoicePeerState(prev => ({
      peerVolumes: { ...prev.peerVolumes, ...s.peerVolumes },
      peerMuted: { ...prev.peerMuted, ...s.peerMuted },
      peerStatuses: { ...prev.peerStatuses, ...s.peerStatuses },
      levels: { ...prev.levels, ...s.levels }
    }));
  }, [setVoicePeerState]);

  const playSound = (filename: string) => {
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
      }
      // ensure volume matches current setting
      try { audio.volume = soundVolume; } catch (err) {}

      // Reset playback to start for short sounds
      try {
        audio.currentTime = 0;
      } catch (err) { /* ignore */ }
      audio.play().catch(err => console.error('Failed to play sound:', err));
    } catch (err) {
      console.error('Failed to load sound:', err);
    }
  };

  // Update cached audio elements when soundVolume changes
  useEffect(() => {
    for (const k of Object.keys(audioCache.current)) {
      try { audioCache.current[k].volume = soundVolume; } catch (err) {}
    }
  }, [soundVolume]);

  // Poll for game state
  const { data: gameState, refetch } = useQuery<GameState | null>({
    queryKey: ['/api/game'],
    refetchInterval: 2000,
    enabled: !isJoining
  });

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
      } catch (err) {
        // ignore storage errors
      }
      setJoinError(null);
      setIsJoining(false);
      // do not navigate away after join; keep user on the Game page
      setTimeLeft(MOVE_TIME);
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
    onError: (error) => {
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

      // apply board patches
      for (const key of Object.keys(pendingPatchRef.current.board)) {
        const [rStr, cStr] = key.split(',');
        const r = Number(rStr);
        const c = Number(cStr);
        base.board[r][c] = pendingPatchRef.current.board[key];
      }

      // apply rack patches for current player
      const player = base.players.find(p => p.id === playerId);
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
          base.board[r][c] = pendingPatchRef.current.board[key];
        }
        const player = base.players.find(p => p.id === playerId);
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
    const getCurrentPlayer = () => gameState?.players.find(p => p.id === playerId) || null;

    const clientBoardState = useMemo(() => {
      if (!gameState) return null;
      const b = structuredClone(gameState.board);
      for (const t of placedTiles) {
        b[t.row][t.col] = { letter: t.letter, blank: !!t.blank } as any;
      }
      return b;
    }, [gameState, placedTiles]);

    const clientRackState = useMemo(() => {
      if (!gameState || !playerId) return null;
      const player = gameState.players.find(p => p.id === playerId);
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
    }, [gameState, playerId, typedSequence]);

    // initialize rackView when server rack updates
    useEffect(() => {
      if (clientRackState) setRackView([...clientRackState]);
    }, [clientRackState]);

    // Periodically send previews to the server so other players can see our
    // planning placements without committing them. We send every 2s while
    // the player has local placedTiles; when there are none we clear the
    // preview on the server for this player.
    useEffect(() => {
      let stopped = false;
      if (!playerId) return;
      const send = async () => {
        try {
          // Only send when we have placed tiles (or to clear them)
          await sendPreview(playerId, placedTiles.map(t => ({ row: t.row, col: t.col, letter: t.letter, blank: !!t.blank })));
        } catch (err) {
          // ignore network errors for now
        }
      };

      // Send immediately once, then every 2s while placedTiles exist
      let interval: number | null = null;
      (async () => {
        await send();
        if (stopped) return;
        interval = window.setInterval(() => { send(); }, 2000) as unknown as number;
      })();

      return () => {
        stopped = true;
        if (interval) clearInterval(interval as number);
        // On unmount/cleanup ensure server preview is cleared for this player
        (async () => {
          try { await sendPreview(playerId, []); } catch (err) { /* ignore */ }
        })();
      };
    }, [playerId, placedTiles]);

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

    // When placedTiles or preview board changes, validate placed words and compute potential score
    useEffect(() => {
      if (!gameState) return;
      const board = clientBoardState || gameState.board;
      if (!placedTiles || placedTiles.length === 0) {
        setPlacedWordStatuses([]);
        setPotentialScore(null);
        return;
      }

      const words = extractWordsFromBoard(board, placedTiles);
      if (!words || words.length === 0) {
        setPlacedWordStatuses([]);
        setPotentialScore(null);
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
    }, [placedTiles, clientBoardState, gameState]);

    // Play turn sound on all turn switches
  useEffect(() => {
    if (!gameState) return;

    // Play turn-change sound only when current player changed (avoid duplicate plays)
    if (previousCurrentPlayer !== null && gameState.currentPlayer !== previousCurrentPlayer) {
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

    const isWinner = gameState.winnerId === playerId;
    if (isWinner) {
      playSound('win.mp3');
    } else {
      playSound('lose.mp3');
    }
    setHasPlayedEndGameSound(true);

    // Update local player stats once per finished game
    try {
      if (!statsUpdatedRef.current) {
        const winnerId = gameState.winnerId;
        if (winnerId) incrementWin(winnerId);
        for (const p of gameState.players) {
          if (p.id !== winnerId) incrementLoss(p.id);
        }
        statsUpdatedRef.current = true;
      }
    } catch (err) {
      // ignore stats update errors
    }
  }, [gameState?.gameEnded, gameState?.winnerId, playerId, hasPlayedEndGameSound]);

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

  // Continuous timer for everyone: compute remaining time by comparing now to the
  // last-turn start timestamp (derived from the last move). This keeps the visible
  // countdown running for all players, not only the local player.
  useEffect(() => {
    if (!gameState) return;
    // If the game ended, show 0
    if (gameState.gameEnded) {
      setTimeLeft(0);
      return;
    }

    // Compute remaining based on server `turnStart` and `pausedAt` when paused
    const computeRemainingAt = (nowMs: number) => {
      const startMs = (typeof gameState.turnStart === 'number' && gameState.turnStart) ? gameState.turnStart : (lastTurnStartRef.current ?? nowMs);
      // if paused, use pausedAt as the reference moment to compute elapsed
      const refMs = (gameState.paused && typeof gameState.pausedAt === 'number' && gameState.pausedAt) ? gameState.pausedAt : nowMs;
      const elapsed = Math.floor((refMs - startMs) / 1000);
      return Math.max(0, MOVE_TIME - elapsed);
    };

    // If paused, set a static remaining and don't start ticking
    if (gameState.paused) {
      const remaining = computeRemainingAt(Date.now());
      setTimeLeft(remaining);
      return;
    }

    let cancelled = false;
    const tick = () => {
      if (cancelled) return;
      const now = Date.now();
      const remaining = computeRemainingAt(now);

      setTimeLeft(prev => {
        if (gameState.currentPlayer === playerId) {
          if (remaining <= 20 && !hasPlayed20SecSound) {
            playSound('20sec.mp3');
            setHasPlayed20SecSound(true);
          }
        }
        return remaining;
      });

      if (remaining <= 0 && gameState.currentPlayer === playerId) {
        handleSkipTurn();
        // don't manipulate lastTurnStartRef — server will provide authoritative state
      }
    };

    tick();
    const id = setInterval(tick, 1000);
    return () => { cancelled = true; clearInterval(id); };
  }, [gameState?.gameEnded, gameState?.paused, gameState?.pausedAt, gameState?.turnStart, gameState?.currentPlayer, playerId, hasPlayed20SecSound]);

  // Note: server now manages `pausedAt` and `turnStart`; client relies on those fields.

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

  const handleCheckWord = async () => {
    const w = wordToCheck.trim();
    if (!w) return;
    setIsCheckingWord(true);
    setWordCheckResult(null);
    try {
      await ensureWordListLoaded();
      const local = isWordLocal(w.toLowerCase());
      if (local !== null) {
        setWordCheckResult({ word: w, valid: local, extract: null });
      } else {
        const res = await validateWord(w.toLowerCase());
        setWordCheckResult({ word: w, valid: res.isValid, extract: res.extract || null });
      }
    } catch (err) {
      setWordCheckResult({ word: w, valid: false, extract: null });
    } finally {
      setIsCheckingWord(false);
    }
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

  const handleSquareClick = async (row: number, col: number) => {
          if (!gameState) return;
    
    const currentPlayer = getCurrentPlayer();
    if (!currentPlayer) return;

    const boardToCheck = clientBoardState || gameState.board;

    // If a rack tile is selected, place it normally (client-side only)
    if (selectedTileIndex !== null && boardToCheck[row][col] === null) {
      const rackToCheck = clientRackState || currentPlayer.rack;
      const letter = rackToCheck[selectedTileIndex];
      if (!letter) return;

      // Handle blank tile assignment by opening modal
      if (letter === '?') {
        setBlankAssign({ row, col, rackIndex: selectedTileIndex });
        setIsBlankDialogOpen(true);
        return;
      }

      console.log('[Placement] Placing tile', letter, 'at', row, col);
      setPlacedTiles([...placedTiles, { row, col, letter }]);
      // Track rack index for this placement
      setTypedSequence(prev => [...prev, { row, col, letter, fromRackIndex: selectedTileIndex, blank: false }]);
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
  };

  const handleTileClick = (index: number) => {
    if (discardMode) {
      setSelectedDiscardIndices(prev => {
        if (prev.includes(index)) return prev.filter(i => i !== index);
        return [...prev, index];
      });
      return;
    }

    setSelectedTileIndex(selectedTileIndex === index ? null : index);
  };

  // Reorder rack indices (drag within rack) - client-side only, no server update
  const handleReorderRack = async (from: number, to: number) => {
    if (from === to) return;

    // Update visual rack order (local only)
    setRackView(prev => {
      const base = prev ? [...prev] : (clientRackState ? [...clientRackState] : []);
      if (!base || from < 0 || to < 0 || from >= base.length || to >= base.length) return base;
      const [item] = base.splice(from, 1);
      base.splice(to, 0, item);
      return base;
    });

    // Update local selected index mapping so selection follows the tile
    setSelectedTileIndex(prev => {
      if (prev === null) return null;
      if (prev === from) return to;
      if (from < to && prev > from && prev <= to) return prev - 1;
      if (from > to && prev >= to && prev < from) return prev + 1;
      return prev;
    });
  };

  // Drop a placed board tile into a rack slot (or swap) - client-side only
  const handleDropFromBoard = async (fromRow: number, fromCol: number, toIndex: number) => {
    if (!gameState) return;
    const currentPlayer = getCurrentPlayer();
    if (!currentPlayer) return;

    const boardToCheck = clientBoardState || gameState.board;
    const tileCell = boardToCheck[fromRow][fromCol] as any;
    if (!tileCell) return;
    const tileLetter = tileCell.letter as string | undefined;
    const placedEntry = placedTiles.find(t => t.row === fromRow && t.col === fromCol) as any;
    const isBlank = !!tileCell.blank || !!placedEntry?.blank;

    const rackToCheck = clientRackState || currentPlayer.rack;
    const rackVal = rackToCheck[toIndex];

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
      setBlankAssign({ row: fromRow, col: fromCol, rackIndex: toIndex });
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
      // Find the rack index for the new tile
      const rackIndex = currentPlayer.rack.findIndex(t => t === rackVal);
      if (rackIndex !== -1) {
        return [...without, { row: fromRow, col: fromCol, letter: rackVal, fromRackIndex: rackIndex, blank: false }];
      }
      return without;
    });
  };

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

  const handleShuffle = async () => {
    if (!gameState || gameState.currentPlayer !== playerId) return;
    const currentPlayer = getCurrentPlayer();
    if (!currentPlayer) return;

    // Shuffle is visual only - actual rack state comes from server
    // We don't need to update server for this as it's just UI reordering
    console.log('[Shuffle] Shuffling rack (client-side only)');
  };

  const handleRecall = async () => {
    if (!gameState || placedTiles.length === 0) return;
    if (gameState.paused) {
      toast({ variant: 'destructive', title: 'Игра приостановлена', description: 'Нельзя изменять состояние во время паузы' });
      return;
    }
    const currentPlayer = getCurrentPlayer();
    if (!currentPlayer) return;

    const newState = structuredClone(gameState);
    const newPlayer = newState.players.find(p => p.id === playerId);
    if (!newPlayer) return;

    // Return placed tiles to player's rack. Prefer to return to the original
    // rack index recorded in typedSequence (fromRackIndex). If that isn't
    // available, put into the first `null` slot. As a last resort overwrite the
    // first slot to avoid losing tiles.
    for (const placed of placedTiles) {
      const { row, col, letter, blank } = placed as any;
      newState.board[row][col] = null;

      // try find typedSequence entry for this placed tile
      const typed = typedSequence.find(t => t.row === row && t.col === col && typeof t.fromRackIndex === 'number');
      if (typed && typeof typed.fromRackIndex === 'number') {
        const idx = typed.fromRackIndex;
        if (idx >= 0 && idx < newPlayer.rack.length) {
          newPlayer.rack[idx] = typed.blank ? '?' : typed.letter;
          continue;
        }
      }

      const emptyIndex = newPlayer.rack.findIndex(t => t === null);
      if (emptyIndex !== -1) {
        newPlayer.rack[emptyIndex] = blank ? '?' : letter;
        continue;
      }

      // last resort: overwrite first slot to avoid dropping the tile entirely
      newPlayer.rack[0] = blank ? '?' : letter;
    }

    setPlacedTiles([]);
    setTypedSequence([]);
    setSelectedTileIndex(null);
    await updateMutation.mutateAsync(newState);
  };

  const handleSubmitMove = async () => {
    if (!gameState || gameState.currentPlayer !== playerId || placedTiles.length === 0) return;
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
      
      const newState = structuredClone(gameState);
      const currentPlayer = newState.players.find(p => p.id === playerId);
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

      // Move to next player
      const currentIndex = newState.players.findIndex(p => p.id === playerId);
      const nextIndex = (currentIndex + 1) % newState.players.length;
      newState.currentPlayer = newState.players[nextIndex].id;
      newState.turn += 1;

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

      setPlacedTiles([]);
      setTypedSequence([]);
      setSelectedTileIndex(null);
      setTimeLeft(MOVE_TIME);
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
    }
  };

  // expose submit handler to keyboard shortcut handler
  submitMoveRef.current = handleSubmitMove;

  const handleSkipTurn = async () => {
    if (!gameState || gameState.currentPlayer !== playerId) return;
    if (gameState.paused) {
      toast({ variant: 'destructive', title: 'Игра приостановлена', description: 'Нельзя пропустить ход во время паузы' });
      return;
    }
    const pid = playerId;
    if (!pid) return;

    // Return tiles to rack first if any placed
    if (placedTiles.length > 0) {
      await handleRecall();
      // Refetch to get updated state after recall
      await refetch();
    }

    // Get fresh state and advance turn
    const freshState = await refetch();
    if (!freshState.data) return;

    const newState = structuredClone(freshState.data);
    const currentIndex = newState.players.findIndex(p => p.id === playerId);
    const nextIndex = (currentIndex + 1) % newState.players.length;
    newState.currentPlayer = newState.players[nextIndex].id;
    newState.turn += 1;
    // Append skip entry to history
    newState.moves = newState.moves || [];
    const skipPlayer = newState.players.find(p => p.id === playerId);
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
    setTimeLeft(MOVE_TIME);
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
    const newPlayer = newState.players.find(p => p.id === playerId);
    if (!newPlayer) return;

    // Collect discarded letters and empty the selected slots
    const discarded: string[] = [];
    // sort indices so assignment is deterministic
    const indices = [...selectedDiscardIndices].sort((a, b) => a - b);
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
    const currentIndex = newState.players.findIndex(p => p.id === playerId);
    const nextIndex = (currentIndex + 1) % newState.players.length;
    newState.currentPlayer = newState.players[nextIndex].id;
    newState.turn += 1;

    try {
      // Append exchange entry to history
      newState.moves = newState.moves || [];
      const exchPlayer = newState.players.find(p => p.id === playerId);
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
      setTimeLeft(MOVE_TIME);
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

  const handleBackToLobby = async () => {
    try { setLocation('/lobby'); } catch {}
    toast({ title: 'Вы вернулись в лобби' });
  };

  const isCurrentPlayer = gameState?.currentPlayer === playerId;

  return (
    <div className="min-h-screen bg-background">
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
              onNewGame={() => {
                // Navigate back to lobby page
                try { setLocation('/lobby'); } catch {}
                setShowEndScreen(false);
                setShowEndScreenMinimized(false);
                setHasPlayedEndGameSound(false);
                setTimeLeft(MOVE_TIME);
                lastTurnStartRef.current = Date.now();
                try { refetch(); } catch {}
                toast({ title: 'Возврат в лобби' });
              }}
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

          <div className="h-screen flex flex-col lg:flex-row gap-4 p-4">
          <aside className="lg:w-72 flex flex-col gap-4">
            <h1 className="text-2xl font-bold">Игроки</h1>
            <div className="flex flex-row gap-2 overflow-x-auto">
              {gameState.players.map((player, index) => (
                <PlayerCard
                  key={player.id}
                  player={player}
                  isCurrentPlayer={player.id === gameState.currentPlayer}
                  playerIndex={index}
                  voiceMuted={voicePeerState.peerMuted[player.id]}
                  voiceVolume={voicePeerState.peerVolumes[player.id]}
                  voiceLevel={voicePeerState.levels[player.id]}
                  voiceStatus={voicePeerState.peerStatuses[player.id]}
                  onToggleMute={() => setVoicePeerState(prev => ({ ...prev, peerMuted: { ...prev.peerMuted, [player.id]: !prev.peerMuted[player.id] } }))}
                  onVolumeChange={(v) => setVoicePeerState(prev => ({ ...prev, peerVolumes: { ...prev.peerVolumes, [player.id]: v } }))}
                />
              ))}
            </div>
            {/* Voice chat controls (global + background component) */}
            {playerId && <div className="mt-2"><VoiceChat playerId={playerId} voiceVolume={voiceVolume} playerNames={Object.fromEntries((gameState.players||[]).map(p => [p.id, p.name]))} /></div>}
            {/* Global sound & voice controls in one themed row */}
            <div className="mt-2">
              <div className="flex items-center gap-3">
                <div className="flex-1">
                  <div className="text-sm font-medium">Sound</div>
                  <div className="flex items-center gap-2 mt-1">
                    <input
                      type="range"
                      min={0}
                      max={100}
                      value={Math.round(soundVolume * 100)}
                      onChange={(e) => setSoundVolume(Math.max(0, Math.min(100, Number(e.target.value))) / 100)}
                      className="w-full h-2 accent-primary bg-transparent"
                    />
                    <div className="text-xs w-8 text-right">{Math.round(soundVolume * 100)}%</div>
                  </div>
                </div>

                <div className="flex-1">
                  <div className="text-sm font-medium">Voice</div>
                  <div className="flex items-center gap-2 mt-1">
                    <input
                      type="range"
                      min={0}
                      max={100}
                      value={Math.round(voiceVolume * 100)}
                      onChange={(e) => setVoiceVolume(Math.max(0, Math.min(100, Number(e.target.value))) / 100)}
                      className="w-full h-2 accent-primary bg-transparent"
                    />
                    <div className="text-xs w-8 text-right">{Math.round(voiceVolume * 100)}%</div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleTogglePause}
                    disabled={!!gameState?.gameEnded}
                    className={`px-3 py-1 rounded hover:bg-muted/10 ${gameState?.paused ? 'bg-yellow-500 text-white' : 'bg-transparent'}`}
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
            <div className="mt-4">
              <h2 className="text-lg font-semibold">История ходов</h2>
              <div className="mt-2 flex flex-col gap-2 max-h-[30vh] overflow-auto history-scroll">
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

          <main className="flex-1 flex flex-col items-center justify-center gap-4 relative">
            <ValidationMessage
              message={validationMessage}
              isValidating={isValidating}
              isError={isError}
            />
            {/* placedWordStatuses moved to sidebar below timer */}
              <GameBoard
                board={clientBoardState || gameState.board}
                placedTiles={placedTiles}
                typingCursor={typingCursor}
                placedWordStatuses={placedWordStatuses}
                lastMovePositions={lastMovePositions}
                previews={gameState?.previews || {}}
                onSquareClick={handleSquareClick}
                onTileDrop={async (row: number, col: number, data: any) => {
                  if (!gameState) return;

                  const currentPlayer = getCurrentPlayer();
                  if (!currentPlayer) return;

                  const boardToCheck = clientBoardState || gameState.board;
                  const rackToCheck = clientRackState || currentPlayer.rack;

                  try {
                    if (data?.source === 'rack') {
                      const index = data.index as number;
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
                        if (isCurrentPlayer) playSound('tile.mp3');
                        return;
                      }

                      // If target occupied -> check if it's a tile placed this turn (can swap) or old tile (cannot replace)
                      const replacedPlaced = placedTiles.find(t => t.row === row && t.col === col);
                      if (!replacedPlaced) {
                        // Target has an old tile from previous turns - cannot replace it
                        return;
                      }

                      // Target has a tile placed this turn -> swap: place rack tile on board, move replaced tile into rack slot (client-side only)
                      const replaced = targetLetter;
                      const replacedIsBlank = !!replacedPlaced?.blank;

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

                      // update placedTiles: adjust positions and preserve blank flags
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
                      return;
                    }
                  } catch (err) {
                    console.error('[Drop] error', err);
                  }
                }}
              />
              
          </main>

          <aside className="lg:w-80 flex flex-col gap-4">
            {(//isCurrentPlayer && (
              <>
                <div className="flex items-center justify-between gap-2">
                  <GameTimer timeLeft={timeLeft} totalTime={MOVE_TIME} />
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
                    Фишек в мешке: <span className="font-semibold">{gameState.tileBag.length}</span>
                  </div>
                )}

                {/* Active placed-word status */}
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

                <div className="mt-4">
                  <h3 className="text-sm font-semibold mb-2">Проверить слово</h3>
                  <div className="flex gap-2">
                    <Input
                      placeholder="Введите слово"
                      value={wordToCheck}
                      onChange={(e) => setWordToCheck(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          handleCheckWord();
                        }
                      }}
                      data-testid="input-check-word"
                    />
                    <Button
                      onClick={handleCheckWord}
                      disabled={isCheckingWord || !!gameState?.gameEnded}
                    >
                      {isCheckingWord ? 'Проверка...' : 'Проверить'}
                    </Button>
                  </div>
                  {wordCheckResult && (
                    <div className={`mt-2 text-sm font-medium ${wordCheckResult.valid ? 'text-green-700' : 'text-red-700'}`} data-testid="check-result">
                      <div>{wordCheckResult.word} — {wordCheckResult.valid ? 'В словаре' : 'Не найдено'}</div>
                      {wordCheckResult.extract ? (
                        <>
                          <div className="mt-1 text-xs text-muted-foreground whitespace-pre-wrap">{wordCheckResult.extract}</div>
                          <div className="mt-1 text-xs">
                            <a
                              href={`https://ru.wiktionary.org/wiki/${encodeURIComponent(wordCheckResult.word.toLowerCase())}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-sm text-primary underline"
                              data-testid="link-more"
                            >
                              Подробнее
                            </a>
                          </div>
                        </>
                      ) : (
                        <div className="mt-1 text-xs">
                          <a
                            href={`https://ru.wiktionary.org/wiki/${encodeURIComponent(wordCheckResult.word)}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-sm text-primary underline"
                            data-testid="link-more"
                          >
                            Подробнее
                          </a>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                <div>
                  <h2 className="text-lg font-semibold mb-4">Ваши фишки</h2>
                  <TileRack
                    rack={rackView || clientRackState || getCurrentPlayer()?.rack || []}
                    selectedTileIndex={selectedTileIndex}
                    selectedIndices={discardMode ? selectedDiscardIndices : undefined}
                    onTileClick={handleTileClick}
                    onShuffle={handleShuffle}
                    onRecall={handleRecall}
                    onReorder={handleReorderRack}
                    onDropFromBoard={handleDropFromBoard}
                    // Disable interactions when the game has ended
                    canInteract={!isJoining && !gameState?.gameEnded}
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

