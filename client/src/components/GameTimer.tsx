import { Clock } from "lucide-react";
import { Progress } from "@/components/ui/progress";

interface GameTimerProps {
  timeLeft: number;
  totalTime: number;
}

export default function GameTimer({ timeLeft, totalTime }: GameTimerProps) {
  const minutes = Math.floor(timeLeft / 60);
  const seconds = timeLeft % 60;
  const percentage = (timeLeft / totalTime) * 100;
  const isCritical = timeLeft <= 30;

  return (
    <div 
      className={`
        flex flex-col items-center gap-2 p-4 rounded-lg bg-card border border-card-border
        ${isCritical ? 'animate-pulse' : ''}
      `}
      data-testid="game-timer"
    >
      <div className="flex items-center gap-2">
        <Clock className={`w-5 h-5 ${isCritical ? 'text-destructive' : 'text-muted-foreground'}`} />
        <div 
          className={`text-4xl font-bold font-mono ${isCritical ? 'text-destructive' : 'text-foreground'}`}
          data-testid="timer-display"
        >
          {minutes}:{seconds.toString().padStart(2, '0')}
        </div>
      </div>
      <Progress 
        value={percentage} 
        className={`w-full h-2 ${isCritical ? '[&>div]:bg-destructive' : ''}`}
      />
    </div>
  );
}
