import GameBoard from '../GameBoard';
import { BOARD_SIZE } from '@shared/schema';

export default function GameBoardExample() {
  const emptyBoard = Array(BOARD_SIZE).fill(null).map(() => Array(BOARD_SIZE).fill(null));
  
  emptyBoard[7][7] = 'С';
  emptyBoard[7][8] = 'Л';
  emptyBoard[7][9] = 'О';
  emptyBoard[7][10] = 'В';
  emptyBoard[7][11] = 'О';

  const placedTiles = [
    { row: 7, col: 7, letter: 'С' },
    { row: 7, col: 8, letter: 'Л' }
  ];

  return (
    <div className="p-8 bg-background">
      <GameBoard 
        board={emptyBoard} 
        placedTiles={placedTiles}
        onSquareClick={(r, c) => console.log('Clicked square:', r, c)}
      />
    </div>
  );
}
