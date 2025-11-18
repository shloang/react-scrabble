import PlayerCard from '../PlayerCard';

export default function PlayerCardExample() {
  const players = [
    { id: '1', name: 'Алексей', rack: ['А', 'Б', 'В', null, null, null, null], score: 145 },
    { id: '2', name: 'Мария', rack: ['Г', 'Д', 'Е', 'Ё', 'Ж', 'З', 'И'], score: 89 },
    { id: '3', name: 'Дмитрий', rack: ['К', 'Л', 'М', 'Н', 'О', 'П', 'Р'], score: 56 }
  ];

  return (
    <div className="flex flex-col gap-4 p-8 max-w-sm bg-background">
      {players.map((player, index) => (
        <PlayerCard
          key={player.id}
          player={player}
          isCurrentPlayer={index === 0}
          playerIndex={index}
        />
      ))}
    </div>
  );
}
