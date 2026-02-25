import React, { useEffect, useRef, useState } from 'react';

interface VoiceChatProps {
  playerId: string | null;
  voiceVolume?: number;
  playerNames?: Record<string, string>;
}

export default function VoiceChatMinimal({ playerId, voiceVolume = 1, playerNames }: VoiceChatProps) {
  const wsRef = useRef<WebSocket | null>(null);
  const [wsState, setWsState] = useState<'connecting' | 'open' | 'closed' | 'error' | 'none'>('none');
  const pcRefs = useRef<Record<string, RTCPeerConnection>>({});
  const iceServersRef = useRef<any[] | null>(null);
  const forceRelayRef = useRef<boolean>(false);
  const dataChannelsRef = useRef<Record<string, RTCDataChannel | null>>({});
  const keepaliveTimersRef = useRef<Record<string, number>>({});
  const audioEls = useRef<Record<string, HTMLAudioElement>>({});
  const localStreamRef = useRef<MediaStream | null>(null);
  const pendingCandidatesRef = useRef<Record<string, RTCIceCandidateInit[]>>({});
  const [micEnabled, setMicEnabled] = useState(false);
  const [peers, setPeers] = useState<string[]>([]);

  useEffect(() => {
    if (!playerId) return;

    let cleanupCurrent: (() => void) | null = null;

    const setup = () => {
      try { if (cleanupCurrent) { cleanupCurrent(); cleanupCurrent = null; } } catch (e) {}

      const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
      let ws: WebSocket | null = null;
      const tryCreate = (url: string) => {
        try { console.log('[VoiceChat] attempting websocket to', url); return new WebSocket(url); } catch (e) { console.warn('[VoiceChat] websocket creation failed for', url, e); return null; }
      };

      const candidates: string[] = [];
      try { const u = new URL(window.location.href); if (u.origin) candidates.push(u.origin); } catch (e) {}
      if (typeof window !== 'undefined' && (window as any).location && (window as any).location.origin) candidates.push((window as any).location.origin);
      try { const hostOnly = window.location.hostname + (window.location.port ? `:${window.location.port}` : ''); candidates.push(`${window.location.protocol.includes('https') ? 'https' : 'http'}://${hostOnly}`); } catch (e) {}

      for (const base of candidates) {
        try { const u = new URL(base); u.protocol = protocol + ':'; u.pathname = '/ws'; u.search = ''; u.hash = ''; ws = tryCreate(u.toString()); if (ws) break; } catch (e) {}
      }

      if (!ws) { console.error('[VoiceChat] failed to create websocket connection - no valid URL'); setWsState('error'); return; }
      wsRef.current = ws;
      setWsState('connecting');

      let wsKeepaliveTimer: number | null = null;
      const onOpen = () => {
        console.log('[VoiceChat] ws open');
        setWsState('open');
        try { ws!.send(JSON.stringify({ type: 'join', playerId })); } catch (e) {}
        try {
          wsKeepaliveTimer = window.setInterval(() => {
            try { if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'ws-ping' })); } catch (e) {}
          }, 20000) as unknown as number;
        } catch (e) {}
      };
      const onError = (e: any) => { console.error('[VoiceChat] ws error', e); setWsState('error'); };
      const onClose = () => { console.log('[VoiceChat] ws closed'); setWsState('closed'); };
      const onMessage = async (ev: MessageEvent) => {
        try { console.log('[VoiceChat] ws message', ev.data); } catch (e) {}
        try {
          const msg = JSON.parse(ev.data as string);
          const type = msg.type;
          if (type === 'peers') {
            const list: string[] = Array.isArray(msg.peers) ? msg.peers : [];
            setPeers(list);
            for (const peerId of list) { if (peerId === playerId) continue; await createOffer(peerId); }
          } else if (type === 'new-peer') { const newId = String(msg.playerId); setPeers(prev => prev.includes(newId) ? prev : [...prev, newId]); }
          else if (type === 'offer') { const from = String(msg.from); await handleOffer(from, msg.sdp); }
          else if (type === 'answer') { const from = String(msg.from); await handleAnswer(from, msg.sdp); }
          else if (type === 'candidate') { const from = String(msg.from); await handleCandidate(from, msg.candidate); }
          else if (type === 'peer-left') { const pid = String(msg.playerId); cleanupPeer(pid); setPeers(prev => prev.filter(p => p !== pid)); }
        } catch (err) {}
      };

      ws.addEventListener('open', onOpen);
      ws.addEventListener('error', onError);
      ws.addEventListener('close', onClose);
      ws.addEventListener('message', onMessage as any);

      cleanupCurrent = () => {
        try { ws.send(JSON.stringify({ type: 'leave', playerId })); } catch (e) {}
        try { ws.close(); } catch (e) {}
        ws.removeEventListener('open', onOpen);
        ws.removeEventListener('error', onError);
        ws.removeEventListener('close', onClose);
        ws.removeEventListener('message', onMessage as any);
        for (const pid of Object.keys(pcRefs.current)) cleanupPeer(pid);
        try { if (wsKeepaliveTimer) { clearInterval(wsKeepaliveTimer); wsKeepaliveTimer = null; } } catch (e) {}
        wsRef.current = null;
        setWsState('closed');
      };
    };

    setup();
    const onReconnect = () => { try { if (cleanupCurrent) { cleanupCurrent(); cleanupCurrent = null; } } catch (e) {} setup(); };
    window.addEventListener('voicechat:reconnect', onReconnect);
    return () => { try { if (cleanupCurrent) cleanupCurrent(); } catch (e) {} window.removeEventListener('voicechat:reconnect', onReconnect); };
  }, [playerId]);

  // Add local tracks to existing peer connections and renegotiate
  async function addLocalTracksToPeers() {
    try {
      const s = await ensureLocalStream();
      for (const pid of Object.keys(pcRefs.current)) {
        const pc = pcRefs.current[pid];
        try {
          for (const t of s.getTracks()) {
            try { pc.addTrack(t, s); } catch (e) { /* ignore duplicate */ }
          }
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          sendSignal({ type: 'offer', to: pid, from: playerId, sdp: offer });
        } catch (e) {
          console.warn('[VoiceChat] failed to add tracks/renegotiate for', pid, e);
        }
      }
    } catch (e) {
      console.warn('[VoiceChat] addLocalTracksToPeers: no local stream', e);
    }
  }

  async function ensureLocalStream() {
    if (localStreamRef.current) return localStreamRef.current;
    const s = await navigator.mediaDevices.getUserMedia({ audio: true });
    localStreamRef.current = s;
    return s;
  }

  function sendSignal(msg: any) { if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) wsRef.current.send(JSON.stringify(msg)); }

  async function createPeerConnection(remoteId: string) {
    if (pcRefs.current[remoteId]) return pcRefs.current[remoteId];
    // try to fetch server-provided TURN/STUN config (only once)
      try {
      if (!iceServersRef.current) {
        const resp = await fetch('/api/turn-config');
        if (resp.ok) {
          const data = await resp.json();
          if (Array.isArray(data?.iceServers) && data.iceServers.length > 0) iceServersRef.current = data.iceServers;
          if (data?.forceRelay) forceRelayRef.current = true;
        }
      }
    } catch (err) {
      console.warn('[VoiceChat] failed to fetch turn-config, using default STUN', err);
    }

    const servers = iceServersRef.current ?? [{ urls: 'stun:stun.l.google.com:19302' }];
    const cfg: RTCConfiguration = { iceServers: servers };
    if (forceRelayRef.current) {
      // Force relay-only mode so all media is routed via TURN
      // This will fail to connect if TURN is not reachable.
      (cfg as any).iceTransportPolicy = 'relay';
    }
    const pc = new RTCPeerConnection(cfg);
    pcRefs.current[remoteId] = pc;
    pc.onicecandidate = (ev) => { if (ev.candidate) sendSignal({ type: 'candidate', to: remoteId, from: playerId, candidate: ev.candidate }); };
    pc.ontrack = (ev) => { const stream = (ev.streams && ev.streams[0]) || null; if (stream) { let audio = audioEls.current[remoteId]; if (!audio) { audio = document.createElement('audio'); audio.autoplay = true; (audio as any).playsInline = true; audioEls.current[remoteId] = audio; } audio.srcObject = stream; audio.volume = 1 * (voiceVolume ?? 1); audio.play().catch(() => {}); } };

    pc.oniceconnectionstatechange = () => {
      try {
        const s = (pc as any).iceConnectionState;
        console.log('[VoiceChat] iceConnectionState', remoteId, s);
        if (s === 'failed' || s === 'disconnected') {
          // attempt quick reconnect: cleanup and re-offer
          setTimeout(() => {
            try { cleanupPeer(remoteId); createOffer(remoteId); } catch (e) {}
          }, 2000);
        }
      } catch (e) {}
    };

    pc.ondatachannel = (ev) => {
      try {
        const ch = ev.channel;
        dataChannelsRef.current[remoteId] = ch;
        ch.onmessage = () => { /* keepalive pings received */ };
        ch.onopen = () => {
          if (!keepaliveTimersRef.current[remoteId]) {
            try {
              keepaliveTimersRef.current[remoteId] = window.setInterval(() => {
                try { if (ch.readyState === 'open') ch.send(JSON.stringify({ type: 'ping' })); } catch (e) {}
              }, 20000) as unknown as number;
            } catch (e) {}
          }
        };
        ch.onclose = () => { try { const t = keepaliveTimersRef.current[remoteId]; if (t) { clearInterval(t); delete keepaliveTimersRef.current[remoteId]; } } catch (e) {} };
      } catch (e) {}
    };

    return pc;
  }

  async function createOffer(remoteId: string) {
    try {
      const pc = await createPeerConnection(remoteId);
      try { const s = await ensureLocalStream(); for (const t of s.getTracks()) pc.addTrack(t, s); } catch (e) {}
      try {
        if (!dataChannelsRef.current[remoteId]) {
          const ch = pc.createDataChannel('keepalive');
          dataChannelsRef.current[remoteId] = ch;
          ch.onopen = () => {
            try {
              if (!keepaliveTimersRef.current[remoteId]) {
                keepaliveTimersRef.current[remoteId] = window.setInterval(() => {
                  try { if (ch.readyState === 'open') ch.send(JSON.stringify({ type: 'ping' })); } catch (e) {}
                }, 20000) as unknown as number;
              }
            } catch (e) {}
          };
          ch.onmessage = () => { /* handle if needed */ };
          ch.onclose = () => { try { const t = keepaliveTimersRef.current[remoteId]; if (t) { clearInterval(t); delete keepaliveTimersRef.current[remoteId]; } } catch (e) {} };
        }
      } catch (e) {}

      const offer = await pc.createOffer(); await pc.setLocalDescription(offer); sendSignal({ type: 'offer', to: remoteId, from: playerId, sdp: offer });
    } catch (err) { console.error('createOffer failed', err); }
  }

  async function handleOffer(from: string, sdp: any) {
    try {
      const pc = await createPeerConnection(from);
      await pc.setRemoteDescription(new RTCSessionDescription(sdp));
      try { const s = await ensureLocalStream(); for (const t of s.getTracks()) pc.addTrack(t, s); } catch (e) {}
      const answer = await pc.createAnswer(); await pc.setLocalDescription(answer); sendSignal({ type: 'answer', to: from, from: playerId, sdp: answer });
    } catch (err) { console.error('handleOffer failed', err); }
  }

  async function handleAnswer(from: string, sdp: any) {
    try {
      const pc = pcRefs.current[from]; if (!pc) return; await pc.setRemoteDescription(new RTCSessionDescription(sdp)); const pending = pendingCandidatesRef.current[from] || []; for (const c of pending) { try { await pc.addIceCandidate(c); } catch (e) {} } pendingCandidatesRef.current[from] = [];
    } catch (err) { console.error('handleAnswer failed', err); }
  }

  async function handleCandidate(from: string, candidate: any) {
    try { const pc = pcRefs.current[from]; if (!pc) { pendingCandidatesRef.current[from] = pendingCandidatesRef.current[from] || []; pendingCandidatesRef.current[from].push(candidate as RTCIceCandidateInit); return; } const remoteDesc = (pc as any).remoteDescription; if (!remoteDesc || !remoteDesc.type) { pendingCandidatesRef.current[from] = pendingCandidatesRef.current[from] || []; pendingCandidatesRef.current[from].push(candidate as RTCIceCandidateInit); return; } await pc.addIceCandidate(candidate); } catch (err) { console.error('handleCandidate failed', err); }
  }

  function cleanupPeer(pid: string) {
    try {
      const pc = pcRefs.current[pid];
      if (pc) {
        try { pc.close(); } catch (e) {}
        delete pcRefs.current[pid];
      }
      const a = audioEls.current[pid];
      if (a) {
        try { a.pause(); } catch (e) {}
        try { a.srcObject = null; } catch (e) {}
        delete audioEls.current[pid];
      }
      // cleanup datachannel and its keepalive timer
      try {
        const ch = dataChannelsRef.current[pid];
        if (ch) {
          try { ch.close(); } catch (e) {}
          delete dataChannelsRef.current[pid];
        }
      } catch (e) {}
      try {
        const t = keepaliveTimersRef.current[pid];
        if (t) { try { clearInterval(t); } catch (e) {} delete keepaliveTimersRef.current[pid]; }
      } catch (e) {}
      delete pendingCandidatesRef.current[pid];
    } catch (e) {}
  }

  const toggleMic = async () => {
    if (!micEnabled) {
      try {
        await ensureLocalStream();
        setMicEnabled(true);
        // add local tracks to peers and renegotiate
        await addLocalTracksToPeers();
      } catch (e) {
        setMicEnabled(false);
      }
    } else {
      const s = localStreamRef.current;
      if (s) {
        for (const t of s.getTracks()) t.stop();
        localStreamRef.current = null;
      }
      setMicEnabled(false);
      for (const pid of Object.keys(pcRefs.current)) {
        const pc = pcRefs.current[pid];
        try {
          pc.getSenders().forEach(sender => { try { if (sender.track) { try { sender.track.stop(); } catch (e) {} } } catch (err) {} });
          // trigger renegotiation to let peers know we've removed tracks
          try {
            (async () => {
              const offer = await pc.createOffer();
              await pc.setLocalDescription(offer);
              sendSignal({ type: 'offer', to: pid, from: playerId, sdp: offer });
            })();
          } catch (e) {
            /* ignore */
          }
        } catch (e) {}
      }
    }
  };

  return (
    <div className="voice-chat">
      <div className="flex items-center gap-2">
        <button onClick={toggleMic} className={`px-3 py-1 rounded ${micEnabled ? 'bg-red-600 text-white' : 'bg-green-600 text-white'}`}>
          {micEnabled ? 'Disable Mic' : 'Enable Mic'}
        </button>
        <div className="text-sm text-muted-foreground">Peers: {peers.length}</div>
        <div className="text-xs px-2 py-1 rounded ml-2 flex items-center gap-2" aria-hidden>
          {wsState === 'open' ? <span className="text-green-500">● connected</span> : wsState === 'connecting' ? <span className="text-yellow-500">● connecting</span> : wsState === 'error' ? <span className="text-red-500">● error</span> : <span className="text-gray-400">● idle</span>}
          {(wsState === 'error' || wsState === 'closed') && (
            <button
              onClick={() => window.dispatchEvent(new Event('voicechat:reconnect'))}
              className="text-xs px-2 py-1 rounded bg-muted/10 hover:bg-muted/20"
              title="Reconnect signaling"
            >
              Reconnect
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
