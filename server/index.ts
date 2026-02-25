import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { setupVite, serveStatic, log } from "./vite";
import { spawn, type ChildProcessWithoutNullStreams } from 'child_process';
import net from 'net';

const app = express();

declare module 'http' {
  interface IncomingMessage {
    rawBody: unknown
  }
}
app.use(express.json({
  verify: (req, _res, buf) => {
    req.rawBody = buf;
  }
}));
app.use(express.urlencoded({ extended: false }));

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }

      if (logLine.length > 80) {
        logLine = logLine.slice(0, 79) + "…";
      }

      log(logLine);
    }
  });

  next();
});

(async () => {
  // Optionally start an embedded TURN server when TURN_EMBED=1 is set.
  // This will attempt to spawn `node-turn` via `npx` or a custom executable
  // provided in `TURN_EXEC`. Configure credentials via TURN_USER/TURN_PASS/TURN_PORT.
  let turnProc: ChildProcessWithoutNullStreams | null = null;

  const waitForTcpOpen = (host: string, port: number, timeoutMs = 5000) => new Promise<void>((resolve, reject) => {
    const start = Date.now();
    const attempt = () => {
      const socket = new net.Socket();
      let settled = false;
      socket.setTimeout(1000);
      socket.once('error', () => {
        socket.destroy();
        if (settled) return;
        if (Date.now() - start >= timeoutMs) {
          settled = true;
          reject(new Error('timeout'));
        } else {
          setTimeout(attempt, 250);
        }
      });
      socket.once('timeout', () => {
        socket.destroy();
        if (settled) return;
        if (Date.now() - start >= timeoutMs) {
          settled = true;
          reject(new Error('timeout'));
        } else {
          setTimeout(attempt, 250);
        }
      });
      socket.connect(port, host, () => {
        if (settled) return;
        settled = true;
        socket.end();
        resolve();
      });
    };
    attempt();
  });

  const startEmbeddedTurn = async () => {
    try {
      if (process.env.TURN_EMBED !== '1') return;
      const turnPort = process.env.TURN_PORT || '3478';
      const turnUser = process.env.TURN_USER || 'testuser';
      const turnPass = process.env.TURN_PASS || 'testpass';
      const turnRealm = process.env.TURN_REALM || 'react-scrabble';
      const execPath = process.env.TURN_EXEC; // optional custom executable

      const args = [
        'node-turn',
        '--ports', turnPort,
        '--realm', turnRealm,
        '--username', turnUser,
        '--password', turnPass,
      ];

      if (execPath && execPath.length > 0) {
        log(`[TURN] starting embedded TURN via ${execPath} on port ${turnPort}`);
        turnProc = spawn(execPath, ['--ports', turnPort, '--realm', turnRealm, '--username', turnUser, '--password', turnPass], { stdio: 'pipe' });
      } else {
        log(`[TURN] starting embedded TURN via npx node-turn on port ${turnPort}`);
        turnProc = spawn('npx', args, { stdio: 'pipe' });
      }

      if (!turnProc) return;

      turnProc.stdout.on('data', (chunk) => {
        const s = String(chunk).trim(); if (s) log(`[TURN STDOUT] ${s}`);
      });
      turnProc.stderr.on('data', (chunk) => {
        const s = String(chunk).trim(); if (s) log(`[TURN STDERR] ${s}`);
      });
      turnProc.on('exit', (code, signal) => {
        log(`[TURN] process exited code=${code} signal=${signal}`);
        turnProc = null;
      });

      // ensure we kill child on parent exit
      const killTurn = () => { try { if (turnProc) { turnProc.kill('SIGTERM'); turnProc = null; } } catch (e) {} };
      process.on('exit', killTurn);
      process.on('SIGINT', () => { killTurn(); process.exit(0); });
      process.on('SIGTERM', () => { killTurn(); process.exit(0); });

      // Wait for the TURN port to become reachable (quick retries)
      const host = process.env.TURN_HOST || '127.0.0.1';
      const portNum = parseInt(turnPort, 10) || 3478;
      const waitMs = parseInt(process.env.TURN_WAIT_MS || '5000', 10);
      try {
        await waitForTcpOpen(host, portNum, waitMs);
        log(`[TURN] reachable at ${host}:${portNum}`);
      } catch (err) {
        const strict = process.env.TURN_STRICT === '1';
        const msg = `[TURN] not reachable at ${host}:${portNum} after ${waitMs}ms`;
        if (strict) {
          log(msg + ' (TURN_STRICT=1, exiting)');
          process.exit(1);
        } else {
          log(msg + ' (continuing without TURN)');
        }
      }
    } catch (err) {
      log('[TURN] failed to start embedded TURN: ' + String(err));
    }
  };
  await startEmbeddedTurn();
  const server = await registerRoutes(app);

  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    res.status(status).json({ message });
    throw err;
  });

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (app.get("env") === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  // ALWAYS serve the app on the port specified in the environment variable PORT
  // Other ports are firewalled. Default to 5000 if not specified.
  // this serves both the API and the client.
  // It is the only port that is not firewalled.
  const port = parseInt(process.env.PORT || '5000', 10);
  server.listen({
    port,
    host: "0.0.0.0",
    reusePort: true,
  }, () => {
    log(`serving on port ${port}`);
  });
})();
