import { createServer } from "node:http";
import { randomBytes } from "node:crypto";

const PORT = 9274;

export interface AuthCallbackTokens {
  developerToken: string;
  musicUserToken: string;
}

export function startAuthServer(): {
  promise: Promise<AuthCallbackTokens>;
  close: () => void;
  nonce: string;
} {
  const server = createServer();
  const ALLOWED_ORIGIN = "https://music.apple.com";
  const nonce = randomBytes(16).toString("hex");

  const promise = new Promise<AuthCallbackTokens>((resolve, reject) => {
    server.on("request", (req, res) => {
      res.setHeader("Access-Control-Allow-Origin", ALLOWED_ORIGIN);
      res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type");

      if (req.method === "OPTIONS") {
        res.writeHead(204);
        res.end();
        return;
      }

      if (req.method === "POST" && req.url === "/callback") {
        const MAX_BODY = 64 * 1024;
        let body = "";
        let aborted = false;
        req.on("data", (chunk) => {
          body += chunk;
          if (body.length > MAX_BODY) {
            aborted = true;
            res.writeHead(413, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Request body too large" }));
            req.destroy();
          }
        });
        req.on("end", () => {
          if (aborted) return;
          let data: { dt?: string; ut?: string; nonce?: string };
          try {
            data = JSON.parse(body);
          } catch {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Invalid JSON" }));
            return;
          }

          if (!data.dt || !data.ut) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Missing dt or ut" }));
            return;
          }

          if (data.nonce !== nonce) {
            res.writeHead(403, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Invalid nonce" }));
            return;
          }

          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: true }));
          server.close();
          resolve({
            developerToken: data.dt,
            musicUserToken: data.ut,
          });
        });
        return;
      }

      res.writeHead(404);
      res.end();
    });

    server.on("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "EADDRINUSE") {
        reject(new Error(`Port ${PORT} is already in use. Close the other process and try again.`));
      } else {
        reject(new Error(`Auth server failed to start: ${err.message}`));
      }
    });

    server.listen(PORT, "127.0.0.1");

    const timeout = setTimeout(() => {
      server.close();
      reject(
        new Error("Auth timed out. No tokens received within 5 minutes."),
      );
    }, 5 * 60 * 1000);

    server.on("close", () => clearTimeout(timeout));
  });

  return {
    promise,
    close: () => server.close(),
    nonce,
  };
}

export function getAuthSnippet(nonce: string): string {
  return `fetch('http://localhost:${PORT}/callback',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({dt:MusicKit.getInstance().developerToken,ut:MusicKit.getInstance().musicUserToken,nonce:'${nonce}'})}).then(()=>document.title='\u2713 songwise connected')`;
}
