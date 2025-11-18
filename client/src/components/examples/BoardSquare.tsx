import BoardSquare from '../BoardSquare';

export default function BoardSquareExample() {
  return (
    <div className="grid grid-cols-6 gap-1 max-w-md p-8 bg-background">
      <BoardSquare row={0} col={0} type="TW" letter={null} />
      <BoardSquare row={0} col={3} type="DL" letter={null} />
      <BoardSquare row={1} col={1} type="DW" letter={null} />
      <BoardSquare row={1} col={5} type="TL" letter={null} />
      <BoardSquare row={7} col={7} type="START" letter={null} />
      <BoardSquare row={5} col={5} type="NORMAL" letter="А" />
    </div>
  );
}
