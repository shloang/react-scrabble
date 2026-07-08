import { useEffect, useRef, useState } from "react";
import { Clock } from "lucide-react";
import { Progress } from "@/components/ui/progress";

interface GameTimerProps {
  totalTime: number;
  timeLeft?: number;
  turnStart?: number | null;
  paused?: boolean;
  pausedAt?: number | null;
  gameEnded?: boolean;
  turnKey?: string | number | null;
  onWarning?: () => void;
  onExpired?: () => void;
}

export default function GameTimer({
  timeLeft: controlledTimeLeft,
  totalTime,
  turnStart,
  paused = false,
  pausedAt,
  gameEnded = false,
  turnKey,
  onWarning,
  onExpired
}: GameTimerProps) {
  const [localTimeLeft, setLocalTimeLeft] = useState(totalTime);
  const fallbackStartRef = useRef<number | null>(null);
  const warnedRef = useRef(false);
  const expiredRef = useRef(false);
  const onWarningRef = useRef(onWarning);
  const onExpiredRef = useRef(onExpired);

  useEffect(() => {
    onWarningRef.current = onWarning;
  }, [onWarning]);

  useEffect(() => {
    onExpiredRef.current = onExpired;
  }, [onExpired]);

  useEffect(() => {
    fallbackStartRef.current = null;
    warnedRef.current = false;
    expiredRef.current = false;
  }, [turnKey]);

  useEffect(() => {
    if (typeof controlledTimeLeft === 'number') {
      setLocalTimeLeft(controlledTimeLeft);
      return;
    }

    if (gameEnded) {
      setLocalTimeLeft(0);
      return;
    }

    const computeRemaining = (nowMs: number) => {
      let startMs = turnStart;
      if (typeof startMs !== 'number' || startMs <= 0) {
        if (!fallbackStartRef.current) {
          fallbackStartRef.current = nowMs;
        }
        startMs = fallbackStartRef.current;
      }
      const refMs = paused && typeof pausedAt === 'number' && pausedAt > 0 ? pausedAt : nowMs;
      const elapsed = Math.floor((refMs - startMs) / 1000);
      return Math.max(0, totalTime - elapsed);
    };

    const tick = () => {
      const remaining = computeRemaining(Date.now());
      setLocalTimeLeft(remaining);

      if (remaining <= 20 && !warnedRef.current) {
        warnedRef.current = true;
        onWarningRef.current?.();
      }

      if (remaining <= 0 && !expiredRef.current) {
        expiredRef.current = true;
        onExpiredRef.current?.();
      }
    };

    tick();

    if (paused) {
      return;
    }

    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [controlledTimeLeft, gameEnded, paused, pausedAt, totalTime, turnStart]);

  const timeLeft = localTimeLeft;
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
