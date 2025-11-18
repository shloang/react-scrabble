import JoinGameDialog from '../JoinGameDialog';

export default function JoinGameDialogExample() {
  return (
    <div className="p-8 bg-background">
      <JoinGameDialog
        open={true}
        playerCount={1}
        onJoin={(name, password) => console.log('Player joined:', name, password)}
      />
    </div>
  );
}
