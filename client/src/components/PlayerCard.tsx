import { Player } from "@shared/schema";
import { Card } from "@/components/ui/card";
import { Users } from "lucide-react";

interface PlayerCardProps {
  player: Player;
  isCurrentPlayer: boolean;
  playerIndex: number;
}

const PLAYER_COLORS = [
  'border-l-blue-500',
  'border-l-green-500', 
  'border-l-purple-500'
];

export default function PlayerCard({ player, isCurrentPlayer, playerIndex }: PlayerCardProps) {
  return (
    <Card
      className={`
        p-4 border-l-4 transition-all duration-200
        ${PLAYER_COLORS[playerIndex % 3]}
        ${isCurrentPlayer ? 'ring-2 ring-primary shadow-lg' : 'shadow-sm'}
      `}
      data-testid={`player-card-${player.id}`}
    >
      <div className="flex items-center gap-3 mb-2">
        <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center">
          <Users className="w-4 h-4 text-muted-foreground" />
        </div>
        <div className="flex-1">
          <h3 className="font-semibold text-lg" data-testid={`player-name-${player.id}`}>
            {player.name}
          </h3>
          {isCurrentPlayer && (
            <p className="text-xs text-primary font-medium">Текущий ход</p>
          )}
        </div>
      </div>
      <div className="text-3xl font-bold" data-testid={`player-score-${player.id}`}>
        {player.score}
        <span className="text-sm text-muted-foreground ml-2">очков</span>
      </div>
    </Card>
  );
}
