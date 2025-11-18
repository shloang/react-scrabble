import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Users } from "lucide-react";

interface JoinGameDialogProps {
  open: boolean;
  playerCount: number;
  onJoin: (name: string) => void;
}

export default function JoinGameDialog({ open, playerCount, onJoin }: JoinGameDialogProps) {
  const [playerName, setPlayerName] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (playerName.trim()) {
      onJoin(playerName.trim());
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
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Users className="w-4 h-4" />
            <span data-testid="text-player-count">
              {playerCount}/3 игроков
            </span>
          </div>
          <Button 
            type="submit" 
            className="w-full" 
            size="lg"
            disabled={!playerName.trim() || playerCount >= 3}
            data-testid="button-join"
          >
            Присоединиться
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
