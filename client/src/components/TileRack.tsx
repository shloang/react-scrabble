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
  onReorder?: (from: number, to: number) => void;
  onDropFromBoard?: (fromRow: number, fromCol: number, toIndex: number) => void;
}

export default function TileRack({ 
  rack, 
  selectedTileIndex, 
  selectedIndices,
  onTileClick, 
  onShuffle, 
  onRecall,
  canInteract,
  onReorder,
  onDropFromBoard
}: TileRackProps) {
  return (
    <div className="w-full" data-testid="tile-rack">
      <div className="grid grid-cols-7 gap-2 mb-4">
        {rack.map((letter, index) => (
          <div
            key={index}
            className="aspect-square"
            onDragOver={(e) => { e.preventDefault(); }}
            onDragEnter={(e) => { const el = e.currentTarget as HTMLElement; if (el) el.classList.add('drop-target'); }}
            onDragLeave={(e) => { const el = e.currentTarget as HTMLElement; if (el) el.classList.remove('drop-target'); }}
            onDrop={(e) => {
              e.preventDefault();
              const el = e.currentTarget as HTMLElement; if (el) el.classList.remove('drop-target');
              try {
                const d = e.dataTransfer.getData('text/plain');
                if (!d) return;
                const parsed = JSON.parse(d);
                          // If dragging from rack -> reorder
                          if (parsed?.source === 'rack' && typeof parsed.index === 'number') {
                            const from = parsed.index as number;
                            const to = index;
                            if (from !== to && typeof onReorder === 'function') {
                              onReorder(from, to);
                            }
                          }
                          // If dragging from board -> drop placed tile into rack slot
                          if (parsed?.source === 'board' && typeof parsed.fromRow === 'number' && typeof parsed.fromCol === 'number') {
                            const fromRow = parsed.fromRow as number;
                            const fromCol = parsed.fromCol as number;
                            if (typeof onDropFromBoard === 'function') {
                              onDropFromBoard(fromRow, fromCol, index);
                            }
                          }
              } catch (err) {
                // ignore
              }
            }}
          >
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
