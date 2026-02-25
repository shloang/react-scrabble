import { useEffect, useState } from "react";
import { Switch, Route, useLocation } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { validatePlayerId } from "@/lib/auth";
import handleInvalidSession from "@/lib/session";
import Game from "@/pages/game";
import Lobby from "@/pages/lobby";
import NotFound from "@/pages/not-found";

function Router() {
  const [location, setLocation] = useLocation();
  const [authState, setAuthState] = useState<'loading' | 'valid' | 'invalid'>('loading');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const savedId = typeof window !== 'undefined' ? localStorage.getItem('playerId') : null;
      if (!savedId) {
        if (!cancelled) setAuthState('invalid');
        return;
      }

      try {
        if (!cancelled) setAuthState('loading');
        const res = await validatePlayerId(savedId, true);
        if (cancelled) return;
        if (!res.ok) {
          try { await handleInvalidSession(queryClient); } catch {}
          if (!cancelled) setAuthState('invalid');
          return;
        }
        if (!cancelled) setAuthState('valid');
      } catch (err) {
        try { await handleInvalidSession(queryClient); } catch {}
        if (!cancelled) setAuthState('invalid');
      }
    })();

    return () => { cancelled = true; };
  }, [location]);

  useEffect(() => {
    if (authState === 'invalid' && location === '/') {
      setLocation('/lobby');
    }
  }, [authState, location, setLocation]);

  if (authState === 'loading') {
    return <div className="p-6">Проверка сессии…</div>;
  }

  if (authState === 'invalid' && location === '/') {
    return <div className="p-6">Перенаправление…</div>;
  }

  return (
      <Switch>
        <Route path="/" component={Game} />
        <Route path="/lobby" component={Lobby} />
        <Route component={NotFound} />
      </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <Router />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
