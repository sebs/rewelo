import http from "node:http";
import { DB } from "../db/connection.js";
import { migrate } from "../db/migrate.js";
import { apiRoutes } from "./api.js";
import { dashboardHtml } from "./html.js";

export async function startDashboard(
  dbPath: string,
  port: number
): Promise<void> {
  const db = await DB.open(dbPath);
  await migrate(db);

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host}`);

    // CORS for local dev
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    // API routes
    if (url.pathname.startsWith("/api/")) {
      try {
        const result = await apiRoutes(db, url);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(result));
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        const status = msg.includes("not found") ? 404 : 400;
        res.writeHead(status, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: msg }));
      }
      return;
    }

    // Dashboard HTML
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(dashboardHtml());
  });

  server.listen(port, () => {
    console.log(`Dashboard running at http://localhost:${port}`);
  });

  // Keep running until SIGINT
  await new Promise<void>((resolve) => {
    process.on("SIGINT", () => {
      server.close();
      db.close().then(resolve);
    });
  });
}
