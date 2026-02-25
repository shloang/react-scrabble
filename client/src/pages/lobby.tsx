import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useLocation } from 'wouter';
import { Button } from '@/components/ui/button';
import VoiceChat from '@/components/VoiceChat_new';
import { getGameState, updateGameState, leaveGame } from '@/lib/gameApi';
import { useToast } from '@/hooks/use-toast';
import { getStats } from '@/lib/playerStats';
import JoinGameDialog from '@/components/JoinGameDialog';
import handleInvalidSession from '@/lib/session';
import { joinGame as joinGameApi } from '@/lib/gameApi';

export default function Lobby() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [location, setLocation] = useLocation();

  const { data: gameState, refetch } = useQuery({
    queryKey: ['/api/game'],
    queryFn: getGameState,
    refetchInterval: 2000,
  });

  type ServerStats = { wins: number; losses: number; games: number; cachedAt?: number | null; score?: number };
  function useServerStats(playerId: string) {
    return useQuery<ServerStats>({
      queryKey: ['/api/player-stats', playerId],
      queryFn: async () => {
        const resp = await fetch(`/api/player-stats/${encodeURIComponent(playerId)}`);
        if (!resp.ok) throw new Error('Failed to load server stats');
        return resp.json();
      },
      staleTime: 1000 * 60 * 5,
    });
  }

  const updateMutation = useMutation({
    mutationFn: (s: any) => updateGameState(s),
    onSuccess: (data) => {
      if (data && data.gameState) queryClient.setQueryData(['/api/game'], data.gameState);
      else queryClient.invalidateQueries({ queryKey: ['/api/game'] });
    },
    onError: (err) => {
      toast({ variant: 'destructive', title: 'Ошибка', description: 'Не удалось обновить состояние' });
    }
  });

  useEffect(() => {
    // ensure query exists on mount
    try { refetch(); } catch {}
  }, []);

  const playerId = typeof window !== 'undefined' ? localStorage.getItem('playerId') : null;

  const [authState, setAuthState] = useState<'valid'|'invalid'>(() => {
    try { return localStorage.getItem('playerId') ? 'valid' : 'invalid'; } catch { return 'invalid'; }
  });
  const [isStarting, setIsStarting] = useState(false);

  const activeSessionPlayer = gameState?.players?.find((p: any) => p.id === playerId) || null;
  const hasActiveSession = !!playerId && !!activeSessionPlayer;
  const gameInProgress = !!gameState?.currentPlayer && (gameState?.turn || 0) > 0 && !gameState?.gameEnded;
  const allReady = !!gameState?.players?.length && gameState.players.every((p: any) => !!p.ready);
  const readyCount = gameState?.players?.filter((p: any) => !!p.ready).length || 0;

  useEffect(() => {
    if (!playerId) {
      setAuthState('invalid');
      return;
    }
    if (gameState && !gameState.players.some((p: any) => p.id === playerId)) {
      setAuthState('invalid');
      return;
    }
    setAuthState('valid');
  }, [playerId, gameState]);

  const handleToggleReady = async (playerId: string) => {
    try {
      const fresh = await getGameState();
      if (!fresh) return;
      const ns = structuredClone(fresh) as any;
      const me = ns.players.find((x: any) => x.id === playerId);
      if (!me) return;
      me.ready = !me.ready;
      await updateMutation.mutateAsync(ns);
    } catch (err) {
      console.error('[Lobby] toggle ready failed', err);
    }
  };

  const handleStart = async () => {
    if (isStarting) return;
    setIsStarting(true);
    try {
      // ensure starter is authenticated
      const storedId = typeof window !== 'undefined' ? localStorage.getItem('playerId') : null;
      if (!storedId) {
        setAuthState('invalid');
        toast({ variant: 'destructive', title: 'Требуется вход', description: 'Сначала присоединитесь к игре' });
        return;
      }

      if (!allReady) {
        toast({ variant: 'destructive', title: 'Не все готовы', description: 'Все игроки должны нажать «Готов» перед стартом' });
        return;
      }

      const resp = await fetch('/api/game/start', { method: 'POST' });
      if (resp.ok) {
        const data = await resp.json();
        if (data && data.gameState) queryClient.setQueryData(['/api/game'], data.gameState);
        // navigate to game
        setLocation('/');
        toast({ title: 'Игра начата' });
      } else {
        if (resp.status === 401 || resp.status === 403) {
          try { await handleInvalidSession(queryClient); } catch {}
          setAuthState('invalid');
          toast({ variant: 'destructive', title: 'Неверная сессия', description: 'Сессия устарела — войдите снова' });
          return;
        }
        const err = await resp.json().catch(() => ({}));
        const details = Array.isArray(err?.notReadyPlayers) && err.notReadyPlayers.length > 0
          ? `Не готовы: ${err.notReadyPlayers.join(', ')}`
          : (err.error || 'Ошибка');
        toast({ variant: 'destructive', title: 'Не удалось начать игру', description: details });
      }
    } catch (err) {
      console.error('[Lobby] start failed', err);
      toast({ variant: 'destructive', title: 'Не удалось начать игру' });
    } finally {
      setIsStarting(false);
    }
  };

  // Join flow used as fallback when authState is invalid
  const handleJoin = async (name: string, password: string) => {
    try {
      const resp = await joinGameApi(name, password);
      if (resp && (resp as any).playerId) {
        const id = (resp as any).playerId;
        try { localStorage.setItem('playerId', id); localStorage.setItem('playerName', name); } catch {}
        setAuthState('valid');
        try { await refetch(); } catch {}
        return;
      }
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Ошибка', description: err?.message || 'Не удалось присоединиться' });
    }
  };

  const handleLeaveLobby = async () => {
    const storedId = typeof window !== 'undefined' ? localStorage.getItem('playerId') : null;
    try {
      if (storedId) {
        const resp = await leaveGame(storedId);
        if (resp?.gameState) {
          queryClient.setQueryData(['/api/game'], resp.gameState);
        } else {
          queryClient.invalidateQueries({ queryKey: ['/api/game'] });
        }
      }
    } catch (err) {
      console.error('[Lobby] leave failed', err);
    } finally {
      try { localStorage.removeItem('playerId'); localStorage.removeItem('playerName'); } catch {}
      setAuthState('invalid');
      setLocation('/');
      toast({ title: 'Вы покинули лобби' });
    }
  };

  const handleEnterGame = async () => {
    if (!gameInProgress) {
      toast({ title: 'Игра ещё не начата', description: 'Сначала нажмите «Начать игру»' });
      return;
    }
    setLocation('/');
  };

  function PlayerRow({ player, localStats, isLocal, onToggleReady }: any) {
    const { data: serverStats, isLoading, error } = useServerStats(player.id);
    const s = serverStats || { wins: 0, losses: 0, games: 0, cachedAt: null, score: player.score };

    const stale = s.cachedAt ? (Date.now() - s.cachedAt) > (1000 * 60 * 60 * 24) : false;

    return (
      <div className="flex items-center justify-between p-2 rounded border bg-background">
        <div className="flex items-center gap-3">
          {player.avatarUrl ? (
            <img src={player.avatarUrl} alt={`${player.name} avatar`} className="w-10 h-10 rounded-full object-cover" />
          ) : (
            <div className="w-10 h-10 rounded-full bg-gray-200 flex items-center justify-center text-xs font-medium">{(player.name || '').slice(0,2).toUpperCase()}</div>
          )}
          <div>
            <div className="font-medium">{player.name}</div>
              <div className="text-xs text-muted-foreground">{player.score} очков • {s.score ?? '-'}</div>
            </div>
            <div
              className={`text-xs ml-2 px-2 py-1 rounded text-sm font-medium ${player.ready ? 'bg-green-100 text-green-800 dark:bg-green-800 dark:text-green-100' : 'bg-amber-100 text-amber-800 dark:bg-amber-800 dark:text-amber-100'}`}
            >
              {player.ready ? 'Готов' : 'Не готов'}
            </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="text-sm text-muted-foreground">Local W:{localStats.wins} / L:{localStats.losses} ({localStats.games})</div>
          <div className="text-sm text-muted-foreground">Server W:{s.wins} / L:{s.losses} ({s.games}){stale ? ' (stale)' : ''}</div>
          {isLocal && (
            <>
              <Button size="sm" onClick={onToggleReady}>{player.ready ? 'Отменить' : 'Готов'}</Button>
              <Button size="sm" variant="outline" onClick={async () => {
                try {
                  const url = window.prompt('Введите URL аватара (https://...)', player.avatarUrl || '');
                  if (!url) return;
                  const resp = await fetch(`/api/player/${encodeURIComponent(player.id)}/avatar`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ avatarUrl: url }) });
                  if (!resp.ok) {
                    const e = await resp.json().catch(() => ({}));
                    toast({ variant: 'destructive', title: 'Не удалось установить аватар', description: e.error || 'Ошибка' });
                    return;
                  }
                  // refresh game state so avatar shows up
                  try { await refetch(); } catch {}
                  toast({ title: 'Аватар обновлён' });
                } catch (err) {
                  console.error('[Avatar] set failed', err);
                  toast({ variant: 'destructive', title: 'Ошибка', description: 'Не удалось установить аватар' });
                }
              }}>Аватар</Button>
            </>
          )}
        </div>
      </div>
    );
  }

  // If not authenticated, show join dialog fallback
  if (authState !== 'valid') {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <JoinGameDialog open={true} playerCount={gameState?.players?.length || 0} onJoin={handleJoin} defaultName={typeof window !== 'undefined' ? localStorage.getItem('playerName') || undefined : undefined} />
      </div>
    );
  }

  if (!gameState) return (
    <div className="p-6">Загрузка лобби…</div>
  );

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-2xl bg-card p-6 rounded shadow-lg">
        <h2 className="text-2xl font-bold mb-4">Лобби — Ожидание игроков</h2>
        <div className="mb-4 flex items-center justify-between rounded border px-3 py-2 text-sm">
          <div className="text-muted-foreground">Сессия</div>
          <div className={`font-medium ${hasActiveSession ? 'text-green-600 dark:text-green-400' : 'text-amber-600 dark:text-amber-400'}`}>
            {hasActiveSession ? `Активна (${activeSessionPlayer?.name || 'игрок'})` : 'Не активна'}
          </div>
        </div>
        {playerId && <div className="mb-4"><VoiceChat playerId={playerId} voiceVolume={1} playerNames={Object.fromEntries((gameState.players||[]).map((p:any) => [p.id, p.name]))} /></div>}
        <div className="mb-4 text-sm text-muted-foreground">Игроки в лобби:</div>
        <div className="mb-3 text-xs text-muted-foreground">Готовность: {readyCount}/{gameState.players.length}</div>
        <div className="flex flex-col gap-2 max-h-60 overflow-auto">
          {gameState.players.map((p: any) => {
            const local = getStats(p.id);
            const isLocal = p.id === localStorage.getItem('playerId');
            return <PlayerRow key={p.id} player={p} localStats={local} isLocal={isLocal} onToggleReady={() => handleToggleReady(p.id)} />;
          })}
        </div>
        <div className="mt-6 flex gap-3 justify-end">
          <Button onClick={handleEnterGame} disabled={!gameInProgress} data-testid="button-enter-game">Войти в игру</Button>
          <Button variant="outline" onClick={handleLeaveLobby}>Покинуть лобби</Button>
          {!gameInProgress && gameState.players.length > 0 && gameState.players[0].id === localStorage.getItem('playerId') && (
            <Button variant="secondary" onClick={handleStart} disabled={isStarting || !allReady}>{isStarting ? 'Запуск...' : 'Начать игру'}</Button>
          )}
        </div>
      </div>
    </div>
  );
}
