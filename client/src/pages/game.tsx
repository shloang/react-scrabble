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
import { CheckCircle, SkipForward } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

export default function Game() {
  const [playerId, setPlayerId] = useState<string | null>(null);
  const [isJoining, setIsJoining] = useState(true);
  const [selectedTileIndex, setSelectedTileIndex] = useState<number | null>(null);
  const [placedTiles, setPlacedTiles] = useState<PlacedTile[]>([]);
  const [timeLeft, setTimeLeft] = useState(MOVE_TIME);
  const [validationMessage, setValidationMessage] = useState('');
  const [isValidating, setIsValidating] = useState(false);
  const [isError, setIsError] = useState(false);
  const { toast } = useToast();

  // Poll for game state
  const { data: gameState, refetch } = useQuery<GameState | null>({
    queryKey: ['/api/game'],
    refetchInterval: 2000,
    enabled: !isJoining
  });

  const joinMutation = useMutation({
    mutationFn: (playerName: string) => joinGameApi(playerName),
    onSuccess: (data) => {
      setPlayerId(data.playerId);
      setIsJoining(false);
      setTimeLeft(MOVE_TIME);
      refetch();
    },
    onError: (error: Error) => {
      toast({
        variant: "destructive",
        title: "Ошибка",
        description: error.message
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

  const handleJoinGame = (name: string) => {
    joinMutation.mutate(name);
  };

  const getCurrentPlayer = (): Player | undefined => {
    return gameState?.players.find(p => p.id === playerId);
  };

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

    await updateMutation.mutateAsync(newState);
    setTimeLeft(MOVE_TIME);
  };

  const isCurrentPlayer = gameState?.currentPlayer === playerId;

  return (
    <div className="min-h-screen bg-background">
      <JoinGameDialog
        open={isJoining}
        playerCount={gameState?.players.length || 0}
        onJoin={handleJoinGame}
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
          </aside>

          <main className="flex-1 flex flex-col items-center justify-center gap-4 relative">
            <ValidationMessage
              message={validationMessage}
              isValidating={isValidating}
              isError={isError}
            />
            <GameBoard
              board={gameState.board}
              placedTiles={placedTiles}
              onSquareClick={handleSquareClick}
            />
          </main>

          <aside className="lg:w-80 flex flex-col gap-4">
            {isCurrentPlayer && (
              <>
                <GameTimer timeLeft={timeLeft} totalTime={MOVE_TIME} />
                
                <div>
                  <h2 className="text-lg font-semibold mb-4">Ваши фишки</h2>
                  <TileRack
                    rack={getCurrentPlayer()?.rack || []}
                    selectedTileIndex={selectedTileIndex}
                    onTileClick={handleTileClick}
                    onShuffle={handleShuffle}
                    onRecall={handleRecall}
                    canInteract={isCurrentPlayer}
                  />
                </div>

                <div className="flex flex-col gap-2">
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
