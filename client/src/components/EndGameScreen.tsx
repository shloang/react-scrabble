import { GameState, Player, Move } from "@shared/schema";
import { useEffect } from 'react';
import { Card } from "@/components/ui/card";
import { Trophy, Award, Target, BookOpen } from "lucide-react";

interface EndGameScreenProps {
  gameState: GameState;
  currentPlayerId: string | null;
  onNewGame?: () => void;
  onClose?: () => void;
  onMinimize?: () => void;
}

export default function EndGameScreen({ gameState, currentPlayerId, onNewGame, onClose, onMinimize }: EndGameScreenProps) {
  const winner = (gameState.players || []).find(p => p.id === gameState.winnerId) || null;
  const currentPlayer = (gameState.players || []).find(p => p.id === currentPlayerId) || null;
  const isWinner = winner?.id === currentPlayerId;

  // Calculate statistics
  const moves = gameState.moves || [];
  const playMoves = moves.filter(m => m.type === 'play') as Move[];
  
  // Highest scored move
  const highestMove = playMoves.reduce((prev, curr) => 
    curr.score > prev.score ? curr : prev, 
    { score: 0 } as Move
  );

  // Highest scored single word (approximate - use move score if only one word, otherwise divide)
  let highestWord = { word: '', score: 0, move: null as Move | null };
  for (const move of playMoves) {
    if (move.words.length === 1) {
      if (move.score > highestWord.score) {
        highestWord = { word: move.words[0], score: move.score, move };
      }
    } else if (move.words.length > 1) {
      // Approximate: divide score by number of words (not perfect but gives an idea)
      const avgScore = Math.round(move.score / move.words.length);
      for (const word of move.words) {
        if (avgScore > highestWord.score) {
          highestWord = { word, score: avgScore, move };
        }
      }
    }
  }

  // Longest word
  let longestWord = { word: '', length: 0, move: null as Move | null };
  for (const move of playMoves) {
    for (const word of move.words) {
      if (word.length > longestWord.length) {
        longestWord = { word, length: word.length, move };
      }
    }
  }

  // allow backdrop click or escape key to close when `onClose` is provided
  useEffect(() => {
    if (!onClose) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-start justify-center z-50 p-3 sm:p-4 overflow-hidden"
      onClick={() => { if (onClose) onClose(); }}
    >
      <Card className="relative max-w-4xl w-full max-h-[calc(100dvh-1.5rem)] sm:max-h-[calc(100dvh-2rem)] overflow-y-auto p-4 sm:p-6 lg:p-8 space-y-4 sm:space-y-6" onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 z-10 -mt-2 -mr-2 flex justify-end gap-2">
          {onMinimize && (
            <button
              aria-label="Minimize"
              onClick={onMinimize}
              className="p-2 rounded-md hover:bg-muted/20"
              title="Свернуть"
            >
              —
            </button>
          )}
          {onClose && (
            <button
              aria-label="Close"
              onClick={onClose}
              className="p-2 rounded-md hover:bg-muted/20"
              title="Закрыть"
            >
              ✕
            </button>
          )}
        </div>
        <div className="text-center">
          <div className={`text-5xl sm:text-6xl mb-3 sm:mb-4 ${isWinner ? 'text-yellow-500' : 'text-gray-400'}`}>
            {isWinner ? '🏆' : '😔'}
          </div>
          <h1 className="text-2xl sm:text-4xl font-bold mb-2">
            {isWinner ? 'Поздравляем! Вы выиграли!' : 'Игра окончена'}
          </h1>
          {winner && (
            <p className="text-lg sm:text-2xl text-muted-foreground">
              Победитель: <span className="font-bold text-primary">{winner.name}</span> ({winner.score} очков)
            </p>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 sm:gap-4">
          <Card className="p-4">
            <div className="flex items-center gap-2 mb-2">
              <Trophy className="w-5 h-5 text-yellow-500" />
              <h3 className="font-semibold">Итоговые очки</h3>
            </div>
            <div className="space-y-3">
              {(gameState.players || []).slice().sort((a, b) => (b.score || 0) - (a.score || 0))
                .map((player, idx) => (
                  <div key={player.id} className="flex justify-between items-start">
                    <div>
                      <div className={player.id === gameState.winnerId ? 'font-bold' : ''}>
                        {idx + 1}. {player.name}
                      </div>
                      {(player.originalScore !== undefined || player.tilePenalty !== undefined) && (
                        <div className="text-xs text-muted-foreground mt-1 space-y-0.5">
                          {player.originalScore !== undefined && (
                            <div>Исходные: {player.originalScore} очков</div>
                          )}
                          {player.tilePenalty !== undefined && player.tilePenalty > 0 && (
                            <div className="text-red-600">Штраф за фишки: -{player.tilePenalty}</div>
                          )}
                        </div>
                      )}
                    </div>
                    <span className="font-semibold">{player.score || 0}</span>
                  </div>
                ))}
            </div>
          </Card>

          <Card className="p-4">
            <div className="flex items-center gap-2 mb-2">
              <Award className="w-5 h-5 text-blue-500" />
              <h3 className="font-semibold">Лучший ход</h3>
            </div>
            {highestMove.score > 0 ? (
              <div>
                <div className="text-2xl font-bold text-primary">{highestMove.score} очков</div>
                <div className="text-sm text-muted-foreground mt-1">
                  {highestMove.playerName}: {highestMove.words.join(', ')}
                </div>
              </div>
            ) : (
              <div className="text-muted-foreground">Нет данных</div>
            )}
          </Card>

          <Card className="p-4">
            <div className="flex items-center gap-2 mb-2">
              <Target className="w-5 h-5 text-green-500" />
              <h3 className="font-semibold">Лучшее слово</h3>
            </div>
            {highestWord.word ? (
              <div>
                <div className="text-2xl font-bold text-primary">{highestWord.word}</div>
                <div className="text-sm text-muted-foreground mt-1">
                  {highestWord.score} очков ({highestWord.move?.playerName})
                </div>
              </div>
            ) : (
              <div className="text-muted-foreground">Нет данных</div>
            )}
          </Card>

          <Card className="p-4">
            <div className="flex items-center gap-2 mb-2">
              <BookOpen className="w-5 h-5 text-purple-500" />
              <h3 className="font-semibold">Самое длинное слово</h3>
            </div>
            {longestWord.word ? (
              <div>
                <div className="text-2xl font-bold text-primary">{longestWord.word}</div>
                <div className="text-sm text-muted-foreground mt-1">
                  {longestWord.length} букв ({longestWord.move?.playerName})
                </div>
              </div>
            ) : (
              <div className="text-muted-foreground">Нет данных</div>
            )}
          </Card>
        </div>

        {onNewGame && (
          <div className="sticky bottom-0 -mb-2 bg-card/95 backdrop-blur text-center pt-3 pb-2">
            <button
              onClick={onNewGame}
              className="px-6 py-3 bg-primary text-primary-foreground rounded-lg font-semibold hover:bg-primary/90 transition-colors"
            >
              Новая игра
            </button>
          </div>
        )}
      </Card>
    </div>
  );
}


