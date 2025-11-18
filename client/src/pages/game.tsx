import { useState, useEffect } from 'react';
import { BOARD_SIZE, TILE_DISTRIBUTION, MOVE_TIME, Player, PlacedTile, GameState } from '@shared/schema';
import GameBoard from '@/components/GameBoard';
import PlayerCard from '@/components/PlayerCard';
import TileRack from '@/components/TileRack';
import GameTimer from '@/components/GameTimer';
import JoinGameDialog from '@/components/JoinGameDialog';
import ValidationMessage from '@/components/ValidationMessage';
import { Button } from '@/components/ui/button';
import { CheckCircle, SkipForward } from 'lucide-react';

export default function Game() {
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [playerId, setPlayerId] = useState<string | null>(null);
  const [isJoining, setIsJoining] = useState(true);
  const [selectedTileIndex, setSelectedTileIndex] = useState<number | null>(null);
  const [placedTiles, setPlacedTiles] = useState<PlacedTile[]>([]);
  const [timeLeft, setTimeLeft] = useState(MOVE_TIME);
  const [validationMessage, setValidationMessage] = useState('');
  const [isValidating, setIsValidating] = useState(false);
  const [isError, setIsError] = useState(false);

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

  const initializeGame = () => {
    const bag: string[] = [];
    Object.entries(TILE_DISTRIBUTION).forEach(([letter, count]) => {
      for (let i = 0; i < count; i++) {
        bag.push(letter);
      }
    });
    shuffleArray(bag);

    const newGameState: GameState = {
      board: Array(BOARD_SIZE).fill(null).map(() => Array(BOARD_SIZE).fill(null)),
      tileBag: bag,
      players: [],
      currentPlayer: null,
      turn: 0
    };

    setGameState(newGameState);
  };

  const shuffleArray = (array: string[]) => {
    for (let i = array.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [array[i], array[j]] = [array[j], array[i]];
    }
  };

  const handleJoinGame = (name: string) => {
    let state = gameState;
    if (!state) {
      const bag: string[] = [];
      Object.entries(TILE_DISTRIBUTION).forEach(([letter, count]) => {
        for (let i = 0; i < count; i++) {
          bag.push(letter);
        }
      });
      shuffleArray(bag);

      state = {
        board: Array(BOARD_SIZE).fill(null).map(() => Array(BOARD_SIZE).fill(null)),
        tileBag: bag,
        players: [],
        currentPlayer: null,
        turn: 0
      };
    }

    if (state.players.length >= 3) return;

    const newPlayerId = `player_${Date.now()}_${Math.random()}`;
    const rack: (string | null)[] = state.tileBag.splice(0, 7);
    while (rack.length < 7) rack.push(null);

    const newPlayer: Player = {
      id: newPlayerId,
      name,
      rack,
      score: 0
    };

    state.players.push(newPlayer);
    if (state.players.length === 1) {
      state.currentPlayer = newPlayerId;
    }

    setGameState({ ...state });
    setPlayerId(newPlayerId);
    setIsJoining(false);
    setTimeLeft(MOVE_TIME);
  };

  const getCurrentPlayer = (): Player | undefined => {
    return gameState?.players.find(p => p.id === playerId);
  };

  const handleSquareClick = (row: number, col: number) => {
    if (!gameState || gameState.currentPlayer !== playerId) return;
    
    const currentPlayer = getCurrentPlayer();
    if (!currentPlayer) return;

    if (selectedTileIndex !== null && gameState.board[row][col] === null) {
      const letter = currentPlayer.rack[selectedTileIndex];
      if (!letter) return;

      const newState = { ...gameState };
      newState.board[row][col] = letter;
      currentPlayer.rack[selectedTileIndex] = null;
      
      setPlacedTiles([...placedTiles, { row, col, letter }]);
      setSelectedTileIndex(null);
      setGameState(newState);
    } else if (gameState.board[row][col] !== null && placedTiles.some(t => t.row === row && t.col === col)) {
      const tile = placedTiles.find(t => t.row === row && t.col === col);
      if (!tile) return;

      const newState = { ...gameState };
      newState.board[row][col] = null;
      
      const emptyIndex = currentPlayer.rack.findIndex(t => t === null);
      if (emptyIndex !== -1) {
        currentPlayer.rack[emptyIndex] = tile.letter;
      }
      
      setPlacedTiles(placedTiles.filter(t => !(t.row === row && t.col === col)));
      setGameState(newState);
    }
  };

  const handleTileClick = (index: number) => {
    setSelectedTileIndex(selectedTileIndex === index ? null : index);
  };

  const handleShuffle = () => {
    if (!gameState || gameState.currentPlayer !== playerId) return;
    const currentPlayer = getCurrentPlayer();
    if (!currentPlayer) return;

    const nonNullTiles = currentPlayer.rack.filter(t => t !== null) as string[];
    shuffleArray(nonNullTiles);
    const newRack = [...currentPlayer.rack];
    let idx = 0;
    for (let i = 0; i < newRack.length; i++) {
      if (newRack[i] !== null) {
        newRack[i] = nonNullTiles[idx++];
      }
    }
    currentPlayer.rack = newRack;
    setGameState({ ...gameState });
  };

  const handleRecall = () => {
    if (!gameState || placedTiles.length === 0) return;
    const currentPlayer = getCurrentPlayer();
    if (!currentPlayer) return;

    placedTiles.forEach(({ row, col, letter }) => {
      gameState.board[row][col] = null;
      const emptyIndex = currentPlayer.rack.findIndex(t => t === null);
      if (emptyIndex !== -1) {
        currentPlayer.rack[emptyIndex] = letter;
      }
    });

    setPlacedTiles([]);
    setSelectedTileIndex(null);
    setGameState({ ...gameState });
  };

  const handleSubmitMove = async () => {
    if (!gameState || gameState.currentPlayer !== playerId || placedTiles.length === 0) return;

    setIsValidating(true);
    setValidationMessage('');
    setIsError(false);

    setTimeout(() => {
      const words = ['СЛОВО', 'ИГРА'];
      setValidationMessage(`Валидные слова: ${words.join(', ')}`);
      setIsValidating(false);
      
      const currentPlayer = getCurrentPlayer();
      if (currentPlayer) {
        currentPlayer.score += 25;
        
        for (let i = 0; i < currentPlayer.rack.length; i++) {
          if (currentPlayer.rack[i] === null && gameState.tileBag.length > 0) {
            currentPlayer.rack[i] = gameState.tileBag.shift() || null;
          }
        }

        const currentIndex = gameState.players.findIndex(p => p.id === playerId);
        const nextIndex = (currentIndex + 1) % gameState.players.length;
        gameState.currentPlayer = gameState.players[nextIndex].id;
        gameState.turn += 1;

        setPlacedTiles([]);
        setSelectedTileIndex(null);
        setGameState({ ...gameState });
        setTimeLeft(MOVE_TIME);
      }

      setTimeout(() => setValidationMessage(''), 3000);
    }, 1500);
  };

  const handleSkipTurn = () => {
    if (!gameState || gameState.currentPlayer !== playerId) return;

    handleRecall();

    const currentIndex = gameState.players.findIndex(p => p.id === playerId);
    const nextIndex = (currentIndex + 1) % gameState.players.length;
    gameState.currentPlayer = gameState.players[nextIndex].id;
    gameState.turn += 1;

    setGameState({ ...gameState });
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
