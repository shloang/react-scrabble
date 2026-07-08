import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
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
  canShuffle?: boolean;
  isPaused?: boolean;
  onReorder?: (from: number, to: number) => void;
  onDropFromBoard?: (fromRow: number, fromCol: number, toIndex: number) => void;
}

function TileRack({
  rack,
  selectedTileIndex,
  selectedIndices,
  onTileClick,
  onShuffle,
  onRecall,
  canInteract,
  canShuffle = canInteract,
  isPaused = false,
  onReorder,
  onDropFromBoard
}: TileRackProps) {
  const [dragPreview, setDragPreview] = useState<{ fromIndex: number; overIndex: number } | null>(null);
  const slotRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const previousRectsRef = useRef<Record<string, DOMRect>>({});

  const visualSlots = useMemo(() => {
    const base = rack.map((letter, index) => ({
      id: `rack-${index}`,
      letter,
      originalIndex: index,
      isDragged: false,
    }));

    if (!dragPreview) return base;
    const { fromIndex, overIndex } = dragPreview;
    if (fromIndex < 0 || fromIndex >= base.length) return base;

    const next = [...base];
    const [dragged] = next.splice(fromIndex, 1);
    const targetIndex = Math.max(0, Math.min(overIndex, next.length));
    next.splice(targetIndex, 0, {
      ...dragged,
      isDragged: true,
    });
    return next;
  }, [dragPreview, rack]);

  useLayoutEffect(() => {
    const nextRects: Record<string, DOMRect> = {};

    for (const slot of visualSlots) {
      const el = slotRefs.current[slot.id];
      if (!el) continue;

      const nextRect = el.getBoundingClientRect();
      const previousRect = previousRectsRef.current[slot.id];
      nextRects[slot.id] = nextRect;

      if (!previousRect) continue;

      const dx = previousRect.left - nextRect.left;
      const dy = previousRect.top - nextRect.top;
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) continue;

      el.getAnimations?.().forEach((animation) => animation.cancel());
      el.animate(
        [
          { transform: `translate(${dx}px, ${dy}px)` },
          { transform: 'translate(0, 0)' },
        ],
        {
          duration: 180,
          easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)',
        },
      );
    }

    previousRectsRef.current = nextRects;
  }, [visualSlots]);

  useEffect(() => {
    const cleanupDragState = () => {
      setDragPreview(null);
      document.body.classList.remove('dragging');
      document.querySelectorAll('.drop-target').forEach((el) => {
        el.classList.remove('drop-target', 'invalid');
      });
    };
    const scheduleCleanup = () => {
      window.setTimeout(cleanupDragState, 0);
    };

    window.addEventListener('dragend', cleanupDragState);
    window.addEventListener('drop', scheduleCleanup);
    window.addEventListener('mouseup', scheduleCleanup);
    window.addEventListener('blur', cleanupDragState);

    return () => {
      window.removeEventListener('dragend', cleanupDragState);
      window.removeEventListener('drop', scheduleCleanup);
      window.removeEventListener('mouseup', scheduleCleanup);
      window.removeEventListener('blur', cleanupDragState);
    };
  }, []);

  const resetDragPreview = () => {
    setDragPreview(null);
    document.body.classList.remove('dragging');
  };

  const updateDragOverIndex = (index: number) => {
    setDragPreview(prev => {
      if (!prev || prev.overIndex === index) return prev;
      return { ...prev, overIndex: index };
    });
  };

  const createLiftDragImage = (e: any) => {
    const source = e.currentTarget as HTMLElement | null;
    if (!source) return;

    const rect = source.getBoundingClientRect();
    const ghost = source.cloneNode(true) as HTMLElement;
    ghost.classList.add('drag-lift-image');
    ghost.style.position = 'fixed';
    ghost.style.left = `${rect.left}px`;
    ghost.style.top = `${rect.top}px`;
    ghost.style.width = `${rect.width}px`;
    ghost.style.height = `${rect.height}px`;
    ghost.style.pointerEvents = 'none';
    ghost.style.zIndex = '9999';
    document.body.appendChild(ghost);

    try {
      e.dataTransfer.setDragImage(ghost, rect.width / 2, rect.height / 2);
    } catch (err) {
      // ignore if the browser rejects custom drag images
    }

    window.setTimeout(() => ghost.remove(), 80);
  };

  return (
    <div className="w-full" data-testid="tile-rack">
      <div
        className={`grid grid-cols-7 gap-2 mb-4 rounded-md transition-colors ${isPaused ? 'bg-black [&>*]:invisible' : ''}`}
        aria-disabled={isPaused}
      >
        {visualSlots.map((slot) => (
          <div
            key={slot.id}
            ref={(el) => {
              slotRefs.current[slot.id] = el;
            }}
            className="aspect-square"
            onDragOver={(e) => {
              e.preventDefault();
            }}
            onDragEnter={(e) => {
              const el = e.currentTarget as HTMLElement;
              if (el) el.classList.add('drop-target');
              if (dragPreview) {
                updateDragOverIndex(slot.isDragged ? dragPreview.overIndex : slot.originalIndex);
              }
            }}
            onDragLeave={(e) => {
              const el = e.currentTarget as HTMLElement;
              if (el) el.classList.remove('drop-target');
            }}
            onDrop={(e) => {
              e.preventDefault();
              const el = e.currentTarget as HTMLElement;
              if (el) el.classList.remove('drop-target');
              try {
                const d = e.dataTransfer.getData('text/plain');
                if (!d) return;
                const parsed = JSON.parse(d);

                if (parsed?.source === 'rack' && typeof parsed.index === 'number') {
                  const from = parsed.index as number;
                  const to = dragPreview?.overIndex ?? slot.originalIndex;
                  if (from !== to && typeof onReorder === 'function') {
                    onReorder(from, to);
                  }
                }

                if (parsed?.source === 'board' && typeof parsed.fromRow === 'number' && typeof parsed.fromCol === 'number') {
                  const fromRow = parsed.fromRow as number;
                  const fromCol = parsed.fromCol as number;
                  if (typeof onDropFromBoard === 'function') {
                    onDropFromBoard(fromRow, fromCol, slot.originalIndex);
                  }
                }
              } catch (err) {
                // ignore invalid drop data
              } finally {
                resetDragPreview();
              }
            }}
          >
            <div className={slot.isDragged ? 'relative h-full w-full rounded-md border-2 border-dashed border-primary/55 bg-primary/10 shadow-inner' : 'h-full w-full'}>
              <Tile
                letter={slot.letter}
                isEmpty={slot.letter === null}
                isSelected={
                  (selectedIndices && selectedIndices.includes(slot.originalIndex)) || selectedTileIndex === slot.originalIndex
                }
                onClick={() => canInteract && slot.letter && onTileClick(slot.originalIndex)}
                onDragStart={(e) => {
                  if (!canInteract || !slot.letter) return;
                  try {
                    e.dataTransfer.setData('text/plain', JSON.stringify({ source: 'rack', index: slot.originalIndex }));
                    e.dataTransfer.effectAllowed = 'move';
                    document.body.classList.add('dragging');
                    createLiftDragImage(e);
                    window.requestAnimationFrame(() => {
                      setDragPreview({ fromIndex: slot.originalIndex, overIndex: slot.originalIndex });
                    });
                  } catch (err) {
                    resetDragPreview();
                  }
                }}
                onDragEnd={resetDragPreview}
                className={slot.isDragged ? 'opacity-0 pointer-events-none' : ''}
              />
            </div>
          </div>
        ))}
      </div>
      <div className="flex gap-2">
        <Button
          variant="outline"
          size="default"
          onClick={onShuffle}
          disabled={!canShuffle}
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

function sameNullableStringArray(a?: (string | null)[], b?: (string | null)[]) {
  if (a === b) return true;
  if (!a || !b || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function sameNumberArray(a?: number[], b?: number[]) {
  if (a === b) return true;
  if (!a && !b) return true;
  if (!a || !b || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

export default memo(TileRack, (prev, next) => (
  sameNullableStringArray(prev.rack, next.rack) &&
  prev.selectedTileIndex === next.selectedTileIndex &&
  sameNumberArray(prev.selectedIndices, next.selectedIndices) &&
  prev.canInteract === next.canInteract &&
  prev.canShuffle === next.canShuffle &&
  prev.isPaused === next.isPaused &&
  prev.onTileClick === next.onTileClick &&
  prev.onShuffle === next.onShuffle &&
  prev.onRecall === next.onRecall &&
  prev.onReorder === next.onReorder &&
  prev.onDropFromBoard === next.onDropFromBoard
));
