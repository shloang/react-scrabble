import React, { useEffect, useRef, useState } from 'react';

interface VoiceChatProps {
  playerId: string | null;
  voiceVolume?: number; // global multiplier for voice audio (0..1)
  playerNames?: Record<string, string>;
  onStateUpdate?: (state: { peerVolumes: Record<string, number>; peerMuted: Record<string, boolean>; peerStatuses: Record<string, string>; levels: Record<string, number> }) => void;
  externalPeerMuted?: Record<string, boolean> | null;
  externalPeerVolumes?: Record<string, number> | null;
}

type SignalMsg = any;

export default function VoiceChat({ playerId, voiceVolume = 1, playerNames, onStateUpdate, externalPeerMuted = null, externalPeerVolumes = null }: VoiceChatProps) {
  const wsRef = useRef<WebSocket | null>(null);
  const pcRefs = useRef<Record<string, RTCPeerConnection>>({});
  const audioEls = useRef<Record<string, HTMLAudioElement>>({});
  const localStreamRef = useRef<MediaStream | null>(null);
  const [micEnabled, setMicEnabled] = useState(false);
  const [peers, setPeers] = useState<string[]>([]);
  const [peerVolumes, setPeerVolumes] = useState<Record<string, number>>({});
  const [peerMuted, setPeerMuted] = useState<Record<string, boolean>>({});
  const [peerStatuses, setPeerStatuses] = useState<Record<string, string>>({});
  const failedTimersRef = useRef<Record<string, number | null>>({});
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analysersRef = useRef<Record<string, AnalyserNode>>({});
  const rafRef = useRef<number | null>(null);
  const [levels, setLevels] = useState<Record<string, number>>({});
  const pendingCandidatesRef = useRef<Record<string, RTCIceCandidateInit[]>>({});

  useEffect(() => {
    if (!playerId) return;

    // Try a few ways to construct a safe websocket URL. Some hosting/proxies
    // (Replit dev URLs) may include query tokens or rewrite hosts — be defensive.
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

    // Preferred: same host + /ws
    const hostUrl = `${protocol}://${window.location.host}/ws`;
    ws = tryCreate(hostUrl);
    // Fallback: use hostname+port explicitly (avoids including query string)
    if (!ws) {
      const hostOnly = window.location.hostname + (window.location.port ? `:${window.location.port}` : '');
      ws = tryCreate(`${protocol}://${hostOnly}/ws`);
    }
    // Last resort: build from full URL but strip query/search
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

    ws.addEventListener('error', (ev) => {
      console.error('[VoiceChat] ws error', ev);
    });

    ws.addEventListener('message', async (ev) => {
      // console log raw message for diagnosis
      try { console.log('[VoiceChat] ws message', ev.data); } catch (err) {}
      try {
        const msg: SignalMsg = JSON.parse(ev.data);
        const type = msg.type;
        if (type === 'peers') {
          const list: string[] = Array.isArray(msg.peers) ? msg.peers : [];
          setPeers(list);
          setPeerStatuses(prev => {
            const next = { ...prev };
            for (const id of list) if (next[id] === undefined) next[id] = 'new';
            return next;
          });
          // initialize per-peer controls defaults for new peers
          setPeerVolumes(prev => {
            const next = { ...prev };
            for (const id of list) if (next[id] === undefined) next[id] = 1;
            return next;
          });
          setPeerMuted(prev => {
            const next = { ...prev };
            for (const id of list) if (next[id] === undefined) next[id] = false;
            return next;
          });
            // create offers to existing peers
          for (const peerId of list) {
            if (peerId === playerId) continue;
            console.log('[VoiceChat] creating offer ->', peerId);
            await createOffer(peerId);
          }
        } else if (type === 'new-peer') {
          const newId = String(msg.playerId);
          // existing client: add peer but DO NOT create an offer (joining client will)
          setPeers(prev => prev.includes(newId) ? prev : [...prev, newId]);
          setPeerStatuses(prev => ({ ...prev, [newId]: prev[newId] ?? 'new' }));
          setPeerVolumes(prev => ({ ...prev, [newId]: prev[newId] ?? 1 }));
          setPeerMuted(prev => ({ ...prev, [newId]: prev[newId] ?? false }));
          console.log('[VoiceChat] received new-peer (will wait for offer) ->', newId);
        } else if (type === 'offer') {
          const from = String(msg.from);
          console.log('[VoiceChat] received offer from', from);
          await handleOffer(from, msg.sdp);
        } else if (type === 'answer') {
          const from = String(msg.from);
          console.log('[VoiceChat] received answer from', from);
          await handleAnswer(from, msg.sdp);
        } else if (type === 'candidate') {
          const from = String(msg.from);
          console.log('[VoiceChat] received candidate from', from, msg.candidate ? '[candidate]' : 'no-candidate');
          await handleCandidate(from, msg.candidate);
        } else if (type === 'peer-left') {
          const pid = String(msg.playerId);
          cleanupPeer(pid);
          setPeers(prev => prev.filter(p => p !== pid));
        }
      } catch (err) {
        // ignore
      }
    });

    ws.addEventListener('close', () => {
      // cleanup
      for (const pid of Object.keys(pcRefs.current)) {
        cleanupPeer(pid);
      }
      wsRef.current = null;
    });

    return () => {
      try { ws.send(JSON.stringify({ type: 'leave', playerId })); } catch (err) {}
      try { ws.close(); } catch (err) {}
      for (const pid of Object.keys(pcRefs.current)) cleanupPeer(pid);
      // stop RAF and disconnect analysers
      try {
        if (rafRef.current) cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      } catch (err) {}
      try {
        for (const k of Object.keys(analysersRef.current)) {
          try { analysersRef.current[k].disconnect(); } catch (err) {}
          delete analysersRef.current[k];
        }
        if (audioCtxRef.current) {
          try { audioCtxRef.current.close(); } catch (err) {}
          audioCtxRef.current = null;
        }
      } catch (err) {}
      wsRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playerId]);

  // Helper: add local tracks to all existing peer connections and signal offers
  async function addLocalTracksToPeers() {
    try {
      const s = await ensureLocalStream();
      for (const pid of Object.keys(pcRefs.current)) {
        const pc = pcRefs.current[pid];
        try {
          // add all non-null tracks
          for (const t of s.getTracks()) {
            try { pc.addTrack(t, s); } catch (e) { /* ignore duplicates */ }
          }
          // trigger renegotiation: create an offer and send
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
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: true });
      console.log('[VoiceChat] getUserMedia success, tracks=', s.getTracks().map(t=>t.kind));
      localStreamRef.current = s;
      return s;
    } catch (err) {
      console.error('getUserMedia failed', err);
      throw err;
    }
  }

  function sendSignal(msg: any) {
    try {
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        console.log('[VoiceChat] sendSignal', msg.type, 'to', msg.to ?? '(broadcast?)', msg);
        wsRef.current.send(JSON.stringify(msg));
      } else {
        console.warn('[VoiceChat] sendSignal: ws not open', wsRef.current && wsRef.current.readyState);
      }
    } catch (err) {}
  }

  async function createPeerConnection(remoteId: string) {
    if (pcRefs.current[remoteId]) return pcRefs.current[remoteId];
    const pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
    pcRefs.current[remoteId] = pc;

    // connection state tracking
    const updateStatus = (state: string) => {
      try {
        // Map raw connection states to friendlier labels
        let label = state;
        if (state === 'new' || state === 'connecting') label = 'connecting';
        else if (state === 'connected') label = 'connected';
        else if (state === 'disconnected') label = 'disconnected';
        else if (state === 'failed') label = 'failed';
        else if (state === 'closed') label = 'closed';

        // If we see a transient failure, don't immediately mark as failed — wait a bit
        if (label === 'failed') {
          // start a short timer to allow ICE to recover
          if (failedTimersRef.current[remoteId]) {
            // already timing
          } else {
            // show retrying immediately
            setPeerStatuses(prev => ({ ...prev, [remoteId]: 'retrying' }));
            const tid = window.setTimeout(() => {
              // if still failed, mark as failed
              const current = pc.connectionState;
              if (current === 'failed') setPeerStatuses(prev => ({ ...prev, [remoteId]: 'failed' }));
              failedTimersRef.current[remoteId] = null;
            }, 5000);
            failedTimersRef.current[remoteId] = tid as unknown as number;
          }
        } else {
          // clear any pending failure timers
          try { if (failedTimersRef.current[remoteId]) { clearTimeout(failedTimersRef.current[remoteId] as any); failedTimersRef.current[remoteId] = null; } } catch (e) {}
          setPeerStatuses(prev => ({ ...prev, [remoteId]: label }));
        }
      } catch (err) {
        console.debug('[VoiceChat] updateStatus error', err);
      }
    };

    pc.onconnectionstatechange = () => updateStatus(pc.connectionState);
    // also watch ICE layer for quicker hints
    pc.oniceconnectionstatechange = () => updateStatus((pc as any).iceConnectionState || pc.connectionState);

    pc.onicecandidate = (ev) => {
      if (ev.candidate) {
        console.log('[VoiceChat] onicecandidate ->', remoteId, ev.candidate);
        sendSignal({ type: 'candidate', to: remoteId, from: playerId, candidate: ev.candidate });
      }
    };

    pc.ontrack = (ev) => {
      // prefer streams[0]
      const stream = ev.streams && ev.streams[0];
      if (stream) {
        console.log('[VoiceChat] ontrack from', remoteId, stream);
        let audio = audioEls.current[remoteId];
        if (!audio) {
          audio = document.createElement('audio');
          audio.autoplay = true;
          (audio as any).playsInline = true;
          audioEls.current[remoteId] = audio;
        }
        audio.srcObject = stream;
        // apply saved volume/mute if present and global voiceVolume
        audio.volume = (peerVolumes[remoteId] ?? 1) * (voiceVolume ?? 1);
        audio.muted = !!peerMuted[remoteId];
        // ensure it's playing
        audio.play().catch(() => {});

        // Setup analyser node for VU meter
        try {
          if (!audioCtxRef.current) audioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
          const ctx = audioCtxRef.current;
          // create MediaStreamSource from the stream
          const src = ctx.createMediaStreamSource(stream as MediaStream);
          const analyser = ctx.createAnalyser();
          analyser.fftSize = 256;
          analyser.smoothingTimeConstant = 0.3;
          src.connect(analyser);
          analysersRef.current[remoteId] = analyser;
          // RAF loop runs in effect; analyser node registered above will be picked up
        } catch (err) {
          console.debug('[VoiceChat] analyser setup failed', err);
        }
      }
    };

    return pc;
  }

  async function createOffer(remoteId: string) {
    try {
      const pc = await createPeerConnection(remoteId);
      // add local tracks if mic enabled
      try {
        const s = await ensureLocalStream();
        console.log('[VoiceChat] add local tracks for offer to', remoteId, 'tracks=', s.getTracks().map(t=>t.kind));
        for (const t of s.getTracks()) pc.addTrack(t, s);
      } catch (err) {
        // not fatal; we'll still offer (quiet)
        console.warn('[VoiceChat] ensureLocalStream failed or no tracks for offer to', remoteId, err);
      }

      const offer = await pc.createOffer();
      console.log('[VoiceChat] created offer for', remoteId);
      await pc.setLocalDescription(offer);
      console.log('[VoiceChat] set local description, sending offer to', remoteId);
      sendSignal({ type: 'offer', to: remoteId, from: playerId, sdp: offer });
    } catch (err) {
      console.error('[Voice] createOffer failed', err);
    }
  }

  async function handleOffer(from: string, sdp: any) {
    try {
      console.log('[VoiceChat] handleOffer from', from);
      const pc = await createPeerConnection(from);
      await pc.setRemoteDescription(new RTCSessionDescription(sdp));
      // flush any candidates we received early
      try {
        const pending = pendingCandidatesRef.current[from] || [];
        for (const c of pending) {
          try { await pc.addIceCandidate(c); } catch (e) { console.warn('[VoiceChat] addIceCandidate flush failed', from, e); }
        }
        pendingCandidatesRef.current[from] = [];
      } catch (err) {}

      try {
        const s = await ensureLocalStream();
        console.log('[VoiceChat] adding local tracks in handleOffer for', from, 'tracks=', s.getTracks().map(t=>t.kind));
        for (const t of s.getTracks()) pc.addTrack(t, s);
      } catch (err) {
        console.warn('[VoiceChat] ensureLocalStream failed in handleOffer', err);
      }

      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      console.log('[VoiceChat] created answer for', from);
      sendSignal({ type: 'answer', to: from, from: playerId, sdp: answer });
    } catch (err) {
      console.error('[Voice] handleOffer failed', err);
    }
  }

  async function handleAnswer(from: string, sdp: any) {
    try {
      console.log('[VoiceChat] handleAnswer from', from);
      const pc = pcRefs.current[from];
      if (!pc) return;
      await pc.setRemoteDescription(new RTCSessionDescription(sdp));
      // flush pending candidates
      try {
        const pending = pendingCandidatesRef.current[from] || [];
        for (const c of pending) {
          try { await pc.addIceCandidate(c); } catch (e) { console.warn('[VoiceChat] addIceCandidate flush failed', from, e); }
        }
        pendingCandidatesRef.current[from] = [];
      } catch (err) {}
    } catch (err) {
      console.error('[Voice] handleAnswer failed', err);
    }
  }

  async function handleCandidate(from: string, candidate: any) {
    try {
      console.log('[VoiceChat] handleCandidate from', from, candidate);
      const pc = pcRefs.current[from];
      if (!pc) {
        // store for later
        pendingCandidatesRef.current[from] = pendingCandidatesRef.current[from] || [];
        pendingCandidatesRef.current[from].push(candidate as RTCIceCandidateInit);
        return;
      }
      // if remoteDescription isn't set yet, buffer
      const remoteDesc = (pc as any).remoteDescription;
      if (!remoteDesc || !remoteDesc.type) {
        pendingCandidatesRef.current[from] = pendingCandidatesRef.current[from] || [];
        pendingCandidatesRef.current[from].push(candidate as RTCIceCandidateInit);
        return;
      }
      await pc.addIceCandidate(candidate);
    } catch (err) {
      console.error('[Voice] handleCandidate failed', err);
    }
  }

  function cleanupPeer(pid: string) {
    try {
      const pc = pcRefs.current[pid];
      if (pc) {
        try { pc.close(); } catch (err) {}
        delete pcRefs.current[pid];
      }
      const audio = audioEls.current[pid];
      if (audio) {
        try { audio.pause(); } catch (err) {}
        try { audio.srcObject = null; } catch (err) {}
        delete audioEls.current[pid];
      }
      // disconnect analyser
      try {
        const a = analysersRef.current[pid];
        if (a) {
          try { a.disconnect(); } catch (err) {}
          delete analysersRef.current[pid];
        }
      } catch (err) {}
      // clear any pending failure timer
      try { if (failedTimersRef.current[pid]) { clearTimeout(failedTimersRef.current[pid] as any); failedTimersRef.current[pid] = null; } } catch (err) {}
      setPeerStatuses(prev => { const n = { ...prev }; delete n[pid]; return n; });
      setPeerVolumes(prev => { const n = { ...prev }; delete n[pid]; return n; });
      setPeerMuted(prev => { const n = { ...prev }; delete n[pid]; return n; });
      setLevels(prev => { const n = { ...prev }; delete n[pid]; return n; });
    } catch (err) {}
  }

  const toggleMic = async () => {
    if (!micEnabled) {
      try {
        await ensureLocalStream();
        setMicEnabled(true);
        // add tracks to existing peers and renegotiate
        await addLocalTracksToPeers();
      } catch (err) {
        setMicEnabled(false);
      }
    } else {
      // stop local tracks
      const s = localStreamRef.current;
      if (s) {
        for (const t of s.getTracks()) t.stop();
        localStreamRef.current = null;
      }
      setMicEnabled(false);
      // remove tracks from peer connections (they will renegotiate when needed)
      for (const pid of Object.keys(pcRefs.current)) {
        const pc = pcRefs.current[pid];
        try {
          pc.getSenders().forEach(sender => { try { if (sender.track) { try { sender.track.stop(); } catch (e) {} } } catch (err) {} });
          // trigger renegotiation to notify peers we've removed tracks
          try {
            (async () => {
              const offer = await pc.createOffer();
              await pc.setLocalDescription(offer);
              sendSignal({ type: 'offer', to: pid, from: playerId, sdp: offer });
            })();
          } catch (e) { /* ignore */ }
        } catch (err) {}
      }
    }
  };

  // apply peer volume/mute changes to actual audio elements
  useEffect(() => {
    for (const pid of Object.keys(audioEls.current)) {
      const a = audioEls.current[pid];
      if (!a) continue;
      a.volume = (peerVolumes[pid] ?? 1) * (voiceVolume ?? 1);
      a.muted = !!peerMuted[pid];
    }
  }, [peerVolumes, peerMuted, voiceVolume]);

  // Notify parent of current voice state when anything changes
  useEffect(() => {
    if (typeof onStateUpdate === 'function') {
      try { onStateUpdate({ peerVolumes, peerMuted, peerStatuses, levels }); } catch (e) { /* ignore */ }
    }
  }, [peerVolumes, peerMuted, peerStatuses, levels, onStateUpdate]);

  // Apply external overrides from parent when props change
  useEffect(() => {
    if (externalPeerMuted) setPeerMuted(prev => ({ ...prev, ...externalPeerMuted }));
  }, [externalPeerMuted]);
  useEffect(() => {
    if (externalPeerVolumes) setPeerVolumes(prev => ({ ...prev, ...externalPeerVolumes }));
  }, [externalPeerVolumes]);

  // RAF loop to sample analyser nodes and compute per-peer levels
  useEffect(() => {
    let cancelled = false;
    const buf = new Uint8Array(128);
    const loop = () => {
      if (cancelled) return;
      const nextLevels: Record<string, number> = {};
      for (const pid of Object.keys(analysersRef.current)) {
        try {
          const analyser = analysersRef.current[pid];
          analyser.getByteFrequencyData(buf);
          let sum = 0;
          for (let i = 0; i < buf.length; i++) sum += buf[i];
          const avg = sum / buf.length;
          nextLevels[pid] = Math.min(1, Math.max(0, avg / 255));
        } catch (err) {
          nextLevels[pid] = 0;
        }
      }
      setLevels(prev => ({ ...prev, ...nextLevels }));
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => { cancelled = true; if (rafRef.current) cancelAnimationFrame(rafRef.current); rafRef.current = null; };
  }, []);

  return (
    <div className="voice-chat">
      <div className="flex items-center gap-2">
        <button
          onClick={toggleMic}
          className={`px-3 py-1 rounded ${micEnabled ? 'bg-red-600 text-white' : 'bg-green-600 text-white'}`}
        >
          {micEnabled ? 'Disable Mic' : 'Enable Mic'}
        </button>
        <div className="text-sm text-muted-foreground">Peers: {peers.length}</div>
      </div>
      {/* Per-peer UI is shown inline on each PlayerCard; keep this component compact */}
    </div>
  );
}
