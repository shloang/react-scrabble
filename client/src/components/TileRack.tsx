import Tile from "./Tile";
import { Button } from "@/components/ui/button";
import { Shuffle, RotateCcw } from "lucide-react";

interface TileRackProps {
  rack: (string | null)[];
  selectedTileIndex: number | null;
  selectedIndices?: number[];
  onTileClick: (index: number) => void;
  onShuffle: () => void;
  onRecall: () => void;
  canInteract: boolean;
}

export default function TileRack({ 
  rack, 
  selectedTileIndex, 
  selectedIndices,
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
              isSelected={
                (selectedIndices && selectedIndices.includes(index)) || selectedTileIndex === index
              }
              onClick={() => canInteract && letter && onTileClick(index)}
              onDragStart={(e) => {
                if (!canInteract || !letter) return;
                try {
                  // Set payload
                  e.dataTransfer.setData('text/plain', JSON.stringify({ source: 'rack', index }));
                  e.dataTransfer.effectAllowed = 'move';

                  // Add dragging body class for cursor
                  document.body.classList.add('dragging');

                  // Create ghost element for nicer drag image
                  const ghost = document.createElement('div');
                  ghost.className = 'drag-ghost';
                  ghost.textContent = letter;
                  document.body.appendChild(ghost);
                  // Use half width/height offset
                  const rect = ghost.getBoundingClientRect();
                  const offsetX = rect.width / 2;
                  const offsetY = rect.height / 2;
                  try {
                    e.dataTransfer.setDragImage(ghost, offsetX, offsetY);
                  } catch (err) {
                    // ignore if not supported
                  }
                  // Remove after a tick — drag image is already captured by browser
                  setTimeout(() => ghost.remove(), 0);
                } catch (err) {
                  // ignore
                }
              }}
              onDragEnd={() => {
                document.body.classList.remove('dragging');
              }}
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
