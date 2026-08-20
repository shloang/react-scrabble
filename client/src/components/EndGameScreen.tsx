import { GameState } from "@shared/schema";
import { useEffect } from 'react';
import { Card } from "@/components/ui/card";
import { Trophy, Award, Target, BookOpen } from "lucide-react";
import { getEndGameHighlights } from '@/lib/endGameStats';

interface EndGameScreenProps {
  gameState: GameState;
  currentPlayerId: string | null;
  onNewGame?: () => void;
  onClose?: () => void;
  onMinimize?: () => void;
}

export default function EndGameScreen({ gameState, currentPlayerId, onNewGame, onClose, onMinimize }: EndGameScreenProps) {
  const winner = (gameState.players || []).find(p => p.id === gameState.winnerId) || null;
  const drawPlayerIds = Array.isArray(gameState.drawPlayerIds) ? gameState.drawPlayerIds : [];
  const drawPlayerSet = new Set(drawPlayerIds);
  const drawPlayers = (gameState.players || []).filter(player => drawPlayerSet.has(player.id));
  const isDraw = drawPlayers.length > 1;
  const isWinner = winner?.id === currentPlayerId;
  const isDrawParticipant = isDraw && !!currentPlayerId && drawPlayerSet.has(currentPlayerId);
  const rankedPlayers = (gameState.players || []).slice().sort((a, b) => (b.score || 0) - (a.score || 0));

  const moves = gameState.moves || [];
  const { highestMove, highestWord, longestWord } = getEndGameHighlights(moves);

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
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-2 sm:p-3 overflow-hidden"
      onClick={() => { if (onClose) onClose(); }}
    >
      <Card className="relative flex max-h-[calc(100dvh-1rem)] w-full max-w-4xl flex-col overflow-hidden p-[clamp(0.75rem,2.2vmin,1.75rem)] gap-[clamp(0.5rem,1.5vmin,1.25rem)]" onClick={(e) => e.stopPropagation()}>
        <div className="absolute right-2 top-2 z-10 flex justify-end gap-1">
          {onMinimize && (
            <button
              aria-label="Minimize"
              onClick={onMinimize}
              className="h-8 w-8 rounded-md hover:bg-muted/20"
              title="Свернуть"
            >
              —
            </button>
          )}
          {onClose && (
            <button
              aria-label="Close"
              onClick={onClose}
              className="h-8 w-8 rounded-md hover:bg-muted/20"
              title="Закрыть"
            >
              ✕
            </button>
          )}
        </div>
        <div className="shrink-0 pr-16 text-center">
          <div className={`mb-[clamp(0.25rem,1vmin,0.75rem)] text-[clamp(2rem,7vmin,4rem)] leading-none ${isWinner ? 'text-yellow-500' : isDrawParticipant ? 'text-blue-500' : 'text-gray-400'}`}>
            {isWinner ? '🏆' : isDrawParticipant ? '🤝' : '😔'}
          </div>
          <h1 className="mb-1 text-[clamp(1.35rem,4.5vmin,2.75rem)] font-bold leading-tight">
            {isWinner ? 'Поздравляем! Вы выиграли!' : isDrawParticipant ? 'Ничья!' : 'Игра окончена'}
          </h1>
          {isDraw ? (
            <p className="text-[clamp(0.95rem,2.8vmin,1.5rem)] leading-snug text-muted-foreground">
              Ничья за первое место: <span className="font-bold text-primary">{drawPlayers.map(player => player.name).join(', ')}</span>
              {drawPlayers[0] ? ` (${drawPlayers[0].score} очков)` : ''}
            </p>
          ) : winner && (
            <p className="text-[clamp(0.95rem,2.8vmin,1.5rem)] leading-snug text-muted-foreground">
              Победитель: <span className="font-bold text-primary">{winner.name}</span> ({winner.score} очков)
            </p>
          )}
        </div>

        <div className="grid min-h-0 flex-1 grid-cols-2 gap-[clamp(0.4rem,1.2vmin,1rem)]">
          <Card className="min-h-0 overflow-hidden p-[clamp(0.65rem,1.6vmin,1rem)]">
            <div className="mb-[clamp(0.25rem,0.8vmin,0.5rem)] flex items-center gap-2">
              <Trophy className="h-[clamp(1rem,2.4vmin,1.25rem)] w-[clamp(1rem,2.4vmin,1.25rem)] text-yellow-500" />
              <h3 className="text-[clamp(0.9rem,2vmin,1rem)] font-semibold">Итоговые очки</h3>
            </div>
            <div className="space-y-[clamp(0.25rem,0.9vmin,0.75rem)] text-[clamp(0.82rem,1.8vmin,1rem)] leading-tight">
              {rankedPlayers.map((player) => (
                  <div key={player.id} className="flex justify-between gap-3">
                    <div>
                      <div className={player.id === gameState.winnerId || drawPlayerSet.has(player.id) ? 'font-bold' : ''}>
                        {rankedPlayers.findIndex(candidate => candidate.score === player.score) + 1}. {player.name}
                      </div>
                      {(player.originalScore !== undefined || player.tilePenalty !== undefined) && (
                        <div className="mt-0.5 space-y-0.5 text-[clamp(0.68rem,1.45vmin,0.75rem)] text-muted-foreground">
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

          <Card className="min-h-0 overflow-hidden p-[clamp(0.65rem,1.6vmin,1rem)]">
            <div className="mb-[clamp(0.25rem,0.8vmin,0.5rem)] flex items-center gap-2">
              <Award className="h-[clamp(1rem,2.4vmin,1.25rem)] w-[clamp(1rem,2.4vmin,1.25rem)] text-blue-500" />
              <h3 className="text-[clamp(0.9rem,2vmin,1rem)] font-semibold">Лучший ход</h3>
            </div>
            {highestMove && highestMove.score > 0 ? (
              <div>
                <div className="text-[clamp(1.25rem,3vmin,1.75rem)] font-bold leading-tight text-primary">{highestMove.score} очков</div>
                <div className="mt-1 text-[clamp(0.78rem,1.7vmin,0.9rem)] leading-snug text-muted-foreground">
                  {highestMove.playerName}: {highestMove.words.join(', ')}
                </div>
              </div>
            ) : (
              <div className="text-muted-foreground">Нет данных</div>
            )}
          </Card>

          <Card className="min-h-0 overflow-hidden p-[clamp(0.65rem,1.6vmin,1rem)]">
            <div className="mb-[clamp(0.25rem,0.8vmin,0.5rem)] flex items-center gap-2">
              <Target className="h-[clamp(1rem,2.4vmin,1.25rem)] w-[clamp(1rem,2.4vmin,1.25rem)] text-green-500" />
              <h3 className="text-[clamp(0.9rem,2vmin,1rem)] font-semibold">Лучшее слово</h3>
            </div>
            {highestWord.word ? (
              <div>
                <div className="break-words text-[clamp(1.2rem,3vmin,1.75rem)] font-bold leading-tight text-primary">{highestWord.word}</div>
                <div className="mt-1 text-[clamp(0.78rem,1.7vmin,0.9rem)] leading-snug text-muted-foreground">
                  {highestWord.score} очков ({highestWord.move?.playerName})
                </div>
              </div>
            ) : (
              <div className="text-muted-foreground">Нет данных</div>
            )}
          </Card>

          <Card className="min-h-0 overflow-hidden p-[clamp(0.65rem,1.6vmin,1rem)]">
            <div className="mb-[clamp(0.25rem,0.8vmin,0.5rem)] flex items-center gap-2">
              <BookOpen className="h-[clamp(1rem,2.4vmin,1.25rem)] w-[clamp(1rem,2.4vmin,1.25rem)] text-purple-500" />
              <h3 className="text-[clamp(0.9rem,2vmin,1rem)] font-semibold">Самое длинное слово</h3>
            </div>
            {longestWord.word ? (
              <div>
                <div className="break-words text-[clamp(1.2rem,3vmin,1.75rem)] font-bold leading-tight text-primary">{longestWord.word}</div>
                <div className="mt-1 text-[clamp(0.78rem,1.7vmin,0.9rem)] leading-snug text-muted-foreground">
                  {longestWord.length} букв ({longestWord.move?.playerName})
                </div>
              </div>
            ) : (
              <div className="text-muted-foreground">Нет данных</div>
            )}
          </Card>
        </div>

        {onNewGame && (
          <div className="shrink-0 text-center">
            <button
              onClick={onNewGame}
              className="rounded-lg bg-primary px-[clamp(1rem,3vmin,1.5rem)] py-[clamp(0.55rem,1.7vmin,0.75rem)] text-[clamp(0.9rem,2vmin,1rem)] font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
            >
              Новая игра
            </button>
          </div>
        )}
      </Card>
    </div>
  );
}


