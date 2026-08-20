import type { Express } from "express";
import net from 'net';
import { createHash, randomBytes, timingSafeEqual } from 'crypto';
import { createServer, type Server } from "http";
import { WebSocketServer, WebSocket } from 'ws';
import { storage, type StoredPlayerStats, type StoredPlayerStatsEntry } from "./storage";
import { BOARD_SIZE, TILE_DISTRIBUTION, MOVE_TIME, type GameState, type Player, gameStateSchema } from "@shared/schema";
import { extractWordsFromBoard, calculateScoreBreakdown, checkGameEnd } from "./gameLogic";
import { loadWordDictionary, isWordValid } from "./wordDictionary";
import os from 'os';
import fs from 'fs';
import path from 'path';

// Load word dictionary on server startup
const USE_WORD_FILE = process.env.USE_WORD_FILE !== 'false'; // Default to true, set USE_WORD_FILE=false to use wiki API
if (USE_WORD_FILE) {
  loadWordDictionary();
}

export async function registerRoutes(app: Express): Promise<Server> {
  let stateMutationQueue: Promise<void> = Promise.resolve();
  type VoiceTokenRecord = { hash: string; expiresAt: number };
  type CachedStatsEntry = {
    playerId: string;
    score: number;
    wins: number;
    losses: number;
    draws: number;
    games: number;
    cachedAt: number;
    staleAt: number;
    expiresAt: number;
    stateRevision: number;
  };
  type CacheStatus = 'fresh' | 'stale' | 'expired';
  const voiceTokens = new Map<string, VoiceTokenRecord>();
  const playerStatsCache = new Map<string, CachedStatsEntry>();
  const playerStatsCacheLogSignatures = new Map<string, string>();
  const playerStatsCacheStatusByPlayer = new Map<string, CacheStatus>();

  const MAX_AVATAR_REMOTE_URL_LENGTH = 1024;
  const MAX_AVATAR_DATA_URL_LENGTH = parseInt(process.env.MAX_AVATAR_DATA_URL_LENGTH || '360000', 10);
  const MAX_AVATAR_DATA_BYTES = parseInt(process.env.MAX_AVATAR_DATA_BYTES || '262144', 10);
  const ALLOWED_AVATAR_MIME = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
  const AVATAR_FALLBACK_PALETTE: Array<{ backgroundColor: string; textColor: string }> = [
    { backgroundColor: '#0f766e', textColor: '#ecfeff' },
    { backgroundColor: '#1d4ed8', textColor: '#eff6ff' },
    { backgroundColor: '#7c2d12', textColor: '#fff7ed' },
    { backgroundColor: '#3f3f46', textColor: '#f4f4f5' },
    { backgroundColor: '#166534', textColor: '#f0fdf4' },
    { backgroundColor: '#831843', textColor: '#fdf2f8' },
    { backgroundColor: '#4338ca', textColor: '#eef2ff' },
    { backgroundColor: '#92400e', textColor: '#fffbeb' },
  ];

  const VOICE_TOKEN_TTL_MS = parseInt(process.env.VOICE_TOKEN_TTL_MS || '7200000', 10);
  const FUTURE_SKEW_MS = 5000;

  function boundedMs(rawValue: string | undefined, fallbackMs: number, minMs: number, maxMs: number): number {
    const parsed = parseInt(String(rawValue || fallbackMs), 10);
    if (!Number.isFinite(parsed)) return fallbackMs;
    return Math.min(maxMs, Math.max(minMs, parsed));
  }

  const PLAYER_STATS_FRESH_MS = boundedMs(
    process.env.PLAYER_STATS_FRESH_MS,
    5 * 60 * 1000,
    30 * 1000,
    7 * 24 * 60 * 60 * 1000,
  );
  const PLAYER_STATS_STALE_MS = Math.max(
    PLAYER_STATS_FRESH_MS,
    boundedMs(
      process.env.PLAYER_STATS_STALE_MS,
      24 * 60 * 60 * 1000,
      60 * 1000,
      30 * 24 * 60 * 60 * 1000,
    ),
  );
  const PLAYER_STATS_EXPIRE_MS = Math.max(
    PLAYER_STATS_STALE_MS,
    boundedMs(
      process.env.PLAYER_STATS_EXPIRE_MS,
      7 * 24 * 60 * 60 * 1000,
      5 * 60 * 1000,
      90 * 24 * 60 * 60 * 1000,
    ),
  );
  const SESSION_STALE_MS = 24 * 60 * 60 * 1000;

  function sanitizeStoredStatsEntry(entry?: Partial<StoredPlayerStatsEntry> | null): StoredPlayerStatsEntry {
    return {
      wins: Math.max(0, Math.floor(Number(entry?.wins) || 0)),
      losses: Math.max(0, Math.floor(Number(entry?.losses) || 0)),
      draws: Math.max(0, Math.floor(Number(entry?.draws) || 0)),
      games: Math.max(0, Math.floor(Number(entry?.games) || 0)),
      updatedAt: Number.isFinite(entry?.updatedAt) ? Number(entry?.updatedAt) : 0,
      lastGameKey: typeof entry?.lastGameKey === 'string' ? entry.lastGameKey : undefined,
    };
  }

  function normalizeStatsName(name: string): string {
    return String(name || '').trim().toLowerCase();
  }

  function statsNameKey(name: string): string | null {
    const normalized = normalizeStatsName(name);
    return normalized ? `name:${normalized}` : null;
  }

  function pickLatestStatsEntry(...entries: Array<StoredPlayerStatsEntry | undefined>): StoredPlayerStatsEntry {
    return entries
      .map((entry) => sanitizeStoredStatsEntry(entry))
      .sort((a, b) => {
        if (b.games !== a.games) return b.games - a.games;
        return b.updatedAt - a.updatedAt;
      })[0] || sanitizeStoredStatsEntry(null);
  }

  async function loadStoredPlayerStats(): Promise<StoredPlayerStats> {
    if (typeof storage.getPlayerStats !== 'function') return {};
    const raw = await storage.getPlayerStats();
    const out: StoredPlayerStats = {};
    for (const [playerId, entry] of Object.entries(raw || {})) {
      out[playerId] = sanitizeStoredStatsEntry(entry);
    }
    return out;
  }

  async function saveStoredPlayerStats(stats: StoredPlayerStats): Promise<void> {
    if (typeof storage.savePlayerStats !== 'function') return;
    await storage.savePlayerStats(stats);
  }

  function completedGameKey(state: GameState): string {
    const playerIds = (state.players || []).map((p) => p.id).sort().join(',');
    const lastMove = Array.isArray(state.moves) && state.moves.length > 0 ? state.moves[state.moves.length - 1] : null;
    const resultIds = completedGameTopPlayerIds(state).slice().sort().join(',');
    return [
      Number.isFinite(state.sessionCreatedAt) ? Number(state.sessionCreatedAt) : '',
      playerIds,
      resultIds,
      state.endReason || '',
      state.moves?.length || 0,
      Number.isFinite(lastMove?.timestamp) ? Number(lastMove?.timestamp) : '',
    ].join('|');
  }

  function completedGameTopPlayerIds(state: GameState): string[] {
    const playerIds = new Set((state.players || []).map(player => player.id));
    const explicitDrawIds = Array.isArray(state.drawPlayerIds)
      ? Array.from(new Set(state.drawPlayerIds.filter(id => playerIds.has(id))))
      : [];
    if (explicitDrawIds.length > 1) return explicitDrawIds;

    const scores = (state.players || []).map(player => Number(player.score));
    if (scores.length === 0 || scores.some(score => !Number.isFinite(score))) return [];
    const highestScore = Math.max(...scores);
    const tiedTopIds = state.players
      .filter(player => Number(player.score) === highestScore)
      .map(player => player.id);
    if (tiedTopIds.length > 1) return tiedTopIds;
    if (state.winnerId && playerIds.has(state.winnerId)) return [state.winnerId];
    return [];
  }

  async function recordCompletedGameStats(state: GameState): Promise<void> {
    if (!state?.gameEnded || !Array.isArray(state.players) || state.players.length === 0) return;
    const topPlayerIds = completedGameTopPlayerIds(state);
    if (topPlayerIds.length === 0) return;
    const topPlayerSet = new Set(topPlayerIds);
    const isDraw = topPlayerIds.length > 1;
    const gameKey = completedGameKey(state);
    const now = Date.now();
    const stats = await loadStoredPlayerStats();
    let changed = false;

    for (const player of state.players) {
      const nameKey = statsNameKey(player.name);
      const previous = pickLatestStatsEntry(stats[player.id], nameKey ? stats[nameKey] : undefined);
      if (previous.lastGameKey === gameKey) continue;

      const isTopPlayer = topPlayerSet.has(player.id);
      const next: StoredPlayerStatsEntry = {
        wins: previous.wins + (!isDraw && isTopPlayer ? 1 : 0),
        losses: previous.losses + (isTopPlayer ? 0 : 1),
        draws: previous.draws + (isDraw && isTopPlayer ? 1 : 0),
        games: previous.games + 1,
        updatedAt: now,
        lastGameKey: gameKey,
      };
      stats[player.id] = next;
      if (nameKey) stats[nameKey] = next;
      playerStatsCache.delete(player.id);
      playerStatsCacheLogSignatures.delete(player.id);
      changed = true;
    }

    if (changed) {
      await saveStoredPlayerStats(stats);
    }
  }

  function tokenHash(value: string): string {
    return createHash('sha256').update(value).digest('hex');
  }

  function issueVoiceToken(playerId: string): string {
    const token = randomBytes(32).toString('hex');
    voiceTokens.set(playerId, {
      hash: tokenHash(token),
      expiresAt: Date.now() + VOICE_TOKEN_TTL_MS,
    });
    return token;
  }

  function revokeVoiceToken(playerId: string) {
    voiceTokens.delete(playerId);
  }

  function verifyVoiceToken(playerId: string, token: string): boolean {
    const rec = voiceTokens.get(playerId);
    if (!rec) return false;
    if (Date.now() > rec.expiresAt) {
      voiceTokens.delete(playerId);
      return false;
    }
    const expected = Buffer.from(rec.hash, 'hex');
    const actual = Buffer.from(tokenHash(token), 'hex');
    if (expected.length !== actual.length) return false;
    return timingSafeEqual(expected, actual);
  }

  function pruneExpiredVoiceTokens() {
    const now = Date.now();
    for (const [playerId, rec] of Array.from(voiceTokens.entries())) {
      if (now > rec.expiresAt) {
        voiceTokens.delete(playerId);
      }
    }
  }

  async function withStateMutationLock<T>(work: () => Promise<T>): Promise<T> {
    const previous = stateMutationQueue;
    let release!: () => void;
    stateMutationQueue = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await work();
    } finally {
      release();
    }
  }

  function runLocked(handler: (req: any, res: any) => Promise<any>) {
    return async (req: any, res: any) => {
      return withStateMutationLock(() => handler(req, res));
    };
  }

  function stateRevision(state?: GameState | null): number {
    return typeof state?.revision === "number" ? state.revision : 0;
  }

  function bumpRevision(state: GameState): GameState {
    state.revision = stateRevision(state) + 1;
    return state;
  }

  function fallbackInitials(name: string): string {
    const trimmed = String(name || '').trim().replace(/\s+/g, ' ');
    if (!trimmed) return '??';
    const parts = trimmed.split(' ').filter(Boolean);
    if (parts.length >= 2) {
      const a = Array.from(parts[0])[0] || '?';
      const b = Array.from(parts[1])[0] || '?';
      return `${a}${b}`.toUpperCase();
    }
    const chars = Array.from(parts[0]);
    const first = chars[0] || '?';
    const second = chars[1] || first || '?';
    return `${first}${second}`.toUpperCase();
  }

  function buildAvatarFallback(player: Pick<Player, 'id' | 'name'>): NonNullable<Player['avatarFallback']> {
    const seed = createHash('sha256').update(`${player.id}:${String(player.name || '').trim().toLowerCase()}`).digest('hex').slice(0, 16);
    const idx = parseInt(seed.slice(0, 8), 16) % AVATAR_FALLBACK_PALETTE.length;
    const palette = AVATAR_FALLBACK_PALETTE[idx];
    return {
      seed,
      initials: fallbackInitials(player.name),
      backgroundColor: palette.backgroundColor,
      textColor: palette.textColor,
    };
  }

  function sanitizeAvatarUrlInput(rawValue: unknown): { avatarUrl?: string; error?: string } {
    if (rawValue === null || rawValue === undefined) return {};
    if (typeof rawValue !== 'string') return { error: 'avatarUrl must be a string when provided' };

    const trimmed = rawValue.trim();
    if (!trimmed) return {};

    if (/[\u0000-\u001F\u007F]/.test(trimmed)) {
      return { error: 'avatarUrl contains control characters' };
    }

    if (/^data:/i.test(trimmed)) {
      if (trimmed.length > MAX_AVATAR_DATA_URL_LENGTH) {
        return { error: `avatar data URL exceeds ${MAX_AVATAR_DATA_URL_LENGTH} characters` };
      }
      const m = trimmed.match(/^data:([^;,]+);base64,([A-Za-z0-9+/=\s]+)$/i);
      if (!m) return { error: 'avatar data URL must be base64 encoded image data' };

      const normalizedMime = m[1].toLowerCase() === 'image/jpg' ? 'image/jpeg' : m[1].toLowerCase();
      if (!ALLOWED_AVATAR_MIME.has(normalizedMime)) {
        return { error: `avatar content type ${normalizedMime} is not allowed` };
      }

      const base64Payload = m[2].replace(/\s+/g, '');
      if (!base64Payload || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64Payload)) {
        return { error: 'avatar data URL payload is not valid base64' };
      }

      const bytes = Buffer.byteLength(base64Payload, 'base64');
      if (!Number.isFinite(bytes) || bytes <= 0) {
        return { error: 'avatar data URL payload is empty' };
      }
      if (bytes > MAX_AVATAR_DATA_BYTES) {
        return { error: `avatar upload too large (${bytes} bytes > ${MAX_AVATAR_DATA_BYTES} bytes)` };
      }

      return { avatarUrl: `data:${normalizedMime};base64,${base64Payload}` };
    }

    if (trimmed.length > MAX_AVATAR_REMOTE_URL_LENGTH) {
      return { error: `avatarUrl exceeds ${MAX_AVATAR_REMOTE_URL_LENGTH} characters` };
    }

    let parsed: URL;
    try {
      parsed = new URL(trimmed);
    } catch {
      return { error: 'avatarUrl must be a valid absolute URL' };
    }

    if (!/^https?:$/i.test(parsed.protocol)) {
      return { error: 'avatarUrl must use http or https' };
    }
    if (parsed.username || parsed.password) {
      return { error: 'avatarUrl cannot include credentials' };
    }

    const normalized = parsed.toString();
    if (normalized.length > MAX_AVATAR_REMOTE_URL_LENGTH) {
      return { error: `normalized avatarUrl exceeds ${MAX_AVATAR_REMOTE_URL_LENGTH} characters` };
    }

    return { avatarUrl: normalized };
  }

  function normalizePlayerAvatar(player: Player): { changed: boolean; invalidReason?: string } {
    const previousUrl = typeof player.avatarUrl === 'string' ? player.avatarUrl : undefined;
    const previousFallback = player.avatarFallback;
    const sanitized = sanitizeAvatarUrlInput(previousUrl);

    if (sanitized.avatarUrl) player.avatarUrl = sanitized.avatarUrl;
    else delete (player as any).avatarUrl;

    const fallback = buildAvatarFallback(player);
    player.avatarFallback = fallback;

    const fallbackChanged = !previousFallback
      || previousFallback?.seed !== fallback.seed
      || previousFallback?.initials !== fallback.initials
      || previousFallback?.backgroundColor !== fallback.backgroundColor
      || previousFallback?.textColor !== fallback.textColor;

    return {
      changed: previousUrl !== player.avatarUrl || fallbackChanged,
      invalidReason: sanitized.error,
    };
  }

  function normalizeGameStateAvatars(state?: GameState | null): boolean {
    if (!state || !Array.isArray(state.players)) return false;
    let changed = false;
    for (const p of state.players) {
      const result = normalizePlayerAvatar(p);
      if (result.changed) changed = true;
    }
    return changed;
  }

  function gameInProgress(state?: GameState | null): boolean {
    if (!state) return false;
    return !!state.currentPlayer && (state.turn || 0) > 0 && !state.gameEnded;
  }

  function findCommittedBoardChange(previousBoard: GameState['board'], incomingBoard: GameState['board']) {
    for (let row = 0; row < BOARD_SIZE; row += 1) {
      for (let col = 0; col < BOARD_SIZE; col += 1) {
        const previousCell = previousBoard[row]?.[col];
        if (!previousCell) continue;

        const incomingCell = incomingBoard[row]?.[col];
        if (!incomingCell) {
          return { row, col, kind: 'removed' as const, previousCell };
        }

        if (
          incomingCell.letter !== previousCell.letter
          || !!incomingCell.blank !== !!previousCell.blank
        ) {
          return { row, col, kind: 'changed' as const, previousCell, incomingCell };
        }
      }
    }

    return null;
  }

  function findBoardAdditions(previousBoard: GameState['board'], incomingBoard: GameState['board']) {
    const additions: Array<{ row: number; col: number; cell: NonNullable<GameState['board'][number][number]> }> = [];
    for (let row = 0; row < BOARD_SIZE; row += 1) {
      for (let col = 0; col < BOARD_SIZE; col += 1) {
        const previousCell = previousBoard[row]?.[col];
        const incomingCell = incomingBoard[row]?.[col];
        if (!previousCell && incomingCell) additions.push({ row, col, cell: incomingCell });
      }
    }
    return additions;
  }

  function headerValue(value: string | string[] | undefined): string {
    if (Array.isArray(value)) return String(value[0] || '').trim();
    return String(value || '').trim();
  }

  function parseRequesterCredentials(req: any): { requesterId: string; requesterPassword: string } {
    const requesterIdFromQuery = typeof req.query?.requesterId === 'string' ? req.query.requesterId : '';
    const requesterPasswordFromQuery = typeof req.query?.requesterPassword === 'string' ? req.query.requesterPassword : '';
    const requesterIdFromHeader = headerValue(req.headers?.['x-player-id']);
    const requesterPasswordFromHeader = headerValue(req.headers?.['x-player-password']);

    return {
      requesterId: String(requesterIdFromQuery || requesterIdFromHeader || '').trim(),
      requesterPassword: String(requesterPasswordFromQuery || requesterPasswordFromHeader || '').trim(),
    };
  }

  async function authorizePlayerStatsRead(req: any, state: GameState): Promise<{ allowed: true; mode: string } | { allowed: false; status: number; error: string }> {
    const { requesterId, requesterPassword } = parseRequesterCredentials(req);

    // Backward compatibility for current lobby behavior: before game start,
    // stats can be fetched without explicit requester credentials.
    if (!requesterId) {
      if (gameInProgress(state)) {
        return {
          allowed: false,
          status: 401,
          error: 'requesterId required once game has started',
        };
      }
      return { allowed: true, mode: 'legacy-anonymous' };
    }

    const requester = state.players.find((pl) => pl.id === requesterId);
    if (!requester) {
      return {
        allowed: false,
        status: 403,
        error: 'Requester is not a participant in this game',
      };
    }

    if (requesterPassword) {
      const ok = await storage.verifyPlayerPassword(requesterId, requesterPassword);
      if (!ok) {
        return {
          allowed: false,
          status: 401,
          error: 'Invalid requester credentials',
        };
      }
      return { allowed: true, mode: 'participant-password' };
    }

    return { allowed: true, mode: 'participant-id' };
  }

  function hasValidStatsMetadata(entry: CachedStatsEntry, now: number): boolean {
    if (!entry || typeof entry !== 'object') return false;
    if (!Number.isFinite(entry.cachedAt) || !Number.isFinite(entry.staleAt) || !Number.isFinite(entry.expiresAt)) return false;
    if (!Number.isFinite(entry.wins) || !Number.isFinite(entry.losses) || !Number.isFinite(entry.draws) || !Number.isFinite(entry.games) || !Number.isFinite(entry.score)) return false;
    if (!Number.isFinite(entry.stateRevision)) return false;
    if (entry.cachedAt > now + FUTURE_SKEW_MS) return false;
    if (entry.staleAt < entry.cachedAt) return false;
    if (entry.expiresAt < entry.staleAt) return false;
    const staleWindowMs = entry.staleAt - entry.cachedAt;
    const expireWindowMs = entry.expiresAt - entry.cachedAt;
    if (staleWindowMs < PLAYER_STATS_FRESH_MS) return false;
    if (staleWindowMs > PLAYER_STATS_STALE_MS + FUTURE_SKEW_MS) return false;
    if (expireWindowMs < PLAYER_STATS_STALE_MS) return false;
    if (expireWindowMs > PLAYER_STATS_EXPIRE_MS + FUTURE_SKEW_MS) return false;
    return true;
  }

  function buildStatsCacheEntry(player: Player, revision: number, now: number, stored?: StoredPlayerStatsEntry): CachedStatsEntry {
    const totals = sanitizeStoredStatsEntry(stored);
    return {
      playerId: player.id,
      score: Number(player.score) || 0,
      wins: totals.wins,
      losses: totals.losses,
      draws: totals.draws,
      games: totals.games,
      cachedAt: now,
      staleAt: now + PLAYER_STATS_STALE_MS,
      expiresAt: now + PLAYER_STATS_EXPIRE_MS,
      stateRevision: Math.max(0, Number(revision) || 0),
    };
  }

  function buildStatsResponse(entry: CachedStatsEntry, now: number) {
    const ageMs = Math.max(0, now - entry.cachedAt);
    const isExpired = now >= entry.expiresAt;
    const isStale = isExpired || now >= entry.staleAt;
    const cacheStatus: CacheStatus = isExpired ? 'expired' : (isStale ? 'stale' : 'fresh');

    return {
      playerId: entry.playerId,
      score: entry.score,
      wins: entry.wins,
      losses: entry.losses,
      draws: entry.draws,
      games: entry.games,
      cachedAt: entry.cachedAt,
      staleAt: entry.staleAt,
      expiresAt: entry.expiresAt,
      isStale,
      isExpired,
      cacheStatus,
      ageMs,
      source: 'server-snapshot',
    };
  }

  function logPlayerStatsCacheEvent(playerId: string, payload: {
    event: 'hit' | 'miss' | 'repair';
    reason: string;
    cacheStatus: 'fresh' | 'stale' | 'expired';
    revision: number;
    score: number;
    ageMs: number;
    authMode: string;
  }) {
    const signature = [
      payload.event,
      payload.reason,
      payload.cacheStatus,
      payload.revision,
      payload.score,
      Math.floor(payload.ageMs / 1000),
      payload.authMode,
    ].join('|');

    const previous = playerStatsCacheLogSignatures.get(playerId);
    if (previous === signature) return;
    playerStatsCacheLogSignatures.set(playerId, signature);

    console.info('[PlayerStatsCache]', {
      playerId,
      ...payload,
    });

    const prevStatus = playerStatsCacheStatusByPlayer.get(playerId);
    if (prevStatus !== payload.cacheStatus) {
      console.info('[PlayerStatsCacheTransition]', {
        playerId,
        from: prevStatus || 'none',
        to: payload.cacheStatus,
      });
      playerStatsCacheStatusByPlayer.set(playerId, payload.cacheStatus);
    }
  }

  function isStatsResponseConsistent(response: ReturnType<typeof buildStatsResponse>, now: number): boolean {
    if (!Number.isFinite(response.cachedAt) || !Number.isFinite(response.staleAt) || !Number.isFinite(response.expiresAt)) return false;
    if (response.cachedAt > now + FUTURE_SKEW_MS) return false;
    if (response.staleAt < response.cachedAt) return false;
    if (response.expiresAt < response.staleAt) return false;
    const staleWindowMs = response.staleAt - response.cachedAt;
    const expireWindowMs = response.expiresAt - response.cachedAt;
    if (staleWindowMs < PLAYER_STATS_FRESH_MS) return false;
    if (staleWindowMs > PLAYER_STATS_STALE_MS + FUTURE_SKEW_MS) return false;
    if (expireWindowMs < PLAYER_STATS_STALE_MS) return false;
    if (expireWindowMs > PLAYER_STATS_EXPIRE_MS + FUTURE_SKEW_MS) return false;
    if (!['fresh', 'stale', 'expired'].includes(response.cacheStatus)) return false;
    return true;
  }

  function stateEvidenceLastActivityAt(state?: GameState | null): number | null {
    if (!state) return null;
    const candidates: number[] = [];
    if (Number.isFinite(state.lastActivityAt)) candidates.push(Number(state.lastActivityAt));
    if (Number.isFinite(state.turnStart)) candidates.push(Number(state.turnStart));
    if (Number.isFinite(state.pausedAt)) candidates.push(Number(state.pausedAt));
    if (Array.isArray(state.moves)) {
      for (const mv of state.moves) {
        if (Number.isFinite(mv?.timestamp)) candidates.push(Number(mv.timestamp));
      }
    }
    if (!candidates.length) return null;
    return Math.max(...candidates);
  }

  function touchStateActivity(state: GameState, now = Date.now()): GameState {
    if (!Number.isFinite(state.sessionCreatedAt)) {
      state.sessionCreatedAt = now;
    }
    state.lastActivityAt = now;
    return state;
  }

  async function loadActiveStateWithExpiry(): Promise<{ state: GameState | undefined; expired: boolean }> {
    let state = await storage.getGameState();
    if (!state) return { state: undefined, expired: false };

    const now = Date.now();
    const lastActivity = stateEvidenceLastActivityAt(state);
    if (Number.isFinite(lastActivity) && (now - Number(lastActivity)) >= SESSION_STALE_MS) {
      const resetState = touchStateActivity(createEmptyGameState(), now);
      bumpRevision(resetState);
      await storage.saveGameState(resetState);
      return { state: resetState, expired: true };
    }

    // Backfill timestamps for old states so expiration works consistently.
    let changed = false;
    if (!Number.isFinite(state.sessionCreatedAt)) {
      state.sessionCreatedAt = Number.isFinite(lastActivity) ? Number(lastActivity) : now;
      changed = true;
    }
    if (!Number.isFinite(state.lastActivityAt)) {
      state.lastActivityAt = Number.isFinite(lastActivity) ? Number(lastActivity) : now;
      changed = true;
    }
    if (changed) {
      await storage.saveGameState(state);
    }

    return { state, expired: false };
  }

  function cleanupPlayerStatsCache(state: GameState, now: number, revision: number) {
    const playersById = new Map((state.players || []).map((pl) => [pl.id, pl]));

    for (const [key, entry] of Array.from(playerStatsCache.entries())) {
      const livePlayer = playersById.get(key);
      if (!livePlayer) {
        playerStatsCache.delete(key);
        playerStatsCacheLogSignatures.delete(key);
        playerStatsCacheStatusByPlayer.delete(key);
        continue;
      }

      const liveScore = Number(livePlayer.score) || 0;
      const shouldDrop = !hasValidStatsMetadata(entry, now)
        || now >= entry.expiresAt
        || entry.playerId !== key
        || entry.stateRevision !== revision
        || entry.score !== liveScore;

      if (shouldDrop) {
        playerStatsCache.delete(key);
        playerStatsCacheLogSignatures.delete(key);
      }
    }
  }

  function createEmptyGameState(): GameState {
    const now = Date.now();
    const bag: string[] = [];
    Object.entries(TILE_DISTRIBUTION).forEach(([letter, count]) => {
      for (let i = 0; i < count; i++) {
        bag.push(letter);
      }
    });

    for (let i = bag.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [bag[i], bag[j]] = [bag[j], bag[i]];
    }

    return {
      board: Array(BOARD_SIZE).fill(null).map(() => Array(BOARD_SIZE).fill(null)),
      tileBag: bag,
      revision: 0,
      players: [],
      currentPlayer: null,
      turn: 0,
      moves: [],
      paused: false,
      pausedBy: null,
      turnStart: null,
      pausedAt: null,
      sessionCreatedAt: now,
      lastActivityAt: now,
      gameEnded: false,
      winnerId: undefined,
      drawPlayerIds: undefined,
      endReason: undefined,
      previews: {},
    };
  }

  function createFreshLobbyPreservingPlayers(previous: GameState): GameState {
    const nextState = createEmptyGameState();
    const players = Array.isArray(previous.players) ? previous.players : [];

    nextState.players = players.map((player) => {
      const rack: (string | null)[] = nextState.tileBag.splice(0, 7);
      while (rack.length < 7) rack.push(null);

      const nextPlayer: Player = {
        id: player.id,
        name: player.name,
        rack,
        score: 0,
        ready: false,
        voiceEnabled: false,
      };

      if (player.avatarUrl) nextPlayer.avatarUrl = player.avatarUrl;
      if (player.avatarFallback) nextPlayer.avatarFallback = player.avatarFallback;

      return nextPlayer;
    });

    nextState.currentPlayer = null;
    nextState.turn = 0;
    nextState.moves = [];
    nextState.gameEnded = false;
    nextState.winnerId = undefined;
    nextState.drawPlayerIds = undefined;
    nextState.endReason = undefined;
    nextState.paused = false;
    nextState.pausedBy = null;
    nextState.turnStart = null;
    nextState.pausedAt = null;
    nextState.previews = {};

    normalizeGameStateAvatars(nextState);
    return nextState;
  }

  // Get current game state
  app.get("/api/game", async (req, res) => {
    try {
      const { state: gameState } = await loadActiveStateWithExpiry();
      normalizeGameStateAvatars(gameState);
      res.json(gameState || null);
    } catch (error) {
      res.status(500).json({ error: "Failed to get game state" });
    }
  });

  // Validate a playerId: returns minimal player info if present
  app.get('/api/player/:id', async (req, res) => {
    try {
      const id = String(req.params.id || '');
      if (!id || typeof id !== 'string') return res.status(400).json({ error: 'Invalid player id' });
      const { state } = await loadActiveStateWithExpiry();
      if (!state || !Array.isArray(state.players)) return res.status(404).json({ error: 'Player not found' });
      const p = state.players.find(pl => pl.id === id);
      if (!p) return res.status(404).json({ error: 'Player not found' });
      normalizePlayerAvatar(p);
      // return only minimal public information
      const out: any = { id: p.id, name: p.name, score: p.score };
      if ((p as any).avatarUrl) out.avatarUrl = (p as any).avatarUrl;
      out.avatarFallback = p.avatarFallback;
      return res.json(out);
    } catch (err) {
      console.error('[PlayerValidate] failed', err);
      return res.status(500).json({ error: 'Failed to validate player' });
    }
  });

  // Initialize or reset game
  app.post("/api/game/init", runLocked(async (req, res) => {
    try {
      const bag: string[] = [];
      Object.entries(TILE_DISTRIBUTION).forEach(([letter, count]) => {
        for (let i = 0; i < count; i++) {
          bag.push(letter);
        }
      });
      
      // Shuffle the bag
      for (let i = bag.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [bag[i], bag[j]] = [bag[j], bag[i]];
      }

      const newGameState: GameState = {
        board: Array(BOARD_SIZE).fill(null).map(() => Array(BOARD_SIZE).fill(null)),
        tileBag: bag,
        players: [],
        currentPlayer: null,
        turn: 0,
        moves: []
        , paused: false,
        pausedBy: null,
        turnStart: null,
        pausedAt: null,
        sessionCreatedAt: Date.now(),
        lastActivityAt: Date.now(),
      };

      touchStateActivity(newGameState);
      bumpRevision(newGameState);
      await storage.saveGameState(newGameState);
      normalizeGameStateAvatars(newGameState);
      res.json(newGameState);
    } catch (error) {
      res.status(500).json({ error: "Failed to initialize game" });
    }
  }));

  // Join game
  app.post("/api/game/join", runLocked(async (req, res) => {
    try {
      const { playerName, password } = req.body;

      if (!playerName || typeof playerName !== 'string' || !playerName.trim()) {
        return res.status(400).json({ error: "Player name is required" });
      }

      if (!password || typeof password !== 'string' || !password.trim()) {
        return res.status(400).json({ error: "Password is required" });
      }

      let { state: gameState } = await loadActiveStateWithExpiry();
      
      // Initialize game if it doesn't exist
      if (!gameState) {
        const bag: string[] = [];
        Object.entries(TILE_DISTRIBUTION).forEach(([letter, count]) => {
          for (let i = 0; i < count; i++) {
            bag.push(letter);
          }
        });
        
        for (let i = bag.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [bag[i], bag[j]] = [bag[j], bag[i]];
        }

        gameState = {
          board: Array(BOARD_SIZE).fill(null).map(() => Array(BOARD_SIZE).fill(null)),
          tileBag: bag,
          players: [],
          currentPlayer: null,
          turn: 0,
          moves: []
          , paused: false,
          pausedBy: null,
          turnStart: null,
          pausedAt: null,
          sessionCreatedAt: Date.now(),
          lastActivityAt: Date.now(),
        };
      }

      // Check for existing player by name (case-insensitive)
      const normalized = playerName.trim().toLowerCase();
      const existing = gameState.players.find(p => p.name.trim().toLowerCase() === normalized);

      if (existing) {
        // Verify password
        const ok = await storage.verifyPlayerPassword(existing.id, password);
        if (!ok) {
          return res.status(403).json({ error: 'Name already taken with different password' });
        }

        // Good: return existing player id and current game state
        const signalingToken = issueVoiceToken(existing.id);
        normalizeGameStateAvatars(gameState);
        return res.json({ playerId: existing.id, gameState, signalingToken, signalingTokenTtlMs: VOICE_TOKEN_TTL_MS });
      }

      if (gameInProgress(gameState)) {
        return res.status(409).json({ error: "Game already started. New players cannot join until lobby resets." });
      }

      // Create new player
      if (gameState.players.length >= 3) {
        return res.status(400).json({ error: "Game is full (max 3 players)" });
      }

      const playerId = `player_${Date.now()}_${Math.random()}`;
      const rack: (string | null)[] = gameState.tileBag.splice(0, 7);
      while (rack.length < 7) rack.push(null);

      const newPlayer: Player = {
        id: playerId,
        name: playerName.trim(),
        rack,
        score: 0,
        ready: false,
        voiceEnabled: false
      };

      gameState.players.push(newPlayer);
      normalizeGameStateAvatars(gameState);

      // Save password for new player
      await storage.setPlayerPassword(playerId, password);

      // Do not auto-start or set current player here; game start is explicit

      touchStateActivity(gameState);
      bumpRevision(gameState);
      await storage.saveGameState(gameState);
      const signalingToken = issueVoiceToken(playerId);
      res.json({ playerId, gameState, signalingToken, signalingTokenTtlMs: VOICE_TOKEN_TTL_MS });
    } catch (error) {
      res.status(500).json({ error: "Failed to join game" });
    }
  }));

  // Leave game: remove player from current session; if last player leaves, reset session
  app.post('/api/game/leave', runLocked(async (req, res) => {
    try {
      const playerId = String(req.body?.playerId || '').trim();
      if (!playerId) return res.status(400).json({ error: 'playerId is required' });

      const { state } = await loadActiveStateWithExpiry();
      normalizeGameStateAvatars(state);
      if (!state || !Array.isArray(state.players)) {
        return res.json({ success: true, gameState: state || null });
      }

      const existingIndex = state.players.findIndex(p => p.id === playerId);
      if (existingIndex === -1) {
        return res.json({ success: true, gameState: state });
      }

      revokeVoiceToken(playerId);

      const wasCurrentPlayer = state.currentPlayer === playerId;
      state.players.splice(existingIndex, 1);

      // Remove preview data for this player
      try {
        if (state.previews && typeof state.previews === 'object') {
          delete (state.previews as any)[playerId];
        }
      } catch {}

      // If no players remain, terminate/reset session to empty initialized state
      if (state.players.length === 0) {
        const resetState = touchStateActivity(createEmptyGameState());
        bumpRevision(resetState);
        await storage.saveGameState(resetState);
        normalizeGameStateAvatars(resetState);
        return res.json({ success: true, gameState: resetState });
      }

      // If removed player had the turn, pass turn to next valid player
      if (wasCurrentPlayer) {
        const nextIndex = Math.min(existingIndex, state.players.length - 1);
        state.currentPlayer = state.players[nextIndex]?.id ?? state.players[0]?.id ?? null;
        state.turnStart = Date.now();
      } else if (!state.currentPlayer || !state.players.some(p => p.id === state.currentPlayer)) {
        // Defensive: ensure currentPlayer always references an existing player
        state.currentPlayer = state.players[0]?.id ?? null;
        state.turnStart = state.currentPlayer ? Date.now() : null;
      }

      touchStateActivity(state);
      bumpRevision(state);
      await storage.saveGameState(state);
      normalizeGameStateAvatars(state);
      return res.json({ success: true, gameState: state });
    } catch (err) {
      console.error('[Leave] failed', err);
      return res.status(500).json({ error: 'Failed to leave game' });
    }
  }));

  app.post('/api/game/kick', runLocked(async (req, res) => {
    try {
      const requesterId = String(req.body?.requesterId || '').trim();
      const targetPlayerId = String(req.body?.targetPlayerId || '').trim();
      if (!requesterId || !targetPlayerId) return res.status(400).json({ error: 'requesterId and targetPlayerId are required' });

      const { state } = await loadActiveStateWithExpiry();
      normalizeGameStateAvatars(state);
      if (!state || !Array.isArray(state.players) || state.players.length === 0) {
        return res.status(404).json({ error: 'No active lobby' });
      }
      if (gameInProgress(state)) {
        return res.status(409).json({ error: 'Cannot remove players while game is in progress' });
      }

      const requesterIsParticipant = state.players.some((p) => p.id === requesterId);
      if (!requesterIsParticipant) {
        return res.status(403).json({ error: 'Only lobby participants can remove players' });
      }
      if (targetPlayerId === requesterId) {
        return res.status(400).json({ error: 'Players cannot remove themselves' });
      }

      const targetIndex = state.players.findIndex((p) => p.id === targetPlayerId);
      if (targetIndex === -1) {
        normalizeGameStateAvatars(state);
        return res.json({ success: true, gameState: state });
      }

      revokeVoiceToken(targetPlayerId);
      state.players.splice(targetIndex, 1);
      if (state.previews && typeof state.previews === 'object') {
        delete (state.previews as any)[targetPlayerId];
      }
      if (!state.currentPlayer || !state.players.some((p) => p.id === state.currentPlayer)) {
        state.currentPlayer = null;
        state.turnStart = null;
      }

      touchStateActivity(state);
      bumpRevision(state);
      await storage.saveGameState(state);
      normalizeGameStateAvatars(state);
      return res.json({ success: true, gameState: state });
    } catch (err) {
      console.error('[Kick] failed', err);
      return res.status(500).json({ error: 'Failed to remove player' });
    }
  }));

  // Host-only manual session reset. After an ended game, participants return to
  // a fresh lobby with the same player identities so saved stats/session IDs survive.
  app.post('/api/game/reset-session', runLocked(async (req, res) => {
    try {
      const requesterId = String(req.body?.requesterId || '').trim();
      const preservePlayers = req.body?.preservePlayers === true;
      if (!requesterId) return res.status(400).json({ error: 'requesterId is required' });

      const { state } = await loadActiveStateWithExpiry();
      if (state && Array.isArray(state.players) && state.players.length > 0) {
        const hostId = state.players[0]?.id;
        const isParticipant = state.players.some((p) => p.id === requesterId);
        const canParticipantResetEndedGame = !!state.gameEnded && isParticipant;
        const isAlreadyFreshLobbyForParticipant = isParticipant && !gameInProgress(state) && !state.gameEnded;
        if (preservePlayers && isAlreadyFreshLobbyForParticipant) {
          normalizeGameStateAvatars(state);
          return res.json({ success: true, gameState: state });
        }
        if ((!hostId || hostId !== requesterId) && !(preservePlayers && canParticipantResetEndedGame)) {
          return res.status(403).json({ error: 'Only lobby host can reset session' });
        }

        if (preservePlayers && canParticipantResetEndedGame) {
          await recordCompletedGameStats(state);
          const resetState = touchStateActivity(createFreshLobbyPreservingPlayers(state));
          bumpRevision(resetState);
          await storage.saveGameState(resetState);
          return res.json({ success: true, gameState: resetState });
        }

        for (const p of state.players) revokeVoiceToken(p.id);
      }

      const resetState = touchStateActivity(createEmptyGameState());
      bumpRevision(resetState);
      await storage.saveGameState(resetState);
      normalizeGameStateAvatars(resetState);
      return res.json({ success: true, gameState: resetState });
    } catch (err) {
      console.error('[ResetSession] failed', err);
      return res.status(500).json({ error: 'Failed to reset session' });
    }
  }));

  // Update game state (for moves)
  app.post("/api/game/update", runLocked(async (req, res) => {
    try {
      const updates = req.body;
      const result = gameStateSchema.safeParse(updates);
      
      if (!result.success) {
        console.error("Invalid game state data:", result.error);
        return res.status(400).json({ error: "Invalid game state data", details: result.error });
      }

      // If there is an existing saved state, perform scoring validation
      const { state: previous } = await loadActiveStateWithExpiry();
      // Enforce server-side: reject updates if the saved game already ended
      if (previous && previous.gameEnded) {
        console.warn('[Update] rejected update: game already ended');
        return res.status(400).json({ error: 'Game has already ended' });
      }
      const incoming = result.data as GameState;
      const prevMoves = previous?.moves?.length || 0;
      const newMoves = incoming.moves?.length || 0;

      if (previous) {
        const incomingRevision = typeof incoming.revision === 'number' ? incoming.revision : -1;
        const currentRevision = stateRevision(previous);
        if (incomingRevision !== currentRevision) {
          return res.status(409).json({
            error: 'State is stale. Refresh and retry.',
            currentRevision,
          });
        }

        if ((incoming.turn || 0) < (previous.turn || 0)) {
          return res.status(409).json({ error: 'State is stale. Turn cannot move backwards.' });
        }

        const previousInProgress = gameInProgress(previous);
        const incomingInProgress = gameInProgress(incoming);
        if (!previousInProgress && incomingInProgress) {
          return res.status(400).json({ error: 'Lobby-to-game transition must use /api/game/start.' });
        }
        if (previousInProgress && !incomingInProgress && !incoming.gameEnded) {
          return res.status(400).json({ error: 'Game-to-lobby transition must use reset/init flow, not /api/game/update.' });
        }

        if (incoming.currentPlayer && !(incoming.players || []).some((p) => p.id === incoming.currentPlayer)) {
          return res.status(400).json({ error: 'currentPlayer must reference an existing player.' });
        }
        if (!incoming.currentPlayer && (incoming.turn || 0) > 0 && !incoming.gameEnded) {
          return res.status(400).json({ error: 'Active turns require a currentPlayer.' });
        }

        const previousPlayerIds = (previous.players || []).map((p) => p.id).sort().join('|');
        const incomingPlayerIds = (incoming.players || []).map((p) => p.id).sort().join('|');
        if (previousPlayerIds !== incomingPlayerIds) {
          return res.status(400).json({ error: 'Player roster changes must use join/leave endpoints.' });
        }

        const committedBoardChange = findCommittedBoardChange(previous.board, incoming.board);
        if (committedBoardChange) {
          console.warn('[BoardProtection] rejected committed board mutation', {
            row: committedBoardChange.row,
            col: committedBoardChange.col,
            kind: committedBoardChange.kind,
          });
          return res.status(400).json({
            error: 'Committed board tiles cannot be removed or changed.',
            row: committedBoardChange.row,
            col: committedBoardChange.col,
          });
        }

        const moveDelta = newMoves - prevMoves;
        const boardAdditions = findBoardAdditions(previous.board, incoming.board);
        if (moveDelta < 0 || moveDelta > 1) {
          return res.status(400).json({ error: 'Exactly one move may be appended per turn update.' });
        }

        if (moveDelta === 0) {
          if (incoming.turn !== previous.turn || incoming.currentPlayer !== previous.currentPlayer) {
            return res.status(409).json({ error: 'Turn changes require exactly one new move.' });
          }
          if (boardAdditions.length > 0) {
            return res.status(400).json({ error: 'Board tiles may only be added by a play move.' });
          }
        } else {
          const lastMove = incoming.moves?.[newMoves - 1];
          if (!lastMove || lastMove.playerId !== previous.currentPlayer) {
            return res.status(409).json({ error: 'Move player no longer owns the current turn.' });
          }

          const currentIndex = previous.players.findIndex(player => player.id === previous.currentPlayer);
          const expectedNextPlayerId = currentIndex >= 0 && previous.players.length > 0
            ? previous.players[(currentIndex + 1) % previous.players.length]?.id ?? null
            : null;
          if (
            incoming.turn !== previous.turn + 1
            || lastMove.turn !== incoming.turn
            || incoming.currentPlayer !== expectedNextPlayerId
          ) {
            return res.status(409).json({ error: 'Move does not match the current turn transition.' });
          }

          const moveType = lastMove.type ?? 'play';
          if (moveType === 'skip' || moveType === 'exchange') {
            if (boardAdditions.length > 0) {
              return res.status(400).json({ error: 'Skip and exchange moves cannot place board tiles.' });
            }
          } else if (boardAdditions.length === 0) {
            return res.status(400).json({ error: 'Play move must add at least one board tile.' });
          }
        }
      }

      // If there are more moves in the incoming state, inspect the last move
      // Score breakdowns already accepted by the server are immutable. The
      // client still posts a full snapshot, so copy these fields from storage
      // before handling a newly appended move.
      if (previous?.moves && incoming.moves) {
        const sharedMoveCount = Math.min(prevMoves, newMoves);
        for (let index = 0; index < sharedMoveCount; index++) {
          incoming.moves[index].wordScores = previous.moves[index].wordScores;
          incoming.moves[index].bingoBonus = previous.moves[index].bingoBonus;
        }
      }

      // Enforce pause: if the saved state is paused, reject any incoming new moves
      if (previous && previous.paused && newMoves > prevMoves) {
        console.warn('[Update] rejected update: game is paused (incoming contained new moves)');
        return res.status(400).json({ error: 'Game is paused' });
      }

      if (previous && newMoves > prevMoves && incoming.moves) {
        const lastMove = incoming.moves[incoming.moves.length - 1];
        // Only validate scoring for 'play' moves
        if (lastMove.type !== 'skip' && lastMove.type !== 'exchange') {
          // Prefer placedTiles provided by the client in move.meta. Fallback to board diff.
          let placedTiles: { row: number; col: number; letter: string }[] = [];
          if (lastMove.meta && Array.isArray(lastMove.meta.placedTiles)) {
            placedTiles = lastMove.meta.placedTiles as any;
            } else {
            for (let r = 0; r < BOARD_SIZE; r++) {
              for (let c = 0; c < BOARD_SIZE; c++) {
                const prevCell = previous.board[r][c];
                const newCell = incoming.board[r][c];
                if ((prevCell === null || prevCell === undefined) && newCell !== null && newCell !== undefined) {
                  // newCell may be a BoardCell object; extract letter if present
                  const letter = (newCell as any)?.letter ?? newCell;
                  placedTiles.push({ row: r, col: c, letter });
                }
              }
            }
          }

          // Derive words and expected score
          const words = extractWordsFromBoard(incoming.board, placedTiles as any);
          const scoreBreakdown = calculateScoreBreakdown(words, incoming.board, placedTiles as any);
          const expectedScore = scoreBreakdown.totalScore;

          // Find the player whose score increased (should be the player in lastMove.playerId)
          const prevPlayer = previous.players.find(p => p.id === lastMove.playerId);
          const newPlayer = incoming.players.find(p => p.id === lastMove.playerId);
          const prevScore = prevPlayer?.score ?? 0;
          const newScore = newPlayer?.score ?? 0;
          const delta = newScore - prevScore;

          // Overwrite the client's reported move score with the server-computed expected score
          lastMove.score = expectedScore;
          lastMove.words = scoreBreakdown.wordScores.map(entry => entry.word);
          lastMove.wordScores = scoreBreakdown.wordScores;
          lastMove.bingoBonus = scoreBreakdown.bingoBonus;

          // Update the incoming player's score to be previous + expectedScore so server is authoritative
          if (newPlayer) {
            newPlayer.score = (prevPlayer?.score ?? 0) + expectedScore;
          }
        }
      }

      // Reconcile tile bag to ensure counts match the canonical distribution
      // This prevents accidental duplication or loss of tiles caused by clients
      // or race conditions. We compute expected remaining tiles as: distribution
      // minus tiles currently on board and tiles in players' racks, then
      // rebuild and shuffle the bag accordingly.
      const incomingState = result.data as GameState;
      normalizeGameStateAvatars(incomingState);
      if (previous) {
        const previousPreviews = previous.previews && typeof previous.previews === 'object' ? previous.previews : {};
        const incomingPreviews = incomingState.previews && typeof incomingState.previews === 'object' ? incomingState.previews : {};
        incomingState.previews = { ...incomingPreviews, ...previousPreviews };
        if (newMoves > prevMoves && incoming.moves && incoming.moves.length > 0) {
          const lastMove = incoming.moves[incoming.moves.length - 1];
          if (lastMove?.playerId) delete (incomingState.previews as any)[lastMove.playerId];
        }
      }
      // Adjust server-authoritative timestamps and pause transitions.
      try {
        if (previous) {
          const prevPaused = !!previous.paused;
          const incPaused = !!incomingState.paused;

          // If we're transitioning to paused, record pausedAt if not set
          if (!prevPaused && incPaused) {
            incomingState.pausedAt = incomingState.pausedAt ?? Date.now();
          }

          // If we're resuming from pause, advance turnStart by pause duration
          if (prevPaused && !incPaused) {
            const pausedAt = previous.pausedAt ?? incomingState.pausedAt ?? Date.now();
            const delta = Date.now() - pausedAt;
            if (incomingState.turnStart) incomingState.turnStart = (incomingState.turnStart || Date.now()) + delta;
            else incomingState.turnStart = Date.now();
            incomingState.pausedAt = null;
          }

          // When turn advances, reset turnStart to now
          if (incomingState.currentPlayer !== previous.currentPlayer || (incomingState.turn || 0) > (previous.turn || 0)) {
            incomingState.turnStart = Date.now();
          }
        } else {
          // No previous state: ensure turnStart exists if there is a current player
          if (incomingState.currentPlayer && !incomingState.turnStart) incomingState.turnStart = Date.now();
        }
      } catch (err) {
        console.error('[Timestamps] failed to adjust turnStart/pausedAt', err);
      }
      try {
        const expected: Record<string, number> = {};
        Object.entries(TILE_DISTRIBUTION).forEach(([ltr, cnt]) => expected[ltr] = cnt);

        // Build a canonical board to use for counting remaining tiles. We prefer
        // to start from the previously saved board and then apply only the
        // validated last play (if any). This prevents clients from accidentally
        // sending an incoming state that omits tiles (for example during a
        // skip) and causing the server to think those tiles are back in the bag.
        const usedBoard = Array(BOARD_SIZE).fill(null).map(() => Array(BOARD_SIZE).fill(null)) as any[][];
        if (previous) {
          // clone previous board into usedBoard
          for (let r = 0; r < BOARD_SIZE; r++) for (let c = 0; c < BOARD_SIZE; c++) usedBoard[r][c] = previous.board[r][c];
        } else {
          // no previous state (rare) — fall back to incoming board
          for (let r = 0; r < BOARD_SIZE; r++) for (let c = 0; c < BOARD_SIZE; c++) usedBoard[r][c] = incomingState.board[r][c];
        }

        // If there is a new move and it's a 'play', apply the placed tiles from
        // that move onto usedBoard so the counts include them. Prefer explicit
        // meta.placedTiles provided by the client; otherwise fall back to a
        // diff between previous and incoming.
        let placedTilesForCount: { row: number; col: number; letter: string; blank?: boolean }[] = [];
        if (previous && newMoves > prevMoves && incoming.moves && incoming.moves.length > 0) {
          const lastMove = incoming.moves[incoming.moves.length - 1];
          if (lastMove && lastMove.type === 'play') {
            if (lastMove.meta && Array.isArray(lastMove.meta.placedTiles)) {
              placedTilesForCount = lastMove.meta.placedTiles as any;
            } else {
              // compute diff between previous.board and incoming.board
              for (let r = 0; r < BOARD_SIZE; r++) {
                for (let c = 0; c < BOARD_SIZE; c++) {
                  const prevCell = previous.board[r][c] as any;
                  const newCell = incomingState.board[r][c] as any;
                  if ((prevCell === null || prevCell === undefined) && newCell !== null && newCell !== undefined) {
                    const letter = (newCell as any)?.letter ?? newCell;
                    const blank = !!(newCell && (newCell as any).blank);
                    placedTilesForCount.push({ row: r, col: c, letter, blank });
                  }
                }
              }
            }

            // apply placed tiles onto usedBoard
            for (const t of placedTilesForCount) {
              usedBoard[t.row][t.col] = { letter: t.letter, blank: !!t.blank };
            }
          }
        }

        // subtract tiles found on the usedBoard
        for (let r = 0; r < BOARD_SIZE; r++) {
          for (let c = 0; c < BOARD_SIZE; c++) {
            const cell = usedBoard[r][c] as any;
            if (cell && cell.letter) {
              // If the cell was a blank (wildcard) assigned to a letter, it should
              // consume a '?' from the distribution, not the displayed letter.
              const L = cell.blank ? '?' : (cell.letter as string);
              if (expected[L] !== undefined) expected[L] = Math.max(0, expected[L] - 1);
            }
          }
        }

        // subtract tiles in player racks
        for (const p of incomingState.players) {
          for (const t of p.rack) {
            if (t !== null && expected[t] !== undefined) {
              expected[t] = Math.max(0, expected[t] - 1);
            }
          }
        }

        // build new bag from remaining counts
        const rebuilt: string[] = [];
        for (const [ltr, cnt] of Object.entries(expected)) {
          for (let i = 0; i < cnt; i++) rebuilt.push(ltr);
        }

        // If the incoming bag length differs from rebuilt, replace and shuffle.
        // Otherwise, if the multiset mismatches, replace but keep the client's
        // ordering where possible to avoid surprising reorders on clients.
        let replacedBag = false;
        if (!Array.isArray(incomingState.tileBag) || incomingState.tileBag.length !== rebuilt.length) {
          incomingState.tileBag = rebuilt;
          replacedBag = true;
        } else {
          // Quick sanity: check multiset equality; if mismatch, replace
          const countBag: Record<string, number> = {};
          for (const x of incomingState.tileBag || []) countBag[x] = (countBag[x] || 0) + 1;
          let mismatch = false;
          for (const [ltr, cnt] of Object.entries(expected)) {
            if ((countBag[ltr] || 0) !== cnt) { mismatch = true; break; }
          }
          if (mismatch) {
            incomingState.tileBag = rebuilt;
            replacedBag = true;
          }
        }

        // shuffle the rebuilt bag only when we replaced it; otherwise preserve order
        if (replacedBag) {
          for (let i = incomingState.tileBag.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [incomingState.tileBag[i], incomingState.tileBag[j]] = [incomingState.tileBag[j], incomingState.tileBag[i]];
          }
        }
      } catch (err) {
        console.error('[TileBag Reconcile] failed', err);
      }

      touchStateActivity(incomingState);
      bumpRevision(incomingState);
      await storage.saveGameState(incomingState);

      // Verify save worked
      const { state: saved } = await loadActiveStateWithExpiry();
      normalizeGameStateAvatars(saved);
      console.log("Game state saved. Board center:", saved?.board[7]?.slice(6, 10));

      if (!saved) {
        // Shouldn't happen, but return the incoming state as fallback
        return res.json({ success: true, gameState: incomingState });
      }

      // Check for game end
      const endCheck = checkGameEnd(saved);
      if (endCheck.ended) {
        saved.gameEnded = true;
        saved.winnerId = endCheck.winnerId;
        saved.drawPlayerIds = endCheck.drawPlayerIds;
        saved.endReason = endCheck.reason;
        bumpRevision(saved);
        await recordCompletedGameStats(saved);
        await storage.saveGameState(saved);
      }

      res.json({ success: true, gameState: saved });
    } catch (error) {
      console.error("Failed to update game state:", error);
      res.status(500).json({ error: "Failed to update game state" });
    }
  }));

  // Validate word with Wiktionary or word file
  // Serve the local word list as plain text (one word per line)
  app.get('/api/wordlist', async (req, res) => {
    const candidatePaths = [
      path.join(process.cwd(), 'attached_assets', 'russian-mnemonic-words.txt'),
      path.join(process.cwd(), 'russian-mnemonic-words.txt'),
    ];

    for (const filePath of candidatePaths) {
      try {
        const data = await fs.promises.readFile(filePath, 'utf8');
        return res.type('text/plain').send(data);
      } catch (err: any) {
        if (err && err.code === 'ENOENT') continue;
        console.error('[wordlist] read error', err);
        return res.status(500).json({ error: 'Failed to read word list' });
      }
    }

    return res.status(404).json({ error: 'Word list not found' });
  });

  // Return cached-ish player stats (basic server-side snapshot)
  app.get('/api/player-stats/:playerId', async (req, res) => {
    try {
      const playerId = String(req.params.playerId || '');
      if (!playerId) return res.status(400).json({ error: 'playerId required' });
      const { state } = await loadActiveStateWithExpiry();
      if (!state) return res.status(404).json({ error: 'No game state' });

      const auth = await authorizePlayerStatsRead(req, state);
      if (!auth.allowed) {
        return res.status(auth.status).json({ error: auth.error });
      }

      const now = Date.now();
      const revision = stateRevision(state);
      if (state.gameEnded) {
        await recordCompletedGameStats(state);
      }
      const storedStats = await loadStoredPlayerStats();
      const p = state.players.find(x => x.id === playerId);
      if (!p) {
        const stored = sanitizeStoredStatsEntry(storedStats[playerId]);
        if (stored.games <= 0) return res.status(404).json({ error: 'Player not found' });
        const virtualPlayer: Player = {
          id: playerId,
          name: playerId,
          rack: [null, null, null, null, null, null, null],
          score: 0,
        };
        const entry = buildStatsCacheEntry(virtualPlayer, revision, now, stored);
        const response = buildStatsResponse(entry, now);
        return res.json(response);
      }

      cleanupPlayerStatsCache(state, now, revision);
      const nameKey = statsNameKey(p.name);
      const lifetimeStats = pickLatestStatsEntry(storedStats[p.id], nameKey ? storedStats[nameKey] : undefined);
      if (nameKey && lifetimeStats.games > 0) {
        const nameStats = sanitizeStoredStatsEntry(storedStats[nameKey]);
        const idStats = sanitizeStoredStatsEntry(storedStats[p.id]);
        if (nameStats.games < lifetimeStats.games || idStats.games < lifetimeStats.games) {
          storedStats[nameKey] = lifetimeStats;
          storedStats[p.id] = lifetimeStats;
          await saveStoredPlayerStats(storedStats);
        }
      }
      const cached = playerStatsCache.get(p.id);

      const scoreNow = Number(p.score) || 0;
      let missReason = 'none';
      if (!cached) missReason = 'cold-start';
      else if (!hasValidStatsMetadata(cached, now)) missReason = 'invalid-metadata';
      else if (cached.playerId !== p.id) missReason = 'player-mismatch';
      else if (cached.score !== scoreNow) missReason = 'score-drift';
      else if (cached.stateRevision !== revision) missReason = 'revision-drift';
      else if (cached.wins !== (sanitizeStoredStatsEntry(lifetimeStats).wins)
        || cached.losses !== (sanitizeStoredStatsEntry(lifetimeStats).losses)
        || cached.draws !== (sanitizeStoredStatsEntry(lifetimeStats).draws)
        || cached.games !== (sanitizeStoredStatsEntry(lifetimeStats).games)) missReason = 'lifetime-stats-drift';
      else if (now >= cached.expiresAt) missReason = 'expired';

      const totals = sanitizeStoredStatsEntry(lifetimeStats);
      const canUseCached = !!cached
        && hasValidStatsMetadata(cached, now)
        && cached.playerId === p.id
        && cached.score === scoreNow
        && cached.stateRevision === revision
        && cached.wins === totals.wins
        && cached.losses === totals.losses
        && cached.draws === totals.draws
        && cached.games === totals.games
        && now < cached.expiresAt;

      const entry = canUseCached
        ? (cached as CachedStatsEntry)
        : buildStatsCacheEntry(p, revision, now, totals);

      if (!canUseCached) {
        playerStatsCache.set(p.id, entry);
      }

      let response = buildStatsResponse(entry, now);
      if (!isStatsResponseConsistent(response, now)) {
        const repaired = buildStatsCacheEntry(p, revision, now, totals);
        playerStatsCache.set(p.id, repaired);
        response = buildStatsResponse(repaired, now);
        logPlayerStatsCacheEvent(p.id, {
          event: 'repair',
          reason: 'response-inconsistent',
          cacheStatus: response.cacheStatus,
          revision,
          score: scoreNow,
          ageMs: response.ageMs,
          authMode: auth.mode,
        });
      } else {
        logPlayerStatsCacheEvent(p.id, {
          event: canUseCached ? 'hit' : 'miss',
          reason: canUseCached ? 'reuse-valid' : missReason,
          cacheStatus: response.cacheStatus,
          revision,
          score: scoreNow,
          ageMs: response.ageMs,
          authMode: auth.mode,
        });
      }

      return res.json(response);
    } catch (err) {
      console.error('[PlayerStats] failed', err);
      return res.status(500).json({ error: 'Failed to get player stats' });
    }
  });

  // Set or update a player's avatar URL (strict validation + deterministic fallback data)
  app.post('/api/player/:playerId/avatar', runLocked(async (req, res) => {
    try {
      const playerId = String(req.params.playerId || '');
      const { avatarUrl } = req.body || {};
      if (!playerId) return res.status(400).json({ error: 'playerId required' });
      if (avatarUrl !== null && avatarUrl !== undefined && typeof avatarUrl !== 'string') {
        return res.status(400).json({ error: 'avatarUrl must be a string' });
      }

      const state = await storage.getGameState();
      if (!state) return res.status(404).json({ error: 'No game state' });
      const p = state.players.find(x => x.id === playerId);
      if (!p) return res.status(404).json({ error: 'Player not found' });

      const normalized = sanitizeAvatarUrlInput(avatarUrl);
      if (normalized.error) {
        return res.status(400).json({
          error: 'Invalid avatarUrl',
          details: normalized.error,
          avatarFallback: buildAvatarFallback(p),
        });
      }

      if (normalized.avatarUrl) p.avatarUrl = normalized.avatarUrl;
      else delete (p as any).avatarUrl;
      p.avatarFallback = buildAvatarFallback(p);

      touchStateActivity(state);
      bumpRevision(state);
      await storage.saveGameState(state);
      return res.json({ success: true, avatarUrl: p.avatarUrl || null, avatarFallback: p.avatarFallback });
    } catch (err) {
      console.error('[Avatar] failed', err);
      return res.status(500).json({ error: 'Failed to set avatar' });
    }
  }));

  app.get("/api/validate-word/:word", async (req, res) => {
    try {
      const word = req.params.word.toLowerCase();
      
      if (USE_WORD_FILE) {
        // Use text file lookup (fast, no API calls)
        const isValid = isWordValid(word);
        res.json({ word, isValid, extract: null });
      } else {
        // Use Wiktionary API (slower, requires internet, can get rate limited)
        const url = `https://ru.wiktionary.org/w/api.php?action=query&titles=${encodeURIComponent(word)}&prop=extracts&exintro=1&explaintext=1&format=json`;

        const response = await fetch(url);
        if (!response.ok) {
          throw new Error(`Wiki API returned ${response.status}: ${response.statusText}`);
        }
        const data = await response.json();

        const pages = data.query?.pages || {};
        const pageId = Object.keys(pages)[0];

        // If pageId is -1, the page doesn't exist
        const isValid = pageId !== '-1';

        let extract: string | null = null;
        if (isValid) {
          extract = pages[pageId]?.extract || null;
          // Debug log to help troubleshoot missing extracts
          console.log('[validate-word] fetched', { word, pageId, hasExtract: !!extract, pageKeys: Object.keys(pages).slice(0,5) });
          // Trim long extracts to a reasonable length for UI
          if (extract && extract.length > 1000) extract = extract.slice(0, 1000) + '…';
        }

        res.json({ word, isValid, extract });
      }
    } catch (error) {
      console.error('[validate-word] Error:', error);
      res.status(500).json({ error: "Failed to validate word", details: error instanceof Error ? error.message : String(error) });
    }
  });

  // Receive preview placements from the active player (non-authoritative preview only)
  app.post('/api/game/preview', runLocked(async (req, res) => {
    try {
      const { playerId, placedTiles } = req.body || {};
      if (!playerId || !Array.isArray(placedTiles)) {
        return res.status(400).json({ error: 'Invalid preview payload' });
      }

      const { state } = await loadActiveStateWithExpiry();
      if (!state) return res.status(500).json({ error: 'No game state' });

      // attach previews map on state
      state.previews = state.previews || {};
      // sanitize placed tiles (row/col/letter)
      const sanitized = placedTiles.map((t: any) => ({ row: Number(t.row), col: Number(t.col), letter: String(t.letter), blank: !!t.blank }));
      const previousPreview = Array.isArray((state.previews as any)[playerId]) ? (state.previews as any)[playerId] : [];
      const changed = JSON.stringify(previousPreview) !== JSON.stringify(sanitized);

      if (!changed) {
        normalizeGameStateAvatars(state);
        return res.json({ success: true, gameState: state });
      }

      if (sanitized.length > 0) {
        state.previews[playerId] = sanitized;
      } else {
        delete (state.previews as any)[playerId];
      }

      // Preview changes are non-authoritative and should not bump revision.
      touchStateActivity(state);
      await storage.saveGameState(state);
      normalizeGameStateAvatars(state);
      return res.json({ success: true, gameState: state });
    } catch (err) {
      console.error('[Preview] failed', err);
      return res.status(500).json({ error: 'Failed to save preview' });
    }
  }));

  // Provide ICE server configuration to clients. This allows the client
  // to use a locally-hosted TURN server if environment variables are set.
  app.get('/api/turn-config', async (req, res) => {
    try {
      // Environment-based TURN config. To run a local TURN server you can use
      // `node-turn` or `coturn`. Example (node-turn):
      //   npx node-turn --realm=myrealm --username=testuser --password=testpass --ports=3478
      // Then set TURN_HOST=127.0.0.1 TURN_PORT=3478 TURN_USER=testuser TURN_PASS=testpass
      const { TURN_HOST, TURN_PORT, TURN_USER, TURN_PASS } = process.env as any;
      const iceServers: any[] = [];
      // Always include a public STUN as a fallback
      iceServers.push({ urls: 'stun:stun.l.google.com:19302' });

      let forceRelay = false;
      if (TURN_HOST && TURN_PORT && TURN_USER && TURN_PASS) {
        const url = `turn:${TURN_HOST}:${TURN_PORT}`;
        iceServers.push({ urls: url, username: TURN_USER, credential: TURN_PASS });
        // also include secure TURN (turns) if available on a TLS-enabled TURN server
        const turnsUrl = `turns:${TURN_HOST}:${TURN_PORT}`;
        iceServers.push({ urls: turnsUrl, username: TURN_USER, credential: TURN_PASS });
        forceRelay = true;
      }

      res.json({ iceServers, forceRelay });
    } catch (err) {
      console.error('[TurnConfig] failed', err);
      res.status(500).json({ error: 'Failed to get TURN config' });
    }
  });

  // WebSocket health endpoint (info only)
  app.get('/api/ws-health', async (req, res) => {
    try {
      // best-effort: if ws server not started, return empty
      const info: any = (global as any).__wsHealth || { connected: 0, peers: [] };
      res.json(info);
    } catch (err) {
      res.status(500).json({ error: 'ws-health failed' });
    }
  });

  // Start game: shuffle player order, build tile bag, deal racks, and set initial turn
  app.post('/api/game/start', runLocked(async (req, res) => {
    try {
      const { state } = await loadActiveStateWithExpiry();
      if (!state) return res.status(400).json({ error: 'No game to start' });
      if (!Array.isArray(state.players) || state.players.length === 0) return res.status(400).json({ error: 'No players to start game' });
      if (gameInProgress(state)) return res.status(409).json({ error: 'Game already started' });

      // Enforce readiness: all players in lobby must be marked ready.
      const notReadyPlayers = state.players.filter((p) => !p.ready).map((p) => p.name);
      if (notReadyPlayers.length > 0) {
        return res.status(400).json({
          error: 'Не все игроки готовы',
          notReadyPlayers,
        });
      }

      // Shuffle player order in-place (Fisher-Yates)
      for (let i = state.players.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [state.players[i], state.players[j]] = [state.players[j], state.players[i]];
      }

      // build full tile bag from distribution
      const bag: string[] = [];
      Object.entries(TILE_DISTRIBUTION).forEach(([letter, count]) => {
        for (let i = 0; i < count; i++) bag.push(letter);
      });
      // shuffle bag
      for (let i = bag.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [bag[i], bag[j]] = [bag[j], bag[i]];
      }

      state.tileBag = bag;
      // deal racks
      for (const p of state.players) {
        p.rack = state.tileBag.splice(0, 7);
        while (p.rack.length < 7) p.rack.push(null);
        p.score = p.score || 0;
        p.ready = false; // reset ready flag
      }

      const firstTurnIndex = Math.floor(Math.random() * state.players.length);
      const firstTurnPlayerId = state.players[firstTurnIndex]?.id ?? state.players[0]?.id ?? null;

      // reset board/moves and set current player explicitly at random
      state.board = Array(BOARD_SIZE).fill(null).map(() => Array(BOARD_SIZE).fill(null));
      state.moves = [];
      state.currentPlayer = firstTurnPlayerId;
      state.turn = 1;
      state.turnStart = Date.now();
      state.paused = true;
      state.pausedBy = null;
      state.pausedAt = Date.now();
      state.gameEnded = false;
      state.winnerId = undefined;
      state.drawPlayerIds = undefined;
      state.endReason = undefined;
      state.previews = {};

      touchStateActivity(state);
      bumpRevision(state);
      await storage.saveGameState(state);
      const { state: saved } = await loadActiveStateWithExpiry();
      normalizeGameStateAvatars(saved);
      return res.json({ success: true, gameState: saved });
    } catch (err) {
      console.error('[Start] failed', err);
      return res.status(500).json({ error: 'Failed to start game' });
    }
  }));

  // Health check for TURN server reachability (useful for CI)
  app.get('/api/turn-health', async (req, res) => {
    try {
      const host = process.env.TURN_HOST || '127.0.0.1';
      const port = parseInt(process.env.TURN_PORT || '3478', 10);
      const timeoutMs = parseInt(process.env.TURN_WAIT_MS || '2000', 10);

      const reachable = await new Promise<boolean>((resolve) => {
        const socket = new net.Socket();
        let done = false;
        const onFail = () => { if (done) return; done = true; try { socket.destroy(); } catch (e) {} resolve(false); };
        socket.setTimeout(Math.max(500, timeoutMs));
        socket.once('error', onFail);
        socket.once('timeout', onFail);
        socket.connect(port, host, () => { if (done) return; done = true; try { socket.end(); } catch (e) {} resolve(true); });
      });

      res.json({ host, port, reachable });
    } catch (err) {
      res.status(500).json({ error: 'turn-health failed', details: String(err) });
    }
  });

  const httpServer = createServer(app);

  // Simple WebSocket signaling server for voice chat with heartbeat and health
  try {
    const wss = new WebSocketServer({ server: httpServer, path: '/ws' });
    console.log('[WebSocket] server listening on /ws');

    type RateBucket = { startedAt: number; count: number };
    type ClientRecord = {
      ws: WebSocket,
      lastSeen: number,
      playerId: string,
      ip: string,
      totalBucket: RateBucket,
      sdpBucket: RateBucket,
      candidateBucket: RateBucket,
    };
    const clients = new Map<string, ClientRecord>();

    const WS_HEARTBEAT_INTERVAL = parseInt(process.env.WS_HEARTBEAT_MS || '30000', 10);
    const WS_STALE_MS = parseInt(process.env.WS_STALE_MS || '60000', 10);
    const WS_MAX_MESSAGE_BYTES = parseInt(process.env.WS_MAX_MESSAGE_BYTES || '65536', 10);
    const SIGNAL_WINDOW_MS = parseInt(process.env.VOICE_SIGNAL_WINDOW_MS || '5000', 10);
    const SIGNAL_MAX_TOTAL = parseInt(process.env.VOICE_SIGNAL_MAX_TOTAL || '60', 10);
    const SIGNAL_MAX_SDP = parseInt(process.env.VOICE_SIGNAL_MAX_SDP || '20', 10);
    const SIGNAL_MAX_CANDIDATE = parseInt(process.env.VOICE_SIGNAL_MAX_CANDIDATE || '40', 10);
    const WS_MAX_PLAYER_ID_CHARS = parseInt(process.env.WS_MAX_PLAYER_ID_CHARS || '128', 10);
    const WS_MAX_SDP_CHARS = parseInt(process.env.WS_MAX_SDP_CHARS || '32768', 10);
    const WS_MAX_CANDIDATE_CHARS = parseInt(process.env.WS_MAX_CANDIDATE_CHARS || '8192', 10);
    const WS_MAX_SDP_MID_CHARS = parseInt(process.env.WS_MAX_SDP_MID_CHARS || '128', 10);

    // expose basic health info globally for the /api/ws-health route
    (global as any).__wsHealth = { connected: 0, peers: [] };

    const refreshHealth = () => {
      (global as any).__wsHealth.connected = clients.size;
      (global as any).__wsHealth.peers = Array.from(clients.keys()).map(id => ({ id, lastSeen: clients.get(id)!.lastSeen }));
    };

    const windowAllow = (bucket: RateBucket, limit: number): boolean => {
      const now = Date.now();
      if (now - bucket.startedAt > SIGNAL_WINDOW_MS) {
        bucket.startedAt = now;
        bucket.count = 0;
      }
      bucket.count += 1;
      return bucket.count <= limit;
    };

    const allowSignalMessage = (rec: ClientRecord, type: string): boolean => {
      if (!windowAllow(rec.totalBucket, SIGNAL_MAX_TOTAL)) return false;
      if (type === 'candidate') {
        return windowAllow(rec.candidateBucket, SIGNAL_MAX_CANDIDATE);
      }
      return windowAllow(rec.sdpBucket, SIGNAL_MAX_SDP);
    };

    const isValidPlayerRef = (value: unknown): value is string => {
      if (typeof value !== 'string') return false;
      const trimmed = value.trim();
      if (!trimmed || trimmed.length > WS_MAX_PLAYER_ID_CHARS) return false;
      if(/[\u0000-\u001F\u007F]/.test(trimmed)) return false;
      return true;
    };

    const isObjectLike = (value: unknown): value is Record<string, unknown> => {
      return !!value && typeof value === 'object' && !Array.isArray(value);
    };

    const hasValidSdpPayload = (value: unknown, expectedType: 'offer' | 'answer'): boolean => {
      if (!isObjectLike(value)) return false;
      const sdpType = value.type;
      const sdp = value.sdp;
      if (sdpType !== expectedType) return false;
      if (typeof sdp !== 'string' || !sdp.trim() || sdp.length > WS_MAX_SDP_CHARS) return false;
      return true;
    };

    const extractValidSdpPayload = (msg: any, expectedType: 'offer' | 'answer') => {
      // Accept both legacy client format (msg.sdp) and strict format (msg.offer/msg.answer).
      const primary = expectedType === 'offer' ? msg?.offer : msg?.answer;
      if (hasValidSdpPayload(primary, expectedType)) return primary;
      if (hasValidSdpPayload(msg?.sdp, expectedType)) return msg.sdp;
      return null;
    };

    const hasValidCandidatePayload = (value: unknown): boolean => {
      if (value === null) return true;
      if (!isObjectLike(value)) return false;

      const cand = value.candidate;
      if (typeof cand !== 'string' || !cand.trim() || cand.length > WS_MAX_CANDIDATE_CHARS) return false;

      const sdpMid = value.sdpMid;
      if (sdpMid !== undefined && sdpMid !== null) {
        if (typeof sdpMid !== 'string' || sdpMid.length > WS_MAX_SDP_MID_CHARS) return false;
      }

      const sdpMLineIndex = value.sdpMLineIndex;
      if (sdpMLineIndex !== undefined && sdpMLineIndex !== null) {
        if (typeof sdpMLineIndex !== 'number' || !Number.isInteger(sdpMLineIndex) || sdpMLineIndex < 0 || sdpMLineIndex > 65535) return false;
      }

      return true;
    };

    const isParticipant = async (playerId: string): Promise<boolean> => {
      const state = await storage.getGameState();
      if (!state || !Array.isArray(state.players)) return false;
      return state.players.some((p) => p.id === playerId);
    };

    const isSignalRoomSafe = async (fromPlayerId: string, toPlayerId: string): Promise<boolean> => {
      if (!fromPlayerId || !toPlayerId) return false;
      const state = await storage.getGameState();
      if (!state || !Array.isArray(state.players)) return false;
      const ids = new Set((state.players || []).map((p) => p.id));
      return ids.has(fromPlayerId) && ids.has(toPlayerId);
    };

    const removeClientAndNotify = (playerId: string) => {
      if (!playerId || !clients.has(playerId)) return;
      clients.delete(playerId);
      for (const id of Array.from(clients.keys())) {
        const cws = clients.get(id)!.ws;
        try {
          cws.send(JSON.stringify({ type: 'peer-left', playerId }));
        } catch (err) {
          console.warn('[WebSocket] failed to notify peer-left to', id, err);
        }
      }
      refreshHealth();
    };

    wss.on('connection', (ws: WebSocket, req) => {
      console.log('[WebSocket] connection established', req.socket.remoteAddress);
      let registeredId: string | null = null;
      const remoteIp = String(req.socket.remoteAddress || req.headers['x-forwarded-for'] || 'unknown');

      // Update lastSeen on pong
      ws.on('pong', () => {
        if (registeredId) {
          const rec = clients.get(registeredId);
          if (rec) rec.lastSeen = Date.now();
        }
      });

      ws.on('message', async (raw) => {
        try {
          const rawBytes = typeof raw === 'string' ? Buffer.byteLength(raw) : (raw as Buffer).byteLength;
          if (rawBytes > WS_MAX_MESSAGE_BYTES) {
            console.warn('[WebSocket] oversized message dropped', { ip: remoteIp, bytes: rawBytes });
            try { ws.close(1009, 'Message too large'); } catch (e) {}
            return;
          }

          const msg = JSON.parse(raw.toString());
          const type = msg.type;

          if (type === 'ws-ping') {
            if (registeredId) {
              const rec = clients.get(registeredId);
              if (rec) rec.lastSeen = Date.now();
            }
            return;
          }

          if (type === 'join') {
            const playerId = String(msg.playerId || '');
            const signalingToken = String(msg.signalingToken || '');
            if (!playerId || !signalingToken) {
              try { ws.close(1008, 'Auth required'); } catch (e) {}
              return;
            }
            pruneExpiredVoiceTokens();
            if (!verifyVoiceToken(playerId, signalingToken)) {
              console.warn('[WebSocket] join rejected invalid signaling token', { playerId, ip: remoteIp });
              try { ws.close(1008, 'Unauthorized'); } catch (e) {}
              return;
            }
            const participant = await isParticipant(playerId);
            if (!participant) {
              console.warn('[WebSocket] join rejected non-participant', { playerId, ip: remoteIp });
              try { ws.close(1008, 'Forbidden'); } catch (e) {}
              return;
            }

            const previous = clients.get(playerId);
            if (previous && previous.ws !== ws) {
              try { previous.ws.close(1000, 'Replaced by newer session'); } catch (e) {}
              clients.delete(playerId);
            }

            registeredId = playerId;
            const now = Date.now();
            clients.set(playerId, {
              ws,
              playerId,
              ip: remoteIp,
              lastSeen: now,
              totalBucket: { startedAt: now, count: 0 },
              sdpBucket: { startedAt: now, count: 0 },
              candidateBucket: { startedAt: now, count: 0 },
            });
            refreshHealth();

            // inform the joining client of current peers
            const peers = Array.from(clients.keys()).filter(id => id !== playerId);
            console.log('[WebSocket] player joined', playerId, 'peers->', peers);
            ws.send(JSON.stringify({ type: 'peers', peers }));

            // notify existing peers of the new peer
            for (const id of Array.from(clients.keys())) {
              if (id === playerId) continue;
              const cws = clients.get(id)!.ws;
              try {
                console.log('[WebSocket] notifying existing peer', id, 'of new-peer', playerId);
                cws.send(JSON.stringify({ type: 'new-peer', playerId }));
              } catch (err) {
                console.warn('[WebSocket] failed notify existing peer', id, err);
              }
            }
          } else if (type === 'offer' || type === 'answer' || type === 'candidate') {
            if (!registeredId) {
              try { ws.close(1008, 'Join required'); } catch (e) {}
              return;
            }

            if (msg.from !== undefined && String(msg.from) !== registeredId) {
              console.warn('[WebSocket] signaling payload sender mismatch', {
                registeredId,
                payloadFrom: msg.from,
                type,
                ip: remoteIp,
              });
              return;
            }

            const senderRec = clients.get(registeredId);
            if (!senderRec) {
              try { ws.close(1008, 'Session invalid'); } catch (e) {}
              return;
            }
            if (!allowSignalMessage(senderRec, type)) {
              console.warn('[WebSocket] rate-limited signaling message', { playerId: registeredId, type, ip: senderRec.ip });
              try { ws.send(JSON.stringify({ type: 'error', code: 'RATE_LIMITED', message: 'Too many signaling messages' })); } catch (e) {}
              return;
            }

            if (!isValidPlayerRef(msg.to)) {
              console.warn('[WebSocket] invalid signaling target dropped', { playerId: registeredId, type, ip: senderRec.ip });
              return;
            }
            const to = msg.to.trim();

            if (to === registeredId) {
              console.warn('[WebSocket] self-targeted signaling blocked', { playerId: registeredId, type });
              return;
            }

            const offerPayload = type === 'offer' ? extractValidSdpPayload(msg, 'offer') : null;
            const answerPayload = type === 'answer' ? extractValidSdpPayload(msg, 'answer') : null;

            if (type === 'offer' && !offerPayload) {
              console.warn('[WebSocket] invalid offer payload dropped', { from: registeredId, to, ip: senderRec.ip });
              return;
            }
            if (type === 'answer' && !answerPayload) {
              console.warn('[WebSocket] invalid answer payload dropped', { from: registeredId, to, ip: senderRec.ip });
              return;
            }
            if (type === 'candidate' && !hasValidCandidatePayload(msg.candidate)) {
              console.warn('[WebSocket] invalid candidate payload dropped', { from: registeredId, to, ip: senderRec.ip });
              return;
            }

            const safeRoom = await isSignalRoomSafe(registeredId, to);
            if (!safeRoom) {
              console.warn('[WebSocket] blocked signaling outside active room', { from: registeredId, to, type });
              return;
            }

            const targetRec = clients.get(to);
            console.log('[WebSocket] forwarding', type, 'from', registeredId, 'to', to);
            if (targetRec) {
              try {
                if (targetRec.ws.readyState === WebSocket.OPEN) {
                  // Prevent sender spoofing and normalize SDP field names for client compatibility.
                  const forwarded: any = {
                    type,
                    from: registeredId,
                    to,
                  };
                  if (type === 'offer' && offerPayload) {
                    forwarded.sdp = offerPayload;
                    forwarded.offer = offerPayload;
                  } else if (type === 'answer' && answerPayload) {
                    forwarded.sdp = answerPayload;
                    forwarded.answer = answerPayload;
                  } else if (type === 'candidate') {
                    forwarded.candidate = msg.candidate;
                  }
                  targetRec.ws.send(JSON.stringify(forwarded));
                } else {
                  console.warn('[WebSocket] target not open for', to, 'state=', targetRec.ws.readyState);
                }
              } catch (err) {
                console.error('[WebSocket] failed forwarding', type, 'to', to, err);
              }
            } else {
              console.warn('[WebSocket] no target client found for', to);
            }
          } else if (type === 'leave') {
            const pid = registeredId || String(msg.playerId || '');
            if (registeredId && msg.playerId && String(msg.playerId) !== registeredId) {
              console.warn('[WebSocket] leave payload player mismatch', { payloadPlayerId: msg.playerId, registeredId, ip: remoteIp });
              return;
            }
            if (pid && clients.has(pid)) {
              console.log('[WebSocket] player left', pid);
              removeClientAndNotify(pid);
            }
          } else {
            console.warn('[WebSocket] unknown message type dropped', { type, ip: remoteIp });
          }
        } catch (err) {
          console.warn('[WebSocket] malformed message dropped', { ip: remoteIp, err: String(err) });
        }
      });

      ws.on('close', () => {
        if (registeredId && clients.has(registeredId)) {
          removeClientAndNotify(registeredId);
        }
      });
    });

    // Heartbeat interval: send pings and clean up stale peers
    const heartbeatTimer = setInterval(() => {
      try {
        pruneExpiredVoiceTokens();
        const now = Date.now();
        for (const [id, rec] of Array.from(clients.entries())) {
          try {
            // attempt ping
            if (rec.ws.readyState === WebSocket.OPEN) {
              rec.ws.ping();
            }
          } catch (e) {}

          const age = now - rec.lastSeen;
          if (age > WS_STALE_MS) {
            console.warn('[WebSocket] stale connection, terminating', id, 'ageMs=', age);
            try { rec.ws.terminate(); } catch (e) {}
            clients.delete(id);
            // notify remaining peers
            for (const pid of Array.from(clients.keys())) {
              const cws = clients.get(pid)!.ws;
              try { cws.send(JSON.stringify({ type: 'peer-left', playerId: id })); } catch (e) {}
            }
          }
        }
        refreshHealth();
      } catch (e) {
        // ignore heartbeat errors
      }
    }, WS_HEARTBEAT_INTERVAL);
    if (typeof (heartbeatTimer as any).unref === 'function') {
      (heartbeatTimer as any).unref();
    }
  } catch (err) {
    console.error('[WebSocket] failed to start signaling server', err);
  }

  return httpServer;
}
