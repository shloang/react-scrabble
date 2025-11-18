import { useState, useEffect } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { MOVE_TIME, Player, PlacedTile, GameState } from '@shared/schema';
import { getGameState, joinGame as joinGameApi, updateGameState, validateWord } from '@/lib/gameApi';
import { extractWordsFromBoard, calculateScore, validatePlacement } from '@/lib/gameLogic';
import GameBoard from '@/components/GameBoard';
import PlayerCard from '@/components/PlayerCard';
import TileRack from '@/components/TileRack';
import GameTimer from '@/components/GameTimer';
import JoinGameDialog from '@/components/JoinGameDialog';
import ValidationMessage from '@/components/ValidationMessage';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { CheckCircle, SkipForward } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

export default function Game() {
  const [playerId, setPlayerId] = useState<string | null>(null);
  const [isJoining, setIsJoining] = useState(true);
  const [selectedTileIndex, setSelectedTileIndex] = useState<number | null>(null);
  const [discardMode, setDiscardMode] = useState(false);
  const [selectedDiscardIndices, setSelectedDiscardIndices] = useState<number[]>([]);
  const [placedTiles, setPlacedTiles] = useState<PlacedTile[]>([]);
  const [placedWordStatuses, setPlacedWordStatuses] = useState<{
    word: string;
    positions: { row: number; col: number }[];
    status: 'valid' | 'invalid' | 'checking';
  }[]>([]);
  const [timeLeft, setTimeLeft] = useState(MOVE_TIME);
  const [validationMessage, setValidationMessage] = useState('');
  const [isValidating, setIsValidating] = useState(false);
  const [isError, setIsError] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);
  const [wordToCheck, setWordToCheck] = useState('');
  const [isCheckingWord, setIsCheckingWord] = useState(false);
  const [wordCheckResult, setWordCheckResult] = useState<null | { word: string; valid: boolean }>(null);
  const { toast } = useToast();

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

  const updateMutation = useMutation({
    mutationFn: (state: GameState) => updateGameState(state),
    onSuccess: async () => {
      console.log('[Update] Mutation successful, refetching...');
      await refetch();
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

  useEffect(() => {
    if (!gameState || !playerId) return;
    
    if (gameState.currentPlayer === playerId) {
      const timer = setInterval(() => {
        setTimeLeft(prev => {
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
    }
  }, [gameState?.currentPlayer, playerId]);

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
      const valid = await validateWord(w.toLowerCase());
      setWordCheckResult({ word: w, valid });
      if (valid) {
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

  const getCurrentPlayer = (): Player | undefined => {
    return gameState?.players.find(p => p.id === playerId);
  };

  // Validate placed words as they change and update statuses
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!gameState || placedTiles.length === 0) {
        setPlacedWordStatuses([]);
        return;
      }

      const words = extractWordsFromBoard(gameState.board, placedTiles);
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
          const valid = await validateWord(w.word.toLowerCase());
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
    })();
    return () => { cancelled = true; };
  }, [placedTiles, gameState]);

  const handleSquareClick = async (row: number, col: number) => {
    if (!gameState || gameState.currentPlayer !== playerId) return;
    
    const currentPlayer = getCurrentPlayer();
    if (!currentPlayer) return;

    if (selectedTileIndex !== null && gameState.board[row][col] === null) {
      const letter = currentPlayer.rack[selectedTileIndex];
      if (!letter) return;

      const newState = structuredClone(gameState);
      const newPlayer = newState.players.find(p => p.id === playerId);
      if (!newPlayer) return;

      newState.board[row][col] = letter;
      newPlayer.rack[selectedTileIndex] = null;
      
      console.log('[Placement] Placing tile', letter, 'at', row, col);
      setPlacedTiles([...placedTiles, { row, col, letter }]);
      setSelectedTileIndex(null);
      await updateMutation.mutateAsync(newState);
    } else if (gameState.board[row][col] !== null && placedTiles.some(t => t.row === row && t.col === col)) {
      const tile = placedTiles.find(t => t.row === row && t.col === col);
      if (!tile) return;

      const newState = structuredClone(gameState);
      const newPlayer = newState.players.find(p => p.id === playerId);
      if (!newPlayer) return;

      newState.board[row][col] = null;
      
      const emptyIndex = newPlayer.rack.findIndex(t => t === null);
      if (emptyIndex !== -1) {
        newPlayer.rack[emptyIndex] = tile.letter;
      }
      
      console.log('[Removal] Removing tile from', row, col);
      setPlacedTiles(placedTiles.filter(t => !(t.row === row && t.col === col)));
      await updateMutation.mutateAsync(newState);
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

  const handleShuffle = async () => {
    if (!gameState || gameState.currentPlayer !== playerId) return;
    const currentPlayer = getCurrentPlayer();
    if (!currentPlayer) return;

    const newState = structuredClone(gameState);
    const newPlayer = newState.players.find(p => p.id === playerId);
    if (!newPlayer) return;

    const nonNullTiles = newPlayer.rack.filter(t => t !== null) as string[];
    shuffleArray(nonNullTiles);
    let idx = 0;
    for (let i = 0; i < newPlayer.rack.length; i++) {
      if (newPlayer.rack[i] !== null) {
        newPlayer.rack[i] = nonNullTiles[idx++];
      }
    }
    
    console.log('[Shuffle] Shuffling rack');
    await updateMutation.mutateAsync(newState);
  };

  const handleRecall = async () => {
    if (!gameState || placedTiles.length === 0) return;
    const currentPlayer = getCurrentPlayer();
    if (!currentPlayer) return;

    const newState = structuredClone(gameState);
    const newPlayer = newState.players.find(p => p.id === playerId);
    if (!newPlayer) return;

    placedTiles.forEach(({ row, col, letter }) => {
      newState.board[row][col] = null;
      const emptyIndex = newPlayer.rack.findIndex(t => t === null);
      if (emptyIndex !== -1) {
        newPlayer.rack[emptyIndex] = letter;
      }
    });

    setPlacedTiles([]);
    setSelectedTileIndex(null);
    await updateMutation.mutateAsync(newState);
  };

  const handleSubmitMove = async () => {
    if (!gameState || gameState.currentPlayer !== playerId || placedTiles.length === 0) return;

    // Validate placement
    const placementValidation = validatePlacement(gameState.board, placedTiles);
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
      // Extract all words formed
      const words = extractWordsFromBoard(gameState.board, placedTiles);
      
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
        words.map(async ({ word }) => ({
          word,
          valid: await validateWord(word.toLowerCase())
        }))
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

      // Calculate score
      const score = calculateScore(words, gameState.board, placedTiles);
      
      const newState = structuredClone(gameState);
      const currentPlayer = newState.players.find(p => p.id === playerId);
      if (!currentPlayer) return;

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
        meta: null
      });

      await updateMutation.mutateAsync(newState);

      setPlacedTiles([]);
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
    if (!gameState || gameState.currentPlayer !== playerId) return;
    const currentPlayer = getCurrentPlayer();
    if (!currentPlayer) return;
    if (selectedDiscardIndices.length === 0) return;

    const newState = structuredClone(gameState);
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

      {!isJoining && gameState && (
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
                        <span>{m.words.join(', ')}</span>
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
              <GameBoard
                board={gameState.board}
                placedTiles={placedTiles}
                placedWordStatuses={placedWordStatuses}
                onSquareClick={handleSquareClick}
                onTileDrop={async (row: number, col: number, data: any) => {
                  if (!gameState || gameState.currentPlayer !== playerId) return;

                  const currentPlayer = getCurrentPlayer();
                  if (!currentPlayer) return;

                  try {
                    if (data?.source === 'rack') {
                      const index = data.index as number;
                      const letter = currentPlayer.rack[index];
                      if (!letter) return;
                      if (gameState.board[row][col] !== null) return;

                      const newState = structuredClone(gameState);
                      const newPlayer = newState.players.find(p => p.id === playerId);
                      if (!newPlayer) return;

                      newState.board[row][col] = letter;
                      newPlayer.rack[index] = null;

                      setPlacedTiles([...placedTiles, { row, col, letter }]);
                      setSelectedTileIndex(null);
                      await updateMutation.mutateAsync(newState);
                    } else if (data?.source === 'board') {
                      const fromRow = data.fromRow as number;
                      const fromCol = data.fromCol as number;
                      if (gameState.board[row][col] !== null) return;

                      // Only allow moving tiles that were placed this turn (in placedTiles)
                      const tile = placedTiles.find(t => t.row === fromRow && t.col === fromCol);
                      if (!tile) return;

                      const newState = structuredClone(gameState);
                      newState.board[fromRow][fromCol] = null;
                      newState.board[row][col] = tile.letter;

                      const newPlaced = placedTiles.map(t => {
                        if (t.row === fromRow && t.col === fromCol) {
                          return { ...t, row, col };
                        }
                        return t;
                      });

                      setPlacedTiles(newPlaced);
                      await updateMutation.mutateAsync(newState);
                    }
                  } catch (err) {
                    console.error('[Drop] error', err);
                  }
                }}
              />
          </main>

          <aside className="lg:w-80 flex flex-col gap-4">
            {isCurrentPlayer && (
              <>
                <GameTimer timeLeft={timeLeft} totalTime={MOVE_TIME} />

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
                      {wordCheckResult.word} — {wordCheckResult.valid ? 'В словаре' : 'Не найдено'}
                    </div>
                  )}
                </div>

                <div>
                  <h2 className="text-lg font-semibold mb-4">Ваши фишки</h2>
                  <TileRack
                    rack={getCurrentPlayer()?.rack || []}
                      selectedTileIndex={selectedTileIndex}
                      selectedIndices={discardMode ? selectedDiscardIndices : undefined}
                    onTileClick={handleTileClick}
                    onShuffle={handleShuffle}
                    onRecall={handleRecall}
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
                          disabled={isValidating}
                          className="w-full"
                          data-testid="button-swap"
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
            {!isCurrentPlayer && (
              <div className="text-center text-muted-foreground p-8">
                <p>Ожидание хода другого игрока...</p>
              </div>
            )}
          </aside>
        </div>
      )}
    </div>
  );
}
