#!/usr/bin/env node

/**
 * Minimal dev server for site/public/.
 * Usage: node site/serve.mjs
 */

import { createServer } from "http";
import { readFileSync, existsSync } from "fs";
import { join, extname } from "path";
import { fileURLToPath } from "url";
import { dirname } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "public");
const PORT = 3000;

const TYPES = {
  ".html": "text/html",
  ".css": "text/css",
  ".js": "application/javascript",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".woff2": "font/woff2",
};

createServer((req, res) => {
  let path = req.url === "/" ? "/index.html" : req.url;
  const file = join(ROOT, path);

  if (!existsSync(file)) {
    res.writeHead(404);
    res.end("Not found");
    return;
  }

  const ext = extname(file);
  res.writeHead(200, { "Content-Type": TYPES[ext] || "application/octet-stream" });
  res.end(readFileSync(file));
}).listen(PORT, () => {
  console.log(`Dev server: http://localhost:${PORT}`);
});
