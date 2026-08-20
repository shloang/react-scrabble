import test from 'node:test';
import assert from 'node:assert/strict';
import type { Move } from '../shared/schema.ts';
import { getEndGameHighlights } from '../client/src/lib/endGameStats.ts';

test('best word uses its individual score and excludes the all-tiles bonus', () => {
  const moves: Move[] = [
    {
      playerId: 'p1',
      playerName: 'Alice',
      words: ['ПЕРВОЕ', 'ВТОРОЕ'],
      wordScores: [
        { word: 'ПЕРВОЕ', score: 8 },
        { word: 'ВТОРОЕ', score: 30 },
      ],
      bingoBonus: 0,
      score: 38,
      turn: 1,
      timestamp: 1,
      type: 'play',
    },
    {
      playerId: 'p2',
      playerName: 'Bob',
      words: ['БОНУС'],
      wordScores: [{ word: 'БОНУС', score: 15 }],
      bingoBonus: 50,
      score: 65,
      turn: 2,
      timestamp: 2,
      type: 'play',
    },
  ];

  const highlights = getEndGameHighlights(moves);

  assert.equal(highlights.highestMove?.score, 65);
  assert.deepEqual(
    { word: highlights.highestWord.word, score: highlights.highestWord.score },
    { word: 'ВТОРОЕ', score: 30 },
  );
});

test('older multi-word moves are reconstructed from placed tiles instead of averaged', () => {
  const moves: Move[] = [
    {
      playerId: 'p1',
      playerName: 'Alice',
      words: ['SETUP'],
      wordScores: [{ word: 'SETUP', score: 0 }],
      bingoBonus: 0,
      score: 0,
      turn: 1,
      timestamp: 1,
      type: 'play',
      meta: {
        placedTiles: [
          { row: 7, col: 6, letter: 'А' },
          { row: 7, col: 8, letter: 'Б' },
          { row: 6, col: 7, letter: 'О' },
          { row: 8, col: 7, letter: 'К' },
        ],
      },
    },
    {
      playerId: 'p2',
      playerName: 'Bob',
      words: ['АРБ', 'ОРК'],
      score: 22,
      turn: 2,
      timestamp: 2,
      type: 'play',
      meta: { placedTiles: [{ row: 7, col: 7, letter: 'Р' }] },
    },
  ];

  const highlights = getEndGameHighlights(moves);

  assert.deepEqual(
    { word: highlights.highestWord.word, score: highlights.highestWord.score },
    { word: 'АРБ', score: 12 },
  );
});
