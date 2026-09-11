// Local dev server that behaves like Vercel for this project: serves public/ and runs api/<name>.js
// handlers with req.body parsed and res.status()/res.json() available. Usage: node scripts/dev-server.mjs [port]
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const PORT = Number(process.argv[2] || process.env.PORT || 3000);
const ROOT = process.cwd();
const PUBLIC = path.join(ROOT, "public");
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".md": "text/markdown" };

http
  .createServer(async (req, res) => {
    res.status = (c) => ((res.statusCode = c), res);
    res.json = (o) => (res.setHeader("Content-Type", "application/json"), res.end(JSON.stringify(o)), res);
    const url = new URL(req.url, "http://localhost");
    if (url.pathname.startsWith("/api/")) {
      const file = path.join(ROOT, "api", url.pathname.slice(5).replace(/[^a-z0-9-]/gi, "") + ".js");
      if (!fs.existsSync(file)) return res.status(404).json({ error: "no such route" });
      let raw = "";
      for await (const c of req) raw += c;
      try {
        req.body = raw ? JSON.parse(raw) : undefined;
      } catch {
        req.body = raw;
      }
      try {
        const mod = await import(pathToFileURL(file).href);
        await mod.default(req, res);
      } catch (e) {
        console.error(e);
        if (!res.headersSent) res.status(500).json({ error: e.message });
      }
      return;
    }
    let p = path.join(PUBLIC, decodeURIComponent(url.pathname));
    if (fs.existsSync(p) && fs.statSync(p).isDirectory()) p = path.join(p, "index.html");
    if (!p.startsWith(PUBLIC) || !fs.existsSync(p)) return ((res.statusCode = 404), res.end("not found"));
    res.setHeader("Content-Type", TYPES[path.extname(p)] || "application/octet-stream");
    fs.createReadStream(p).pipe(res);
  })
  .listen(PORT, () => console.log(`dev server on http://localhost:${PORT}`));
