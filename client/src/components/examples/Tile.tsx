import Tile from '../Tile';

export default function TileExample() {
  return (
    <div className="flex gap-4 p-8 bg-background">
      <div className="w-16">
        <Tile letter="А" />
      </div>
      <div className="w-16">
        <Tile letter="Ф" />
      </div>
      <div className="w-16">
        <Tile letter="?" />
      </div>
      <div className="w-16">
        <Tile letter="Я" isSelected />
      </div>
      <div className="w-16">
        <Tile letter={null} />
      </div>
      <div className="w-16">
        <Tile letter={null} isEmpty />
      </div>
    </div>
  );
}
