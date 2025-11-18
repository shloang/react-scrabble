import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Users } from "lucide-react";

interface JoinGameDialogProps {
  open: boolean;
  playerCount: number;
  onJoin: (name: string, password: string) => void;
  defaultName?: string;
  error?: string | null;
  isLoading?: boolean;
}

export default function JoinGameDialog({ open, playerCount, onJoin, defaultName, error, isLoading }: JoinGameDialogProps) {
  const [playerName, setPlayerName] = useState('');
  const [password, setPassword] = useState('');

  // initialize with defaultName when provided
  useEffect(() => {
    if (defaultName && defaultName.trim()) {
      setPlayerName(defaultName.trim());
    }
  }, [defaultName]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (playerName.trim()) {
      onJoin(playerName.trim(), password);
    }
  };

  return (
    <Dialog open={open}>
      <DialogContent className="sm:max-w-md" data-testid="dialog-join-game">
        <DialogHeader>
          <DialogTitle className="text-2xl">Присоединиться к игре</DialogTitle>
          <DialogDescription>
            Введите ваше имя чтобы начать играть в Эрудит
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="player-name">Имя игрока</Label>
            <Input
              id="player-name"
              placeholder="Введите ваше имя"
              value={playerName}
              onChange={(e) => setPlayerName(e.target.value)}
              autoFocus
              data-testid="input-player-name"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="player-password">Пароль</Label>
            <Input
              id="player-password"
              placeholder="Введите пароль"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              data-testid="input-player-password"
            />
          </div>

          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Users className="w-4 h-4" />
            <span data-testid="text-player-count">
              {playerCount}/3 игроков
            </span>
          </div>
          {error && (
            <div className="text-sm text-destructive mb-2" data-testid="join-error">{error}</div>
          )}
          <Button 
            type="submit" 
            className="w-full" 
            size="lg"
            disabled={!playerName.trim() || !password.trim() || playerCount >= 3 || isLoading}
            data-testid="button-join"
          >
            {isLoading ? 'Подключение...' : 'Присоединиться'}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
