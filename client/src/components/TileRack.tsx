import Tile from "./Tile";
import { Button } from "@/components/ui/button";
import { Shuffle, RotateCcw } from "lucide-react";

interface TileRackProps {
  rack: (string | null)[];
  selectedTileIndex: number | null;
  onTileClick: (index: number) => void;
  onShuffle: () => void;
  onRecall: () => void;
  canInteract: boolean;
}

export default function TileRack({ 
  rack, 
  selectedTileIndex, 
  onTileClick, 
  onShuffle, 
  onRecall,
  canInteract 
}: TileRackProps) {
  return (
    <div className="w-full" data-testid="tile-rack">
      <div className="grid grid-cols-7 gap-2 mb-4">
        {rack.map((letter, index) => (
          <div key={index} className="aspect-square">
            <Tile
              letter={letter}
              isEmpty={letter === null}
              isSelected={selectedTileIndex === index}
              onClick={() => canInteract && letter && onTileClick(index)}
            />
          </div>
        ))}
      </div>
      <div className="flex gap-2">
        <Button
          variant="outline"
          size="default"
          onClick={onShuffle}
          disabled={!canInteract}
          className="flex-1"
          data-testid="button-shuffle"
        >
          <Shuffle className="w-4 h-4 mr-2" />
          Перемешать
        </Button>
        <Button
          variant="outline"
          size="default"
          onClick={onRecall}
          disabled={!canInteract}
          className="flex-1"
          data-testid="button-recall"
        >
          <RotateCcw className="w-4 h-4 mr-2" />
          Вернуть
        </Button>
      </div>
    </div>
  );
}
