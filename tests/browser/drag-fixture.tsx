import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import TileRack from '../../client/src/components/TileRack';
import BoardSquare from '../../client/src/components/BoardSquare';

function Fixture() {
  const [rack, setRack] = useState<(string | null)[]>(['A', 'B', 'C', 'D', 'E', 'F', 'G']);
  const [placed, setPlaced] = useState<{ letter: string; index: number } | null>(null);
  const [paused, setPaused] = useState(false);
  const [turn, setTurn] = useState(1);
  const [selectionMode, setSelectionMode] = useState(false);
  const recall = () => {
    if (!placed) return;
    setRack(previous => previous.map((letter, index) => index === placed.index ? placed.letter : letter));
    setPlaced(null);
  };
  return <div style={{ padding: 24, maxWidth: 500 }}>
    <button id="pause" onClick={() => setPaused(value => !value)}>Pause</button>
    <button id="next-turn" onClick={() => setTurn(value => value + 1)}>Next turn</button>
    <button id="selection" onClick={() => setSelectionMode(value => !value)}>Exchange selection</button>
    <div style={{ width: 72, height: 72, margin: '16px 0' }}>
      <BoardSquare row={7} col={7} type="NORMAL" letter={placed?.letter ?? null}
        isNewlyPlaced={!!placed} canDragTile={!paused} onClick={recall}
        onDrop={(_row, _col, data) => {
          if (paused || data.source !== 'rack' || placed || !rack[data.index]) return;
          setPlaced({ letter: rack[data.index]!, index: data.index });
          setRack(previous => previous.map((letter, index) => index === data.index ? null : letter));
        }} />
    </div>
    <TileRack rack={rack} selectedTileIndex={null} selectedIndices={selectionMode ? [] : undefined}
      canInteract={!paused} isPaused={paused} turn={turn} onTileClick={() => {}}
      onRecall={recall} onDropFromBoard={recall} onShuffle={() => setRack(previous => [...previous].reverse())}
      onReorder={(from, to) => setRack(previous => {
        const next = [...previous];
        const [tile] = next.splice(from, 1);
        next.splice(to, 0, tile);
        return next;
      })} />
    <output id="rack-state">{JSON.stringify(rack)}</output>
  </div>;
}

createRoot(document.getElementById('root')!).render(<Fixture />);
