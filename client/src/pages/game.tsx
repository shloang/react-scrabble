import { useState, useEffect, useRef, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { MOVE_TIME, Player, PlacedTile, GameState, TILE_VALUES } from '@shared/schema';
import { getGameState, joinGame as joinGameApi, updateGameState, validateWord } from '@/lib/gameApi';
import { extractWordsFromBoard, calculateScore, validatePlacement } from '@/lib/gameLogic';
import GameBoard from '@/components/GameBoard';
import PlayerCard from '@/components/PlayerCard';
import TileRack from '@/components/TileRack';
import BlankAssignDialog from '@/components/BlankAssignDialog';
import GameTimer from '@/components/GameTimer';
import JoinGameDialog from '@/components/JoinGameDialog';
import ValidationMessage from '@/components/ValidationMessage';
import EndGameScreen from '@/components/EndGameScreen';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { CheckCircle, SkipForward, Sun, Moon } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

export default function Game() {
  const [playerId, setPlayerId] = useState<string | null>(null);
  const [isJoining, setIsJoining] = useState(true);
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

  // Sound effects
  const playSound = (filename: string) => {
    try {
      const audio = new Audio(`/${filename}`);
      audio.volume = 0.5;
      audio.play().catch(err => console.error('Failed to play sound:', err));
    } catch (err) {
      console.error('Failed to load sound:', err);
    }
  };

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
  useEffect(() => { gameStateRef.current = gameState; }, [gameState]);

  const pendingPatchRef = useRef<{ board: Record<string, any>; rack: Record<number, any>; timer: number | null }>({ board: {}, rack: {}, timer: null });

  function schedulePatch(patch: { board?: Record<string, any>; rack?: Record<number, any> }) {
    // merge into pending patch
    if (patch.board) {
      for (const k of Object.keys(patch.board)) pendingPatchRef.current.board[k] = patch.board[k];
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

  // Play turn sound on all turn switches
  useEffect(() => {
    if (!gameState) return;
    
    // Check if turn just switched (currentPlayer changed)
    if (!gameState.gameEnded) {
      playSound('turn.mp3');
    }
    
    if (previousCurrentPlayer !== null && gameState.currentPlayer !== previousCurrentPlayer) {
      // playSound('turn.mp3');
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
  }, [gameState?.gameEnded, gameState?.winnerId, playerId, hasPlayedEndGameSound]);

  useEffect(() => {
    if (!gameState || !playerId) return;
    
    if (gameState.currentPlayer === playerId) {
      setHasPlayed20SecSound(false); // Reset when it becomes player's turn
      const timer = setInterval(() => {
        setTimeLeft(prev => {
          if (prev === 20) {
            // Play 20 second warning sound
            if (!hasPlayed20SecSound) {
              playSound('20sec.mp3');
              setHasPlayed20SecSound(true);
            }
          }
          if (prev <= 1) {
            handleSkipTurn();
            return MOVE_TIME;
          }
          return prev - 1;
        });
      }, 1000);
      return () => clearInterval(timer);
    } else {
      setTimeLeft(MOVE_TIME);
      setHasPlayed20SecSound(false);
    }
  }, [gameState?.currentPlayer, playerId, hasPlayed20SecSound]);

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
      const res = await validateWord(w.toLowerCase());
      setWordCheckResult({ word: w, valid: res.isValid, extract: res.extract || null });
      if (res.isValid) {
        toast({ title: 'Слово найдено', description: `${w} — валидно` });
      } else {
        toast({ variant: 'destructive', title: 'Слово не найдено', description: `${w} — невалидно` });
      }
    } catch (err) {
      toast({ variant: 'destructive', title: 'Ошибка проверки', description: 'Не удалось проверить слово' });
    } finally {
      setIsCheckingWord(false);
    }
  };

  // Auto-restore session from localStorage if possible
  useEffect(() => {
    (async () => {
      try {
        const savedId = localStorage.getItem('playerId');
        const savedName = localStorage.getItem('playerName');
        if (!savedId) return;

        const state = await getGameState();
        if (state && state.players.some(p => p.id === savedId)) {
          setPlayerId(savedId);
          setIsJoining(false);
          // trigger refetch for react-query
          refetch();
        } else {
          // keep joining open and let Join dialog prefill name
          setIsJoining(true);
        }
      } catch (err) {
        // ignore
      }
    })();
  }, []);

  // Sync dark mode with document root and localStorage
  useEffect(() => {
    try {
      if (isDark) document.documentElement.classList.add('dark');
      else document.documentElement.classList.remove('dark');
      localStorage.setItem('dark', isDark ? '1' : '0');
    } catch (err) {
      // ignore
    }
  }, [isDark]);

  const getCurrentPlayer = (): Player | undefined => {
    return gameState?.players.find(p => p.id === playerId);
  };

  // Compute client-side board state that merges server board with placed tiles
  const clientBoardState = useMemo(() => {
    if (!gameState) return null;
    const board = structuredClone(gameState.board);
    // Apply placed tiles to board for rendering
    placedTiles.forEach(tile => {
      board[tile.row][tile.col] = { letter: tile.letter, blank: !!tile.blank } as any;
    });
    return board;
  }, [gameState, placedTiles]);

  // Compute client-side rack state that reflects tiles removed for placed tiles
  const clientRackState = useMemo(() => {
    if (!gameState || !playerId) return null;
    const currentPlayer = getCurrentPlayer();
    if (!currentPlayer) return null;
    const rack = [...currentPlayer.rack];
    // Remove tiles from rack that are in placedTiles
    placedTiles.forEach(tile => {
      // First try to find from typedSequence
      const typedEntry = typedSequence.find(t => t.row === tile.row && t.col === tile.col);
      if (typedEntry && typedEntry.fromRackIndex >= 0 && typedEntry.fromRackIndex < rack.length) {
        rack[typedEntry.fromRackIndex] = null;
      } else {
        // Fallback: find first matching tile in rack
        const tileLetter = tile.blank ? '?' : tile.letter;
        const rackIndex = rack.findIndex((r, idx) => r === tileLetter && rack[idx] !== null);
        if (rackIndex !== -1) {
          rack[rackIndex] = null;
        }
      }
    });
    return rack;
  }, [gameState, playerId, placedTiles, typedSequence]);

  // Validate placed words as they change and update statuses (with debouncing to prevent API spam)
  useEffect(() => {
    let cancelled = false;
    const timeoutId = setTimeout(async () => {
      if (!gameState || placedTiles.length === 0) {
        setPlacedWordStatuses([]);
        return;
      }

      // Use client board state for validation
      const boardForValidation = clientBoardState || gameState.board;
      const words = extractWordsFromBoard(boardForValidation, placedTiles);
      if (words.length === 0) {
        setPlacedWordStatuses([]);
        return;
      }

      // initialize statuses as checking
      const initial = words.map(w => ({ word: w.word, positions: w.positions, status: 'checking' as const }));
      setPlacedWordStatuses(initial);

      // Validate each word via API
      await Promise.all(words.map(async (w, idx) => {
        try {
          const r = await validateWord(w.word.toLowerCase());
          const valid = r.isValid;
          if (cancelled) return;
          setPlacedWordStatuses(prev => {
            const next = [...prev];
            const found = next.find(p => p.word === w.word && JSON.stringify(p.positions) === JSON.stringify(w.positions));
            if (found) {
              found.status = valid ? 'valid' : 'invalid';
            } else {
              next.push({ word: w.word, positions: w.positions, status: valid ? 'valid' : 'invalid' });
            }
            return next;
          });
        } catch (err) {
          if (cancelled) return;
          setPlacedWordStatuses(prev => prev.map(p => p.word === w.word ? { ...p, status: 'invalid' } : p));
        }
      }));
    }, 500); // Debounce for 500ms to prevent API spam

    return () => { 
      cancelled = true;
      clearTimeout(timeoutId);
    };
  }, [placedTiles, gameState, clientBoardState]);

  // Keyboard typing handler when typingCursor is active
  useEffect(() => {
    const handler = async (e: KeyboardEvent) => {
      if (!typingCursor) return;
      if (!gameState || gameState.currentPlayer !== playerId) return;

      const currentPlayer = getCurrentPlayer();
      if (!currentPlayer) return;

      // Backspace -> undo last typed placement (client-side only)
      if (e.key === 'Backspace') {
        e.preventDefault();
        if (typedSequence.length === 0) return;
        const last = typedSequence[typedSequence.length - 1];

        // update local placedTiles and typedSequence (client-side only)
        setPlacedTiles(prev => prev.filter(t => !(t.row === last.row && t.col === last.col)));
        setTypedSequence(prev => prev.slice(0, -1));

        // move cursor back to last removed cell (or keep pointing at that cell when none left)
        if (typedSequence.length > 1) {
          const prev = typedSequence[typedSequence.length - 2];
          setTypingCursor({ row: prev.row, col: prev.col, direction: typingCursor.direction });
        } else {
          // keep the arrow at the last-removed position instead of clearing it
          setTypingCursor({ row: last.row, col: last.col, direction: typingCursor.direction });
        }
        return;
      }

      if (e.key === 'Escape') {
        setTypingCursor(null);
        setTypedSequence([]);
        return;
      }

      const letterKey = e.key;
      // accept letters (Latin or Cyrillic)
      if (!letterKey || !/^[A-Za-zА-ЯЁа-яё]$/u.test(letterKey)) return;
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
      while (r >= 0 && r < 15 && c >= 0 && c < 15 && boardToCheck[r][c] !== null) {
        advance();
      }

      if (!(r >= 0 && r < 15 && c >= 0 && c < 15)) {
        // out of board
        setTypingCursor(null);
        return;
      }

      // find tile in rack matching letter or wildcard (use client rack state)
      const rackToCheck = clientRackState || currentPlayer.rack;
      const rackIndexExact = rackToCheck.findIndex(t => t === letter);
      const rackIndexBlank = rackToCheck.findIndex(t => t === '?');
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

      if (nr >= 0 && nr < 15 && nc >= 0 && nc < 15) {
        setTypingCursor({ row: nr, col: nc, direction: typingCursor.direction });
      } else {
        setTypingCursor(null);
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [typingCursor, gameState, placedTiles, typedSequence, playerId, clientBoardState, clientRackState]);

  // Listen for rack reorder events dispatched from TileRack
  // (no global event usage now)

  const handleSquareClick = async (row: number, col: number) => {
    if (!gameState || gameState.currentPlayer !== playerId) return;
    
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
    if (!gameState || gameState.currentPlayer !== playerId) return;
    if (from === to) return;
    
    // Rack reordering is visual only - actual rack state comes from server
    // We don't need to update server for this as it's just UI reordering
    // Update local selected index if necessary
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
    if (!gameState || gameState.currentPlayer !== playerId) return;
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
    const currentPlayer = getCurrentPlayer();
    if (!currentPlayer) return;

    const newState = structuredClone(gameState);
    const newPlayer = newState.players.find(p => p.id === playerId);
    if (!newPlayer) return;

    placedTiles.forEach(({ row, col, letter, blank }) => {
      newState.board[row][col] = null;
      const emptyIndex = newPlayer.rack.findIndex(t => t === null);
      if (emptyIndex !== -1) {
        newPlayer.rack[emptyIndex] = blank ? '?' : letter;
      }
    });

    setPlacedTiles([]);
    setTypedSequence([]);
    setSelectedTileIndex(null);
    await updateMutation.mutateAsync(newState);
  };

  const handleSubmitMove = async () => {
    if (!gameState || gameState.currentPlayer !== playerId || placedTiles.length === 0) return;

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
        playerId: playerId,
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

  const handleSkipTurn = async () => {
    if (!gameState || gameState.currentPlayer !== playerId) return;

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
      playerId: playerId,
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

    // Return discarded to bag and shuffle
    if (discarded.length > 0) {
      newState.tileBag.push(...discarded);
      shuffleArray(newState.tileBag);
    }

    // Draw replacements
    for (const idx of indices) {
      if (newState.tileBag.length > 0) {
        newPlayer.rack[idx] = newState.tileBag.shift() || null;
      } else {
        newPlayer.rack[idx] = null;
      }
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
        playerId: playerId,
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

  const isCurrentPlayer = gameState?.currentPlayer === playerId;

  return (
    <div className="min-h-screen bg-background">
      <JoinGameDialog
        open={isJoining}
        playerCount={gameState?.players.length || 0}
        onJoin={handleJoinGame}
        defaultName={typeof window !== 'undefined' ? localStorage.getItem('playerName') || undefined : undefined}
        error={joinError}
        isLoading={joinMutation.isLoading}
      />
      <BlankAssignDialog open={isBlankDialogOpen} defaultValue={''} onConfirm={handleConfirmBlank} onCancel={handleCancelBlank} />

      {!isJoining && gameState && (
        <>
          {gameState.gameEnded && (
            <EndGameScreen 
              gameState={gameState} 
              currentPlayerId={playerId}
              onNewGame={() => {
                // Reset game - could add API call here
                window.location.reload();
              }}
            />
          )}
          <div className="h-screen flex flex-col lg:flex-row gap-4 p-4">
          <aside className="lg:w-72 flex flex-col gap-4">
            <h1 className="text-2xl font-bold">Игроки</h1>
            {gameState.players.map((player, index) => (
              <PlayerCard
                key={player.id}
                player={player}
                isCurrentPlayer={player.id === gameState.currentPlayer}
                playerIndex={index}
              />
            ))}
            <div className="mt-4">
              <h2 className="text-lg font-semibold">История ходов</h2>
              <div className="mt-2 flex flex-col gap-2 max-h-[40vh] overflow-auto">
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
                onSquareClick={handleSquareClick}
                onTileDrop={async (row: number, col: number, data: any) => {
                  if (!gameState || gameState.currentPlayer !== playerId) return;

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
                      disabled={isCheckingWord}
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
                    rack={clientRackState || getCurrentPlayer()?.rack || []}
                      selectedTileIndex={selectedTileIndex}
                      selectedIndices={discardMode ? selectedDiscardIndices : undefined}
                    onTileClick={handleTileClick}
                    onShuffle={handleShuffle}
                    onRecall={handleRecall}
                    onReorder={handleReorderRack}
                    onDropFromBoard={handleDropFromBoard}
                    canInteract={isCurrentPlayer}
                  />
                </div>
                  <div className="flex flex-col gap-2">
                    {!discardMode ? (
                      <>
                        <Button
                          size="lg"
                          onClick={handleSubmitMove}
                          disabled={placedTiles.length === 0 || isValidating}
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
                          disabled={isValidating}
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
                          disabled={isValidating || (gameState && gameState.tileBag.length === 0)}
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
                            disabled={selectedDiscardIndices.length === 0 || isValidating}
                            className="flex-1"
                            data-testid="button-confirm-swap"
                          >
                            Подтвердить обмен
                          </Button>
                          <Button
                            variant="outline"
                            size="lg"
                            onClick={handleCancelDiscard}
                            disabled={isValidating}
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
