import React, { useEffect, useRef, useState } from 'react';

interface VoiceChatProps {
  playerId: string | null;
  voiceVolume?: number;
  playerNames?: Record<string, string>;
}

export default function VoiceChatMinimal({ playerId, voiceVolume = 1, playerNames }: VoiceChatProps) {
  const wsRef = useRef<WebSocket | null>(null);
  const pcRefs = useRef<Record<string, RTCPeerConnection>>({});
  const audioEls = useRef<Record<string, HTMLAudioElement>>({});
  const localStreamRef = useRef<MediaStream | null>(null);
  const pendingCandidatesRef = useRef<Record<string, RTCIceCandidateInit[]>>({});
  const [micEnabled, setMicEnabled] = useState(false);
  const [peers, setPeers] = useState<string[]>([]);

  useEffect(() => {
    if (!playerId) return;
    // Build websocket URL defensively: some hosts (e.g. Replit) include query tokens
    // or proxy rewrites that can make a raw `location.host` unsuitable. Try a
    // few reasonable fallbacks and log attempts for diagnosis.
    const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
    let ws: WebSocket | null = null;
    const tryCreate = (url: string) => {
      try {
        console.log('[VoiceChat] attempting websocket to', url);
        return new WebSocket(url);
      } catch (e) {
        console.warn('[VoiceChat] websocket creation failed for', url, e);
        return null;
      }
    };

    const hostUrl = `${protocol}://${window.location.host}/ws`;
    ws = tryCreate(hostUrl);
    if (!ws) {
      const hostOnly = window.location.hostname + (window.location.port ? `:${window.location.port}` : '');
      ws = tryCreate(`${protocol}://${hostOnly}/ws`);
    }
    if (!ws) {
      try {
        const u = new URL(window.location.href);
        u.protocol = protocol + ':';
        u.search = '';
        u.hash = '';
        u.pathname = '/ws';
        ws = tryCreate(u.toString());
      } catch (e) {
        console.warn('[VoiceChat] fallback URL build failed', e);
      }
    }

    if (!ws) {
      console.error('[VoiceChat] failed to create websocket connection - no valid URL');
      return;
    }
    wsRef.current = ws;

    ws.addEventListener('open', () => {
      console.log('[VoiceChat] ws open');
      ws.send(JSON.stringify({ type: 'join', playerId }));
    });

    ws.addEventListener('message', async (ev) => {
      try { console.log('[VoiceChat] ws message', ev.data); } catch (e) {}
      try {
        const msg = JSON.parse(ev.data);
        const type = msg.type;
        if (type === 'peers') {
          const list: string[] = Array.isArray(msg.peers) ? msg.peers : [];
          setPeers(list);
          for (const peerId of list) {
            if (peerId === playerId) continue;
            await createOffer(peerId);
          }
        } else if (type === 'new-peer') {
          const newId = String(msg.playerId);
          setPeers(prev => prev.includes(newId) ? prev : [...prev, newId]);
        } else if (type === 'offer') {
          const from = String(msg.from);
          await handleOffer(from, msg.sdp);
        } else if (type === 'answer') {
          const from = String(msg.from);
          await handleAnswer(from, msg.sdp);
        } else if (type === 'candidate') {
          const from = String(msg.from);
          await handleCandidate(from, msg.candidate);
        } else if (type === 'peer-left') {
          const pid = String(msg.playerId);
          cleanupPeer(pid);
          setPeers(prev => prev.filter(p => p !== pid));
        }
      } catch (err) {}
    });

    ws.addEventListener('close', () => {
      for (const pid of Object.keys(pcRefs.current)) cleanupPeer(pid);
      wsRef.current = null;
    });

    return () => {
      try { ws.send(JSON.stringify({ type: 'leave', playerId })); } catch (e) {}
      try { ws.close(); } catch (e) {}
      for (const pid of Object.keys(pcRefs.current)) cleanupPeer(pid);
      wsRef.current = null;
    };
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
    const pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
    pcRefs.current[remoteId] = pc;
    pc.onicecandidate = (ev) => { if (ev.candidate) sendSignal({ type: 'candidate', to: remoteId, from: playerId, candidate: ev.candidate }); };
    pc.ontrack = (ev) => { const stream = (ev.streams && ev.streams[0]) || null; if (stream) { let audio = audioEls.current[remoteId]; if (!audio) { audio = document.createElement('audio'); audio.autoplay = true; (audio as any).playsInline = true; audioEls.current[remoteId] = audio; } audio.srcObject = stream; audio.volume = 1 * (voiceVolume ?? 1); audio.play().catch(() => {}); } };
    return pc;
  }

  async function createOffer(remoteId: string) {
    try {
      const pc = await createPeerConnection(remoteId);
      try { const s = await ensureLocalStream(); for (const t of s.getTracks()) pc.addTrack(t, s); } catch (e) {}
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

  function cleanupPeer(pid: string) { try { const pc = pcRefs.current[pid]; if (pc) { try { pc.close(); } catch (e) {} delete pcRefs.current[pid]; } const a = audioEls.current[pid]; if (a) { try { a.pause(); } catch (e) {} try { a.srcObject = null; } catch (e) {} delete audioEls.current[pid]; } delete pendingCandidatesRef.current[pid]; } catch (e) {} }

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
      </div>
    </div>
  );
}
