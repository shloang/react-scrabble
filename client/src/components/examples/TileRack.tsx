import { useState } from 'react';
import TileRack from '../TileRack';

export default function TileRackExample() {
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const rack: (string | null)[] = ['А', 'Б', 'В', 'Г', 'Д', null, null];

  return (
    <div className="p-8 max-w-xl bg-background">
      <TileRack
        rack={rack}
        selectedTileIndex={selectedIndex}
        onTileClick={(index) => {
          console.log('Tile clicked:', index);
          setSelectedIndex(selectedIndex === index ? null : index);
        }}
        onShuffle={() => console.log('Shuffle clicked')}
        onRecall={() => console.log('Recall clicked')}
        canInteract={true}
      />
    </div>
  );
}
