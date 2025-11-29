import { Player } from "@shared/schema";
import { Card } from "@/components/ui/card";
import { Users, Mic, MicOff } from "lucide-react";

interface PlayerCardProps {
  player: Player;
  isCurrentPlayer: boolean;
  playerIndex: number;
  // optional voice controls/state (injected by parent)
  voiceMuted?: boolean;
  voiceVolume?: number; // 0..1
  voiceLevel?: number; // 0..1 for VU bar
  voiceStatus?: string;
  onToggleMute?: () => void;
  onVolumeChange?: (v: number) => void;
}

// Player-specific colors removed — use neutral border for consistency

export default function PlayerCard({ player, isCurrentPlayer, playerIndex, voiceMuted, voiceVolume, voiceLevel, voiceStatus, onToggleMute, onVolumeChange }: PlayerCardProps) {
  return (
    <Card
      className={`p-3 border-l-4 border-border transition-all duration-150 ${isCurrentPlayer ? 'ring-1 ring-primary shadow' : 'shadow-sm'} w-1/3 min-h-28 overflow-hidden card-scale`}
      data-testid={`player-card-${player.id}`}
    >
      <div className="flex flex-col gap-2">
        {/* Top row: avatar alone */}
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-muted overflow-hidden flex items-center justify-center shrink-0">
            <img
              src={`https://robohash.org/${encodeURIComponent(player.name)}?size=80x80`}
              alt={`${player.name} avatar`}
              className="w-full h-full object-cover"
            />
          </div>
        </div>

        {/* Second row: name (wraps if needed) */}
        <div className="min-w-0">
          <h3 className="font-medium text-sm break-all whitespace-normal" data-testid={`player-name-${player.id}`}>{player.name}</h3>
        </div>

        {/* Second row: score and current marker */}
        <div className="flex items-center justify-between">
          {/* <div className="text-sm text-muted-foreground">{isCurrentPlayer ? 'ход' : ''}</div> */}
          <div className="text-lg font-semibold" data-testid={`player-score-${player.id}`}>{player.score}</div>
        </div>

        {/* Third row: voice controls */}
        {(typeof voiceStatus !== 'undefined' || typeof voiceMuted !== 'undefined' || typeof onVolumeChange === 'function') && (
          <div className="flex items-center gap-2">
            {typeof onVolumeChange === 'function' && (
              <input
                type="range"
                min={0}
                max={100}
                value={Math.round((voiceVolume ?? 1) * 100)}
                onChange={(e) => onVolumeChange(Number(e.target.value) / 100)}
                className="w-full h-2 accent-primary bg-transparent"
                aria-label="voice volume"
              />
            )}

            {typeof onToggleMute === 'function' && (
              <button onClick={onToggleMute} aria-label={voiceMuted ? 'Unmute player' : 'Mute player'} className={`p-1 rounded ${voiceMuted ? 'bg-primary text-primary-foreground' : 'bg-transparent text-muted-foreground'}`}>
                {voiceMuted ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
              </button>
            )}
          </div>
        )}
      </div>
    </Card>
  );
}
