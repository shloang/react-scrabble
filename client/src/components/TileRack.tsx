import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
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
  turn?: number;
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
  turn,
  onReorder,
  onDropFromBoard
}: TileRackProps) {
  const [dragPreview, setDragPreview] = useState<{ fromIndex: number; overIndex: number } | null>(null);
  const dragPreviewRef = useRef<typeof dragPreview>(null);
  const dragFrameRef = useRef<number | null>(null);
  const dragImageRef = useRef<HTMLElement | null>(null);
  const dragImageTimerRef = useRef<number | null>(null);
  const cleanupTimerRef = useRef<number | null>(null);
  const slotRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const previousRectsRef = useRef<Record<string, DOMRect>>({});
  const canDrag = canInteract && !isPaused && selectedIndices === undefined;

  const resetDragPreview = useCallback(() => {
    if (cleanupTimerRef.current !== null) window.clearTimeout(cleanupTimerRef.current);
    cleanupTimerRef.current = null;
    if (dragFrameRef.current !== null) window.cancelAnimationFrame(dragFrameRef.current);
    if (dragImageTimerRef.current !== null) window.clearTimeout(dragImageTimerRef.current);
    dragFrameRef.current = null;
    dragImageTimerRef.current = null;
    dragPreviewRef.current = null;
    dragImageRef.current?.remove();
    dragImageRef.current = null;
    setDragPreview(null);
    document.body.classList.remove('dragging');
    document.querySelectorAll('.drop-target').forEach(el => el.classList.remove('drop-target', 'invalid'));
    document.querySelectorAll('.drag-ghost').forEach(el => el.remove());
  }, []);

  useEffect(() => {
    resetDragPreview();
  }, [rack, canDrag, turn, resetDragPreview]);

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

    // Measure layout positions, not positions displaced by an unfinished animation.
    for (const el of Object.values(slotRefs.current)) {
      el?.getAnimations?.().forEach(animation => animation.cancel());
    }

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

      el.animate?.(
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
    const scheduleCleanup = () => {
      if (cleanupTimerRef.current !== null) window.clearTimeout(cleanupTimerRef.current);
      cleanupTimerRef.current = window.setTimeout(resetDragPreview, 0);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') resetDragPreview();
    };
    const handleVisibilityChange = () => {
      if (document.hidden) resetDragPreview();
    };
    const recoverMissedRelease = (event: PointerEvent) => {
      if (event.buttons === 0 && document.body.classList.contains('dragging')) resetDragPreview();
    };

    window.addEventListener('dragend', resetDragPreview, true);
    window.addEventListener('drop', scheduleCleanup, true);
    window.addEventListener('mouseup', scheduleCleanup, true);
    window.addEventListener('pointerup', scheduleCleanup, true);
    window.addEventListener('pointermove', recoverMissedRelease, true);
    window.addEventListener('keydown', handleKeyDown, true);
    window.addEventListener('blur', resetDragPreview);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      window.removeEventListener('dragend', resetDragPreview, true);
      window.removeEventListener('drop', scheduleCleanup, true);
      window.removeEventListener('mouseup', scheduleCleanup, true);
      window.removeEventListener('pointerup', scheduleCleanup, true);
      window.removeEventListener('pointermove', recoverMissedRelease, true);
      window.removeEventListener('keydown', handleKeyDown, true);
      window.removeEventListener('blur', resetDragPreview);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      resetDragPreview();
    };
  }, [resetDragPreview]);

  const updateDragOverIndex = (index: number) => {
    const previous = dragPreviewRef.current;
    if (!previous || previous.overIndex === index) return;
    const next = { ...previous, overIndex: index };
    dragPreviewRef.current = next;
    setDragPreview(next);
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
    dragImageRef.current = ghost;

    try {
      e.dataTransfer.setDragImage(ghost, rect.width / 2, rect.height / 2);
    } catch (err) {
      // ignore if the browser rejects custom drag images
    }

    dragImageTimerRef.current = window.setTimeout(() => {
      ghost.remove();
      dragImageRef.current = null;
      dragImageTimerRef.current = null;
    }, 80);
  };

  return (
    <div className="w-full" data-testid="tile-rack">
      <div
        className={`grid grid-cols-7 gap-2 mb-4 rounded-md transition-colors ${isPaused ? 'bg-black [&>*]:invisible' : ''}`}
        aria-disabled={isPaused}
        onDragOver={(e) => {
          if (!canDrag) return;
          e.preventDefault();
          const rect = e.currentTarget.getBoundingClientRect();
          const index = Math.floor((e.clientX - rect.left) / (rect.width / rack.length));
          updateDragOverIndex(Math.max(0, Math.min(rack.length - 1, index)));
        }}
      >
        {[...visualSlots].sort((a, b) => a.originalIndex - b.originalIndex).map((slot) => (
          <div
            key={slot.id}
            ref={(el) => {
              slotRefs.current[slot.id] = el;
            }}
            className="aspect-square"
            style={{ order: visualSlots.findIndex(item => item.id === slot.id) }}
            onDragEnter={(e) => {
              if (!canDrag) return;
              const el = e.currentTarget as HTMLElement;
              if (el) el.classList.add('drop-target');
            }}
            onDragLeave={(e) => {
              const el = e.currentTarget as HTMLElement;
              if (el) el.classList.remove('drop-target');
            }}
            onDrop={(e) => {
              e.preventDefault();
              if (!canDrag) {
                resetDragPreview();
                return;
              }
              const el = e.currentTarget as HTMLElement;
              if (el) el.classList.remove('drop-target');
              try {
                const d = e.dataTransfer.getData('text/plain');
                if (!d) return;
                const parsed = JSON.parse(d);

                if (parsed?.source === 'rack' && typeof parsed.index === 'number') {
                  if (!dragPreviewRef.current) return;
                  const from = parsed.index as number;
                  const to = dragPreviewRef.current.overIndex;
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
                draggable={canDrag && !!slot.letter}
                onDragStart={(e) => {
                  if (!canDrag || !slot.letter) {
                    e.preventDefault();
                    return;
                  }
                  resetDragPreview();
                  try {
                    e.dataTransfer.setData('text/plain', JSON.stringify({ source: 'rack', index: slot.originalIndex, letter: slot.letter, turn }));
                    e.dataTransfer.effectAllowed = 'move';
                    document.body.classList.add('dragging');
                    createLiftDragImage(e);
                    const preview = { fromIndex: slot.originalIndex, overIndex: slot.originalIndex };
                    dragPreviewRef.current = preview;
                    dragFrameRef.current = window.requestAnimationFrame(() => {
                      dragFrameRef.current = null;
                      setDragPreview(dragPreviewRef.current);
                    });
                  } catch (err) {
                    e.preventDefault();
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
  prev.turn === next.turn &&
  prev.onTileClick === next.onTileClick &&
  prev.onShuffle === next.onShuffle &&
  prev.onRecall === next.onRecall &&
  prev.onReorder === next.onReorder &&
  prev.onDropFromBoard === next.onDropFromBoard
));
