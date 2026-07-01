import { useEffect, useRef, useCallback } from 'react';

interface UseAudioKeepAliveOptions {
  checkInterval?: number;
  debug?: boolean;
}

/**
 * Hook to manage AudioContext state and prevent browser suspension.
 * 
 * Browser suspends AudioContext after inactivity (typically 30+ mins).
 * This hook:
 * 1. Monitors AudioContext state (suspended, running, closed)
 * 2. Automatically resumes suspended contexts
 * 3. Maintains keepalive with periodic dummy audio if needed
 * 4. Handles user interaction events to resume context
 * 
 * @param audioElements - Array of HTMLAudioElement references to manage
 * @param options - Configuration options
 */
export function useAudioKeepAlive(
  audioElements: Map<string, HTMLAudioElement>,
  options: UseAudioKeepAliveOptions = {}
) {
  const { checkInterval = 10000, debug = false } = options;
  
  const audioContextRef = useRef<AudioContext | null>(null);
  const keepAliveSourceRef = useRef<OscillatorNode | null>(null);
  const checkIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const lastInteractionRef = useRef<number>(Date.now());

  const log = useCallback((msg: string, data?: any) => {
    if (debug) {
      console.log(`[AudioKeepAlive] ${msg}`, data || '');
    }
  }, [debug]);

  // Initialize AudioContext if needed
  const ensureAudioContext = useCallback(() => {
    if (audioContextRef.current) return audioContextRef.current;

    try {
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      audioContextRef.current = ctx;
      log('AudioContext created', { state: ctx.state });
      return ctx;
    } catch (err) {
      console.error('[AudioKeepAlive] Failed to create AudioContext:', err);
      return null;
    }
  }, [log]);

  // Resume AudioContext if suspended
  const resumeAudioContext = useCallback(async () => {
    const ctx = audioContextRef.current;
    if (!ctx) return false;

    if (ctx.state === 'suspended') {
      try {
        await ctx.resume();
        log('AudioContext resumed', { state: ctx.state });
        return true;
      } catch (err) {
        console.error('[AudioKeepAlive] Failed to resume AudioContext:', err);
        return false;
      }
    }
    return false;
  }, [log]);

  // Create and start keepalive oscillator (silent, won't be heard)
  const startKeepalive = useCallback(() => {
    const ctx = audioContextRef.current;
    if (!ctx || ctx.state !== 'running') return;

    try {
      // Stop any existing keepalive
      if (keepAliveSourceRef.current) {
        keepAliveSourceRef.current.stop();
        keepAliveSourceRef.current = null;
      }

      // Create silent oscillator at extremely low volume/frequency
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      
      osc.frequency.value = 0.1; // Inaudible frequency
      gain.gain.value = 0; // Mute completely
      
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      
      keepAliveSourceRef.current = osc;
      log('Keepalive oscillator started');
    } catch (err) {
      console.error('[AudioKeepAlive] Failed to start keepalive:', err);
    }
  }, [log]);

  // Stop keepalive oscillator
  const stopKeepalive = useCallback(() => {
    if (keepAliveSourceRef.current) {
      try {
        keepAliveSourceRef.current.stop();
        keepAliveSourceRef.current = null;
        log('Keepalive oscillator stopped');
      } catch (err) {
        // Already stopped or disposed
      }
    }
  }, [log]);

  // Periodically check AudioContext state
  const checkAudioContextState = useCallback(() => {
    const ctx = ensureAudioContext();
    if (!ctx) return;

    log('Checking AudioContext state', { state: ctx.state });

    if (ctx.state === 'suspended') {
      log('AudioContext is suspended, attempting to resume');
      resumeAudioContext();
    } else if (ctx.state === 'running') {
      // Maintain keepalive if we're still in the game
      // Only start keepalive if enough time has passed since last interaction
      const timeSinceInteraction = Date.now() - lastInteractionRef.current;
      if (timeSinceInteraction > 5000) { // Start keepalive after 5s of inactivity
        startKeepalive();
      } else {
        stopKeepalive();
      }
    }
  }, [ensureAudioContext, resumeAudioContext, startKeepalive, stopKeepalive, log]);

  // Handle user interaction (resume context and record interaction time)
  const handleUserInteraction = useCallback(() => {
    lastInteractionRef.current = Date.now();
    
    const ctx = audioContextRef.current;
    if (ctx && ctx.state === 'suspended') {
      log('User interaction detected, resuming AudioContext');
      resumeAudioContext();
    }
  }, [resumeAudioContext, log]);

  // Resume all audio elements (in case they're also paused)
  const resumeAllAudio = useCallback(async () => {
    const promises: Promise<void>[] = [];
    
    audioElements.forEach((audio) => {
      try {
        // Some audio elements might not be playing
        if (audio.paused) {
          const promise = audio.play().catch(() => {
            // Ignore errors from audio that aren't supposed to be playing
          });
          promises.push(promise);
        }
      } catch (err) {
        // Ignore errors
      }
    });

    if (promises.length > 0) {
      try {
        await Promise.all(promises);
      } catch (err) {
        // Some audio may fail to play, which is OK
      }
    }
  }, [audioElements]);

  // Set up periodic state checking
  useEffect(() => {
    ensureAudioContext();

    // Start checking immediately and then every checkInterval
    checkAudioContextState();
    checkIntervalRef.current = setInterval(() => {
      checkAudioContextState();
    }, checkInterval);

    return () => {
      if (checkIntervalRef.current) {
        clearInterval(checkIntervalRef.current);
      }
      stopKeepalive();
    };
  }, [checkInterval, ensureAudioContext, checkAudioContextState, stopKeepalive]);

  // Listen for user interactions to wake up AudioContext
  useEffect(() => {
    // Resume context on any interaction
    const events = ['click', 'touchstart', 'keydown', 'mousedown'];
    events.forEach(event => {
      document.addEventListener(event, handleUserInteraction, true);
    });

    return () => {
      events.forEach(event => {
        document.removeEventListener(event, handleUserInteraction, true);
      });
    };
  }, [handleUserInteraction]);

  return {
    ensureAudioContext,
    resumeAudioContext,
    resumeAllAudio,
    getState: () => audioContextRef.current?.state || 'closed'
  };
}
