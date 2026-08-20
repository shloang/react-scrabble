import { test, describe, before } from 'node:test';
import assert from 'node:assert';
import {
  calculateScoreBreakdown,
  calculateRemainingTilesCost, 
  checkGameEnd,
} from '../server/gameLogic.ts';
import type { GameState, Player } from '../shared/schema.ts';

function createTestGameState(overrides?: Partial<GameState>): GameState {
  const state: GameState = {
    board: Array(15).fill(null).map(() => Array(15).fill(null)),
    tileBag: [],
    revision: 1,
    players: [
      {
        id: 'player1',
        name: 'Player 1',
        rack: ['А', 'Б', 'В', 'Г', 'Д', 'Е', 'Ж'],
        score: 100
      },
      {
        id: 'player2',
        name: 'Player 2',
        rack: ['З', 'И', 'Й', 'К', 'Л', 'М', 'Н'],
        score: 95
      }
    ],
    currentPlayer: null,
    turn: 0,
    moves: [],
    gameEnded: false,
    ...overrides
  };
  return state;
}

describe('Penalty-Based Scoring', () => {
  test('calculateRemainingTilesCost with various tiles', () => {
    // Test with specific tiles
    const rack1: (string | null)[] = ['А', 'Б', 'В', null, null, null, null];
    // А=1, Б=3, В=2 = 6 total
    assert.strictEqual(calculateRemainingTilesCost(rack1), 6, 'Should calculate correct cost for A+B+V');

    // Test with high-value tiles
    const rack2: (string | null)[] = ['Ф', 'Ч', 'Щ', null, null, null, null];
    // Ф=10, Ч=5, Щ=10 = 25 total
    assert.strictEqual(calculateRemainingTilesCost(rack2), 25, 'Should calculate correct cost for high-value tiles');

    // Test with blank tiles (should be 0)
    const rack3: (string | null)[] = ['?', '?', 'А', null, null, null, null];
    // ?=0, ?=0, А=1 = 1 total
    assert.strictEqual(calculateRemainingTilesCost(rack3), 1, 'Should treat blanks as 0 value');

    // Test with empty rack
    const rack4: (string | null)[] = [null, null, null, null, null, null, null];
    assert.strictEqual(calculateRemainingTilesCost(rack4), 0, 'Should return 0 for empty rack');
  });

  test('checkGameEnd with player running out of tiles', () => {
    const gameState = createTestGameState({
      tileBag: [],
      players: [
        {
          id: 'player1',
          name: 'Player 1',
          rack: [null, null, null, null, null, null, null], // Empty rack
          score: 100
        },
        {
          id: 'player2',
          name: 'Player 2',
          rack: ['З', 'И', 'Й', 'К', 'Л', 'М', 'Н'], // З=5, И=1, Й=4, К=2, Л=2, М=2, Н=1 = 17
          score: 95
        }
      ]
    });

    const result = checkGameEnd(gameState);
    
    assert.strictEqual(result.ended, true, 'Game should end when player runs out of tiles');
    assert.strictEqual(result.reason, 'player_out_of_tiles', 'Reason should be player_out_of_tiles');
    assert.strictEqual(result.winnerId, 'player1', 'Player 1 should be winner (100 > 95-17=78)');
    
    // Verify penalty was applied
    const player2 = gameState.players.find(p => p.id === 'player2');
    assert.strictEqual(player2?.tilePenalty, 17, 'Player 2 penalty should be 17');
    assert.strictEqual(player2?.originalScore, 95, 'Player 2 original score should be 95');
    assert.strictEqual(player2?.score, 78, 'Player 2 final score should be 95 - 17 = 78');
  });

  test('checkGameEnd penality changes winner', () => {
    const gameState = createTestGameState({
      tileBag: [],
      players: [
        {
          id: 'player1',
          name: 'Player 1',
          rack: [null, null, null, null, null, null, null], // Empty rack, penalty = 0
          score: 50
        },
        {
          id: 'player2',
          name: 'Player 2',
          rack: ['Ф', 'Х', 'Ц', 'Ч', 'Щ', 'Ш', 'Э'], // High value tiles: 10+5+9+5+10+8+8 = 55
          score: 100
        }
      ]
    });

    const result = checkGameEnd(gameState);
    
    assert.strictEqual(result.ended, true, 'Game should end');
    assert.strictEqual(result.winnerId, 'player1', 'Player 1 should win (50 > 100-55=45) after penalty');
    
    const player2 = gameState.players.find(p => p.id === 'player2');
    assert.strictEqual(player2?.score, 45, 'Player 2 final score should be 45 after penalty');
  });

  test('checkGameEnd returns a draw for tied highest scores after penalties', () => {
    const gameState = createTestGameState({
      tileBag: [],
      players: [
        {
          id: 'player1',
          name: 'Player 1',
          rack: [null, null, null, null, null, null, null],
          score: 50,
        },
        {
          id: 'player2',
          name: 'Player 2',
          rack: ['А', null, null, null, null, null, null],
          score: 51,
        },
        {
          id: 'player3',
          name: 'Player 3',
          rack: ['Б', null, null, null, null, null, null],
          score: 40,
        },
      ],
    });

    const result = checkGameEnd(gameState);

    assert.strictEqual(result.ended, true);
    assert.strictEqual(result.winnerId, undefined);
    assert.deepStrictEqual(result.drawPlayerIds, ['player1', 'player2']);
    assert.deepStrictEqual(gameState.players.map(player => player.score), [50, 50, 37]);
  });

  test('score breakdown keeps individual word scores separate from the 50-point bonus', () => {
    const board = Array(15).fill(null).map(() => Array(15).fill(null));
    board[7][7] = { letter: 'А' };
    board[7][8] = { letter: 'Б' };
    board[6][8] = { letter: 'О' };

    const placedTiles = [
      { row: 7, col: 7, letter: 'А' },
      { row: 7, col: 8, letter: 'Б' },
      { row: 0, col: 1, letter: 'А' },
      { row: 0, col: 2, letter: 'А' },
      { row: 0, col: 3, letter: 'А' },
      { row: 0, col: 4, letter: 'А' },
      { row: 0, col: 5, letter: 'А' },
    ];
    for (const tile of placedTiles.slice(2)) {
      board[tile.row][tile.col] = { letter: tile.letter };
    }

    const breakdown = calculateScoreBreakdown([
      { word: 'АБ', positions: [{ row: 7, col: 7 }, { row: 7, col: 8 }] },
      { word: 'ОБ', positions: [{ row: 6, col: 8 }, { row: 7, col: 8 }] },
    ], board, placedTiles);

    assert.deepStrictEqual(breakdown.wordScores, [
      { word: 'АБ', score: 8 },
      { word: 'ОБ', score: 4 },
    ]);
    assert.strictEqual(breakdown.bingoBonus, 50);
    assert.strictEqual(breakdown.totalScore, 62);
  });

  test('checkGameEnd with all players skipping twice', () => {
    const gameState = createTestGameState({
      tileBag: ['А', 'Б'],
      moves: [
        { playerId: 'player1', playerName: 'Player 1', words: [], score: 0, turn: 0, timestamp: 0, type: 'skip' },
        { playerId: 'player2', playerName: 'Player 2', words: [], score: 0, turn: 1, timestamp: 1, type: 'skip' },
        { playerId: 'player1', playerName: 'Player 1', words: [], score: 0, turn: 2, timestamp: 2, type: 'skip' },
        { playerId: 'player2', playerName: 'Player 2', words: [], score: 0, turn: 3, timestamp: 3, type: 'skip' }
      ],
      players: [
        {
          id: 'player1',
          name: 'Player 1',
          rack: ['А', 'Б', 'В', 'Г', 'Д', 'Е', 'Ж'], // А=1, Б=3, В=2, Г=3, Д=2, Е=1, Ж=5 = 17
          score: 100
        },
        {
          id: 'player2',
          name: 'Player 2',
          rack: ['З', 'И', null, null, null, null, null], // З=5, И=1 = 6
          score: 105
        }
      ]
    });

    const result = checkGameEnd(gameState);
    
    assert.strictEqual(result.ended, true, 'Game should end on double skip');
    assert.strictEqual(result.reason, 'all_skipped_twice', 'Reason should be all_skipped_twice');
    // Player 1: 100-17=83, Player 2: 105-6=99 → Player 2 wins
    assert.strictEqual(result.winnerId, 'player2', 'Player 2 should win (105-6=99 > 100-17=83) after penalties');
    
    const player1 = gameState.players.find(p => p.id === 'player1');
    assert.strictEqual(player1?.score, 83, 'Player 1 final score should be 83');
  });

  test('checkGameEnd with blank tiles (value 0)', () => {
    const gameState = createTestGameState({
      tileBag: [],
      players: [
        {
          id: 'player1',
          name: 'Player 1',
          rack: [null, null, null, null, null, null, null], // Empty rack
          score: 50
        },
        {
          id: 'player2',
          name: 'Player 2',
          rack: ['?', '?', '?', 'А', 'Б', 'В', 'Г'], // Blanks have 0 value: 0+0+0+1+3+2+3 = 9
          score: 60
        }
      ]
    });

    const result = checkGameEnd(gameState);
    
    assert.strictEqual(result.ended, true, 'Game should end');
    // Player 1: 50, Player 2: 60-9=51 → Player 2 wins
    assert.strictEqual(result.winnerId, 'player2', 'Player 2 should win (60-9=51 > 50)');
    
    const player2 = gameState.players.find(p => p.id === 'player2');
    assert.strictEqual(player2?.tilePenalty, 9, 'Player 2 penalty should be 9 (blanks count as 0)');
  });

  test('checkGameEnd game not ended when bag has tiles', () => {
    const gameState = createTestGameState({
      tileBag: ['О', 'П', 'Р'], // Bag is not empty
      players: [
        {
          id: 'player1',
          name: 'Player 1',
          rack: [null, null, null, null, null, null, null], // Empty rack
          score: 100
        },
        {
          id: 'player2',
          name: 'Player 2',
          rack: ['З', 'И', 'Й', 'К', 'Л', 'М', 'Н'],
          score: 95
        }
      ]
    });

    const result = checkGameEnd(gameState);
    
    assert.strictEqual(result.ended, false, 'Game should not end if bag has tiles');
  });
});
