import { Suspense, lazy, memo, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useLocation } from 'wouter';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { getGameState, updateGameState, leaveGame, kickPlayer, resetSession as resetSessionApi } from '@/lib/gameApi';
import { useToast } from '@/hooks/use-toast';
import { getStats } from '@/lib/playerStats';
import { deriveCacheBadgeState } from '@/lib/statsCacheDisplay';
import { hasGameInProgress } from '@/lib/sessionPhase';
import JoinGameDialog from '@/components/JoinGameDialog';
import handleInvalidSession from '@/lib/session';
import { joinGame as joinGameApi } from '@/lib/gameApi';
import { ChevronDown, ChevronRight, Loader2, Mic, MicOff, PhoneCall, PhoneOff, RefreshCw, Signal, SignalHigh, Trash2, Upload, UserRoundCheck, Volume2, VolumeX } from 'lucide-react';

const VoiceChat = lazy(() => import('@/components/VoiceChat'));

const MAX_AVATAR_UPLOAD_BYTES = 262144;
const MAX_AVATAR_DATA_URL_LENGTH = 360000;

type CacheTelemetryPayload = {
  playerId: string;
  label: string;
  cacheStatus: string;
  hasServerStats: boolean;
  loading: boolean;
  fetching: boolean;
  hasError: boolean;
  stale: boolean;
  expired: boolean;
  source: string;
};

function validateRemoteAvatarUrl(rawValue: string): { value?: string; error?: string } {
  const trimmed = rawValue.trim();
  if (!trimmed) return {};
  if (!/^https?:\/\//i.test(trimmed)) {
    return { error: 'URL аватара должен начинаться с http:// или https://.' };
  }
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return { error: 'URL аватара должен использовать http(s).' };
    }
    if (parsed.username || parsed.password) {
      return { error: 'URL аватара не должен содержать логин или пароль.' };
    }
    return { value: parsed.toString() };
  } catch {
    return { error: 'Введите корректный абсолютный URL изображения.' };
  }
}

const PlayerAvatar = memo(function PlayerAvatar({ player, className = 'h-11 w-11 ring-1 ring-black/10 dark:ring-white/15 shadow-sm' }: { player: any; className?: string }) {
  const playerName = String(player?.name || 'игрок');
  const avatarUrl = `https://robohash.org/${encodeURIComponent(playerName)}?size=160x160`;

  return (
    <div className={`overflow-hidden rounded-full bg-muted flex items-center justify-center shrink-0 ${className}`}>
      <img
        src={avatarUrl}
        alt={`Аватар ${playerName}`}
        loading="lazy"
        decoding="async"
        referrerPolicy="no-referrer"
        className="h-full w-full object-cover"
      />
    </div>
  );
});
PlayerAvatar.displayName = 'PlayerAvatar';

export default function Lobby() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [, setLocation] = useLocation();

  const { data: gameState, refetch } = useQuery({
    queryKey: ['/api/game'],
    queryFn: getGameState,
    refetchInterval: 2000,
  });

  type ServerStats = {
    playerId?: string;
    score?: number;
    wins: number;
    losses: number;
    draws: number;
    games: number;
    cachedAt?: number | null;
    staleAt?: number | null;
    expiresAt?: number | null;
    isStale?: boolean;
    isExpired?: boolean;
    cacheStatus?: 'fresh' | 'stale' | 'expired';
    ageMs?: number;
    source?: string;
  };
  function useServerStats(playerId: string) {
    return useQuery<ServerStats>({
      queryKey: ['/api/player-stats', playerId],
      queryFn: async () => {
        let requesterId = '';
        try {
          requesterId = localStorage.getItem('playerId') || '';
        } catch {
          requesterId = '';
        }
        const query = requesterId ? `?requesterId=${encodeURIComponent(requesterId)}` : '';
        const resp = await fetch(`/api/player-stats/${encodeURIComponent(playerId)}${query}`);
        if (!resp.ok) throw new Error('Failed to load server stats');
        return resp.json();
      },
      staleTime: 1000 * 60 * 5,
      retry: 1,
    });
  }

  const updateMutation = useMutation({
    mutationFn: (s: any) => updateGameState(s),
    onSuccess: (data) => {
      if (data && data.gameState) queryClient.setQueryData(['/api/game'], data.gameState);
      else queryClient.invalidateQueries({ queryKey: ['/api/game'] });
    },
    onError: async (err: any) => {
      const message = String(err?.message || '');
      if (message.toLowerCase().includes('stale')) {
        try { await refetch(); } catch {}
        toast({ variant: 'destructive', title: 'Состояние устарело', description: 'Лобби обновлено, повторите действие' });
        return;
      }
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
  const [voiceStarted, setVoiceStarted] = useState(false);
  const [voiceMicMuted, setVoiceMicMuted] = useState(false);
  const [voicePeerMuted, setVoicePeerMuted] = useState<Record<string, boolean>>({});
  const [voicePeerVolumes, setVoicePeerVolumes] = useState<Record<string, number>>({});
  const [voiceReconnectAttempt, setVoiceReconnectAttempt] = useState(0);
  const [voicePanelOpen, setVoicePanelOpen] = useState(false);
  const [avatarDialogOpen, setAvatarDialogOpen] = useState(false);
  const [avatarUrlInput, setAvatarUrlInput] = useState('');
  const [avatarUploadDataUrl, setAvatarUploadDataUrl] = useState<string | null>(null);
  const [avatarUploadFileName, setAvatarUploadFileName] = useState('');
  const [avatarError, setAvatarError] = useState<string | null>(null);
  const [avatarSubmitting, setAvatarSubmitting] = useState(false);
  const [voiceState, setVoiceState] = useState<{
    peerVolumes: Record<string, number>;
    peerMuted: Record<string, boolean>;
    peerStatuses: Record<string, string>;
    levels: Record<string, number>;
    wsState: 'connecting' | 'open' | 'closed' | 'error' | 'none';
    peers: string[];
    micEnabled: boolean;
  }>({
    peerVolumes: {},
    peerMuted: {},
    peerStatuses: {},
    levels: {},
    wsState: 'none',
    peers: [],
    micEnabled: false,
  });
  const previousWsStateRef = useRef<typeof voiceState.wsState>('none');
  const previousGameStateRef = useRef<any | null>(null);

  const activeSessionPlayer = gameState?.players?.find((p: any) => p.id === playerId) || null;
  const avatarDialogPreviewUrl = useMemo(() => {
    if (avatarUploadDataUrl) return avatarUploadDataUrl;
    const remote = validateRemoteAvatarUrl(avatarUrlInput);
    if (remote.value) return remote.value;
    return activeSessionPlayer?.avatarUrl;
  }, [avatarUploadDataUrl, avatarUrlInput, activeSessionPlayer?.avatarUrl]);
  const avatarDialogPreviewPlayer = useMemo(
    () => ({ ...activeSessionPlayer, avatarUrl: avatarDialogPreviewUrl }),
    [activeSessionPlayer, avatarDialogPreviewUrl],
  );
  const hasActiveSession = !!playerId && !!activeSessionPlayer;
  const isHost = !!playerId && (gameState?.players?.[0]?.id === playerId);
  const gameInProgress = hasGameInProgress(gameState);
  const gameEnded = !!gameState?.gameEnded;
  const canResetSession = !!activeSessionPlayer && (isHost || gameEnded);
  const sessionStatusClass = gameEnded
    ? 'text-amber-600 dark:text-amber-400'
    : hasActiveSession
      ? 'text-green-600 dark:text-green-400'
      : 'text-amber-600 dark:text-amber-400';
  const sessionStatusLabel = gameEnded
    ? `Партия завершена${activeSessionPlayer?.name ? ` (${activeSessionPlayer.name})` : ''}`
    : hasActiveSession
      ? `Активна (${activeSessionPlayer?.name || 'игрок'})`
      : 'Не активна';
  const allReady = !!gameState?.players?.length && (gameState.players || []).every((p: any) => !!p.ready);
  const readyCount = gameState?.players?.filter((p: any) => !!p.ready).length || 0;
  const localVoiceEnabled = !!activeSessionPlayer?.voiceEnabled;
  const voiceEnabledCount = gameState?.players?.filter((p: any) => !!p.voiceEnabled).length || 0;
  const allPlayersVoiceEnabled = !!gameState?.players?.length && (gameState.players || []).every((p: any) => !!p.voiceEnabled);

  useEffect(() => {
    const prevState = previousGameStateRef.current;
    previousGameStateRef.current = gameState;

    if (!playerId || !gameState || !prevState) return;

    const transitionedToGame = !hasGameInProgress(prevState) && hasGameInProgress(gameState);
    if (!transitionedToGame) return;

    const isActiveParticipant = Array.isArray(gameState.players)
      && gameState.players.some((p: any) => p.id === playerId);
    if (!isActiveParticipant) return;

    setLocation('/');
    toast({ title: 'Игра началась', description: 'Лобби автоматически перевело вас в партию' });
  }, [gameState, playerId, setLocation, toast]);

  useEffect(() => {
    if (!playerId) {
      setAuthState('invalid');
      return;
    }
    // Defensive: ensure players array exists before calling .some
    if (gameState) {
      if (!Array.isArray(gameState.players) || !gameState.players.some((p: any) => p.id === playerId)) {
        setAuthState('invalid');
        return;
      }
    }
    setAuthState('valid');
  }, [playerId, gameState]);

  useEffect(() => {
    if (authState === 'valid' && hasActiveSession) return;
    setVoiceStarted(false);
    setVoiceMicMuted(false);
    setVoicePeerMuted({});
    setVoicePeerVolumes({});
    setVoiceReconnectAttempt(0);
  }, [authState, hasActiveSession]);

  useEffect(() => {
    if (!gameEnded) return;
    setVoiceStarted(false);
    setVoiceMicMuted(false);
    setVoicePeerMuted({});
    setVoicePeerVolumes({});
    setVoiceReconnectAttempt(0);
  }, [gameEnded]);

  useEffect(() => {
    if (!localVoiceEnabled || !allPlayersVoiceEnabled) {
      if (voiceStarted) {
        setVoiceStarted(false);
        setVoiceMicMuted(false);
        setVoicePeerMuted({});
        setVoicePeerVolumes({});
        setVoiceReconnectAttempt(0);
      }
      return;
    }

    let signalingToken: string | null = null;
    try {
      signalingToken = localStorage.getItem('signalingToken');
    } catch {}
    if (signalingToken && !voiceStarted) {
      setVoiceStarted(true);
      setVoiceMicMuted(false);
    }
  }, [localVoiceEnabled, allPlayersVoiceEnabled, voiceStarted]);

  useEffect(() => {
    if (!voiceStarted) return;
    if (voiceState.wsState !== 'closed' && voiceState.wsState !== 'error') return;
    let signalingToken: string | null = null;
    try {
      signalingToken = localStorage.getItem('signalingToken');
    } catch {}
    if (!hasActiveSession || !playerId || !signalingToken) {
      setVoiceStarted(false);
      setVoiceMicMuted(false);
      setVoicePeerMuted({});
      setVoicePeerVolumes({});
      setVoiceReconnectAttempt(0);
      toast({
        variant: 'destructive',
        title: 'Голос остановлен',
        description: 'Сессия или токен голоса недействительны. Перезайдите в лобби для переподключения.',
      });
      return;
    }
    let nextAttempt = 1;
    setVoiceReconnectAttempt((prev) => {
      nextAttempt = prev + 1;
      return nextAttempt;
    });
    toast({
      title: 'Переподключаем голос',
      description: `Попытка ${nextAttempt}: восстанавливаем сигналинг автоматически`,
    });
    const timer = window.setTimeout(() => {
      window.dispatchEvent(new Event('voicechat:reconnect'));
    }, 2500);
    return () => window.clearTimeout(timer);
  }, [voiceStarted, voiceState.wsState, hasActiveSession, playerId, toast]);

  useEffect(() => {
    if (!voiceStarted) {
      previousWsStateRef.current = 'none';
      return;
    }
    if (voiceState.wsState === previousWsStateRef.current) return;
    previousWsStateRef.current = voiceState.wsState;

    if (voiceState.wsState === 'open') {
      if (voiceReconnectAttempt > 0) {
        toast({
          title: 'Голос восстановлен',
          description: `Соединение вернулось после попыток: ${voiceReconnectAttempt}`,
        });
      }
      setVoiceReconnectAttempt(0);
      toast({ title: 'Голос подключен', description: 'Сигналинг установлен, можно говорить' });
    } else if (voiceState.wsState === 'connecting') {
      toast({ title: 'Подключаем голос', description: 'Пробуем соединиться с участниками лобби' });
    } else if (voiceState.wsState === 'error') {
      toast({ variant: 'destructive', title: 'Ошибка голоса', description: 'Не удалось подключить сигналинг, будет выполнена попытка переподключения' });
    } else if (voiceState.wsState === 'closed') {
      toast({ variant: 'destructive', title: 'Голос отключен', description: 'Соединение закрыто, выполняем переподключение' });
    }
  }, [voiceStarted, voiceState.wsState, toast]);

  const handleToggleReady = async (playerId: string) => {
    try {
      if (gameState?.gameEnded) {
        toast({
          variant: 'destructive',
          title: 'Партия завершена',
          description: 'Сначала сбросьте сессию, затем соберите новое лобби.',
        });
        return;
      }
      const fresh = await getGameState();
      if (!fresh) return;
      if (fresh.gameEnded) {
        toast({
          variant: 'destructive',
          title: 'Партия завершена',
          description: 'Сначала сбросьте сессию, затем соберите новое лобби.',
        });
        return;
      }
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
        // Wait for authoritative state to propagate before navigating to avoid
        // race where the Game page mounts before the server has added the player.
        try {
          const fresh = await refetch();
          // small safety delay to allow server processing + client cache updates
          await new Promise(r => setTimeout(r, 150));
          // if we have a stored playerId, ensure server confirms presence
          const stored = typeof window !== 'undefined' ? localStorage.getItem('playerId') : null;
          if (stored && fresh?.data && Array.isArray(fresh.data.players) && !fresh.data.players.some((p:any) => p.id === stored)) {
            // try one more short refetch before navigating
            try { await refetch(); } catch {}
          }
        } catch (err) {
          // ignore refetch errors; still attempt navigation
        }
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
        try {
          localStorage.setItem('playerId', id);
          localStorage.setItem('playerName', name);
          if ((resp as any).signalingToken) {
            localStorage.setItem('signalingToken', (resp as any).signalingToken);
          }
        } catch {}
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
      try {
        localStorage.removeItem('playerId');
        localStorage.removeItem('playerName');
        localStorage.removeItem('signalingToken');
      } catch {}
      setAuthState('invalid');
      setLocation('/');
      toast({ title: 'Вы покинули лобби' });
    }
  };

  const handleResetSession = async () => {
    if (!playerId) {
      toast({ variant: 'destructive', title: 'Сессия недействительна', description: 'Перезайдите в лобби и повторите' });
      return;
    }
    const ok = window.confirm('Сбросить текущую сессию? Это удалит всех игроков из лобби/игры и очистит состояние партии.');
    if (!ok) return;

    try {
      const resp = await resetSessionApi(playerId);
      if (resp?.gameState) {
        queryClient.setQueryData(['/api/game'], resp.gameState);
      } else {
        queryClient.invalidateQueries({ queryKey: ['/api/game'] });
      }
      setVoiceStarted(false);
      setVoiceMicMuted(false);
      setVoicePeerMuted({});
      setVoicePeerVolumes({});
      setVoiceReconnectAttempt(0);
      toast({ title: 'Сессия сброшена', description: 'Лобби и партия очищены' });
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Не удалось сбросить сессию', description: err?.message || 'Ошибка' });
    }
  };

  const handleNewGameFromEnded = async () => {
    if (!playerId) {
      toast({ variant: 'destructive', title: 'Session invalid', description: 'Rejoin the lobby and try again.' });
      return;
    }

    try {
      const resp = await resetSessionApi(playerId, { preservePlayers: true });
      if (resp?.gameState) {
        queryClient.setQueryData(['/api/game'], resp.gameState);
      } else {
        queryClient.invalidateQueries({ queryKey: ['/api/game'] });
      }
      setVoiceStarted(false);
      setVoiceMicMuted(false);
      setVoicePeerMuted({});
      setVoicePeerVolumes({});
      setVoiceReconnectAttempt(0);
      toast({ title: 'New lobby ready', description: 'Players were kept, readiness and voice settings were reset.' });
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Could not create new lobby', description: err?.message || 'Error' });
    }
  };

  const handleKickPlayer = async (targetPlayerId: string) => {
    if (!playerId || !hasActiveSession || gameInProgress || targetPlayerId === playerId) return;
    const target = gameState?.players?.find((p: any) => p.id === targetPlayerId);
    const ok = window.confirm(`Remove ${target?.name || 'player'} from the lobby?`);
    if (!ok) return;

    try {
      const resp = await kickPlayer(playerId, targetPlayerId);
      if (resp?.gameState) {
        queryClient.setQueryData(['/api/game'], resp.gameState);
      } else {
        queryClient.invalidateQueries({ queryKey: ['/api/game'] });
      }
      toast({ title: 'Player removed from lobby' });
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Could not remove player', description: err?.message || 'Error' });
    }
  };

  const handleEnterGame = async () => {
    if (!gameInProgress) {
      toast({ title: 'Игра ещё не начата', description: 'Сначала нажмите «Начать игру»' });
      return;
    }
    setLocation('/');
  };

  const setLocalVoiceEnabled = async (enabled: boolean) => {
    if (!playerId) return null;
    if (gameEnded) {
      toast({
        variant: 'destructive',
        title: 'Партия завершена',
        description: 'Сначала сбросьте сессию, затем настройте голос заново.',
      });
      return null;
    }
    const fresh = await getGameState();
    if (!fresh) return null;
    if (fresh.gameEnded) return null;
    const nextState = structuredClone(fresh) as any;
    const localPlayer = Array.isArray(nextState.players) ? nextState.players.find((p: any) => p.id === playerId) : null;
    if (!localPlayer) return null;
    localPlayer.voiceEnabled = enabled;
    await updateMutation.mutateAsync(nextState);
    return nextState;
  };

  const handleStartVoice = async () => {
    if (!hasActiveSession || !playerId) {
      toast({ variant: 'destructive', title: 'Сессия недействительна', description: 'Перезайдите в лобби перед стартом голоса' });
      return;
    }
    let signalingToken: string | null = null;
    try {
      signalingToken = localStorage.getItem('signalingToken');
    } catch {}
    if (!signalingToken) {
      toast({
        variant: 'destructive',
        title: 'Нет токена сигналинга',
        description: 'Сессия голоса устарела. Перезайдите в лобби, чтобы получить новый токен.',
      });
      return;
    }
    try {
      const nextState = await setLocalVoiceEnabled(true);
      if (!nextState) return;
      const everyoneReady = !!nextState?.players?.length && nextState.players.every((p: any) => !!p.voiceEnabled);
      if (!everyoneReady) {
        setVoiceStarted(false);
        setVoiceMicMuted(false);
      }
      toast({
        title: everyoneReady ? 'Голос включен' : 'Голос ожидает игроков',
        description: everyoneReady
          ? 'Все игроки включили голос, инициализируем канал'
          : 'Соединение начнется, когда все участники включат голос',
      });
    } catch (err) {
      console.error('[Lobby] enable voice failed', err);
      toast({ variant: 'destructive', title: 'Voice unavailable', description: 'Could not enable voice opt-in.' });
    }
  };

  const handleStopVoice = async () => {
    try {
      await setLocalVoiceEnabled(false);
    } catch (err) {
      console.error('[Lobby] disable voice failed', err);
    }
    setVoiceStarted(false);
    setVoiceMicMuted(false);
    setVoicePeerMuted({});
    setVoicePeerVolumes({});
    setVoiceReconnectAttempt(0);
    toast({ title: 'Голос остановлен', description: 'Микрофон и подключение отключены' });
  };

  const resetAvatarDialogState = (player?: any | null) => {
    const currentUrl = typeof player?.avatarUrl === 'string' ? player.avatarUrl : '';
    setAvatarUrlInput(/^https?:\/\//i.test(currentUrl) ? currentUrl : '');
    setAvatarUploadDataUrl(null);
    setAvatarUploadFileName('');
    setAvatarError(null);
  };

  useEffect(() => {
    if (!avatarDialogOpen) return;
    resetAvatarDialogState(activeSessionPlayer);
  }, [avatarDialogOpen, activeSessionPlayer?.avatarUrl]);

  const readFileAsDataUrl = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('Не удалось прочитать файл'));
      reader.onload = () => {
        const value = typeof reader.result === 'string' ? reader.result : '';
        if (!value) reject(new Error('Не удалось подготовить изображение'));
        else resolve(value);
      };
      reader.readAsDataURL(file);
    });
  };

  const handleAvatarFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      setAvatarError('Нужен файл изображения (PNG, JPG, WEBP или GIF).');
      return;
    }
    if (file.size > MAX_AVATAR_UPLOAD_BYTES) {
      setAvatarError(`Файл слишком большой: ${Math.round(file.size / 1024)} KB (лимит 256 KB).`);
      return;
    }

    try {
      const dataUrl = await readFileAsDataUrl(file);
      if (dataUrl.length > MAX_AVATAR_DATA_URL_LENGTH) {
        setAvatarError('Подготовленное изображение слишком длинное для отправки.');
        return;
      }
      setAvatarUploadDataUrl(dataUrl);
      setAvatarUploadFileName(file.name);
      setAvatarError(null);
    } catch (err: any) {
      setAvatarError(err?.message || 'Не удалось загрузить файл.');
    }
  };

  const submitAvatarUpdate = async (avatarUrl: string | null) => {
    if (!activeSessionPlayer?.id) {
      toast({ variant: 'destructive', title: 'Сессия недействительна', description: 'Перезайдите в лобби перед обновлением аватара' });
      return;
    }

    setAvatarSubmitting(true);
    try {
      const resp = await fetch(`/api/player/${encodeURIComponent(activeSessionPlayer.id)}/avatar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ avatarUrl }),
      });

      const payload = await resp.json().catch(() => ({}));

      if (!resp.ok) {
        const details = payload?.details || payload?.error || 'Ошибка';
        setAvatarError(details);
        toast({ variant: 'destructive', title: 'Не удалось обновить аватар', description: details });
        return;
      }

      const normalizedAvatarUrl = Object.prototype.hasOwnProperty.call(payload, 'avatarUrl')
        ? payload.avatarUrl
        : avatarUrl;
      const normalizedFallback = payload?.avatarFallback;

      queryClient.setQueryData(['/api/game'], (prev: any) => {
        if (!prev || !Array.isArray(prev.players)) return prev;
        return {
          ...prev,
          players: prev.players.map((p: any) => {
            if (p?.id !== activeSessionPlayer.id) return p;
            const nextPlayer = { ...p };
            if (typeof normalizedAvatarUrl === 'string' && normalizedAvatarUrl.length > 0) {
              nextPlayer.avatarUrl = normalizedAvatarUrl;
            } else {
              delete nextPlayer.avatarUrl;
            }
            if (
              normalizedFallback
              && typeof normalizedFallback.initials === 'string'
              && typeof normalizedFallback.backgroundColor === 'string'
              && typeof normalizedFallback.textColor === 'string'
            ) {
              nextPlayer.avatarFallback = normalizedFallback;
            }
            return nextPlayer;
          }),
        };
      });
      void queryClient.invalidateQueries({ queryKey: ['/api/game'] });
      setAvatarDialogOpen(false);
      toast({ title: normalizedAvatarUrl ? 'Аватар обновлен' : 'Аватар сброшен' });
    } catch (err) {
      console.error('[Avatar] set failed', err);
      setAvatarError('Не удалось обновить аватар. Проверьте подключение и повторите.');
      toast({ variant: 'destructive', title: 'Ошибка', description: 'Не удалось обновить аватар' });
    } finally {
      setAvatarSubmitting(false);
    }
  };

  const handleAvatarSave = async () => {
    const remote = validateRemoteAvatarUrl(avatarUrlInput);
    if (remote.error) {
      setAvatarError(remote.error);
      return;
    }
    const nextAvatar = avatarUploadDataUrl || remote.value || '';
    if (!nextAvatar) {
      setAvatarError('Введите URL или выберите файл изображения.');
      return;
    }
    setAvatarError(null);
    await submitAvatarUpdate(nextAvatar);
  };

  const signalStateLabel = voiceState.wsState === 'open'
    ? 'Подключено'
    : voiceState.wsState === 'connecting'
      ? 'Подключение'
      : voiceState.wsState === 'error'
        ? 'Ошибка'
        : voiceState.wsState === 'closed'
          ? 'Отключено'
          : 'Ожидание';

  const signalBadgeVariant: 'default' | 'secondary' | 'destructive' | 'outline' =
    voiceState.wsState === 'open'
      ? 'secondary'
      : voiceState.wsState === 'error'
        ? 'destructive'
        : 'outline';

  const signalIcon = voiceState.wsState === 'open'
    ? <SignalHigh className="h-3.5 w-3.5" aria-hidden="true" />
    : <Signal className="h-3.5 w-3.5" aria-hidden="true" />;

  function describeVoicePeerStatus(status: string, isInVoice: boolean, speaking: boolean, isLocal: boolean): {
    label: string;
    variant: 'default' | 'secondary' | 'destructive' | 'outline';
  } {
    if (isLocal) {
      if (!voiceStarted) return { label: 'локально выключен', variant: 'outline' };
      if (voiceMicMuted) return { label: 'микрофон выключен', variant: 'outline' };
      return { label: 'микрофон активен', variant: 'secondary' };
    }
    if (status === 'connected') return { label: speaking ? 'говорит' : 'подключен', variant: 'secondary' };
    if (status === 'retrying') return { label: 'переподключение', variant: 'outline' };
    if (status === 'failed' || status === 'error') return { label: 'ошибка связи', variant: 'destructive' };
    if (status === 'connecting' || status === 'new') return { label: 'подключение', variant: 'outline' };
    if (status === 'disconnected' || status === 'closed') return { label: 'отключен', variant: 'outline' };
    if (isInVoice) return { label: 'в голосе', variant: 'secondary' };
    return { label: 'вне голоса', variant: 'outline' };
  }

  function formatStatsAge(stats?: ServerStats | null): string {
    if (!stats) return 'нет данных';
    const ageMs = Number.isFinite(stats.ageMs) ? Number(stats.ageMs) : (Number.isFinite(stats.cachedAt) ? Date.now() - Number(stats.cachedAt) : NaN);
    if (!Number.isFinite(ageMs)) return 'нет метаданных';
    const seconds = Math.max(0, Math.floor(ageMs / 1000));
    if (seconds <= 1) return 'только что';
    if (seconds < 60) return `${seconds}с назад`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}м назад`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}ч назад`;
    const days = Math.floor(hours / 24);
    return `${days}д назад`;
  }

  function formatStatsTime(ts?: number | null): string {
    if (!Number.isFinite(ts)) return '—';
    return new Date(Number(ts)).toLocaleString('ru-RU', {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  function formatStatsNumber(value: unknown): string {
    const num = Number(value);
    if (!Number.isFinite(num)) return '—';
    return `${num}`;
  }

  function buildCacheMetaTooltip(stats: ServerStats | null | undefined, badgeLabel: string): string {
    if (!stats) {
      return `Статус кэша: ${badgeLabel}. Серверные метаданные недоступны.`;
    }

    const sourceLabel = stats.source ? `Источник: ${stats.source}` : 'Источник: н/д';
    const ageLabel = `Возраст снимка: ${formatStatsAge(stats)}`;
    const cachedAtLabel = `Создан: ${formatStatsTime(stats.cachedAt)}`;
    const staleAtLabel = `Станет устаревшим: ${formatStatsTime(stats.staleAt)}`;
    const expiresAtLabel = `Истечет: ${formatStatsTime(stats.expiresAt)}`;
    return [
      `Статус кэша: ${badgeLabel}`,
      sourceLabel,
      ageLabel,
      cachedAtLabel,
      staleAtLabel,
      expiresAtLabel,
    ].join(' | ');
  }

  function PlayerRow({ player, localStats, isLocal, canKick, onKick }: any) {
    const {
      data: serverStats,
      isLoading: serverStatsLoading,
      isFetching: serverStatsFetching,
      isError: serverStatsError,
    } = useServerStats(player.id);

    const badgeState = deriveCacheBadgeState({
      serverStats,
      serverStatsLoading,
      serverStatsFetching,
      serverStatsError,
    });

    const displayStats = {
      wins: Number(serverStats?.wins ?? localStats?.wins) || 0,
      losses: Number(serverStats?.losses ?? localStats?.losses) || 0,
      draws: Number(serverStats?.draws ?? localStats?.draws) || 0,
      games: Number(serverStats?.games ?? localStats?.games) || 0,
      score: serverStats?.score ?? player.score,
      cachedAt: serverStats?.cachedAt ?? null,
      staleAt: serverStats?.staleAt ?? null,
      expiresAt: serverStats?.expiresAt ?? null,
      cacheStatus: serverStats?.cacheStatus ?? ('fresh' as const),
      source: serverStats?.source ?? 'local-fallback',
      isStale: serverStats?.isStale ?? false,
      isExpired: serverStats?.isExpired ?? false,
      ageMs: serverStats?.ageMs,
    };

    const cacheMetaTooltip = buildCacheMetaTooltip(serverStats, badgeState.label);
    const cacheTelemetrySignatureRef = useRef('');

    useEffect(() => {
      const payload: CacheTelemetryPayload = {
        playerId: String(player?.id || ''),
        label: badgeState.label,
        cacheStatus: String(serverStats?.cacheStatus || 'none'),
        hasServerStats: Boolean(serverStats),
        loading: serverStatsLoading,
        fetching: serverStatsFetching,
        hasError: serverStatsError,
        stale: badgeState.stale,
        expired: badgeState.expired,
        source: String(serverStats?.source || 'none'),
      };

      const signature = JSON.stringify(payload);
      if (cacheTelemetrySignatureRef.current === signature) return;
      cacheTelemetrySignatureRef.current = signature;
      console.info('[Lobby][StatsCache]', payload);
    }, [
      player?.id,
      badgeState.label,
      badgeState.stale,
      badgeState.expired,
      serverStats?.cacheStatus,
      serverStats?.source,
      serverStatsLoading,
      serverStatsFetching,
      serverStatsError,
      Boolean(serverStats),
    ]);

    return (
      <div className="flex flex-col gap-2 rounded-lg border bg-background/90 px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-2.5">
          <PlayerAvatar player={player} className="h-9 w-9 text-xs ring-1 ring-black/10 dark:ring-white/15 shadow-sm" />
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold leading-tight">{player.name}</div>
              <div className="text-xs text-muted-foreground">
                Очки: {formatStatsNumber(player.score)} • Поб {formatStatsNumber(displayStats.wins)} • Пор {formatStatsNumber(displayStats.losses)} • Нич {formatStatsNumber(displayStats.draws)} • Игр {formatStatsNumber(displayStats.games)}
              </div>
            </div>
          <div
            className={`ml-auto shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium sm:ml-0 ${player.ready ? 'bg-green-100 text-green-800 dark:bg-green-800 dark:text-green-100' : 'bg-amber-100 text-amber-800 dark:bg-amber-800 dark:text-amber-100'}`}
          >
            {player.ready ? 'Готов' : 'Не готов'}
          </div>
        </div>
        <div className="flex w-full flex-col gap-1 sm:w-auto sm:items-end">
          <div className="flex flex-wrap items-center gap-2 sm:justify-end">
            <Badge
              variant={badgeState.variant}
              className="inline-flex h-6 items-center gap-1 px-2 text-[11px]"
              aria-live="polite"
              title={cacheMetaTooltip}
              aria-label={cacheMetaTooltip}
            >
              {(serverStatsLoading || serverStatsFetching) && !serverStatsError ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" /> : null}
              <span>{badgeState.label}</span>
            </Badge>
            {false && Number.isFinite(serverStats?.cachedAt) && (
              <span
                className="text-[11px] text-muted-foreground"
                title={`Возраст серверного снимка: ${formatStatsAge(serverStats)}. ${cacheMetaTooltip}`}
              >
                Снимок: {formatStatsAge(serverStats)}
              </span>
            )}
          </div>
          <div className="hidden gap-1 text-xs text-muted-foreground sm:text-right">
            <div>
              Локально: победы {formatStatsNumber(localStats?.wins)}, поражения {formatStatsNumber(localStats?.losses)}, ничьи {formatStatsNumber(localStats?.draws)}, игр {formatStatsNumber(localStats?.games)}
            </div>
            <div className={serverStatsError ? 'text-destructive' : ''}>
              Итоги: победы {formatStatsNumber(displayStats.wins)}, поражения {formatStatsNumber(displayStats.losses)}, ничьи {formatStatsNumber(displayStats.draws)}, игр {formatStatsNumber(displayStats.games)}
              {serverStatsError ? ' (серверный снимок недоступен)' : ''}
            </div>
            {Number.isFinite(serverStats?.cachedAt) || Number.isFinite(serverStats?.staleAt) || Number.isFinite(serverStats?.expiresAt) ? (
              <div className="text-[11px]" title={cacheMetaTooltip}>
                Обновлено: {formatStatsTime(serverStats?.cachedAt)} • Устареет: {formatStatsTime(serverStats?.staleAt)} • Истечет: {formatStatsTime(serverStats?.expiresAt)}
              </div>
            ) : (
              <div className="text-[11px]" title={cacheMetaTooltip}>
                Метаданные кэша недоступны, используются безопасные значения отображения.
              </div>
            )}
          </div>
          {canKick && (
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="destructive" onClick={onKick} className="h-7 px-2 text-xs">Remove</Button>
            </div>
          )}
          {isLocal && (
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={() => setAvatarDialogOpen(true)} className="h-7 px-2 text-xs">Аватар</Button>
            </div>
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
          <div className={`font-medium ${sessionStatusClass}`}>
            {sessionStatusLabel}
          </div>
        </div>
        {gameEnded && activeSessionPlayer && (
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm">
            <div className="text-amber-700 dark:text-amber-300">Game is finished. Create a fresh lobby to start another round.</div>
            <Button size="sm" variant="secondary" onClick={handleNewGameFromEnded}>New game</Button>
          </div>
        )}
        <div className="mb-4 rounded border p-3 bg-background/80">
          <div className="flex flex-wrap items-center gap-2 justify-between">
            <div className="flex items-center gap-2">
              <div className="font-medium text-sm">Голосовой чат</div>
              <Badge variant={signalBadgeVariant} className="inline-flex items-center gap-1" aria-live="polite">
                {signalIcon}
                <span>{signalStateLabel}</span>
              </Badge>
              <Badge variant="outline" className="inline-flex items-center gap-1">
                <UserRoundCheck className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Участники: {voiceState.peers.length}</span>
              </Badge>
              <Badge variant={allPlayersVoiceEnabled ? 'secondary' : 'outline'} className="inline-flex items-center gap-1">
                <span>Голос: {voiceEnabledCount}/{gameState?.players?.length || 0}</span>
              </Badge>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setVoicePanelOpen((prev) => !prev)}
                aria-expanded={voicePanelOpen}
                aria-controls="voice-settings-panel"
              >
                {voicePanelOpen ? <ChevronDown className="h-4 w-4" aria-hidden="true" /> : <ChevronRight className="h-4 w-4" aria-hidden="true" />}
                <span>{voicePanelOpen ? 'Скрыть' : 'Настройки'}</span>
              </Button>
              {voicePanelOpen && (
                <>
              {!localVoiceEnabled ? (
                <Button
                  size="sm"
                  onClick={handleStartVoice}
                  disabled={!hasActiveSession || !playerId || gameEnded}
                  aria-label="Запустить голосовой чат"
                >
                  <PhoneCall className="h-4 w-4" aria-hidden="true" />
                  <span>Включить голос</span>
                </Button>
              ) : !voiceStarted ? (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleStopVoice}
                  aria-label="Отменить готовность к голосовому чату"
                >
                  <PhoneOff className="h-4 w-4" aria-hidden="true" />
                  <span>Ждем голос</span>
                </Button>
              ) : (
                <>
                  <Button
                    size="sm"
                    variant={voiceMicMuted ? 'outline' : 'secondary'}
                    onClick={() => setVoiceMicMuted((prev) => !prev)}
                    disabled={!voiceState.micEnabled}
                    aria-label={voiceMicMuted ? 'Включить микрофон' : 'Выключить микрофон'}
                    aria-pressed={!voiceMicMuted}
                  >
                    {voiceMicMuted ? <MicOff className="h-4 w-4" aria-hidden="true" /> : <Mic className="h-4 w-4" aria-hidden="true" />}
                    <span>{voiceMicMuted ? 'Микрофон выключен' : 'Микрофон включен'}</span>
                  </Button>
                  {(voiceState.wsState === 'closed' || voiceState.wsState === 'error') && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        let signalingToken: string | null = null;
                        try {
                          signalingToken = localStorage.getItem('signalingToken');
                        } catch {}
                        if (!hasActiveSession || !playerId || !signalingToken) {
                          setVoiceStarted(false);
                          setVoiceMicMuted(false);
                          setVoicePeerMuted({});
                          setVoicePeerVolumes({});
                          setVoiceReconnectAttempt(0);
                          toast({
                            variant: 'destructive',
                            title: 'Нельзя переподключить голос',
                            description: 'Сессия или токен сигналинга недействительны. Перезайдите в лобби.',
                          });
                          return;
                        }
                        setVoiceReconnectAttempt((prev) => prev + 1);
                        window.dispatchEvent(new Event('voicechat:reconnect'));
                        toast({ title: 'Переподключаем голос', description: 'Отправили запрос на восстановление соединения' });
                      }}
                      aria-label="Переподключить голосовой чат"
                    >
                      <RefreshCw className="h-4 w-4" aria-hidden="true" />
                      <span>Переподключить</span>
                    </Button>
                  )}
                  <Button size="sm" variant="outline" onClick={handleStopVoice} aria-label="Остановить голосовой чат">
                    <PhoneOff className="h-4 w-4" aria-hidden="true" />
                    <span>Остановить голос</span>
                  </Button>
                </>
              )}
                </>
              )}
            </div>
          </div>

          <div className="sr-only" aria-live="polite">
            Статус голосового чата: {signalStateLabel}
          </div>
          <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">
            {voiceStarted
              ? `Голос активен. Микрофон ${voiceMicMuted ? 'выключен' : 'включен'}. ${voiceReconnectAttempt > 0 ? `Переподключение, попытка ${voiceReconnectAttempt}.` : ''}`
              : 'Голосовой чат отключен.'}
          </div>

          {voicePanelOpen && (
          <div id="voice-settings-panel" className="mt-3 space-y-2">
            {(gameState.players || []).map((p: any) => {
              const isLocalParticipant = p.id === playerId;
              const isInVoice = isLocalParticipant
                ? voiceStarted
                : voiceState.peers.includes(p.id);
              const rawPeerStatus = isLocalParticipant
                ? (voiceStarted ? (voiceMicMuted ? 'mic-muted' : 'mic-live') : 'voice-off')
                : (voiceState.peerStatuses[p.id] || (isInVoice ? 'connecting' : 'offline'));
              const level = voiceState.levels[p.id] ?? 0;
              const speaking = !isLocalParticipant && isInVoice && level > 0.08;
              const peerStatus = describeVoicePeerStatus(rawPeerStatus, isInVoice, speaking, isLocalParticipant);
              const muted = !!voicePeerMuted[p.id];
              const volume = voicePeerVolumes[p.id] ?? 1;

              return (
                <div key={`voice-${p.id}`} className="flex flex-wrap items-center justify-between gap-2 rounded border px-2 py-1.5 text-xs">
                  <div className="flex items-center gap-2 min-w-0">
                    <PlayerAvatar player={p} className="h-8 w-8 text-[10px] ring-1 ring-black/5 dark:ring-white/10" />
                    <span className="font-medium truncate max-w-[10rem]">{p.name}</span>
                    <Badge variant={p.voiceEnabled ? 'secondary' : 'outline'}>{p.voiceEnabled ? 'голос готов' : 'голос выкл.'}</Badge>
                    <Badge variant={isInVoice ? 'secondary' : 'outline'}>{isInVoice ? 'в голосе' : 'вне голоса'}</Badge>
                    <Badge variant={peerStatus.variant} aria-live="polite">{peerStatus.label}</Badge>
                    <div
                      className="w-16 h-2 rounded bg-muted overflow-hidden"
                      role="progressbar"
                      aria-label={`Уровень голоса ${p.name}`}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={Math.round(Math.max(0, Math.min(1, level)) * 100)}
                    >
                      <div
                        className={`h-full transition-all ${speaking ? 'bg-green-500' : 'bg-primary/40'}`}
                        style={{ width: `${Math.max(6, Math.round(level * 100))}%` }}
                      />
                    </div>
                  </div>

                  {!isLocalParticipant && (
                    <div className="flex items-center gap-2">
                      <Button
                        size="sm"
                        variant={muted ? 'secondary' : 'outline'}
                        onClick={() => setVoicePeerMuted((prev) => ({ ...prev, [p.id]: !prev[p.id] }))}
                        aria-label={muted ? `Включить звук игрока ${p.name}` : `Отключить звук игрока ${p.name}`}
                        aria-pressed={muted}
                      >
                        {muted ? <VolumeX className="h-4 w-4" aria-hidden="true" /> : <Volume2 className="h-4 w-4" aria-hidden="true" />}
                        <span>{muted ? 'Без звука' : 'Звук'}</span>
                      </Button>
                      <input
                        aria-label={`Громкость ${p.name}`}
                        type="range"
                        min={0}
                        max={100}
                        value={Math.round(volume * 100)}
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-valuenow={Math.round(volume * 100)}
                        aria-valuetext={`${Math.round(volume * 100)} процентов`}
                        onChange={(event) => {
                          const next = Math.max(0, Math.min(100, Number(event.target.value))) / 100;
                          setVoicePeerVolumes((prev) => ({ ...prev, [p.id]: next }));
                        }}
                        className="w-24 accent-primary"
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          )}

          {voiceStarted && allPlayersVoiceEnabled && playerId && (
            <Suspense
              fallback={
                <div className="hidden" aria-hidden>
                  <Loader2 className="h-4 w-4 animate-spin" />
                </div>
              }
            >
              <div className="hidden" aria-hidden>
                <VoiceChat
                  playerId={playerId}
                  voiceVolume={1}
                  playerNames={Object.fromEntries((gameState.players || []).map((p: any) => [p.id, p.name]))}
                  showControls={false}
                  autoStartMic={true}
                  externalMicMuted={voiceMicMuted}
                  externalPeerMuted={voicePeerMuted}
                  externalPeerVolumes={voicePeerVolumes}
                  onStateUpdate={(next) => setVoiceState(next)}
                />
              </div>
            </Suspense>
          )}
        </div>
        <div className="mb-4 text-sm text-muted-foreground">Игроки в лобби:</div>
        <div className="mb-3 text-xs text-muted-foreground">Готовность: {readyCount}/{gameState?.players?.length || 0}</div>
        <div className="flex flex-col gap-2 max-h-60 overflow-auto">
          {(gameState?.players || []).map((p: any) => {
            const local = getStats(p.id);
            const isLocal = p.id === localStorage.getItem('playerId');
            return (
              <PlayerRow
                key={p.id}
                player={p}
                localStats={local}
                isLocal={isLocal}
                canKick={hasActiveSession && !isLocal && !gameInProgress}
                onKick={() => handleKickPlayer(p.id)}
              />
            );
          })}
        </div>
        <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:flex-wrap sm:justify-end">
          {!gameInProgress && !gameEnded && activeSessionPlayer && (
            <Button onClick={() => handleToggleReady(activeSessionPlayer.id)} data-testid="button-ready">
              {activeSessionPlayer.ready ? 'Отменить готовность' : 'Готов'}
            </Button>
          )}
          <Button onClick={handleEnterGame} disabled={!gameInProgress} data-testid="button-enter-game">Войти в игру</Button>
          <Button variant="outline" onClick={handleLeaveLobby}>Покинуть лобби</Button>
          {canResetSession && (
            <Button variant="destructive" onClick={handleResetSession}>Сбросить сессию</Button>
          )}
          {!gameInProgress && !gameEnded && isHost && (
            <Button variant="secondary" onClick={handleStart} disabled={isStarting || !allReady}>{isStarting ? 'Запуск...' : 'Начать игру'}</Button>
          )}
        </div>

        <Dialog open={avatarDialogOpen} onOpenChange={setAvatarDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Аватар игрока</DialogTitle>
              <DialogDescription>
                Укажите ссылку на изображение или загрузите файл до 256 KB. Если аватар не загрузится, в лобби автоматически останется цветной fallback.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4">
              <div className="flex items-center gap-3 rounded-xl border p-3 bg-background/60">
                <PlayerAvatar player={avatarDialogPreviewPlayer} className="h-14 w-14 text-base ring-2 ring-primary/20" />
                <div className="min-w-0">
                  <div className="text-sm font-medium truncate">{activeSessionPlayer?.name || 'Игрок'}</div>
                  <div className="text-xs text-muted-foreground truncate">
                    {avatarUploadFileName ? `Выбран файл: ${avatarUploadFileName}` : (activeSessionPlayer?.avatarUrl ? 'Текущий аватар из профиля' : 'Сейчас используется fallback-аватар')}
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="avatar-url-input">URL изображения</Label>
                <Input
                  id="avatar-url-input"
                  value={avatarUrlInput}
                  onChange={(event) => {
                    setAvatarUrlInput(event.target.value);
                    setAvatarUploadDataUrl(null);
                    setAvatarUploadFileName('');
                    setAvatarError(null);
                  }}
                  placeholder="https://example.com/avatar.png"
                  autoComplete="off"
                />
                <div className="text-xs text-muted-foreground">
                  Поддерживаются только абсолютные http(s) ссылки.
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="avatar-file-input">Загрузить файл</Label>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                  <Input
                    id="avatar-file-input"
                    type="file"
                    accept="image/png,image/jpeg,image/webp,image/gif"
                    onChange={handleAvatarFileChange}
                    className="w-full sm:max-w-full"
                  />
                  <Badge variant="outline" className="w-fit text-[11px]">До 256 KB</Badge>
                </div>
                <div className="text-xs text-muted-foreground">
                  При выборе файла он отправится как data URL в текущий API аватара.
                </div>
              </div>

              {avatarError && (
                <div className="rounded border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  {avatarError}
                </div>
              )}
            </div>

            <DialogFooter className="flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button
                type="button"
                variant="outline"
                onClick={() => submitAvatarUpdate(null)}
                disabled={avatarSubmitting}
              >
                <Trash2 className="h-4 w-4" aria-hidden="true" />
                <span>Сбросить</span>
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={handleAvatarSave}
                disabled={avatarSubmitting}
              >
                {avatarSubmitting ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Upload className="h-4 w-4" aria-hidden="true" />}
                <span>{avatarSubmitting ? 'Сохраняем...' : 'Сохранить аватар'}</span>
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}
