import { useState, useCallback, useEffect, useMemo, useRef } from 'react';

/**
 * Custom hook to manage tile shuffling and reordering in a player's hand.
 * 
 * This hook maintains a mapping between server tile positions and the
 * player's locally shuffled/reordered view. When the server sends updates,
 * the local shuffle order is preserved for existing tiles, and new tiles
 * are appended at the end.
 * 
 * Usage:
 * const { displayRack, applyTouch, shuffleRack, resetRack } = usePlayerTileOrder(serverRack);
 */

interface ShuffleState {
  /**
   * Maps display index -> server index.
   * E.g., if shuffleOrder = [2, 0, 1], it means:
   *   - position 0 shows tile from server position 2
   *   - position 1 shows tile from server position 0
   *   - position 2 shows tile from server position 1
   */
  shuffleOrder: number[];
  
  /**
   * Counter to force React updates when shuffling happens
   */
  shuffleGeneration: number;
}

function normalizeOrder(order: unknown, rackLength: number): number[] | null {
  if (!Array.isArray(order) || order.length !== rackLength) return null;
  const seen = new Set<number>();
  const normalized: number[] = [];

  for (const value of order) {
    if (!Number.isInteger(value) || value < 0 || value >= rackLength || seen.has(value)) {
      return null;
    }
    seen.add(value);
    normalized.push(value);
  }

  return normalized;
}

export function usePlayerTileOrder(serverRack: (string | null)[] | null, storageKey?: string) {
  const [shuffleState, setShuffleState] = useState<ShuffleState>(() => ({
    shuffleOrder: [],
    shuffleGeneration: 0,
  }));

  const previousRackRef = useRef<(string | null)[] | null>(null);

  /**
   * When server rack changes, preserve existing shuffle order and handle new/removed tiles
   */
  useEffect(() => {
    if (!serverRack) {
      setShuffleState({ shuffleOrder: [], shuffleGeneration: 0 });
      previousRackRef.current = null;
      return;
    }

    setShuffleState((prev) => {
      const prevRack = previousRackRef.current;
      const prevOrder = prev.shuffleOrder;

      // If this is the first time or rack is empty, initialize with saved or identity mapping
      if (prevOrder.length === 0 || !prevRack) {
        let savedOrder: number[] | null = null;
        if (storageKey && typeof window !== 'undefined') {
          try {
            const parsed = JSON.parse(window.localStorage.getItem(storageKey) || 'null');
            savedOrder = normalizeOrder(parsed, serverRack.length);
          } catch {
            savedOrder = null;
          }
        }

        previousRackRef.current = [...serverRack];
        return {
          shuffleOrder: savedOrder || Array.from({ length: serverRack.length }, (_, i) => i),
          shuffleGeneration: prev.shuffleGeneration,
        };
      }

      // If rack size hasn't changed, keep the shuffle order as-is
      if (serverRack.length === prevOrder.length) {
        previousRackRef.current = [...serverRack];
        return prev;
      }

      // Rack size changed - we need to update shuffle order
      // Strategy: preserve the shuffle order for existing positions, append new ones at the end

      let newOrder: number[] = [];

      if (serverRack.length > prevOrder.length) {
        // Tiles were added - preserve existing order and append new indices
        newOrder = [...prevOrder];
        for (let i = prevOrder.length; i < serverRack.length; i++) {
          newOrder.push(i);
        }
      } else {
        // Tiles were removed - filter out indices that are now out of bounds
        newOrder = prevOrder.filter((idx) => idx < serverRack.length);

        // If the filtered order is empty (shouldn't happen), reinitialize
        if (newOrder.length === 0) {
          newOrder = Array.from({ length: serverRack.length }, (_, i) => i);
        }
      }

      previousRackRef.current = [...serverRack];
      return {
        shuffleOrder: newOrder,
        shuffleGeneration: prev.shuffleGeneration,
      };
    });
  }, [serverRack, storageKey]);

  useEffect(() => {
    if (!storageKey || typeof window === 'undefined' || shuffleState.shuffleOrder.length === 0) return;
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(shuffleState.shuffleOrder));
    } catch {
      // Storage can fail in private mode; the in-memory order still works.
    }
  }, [shuffleState.shuffleOrder, storageKey]);

  /**
   * Returns the display order of tiles by applying the shuffle order to the server rack
   */
  const displayRack = useMemo((): (string | null)[] => {
    if (!serverRack || shuffleState.shuffleOrder.length === 0) {
      return serverRack || [];
    }
    return shuffleState.shuffleOrder.map(
      (idx) => (idx >= 0 && idx < serverRack.length ? serverRack[idx] : null)
    );
  }, [serverRack, shuffleState.shuffleOrder]);

  const displayIndexToServerIndex = useCallback((displayIndex: number): number => {
    const mapped = shuffleState.shuffleOrder[displayIndex];
    return Number.isInteger(mapped) ? mapped : displayIndex;
  }, [shuffleState.shuffleOrder]);

  const serverIndexToDisplayIndex = useCallback((serverIndex: number): number => {
    const mapped = shuffleState.shuffleOrder.indexOf(serverIndex);
    return mapped === -1 ? serverIndex : mapped;
  }, [shuffleState.shuffleOrder]);

  /**
   * Reorder tiles: move tile from one display index to another
   */
  const reorderTiles = useCallback((fromIndex: number, toIndex: number) => {
    if (fromIndex === toIndex) return;

    setShuffleState((prev) => {
      const newOrder = [...prev.shuffleOrder];
      const [item] = newOrder.splice(fromIndex, 1);
      newOrder.splice(toIndex, 0, item);

      return {
        shuffleOrder: newOrder,
        shuffleGeneration: prev.shuffleGeneration + 1,
      };
    });
  }, []);

  /**
   * Shuffle the tiles randomly
   */
  const shuffle = useCallback(() => {
    setShuffleState((prev) => {
      const newOrder = [...prev.shuffleOrder];
      if (newOrder.length < 2) return prev;
      // Fisher-Yates shuffle
      for (let i = newOrder.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [newOrder[i], newOrder[j]] = [newOrder[j], newOrder[i]];
      }

      return {
        shuffleOrder: newOrder,
        shuffleGeneration: prev.shuffleGeneration + 1,
      };
    });
  }, []);

  /**
   * Reset to the original server order
   */
  const reset = useCallback(() => {
    if (!serverRack) return;
    
    setShuffleState((prev) => ({
      shuffleOrder: Array.from({ length: serverRack.length }, (_, i) => i),
      shuffleGeneration: prev.shuffleGeneration + 1,
    }));
  }, [serverRack]);

  return {
    displayRack,
    displayOrder: shuffleState.shuffleOrder,
    displayIndexToServerIndex,
    serverIndexToDisplayIndex,
    reorderTiles,
    shuffle,
    reset,
    generation: shuffleState.shuffleGeneration,
  };
}
