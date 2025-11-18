import { useState, useEffect } from 'react';
import GameTimer from '../GameTimer';

export default function GameTimerExample() {
  const [timeLeft, setTimeLeft] = useState(180);

  useEffect(() => {
    const interval = setInterval(() => {
      setTimeLeft(prev => prev > 0 ? prev - 1 : 180);
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="p-8 max-w-sm bg-background">
      <GameTimer timeLeft={timeLeft} totalTime={180} />
    </div>
  );
}
