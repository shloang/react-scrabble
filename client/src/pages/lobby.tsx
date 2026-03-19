import { Suspense, lazy, memo, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useLocation } from 'wouter';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { getGameState, updateGameState, leaveGame } from '@/lib/gameApi';
import { useToast } from '@/hooks/use-toast';
import { getStats } from '@/lib/playerStats';
import { deriveCacheBadgeState } from '@/lib/statsCacheDisplay';
import JoinGameDialog from '@/components/JoinGameDialog';
import handleInvalidSession from '@/lib/session';
import { joinGame as joinGameApi } from '@/lib/gameApi';
import { Loader2, Mic, MicOff, PhoneCall, PhoneOff, RefreshCw, Signal, SignalHigh, Trash2, Upload, UserRoundCheck, Volume2, VolumeX } from 'lucide-react';

const VoiceChat = lazy(() => import('@/components/VoiceChat'));

const MAX_AVATAR_UPLOAD_BYTES = 262144;
const MAX_AVATAR_DATA_URL_LENGTH = 360000;

type AvatarFallbackData = {
  seed?: string;
  initials: string;
  backgroundColor: string;
  textColor: string;
};

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

function fallbackInitialsFromName(name: string): string {
  const trimmed = String(name || '').trim().replace(/\s+/g, ' ');
  if (!trimmed) return '??';
  const parts = trimmed.split(' ').filter(Boolean);
  if (parts.length >= 2) {
    const a = Array.from(parts[0])[0] || '?';
    const b = Array.from(parts[1])[0] || '?';
    return `${a}${b}`.toUpperCase();
  }
  const chars = Array.from(parts[0] || '');
  const first = chars[0] || '?';
  const second = chars[1] || first || '?';
  return `${first}${second}`.toUpperCase();
}

function getPlayerAvatarFallback(player: any): AvatarFallbackData {
  const fallback = player?.avatarFallback;
  if (
    fallback
    && typeof fallback.initials === 'string'
    && typeof fallback.backgroundColor === 'string'
    && typeof fallback.textColor === 'string'
  ) {
    return fallback;
  }
  return {
    initials: fallbackInitialsFromName(player?.name || ''),
    backgroundColor: '#3f3f46',
    textColor: '#f4f4f5',
  };
}

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

const PlayerAvatar = memo(function PlayerAvatar({ player, className = 'h-11 w-11 text-sm ring-1 ring-black/10 dark:ring-white/15 shadow-sm' }: { player: any; className?: string }) {
  const [imageError, setImageError] = useState(false);
  const fallback = getPlayerAvatarFallback(player);

  useEffect(() => {
    setImageError(false);
  }, [player?.avatarUrl]);

  return (
    <Avatar className={className}>
      {player?.avatarUrl && !imageError ? (
        <AvatarImage
          src={player.avatarUrl}
          alt={`Аватар ${player?.name || 'игрока'}`}
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          className="object-cover"
          onError={() => setImageError(true)}
        />
      ) : null}
      <AvatarFallback
        style={{
          color: fallback.textColor,
          backgroundColor: fallback.backgroundColor,
          backgroundImage: `radial-gradient(circle at 28% 22%, rgba(255,255,255,0.28), transparent 62%), linear-gradient(140deg, ${fallback.backgroundColor}, rgba(0,0,0,0.28))`,
        }}
        className="font-semibold tracking-wide motion-safe:animate-pulse [animation-duration:3.2s]"
      >
        {fallback.initials}
      </AvatarFallback>
    </Avatar>
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
  const gameInProgress = !!gameState?.currentPlayer && (gameState?.turn || 0) > 0 && !gameState?.gameEnded;
  const allReady = !!gameState?.players?.length && (gameState.players || []).every((p: any) => !!p.ready);
  const readyCount = gameState?.players?.filter((p: any) => !!p.ready).length || 0;

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

  const handleEnterGame = async () => {
    if (!gameInProgress) {
      toast({ title: 'Игра ещё не начата', description: 'Сначала нажмите «Начать игру»' });
      return;
    }
    setLocation('/');
  };

  const handleStartVoice = () => {
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
    setVoiceStarted(true);
    setVoiceMicMuted(false);
    toast({ title: 'Голос включен', description: 'Инициализируем голосовой канал' });
  };

  const handleStopVoice = () => {
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

  // When the server marks the game as started, automatically navigate
  // authenticated lobby clients into the game so they don't need to click "Enter".
  useEffect(() => {
    if (!gameInProgress || authState !== 'valid') return;

    // Refetch authoritative game state before navigating so the Game page
    // mounts with up-to-date data (avoids race conditions that can crash the UI).
    let cancelled = false;
    (async () => {
      try {
        const fresh = await refetch();
        await new Promise(r => setTimeout(r, 150));
        // ensure local player is present on server before navigating
        const stored = typeof window !== 'undefined' ? localStorage.getItem('playerId') : null;
        if (stored && fresh?.data && Array.isArray(fresh.data.players) && !fresh.data.players.some((p:any) => p.id === stored)) {
          // try a quick second refetch
          try { await refetch(); } catch {}
        }
      } catch (err) {
        // ignore refetch errors — still attempt navigation
      }
      if (cancelled) return;
      try { setLocation('/'); } catch (err) { /* ignore */ }
    })();

    return () => { cancelled = true; };
  }, [gameInProgress, authState, setLocation, refetch]);

  function PlayerRow({ player, localStats, isLocal, onToggleReady }: any) {
    const {
      data: serverStats,
      isLoading: serverStatsLoading,
      isFetching: serverStatsFetching,
      isError: serverStatsError,
    } = useServerStats(player.id);

    const s = serverStats || {
      wins: 0,
      losses: 0,
      games: 0,
      cachedAt: null,
      staleAt: null,
      expiresAt: null,
      score: player.score,
      isStale: false,
      isExpired: false,
      cacheStatus: 'fresh' as const,
      ageMs: undefined,
    };

    const badgeState = deriveCacheBadgeState({
      serverStats,
      serverStatsLoading,
      serverStatsFetching,
      serverStatsError,
    });

    const displayStats = serverStats || {
      wins: Number(localStats?.wins) || 0,
      losses: Number(localStats?.losses) || 0,
      games: Number(localStats?.games) || 0,
      score: player.score,
      cachedAt: null,
      staleAt: null,
      expiresAt: null,
      cacheStatus: 'fresh' as const,
      source: 'local-fallback',
      isStale: false,
      isExpired: false,
      ageMs: undefined,
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
      <div className="flex flex-col gap-3 rounded-xl border bg-background/90 p-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <PlayerAvatar player={player} />
          <div className="min-w-0">
            <div className="font-medium truncate">{player.name}</div>
              <div className="text-xs text-muted-foreground">
                Очки в партии: {formatStatsNumber(player.score)} • Снимок сервера: {formatStatsNumber(s.score)}
              </div>
            </div>
          <div
            className={`ml-auto shrink-0 rounded-full px-2.5 py-1 text-xs font-medium sm:ml-0 ${player.ready ? 'bg-green-100 text-green-800 dark:bg-green-800 dark:text-green-100' : 'bg-amber-100 text-amber-800 dark:bg-amber-800 dark:text-amber-100'}`}
          >
            {player.ready ? 'Готов' : 'Не готов'}
          </div>
        </div>
        <div className="flex w-full flex-col gap-2 sm:w-auto sm:items-end">
          <div className="flex flex-wrap items-center gap-2 sm:justify-end">
            <Badge
              variant={badgeState.variant}
              className="inline-flex items-center gap-1"
              aria-live="polite"
              title={cacheMetaTooltip}
              aria-label={cacheMetaTooltip}
            >
              {(serverStatsLoading || serverStatsFetching) && !serverStatsError ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" /> : null}
              <span>{badgeState.label}</span>
            </Badge>
            {Number.isFinite(s.cachedAt) && (
              <span
                className="text-[11px] text-muted-foreground"
                title={`Возраст серверного снимка: ${formatStatsAge(serverStats)}. ${cacheMetaTooltip}`}
              >
                Снимок: {formatStatsAge(serverStats)}
              </span>
            )}
          </div>
          <div className="grid gap-1 text-xs text-muted-foreground sm:text-right">
            <div>
              Локально: победы {formatStatsNumber(localStats?.wins)}, поражения {formatStatsNumber(localStats?.losses)}, игр {formatStatsNumber(localStats?.games)}
            </div>
            <div className={serverStatsError ? 'text-destructive' : ''}>
              Сервер: победы {formatStatsNumber(displayStats.wins)}, поражения {formatStatsNumber(displayStats.losses)}, игр {formatStatsNumber(displayStats.games)}
              {serverStatsError ? ' (ошибка загрузки)' : ''}
            </div>
            {Number.isFinite(s.cachedAt) || Number.isFinite(s.staleAt) || Number.isFinite(s.expiresAt) ? (
              <div className="text-[11px]" title={cacheMetaTooltip}>
                Обновлено: {formatStatsTime(s.cachedAt)} • Устареет: {formatStatsTime(s.staleAt)} • Истечет: {formatStatsTime(s.expiresAt)}
              </div>
            ) : (
              <div className="text-[11px]" title={cacheMetaTooltip}>
                Метаданные кэша недоступны, используются безопасные значения отображения.
              </div>
            )}
          </div>
          {isLocal && (
            <div className="flex flex-wrap gap-2">
              <Button size="sm" onClick={onToggleReady}>{player.ready ? 'Отменить' : 'Готов'}</Button>
              <Button size="sm" variant="outline" onClick={() => setAvatarDialogOpen(true)}>Аватар</Button>
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
          <div className={`font-medium ${hasActiveSession ? 'text-green-600 dark:text-green-400' : 'text-amber-600 dark:text-amber-400'}`}>
            {hasActiveSession ? `Активна (${activeSessionPlayer?.name || 'игрок'})` : 'Не активна'}
          </div>
        </div>
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
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {!voiceStarted ? (
                <Button
                  size="sm"
                  onClick={handleStartVoice}
                  disabled={!hasActiveSession || !playerId}
                  aria-label="Запустить голосовой чат"
                >
                  <PhoneCall className="h-4 w-4" aria-hidden="true" />
                  <span>Запустить голос</span>
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

          <div className="mt-3 space-y-2">
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

          {voiceStarted && playerId && (
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
            return <PlayerRow key={p.id} player={p} localStats={local} isLocal={isLocal} onToggleReady={() => handleToggleReady(p.id)} />;
          })}
        </div>
        <div className="mt-6 flex gap-3 justify-end">
          <Button onClick={handleEnterGame} disabled={!gameInProgress} data-testid="button-enter-game">Войти в игру</Button>
          <Button variant="outline" onClick={handleLeaveLobby}>Покинуть лобби</Button>
          {!gameInProgress && (gameState?.players?.length || 0) > 0 && gameState?.players?.[0]?.id === localStorage.getItem('playerId') && (
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
