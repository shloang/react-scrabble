export function exchangeTiles(rack: (string | null)[], bag: string[], indices: number[]) {
  if (!indices.length || new Set(indices).size !== indices.length) {
    throw new Error('Select distinct rack tiles to exchange.');
  }
  if (indices.length > bag.length) {
    throw new Error(`Cannot exchange ${indices.length} tiles: only ${bag.length} remain in the bag.`);
  }
  if (indices.some(index => !Number.isInteger(index) || index < 0 || index >= rack.length || !rack[index])) {
    throw new Error('Exchange selection contains an empty or invalid rack slot.');
  }

  const nextRack = [...rack];
  const nextBag = [...bag];
  const discarded: string[] = [];
  // Draw before returning discarded tiles so none can be redrawn immediately.
  for (const index of [...indices].sort((a, b) => a - b)) {
    discarded.push(rack[index]!);
    nextRack[index] = nextBag.shift()!;
  }
  nextBag.push(...discarded);
  return { rack: nextRack, tileBag: nextBag, discarded };
}
