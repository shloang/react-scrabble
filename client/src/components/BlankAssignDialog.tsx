import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { TILE_VALUES } from '@shared/schema';

interface Props {
  open: boolean;
  defaultValue?: string;
  onConfirm: (letter: string) => void;
  onCancel: () => void;
}

const LETTERS = Object.keys(TILE_VALUES).filter(l => l !== '?');

export default function BlankAssignDialog({ open, defaultValue = '', onConfirm, onCancel }: Props) {
  const [value, setValue] = useState(defaultValue);

  useEffect(() => {
    setValue(defaultValue);
  }, [defaultValue, open]);

  const handleClick = (letter: string) => {
    setValue(letter);
    onConfirm(letter);
  };

  return (
    <Dialog open={open}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Пустая фишка — выберите букву</DialogTitle>
          <DialogDescription>Выберите одну букву (А–Я). Буква будет использоваться в слове, но сама фишка останется пустой и не приносит очков.</DialogDescription>
        </DialogHeader>

        <div className="mt-4 grid grid-cols-8 gap-2 max-h-[50vh] overflow-auto">
          {LETTERS.map((L) => (
            <button
              key={L}
              className="p-2 bg-card rounded hover:bg-primary/10 text-sm font-medium"
              onClick={() => handleClick(L)}
              type="button"
            >
              {L}
            </button>
          ))}
        </div>

        <DialogFooter className="mt-4">
          <div className="flex gap-2">
            <Button variant="outline" onClick={onCancel}>Отмена</Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
