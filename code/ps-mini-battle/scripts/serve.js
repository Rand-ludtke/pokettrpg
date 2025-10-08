#!/usr/bin/env node
import http from 'http';
import path from 'path';
import fs from 'fs';
import url from 'url';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const publicDir = path.join(root, 'public');

const server = http.createServer((req, res) => {
  const reqUrl = new URL(req.url, 'http://localhost');
  let filePath = path.join(publicDir, reqUrl.pathname);
  if (reqUrl.pathname === '/') filePath = path.join(publicDir, 'index.html');
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.statusCode = 404;
      res.end('Not found');
      return;
    }
    const ext = path.extname(filePath);
    const type = ext === '.html' ? 'text/html' : ext === '.js' ? 'text/javascript' : ext === '.json' ? 'application/json' : 'text/plain';
    res.setHeader('Content-Type', type);
    res.end(data);
  });
});

const port = process.env.PORT || 5173;
server.listen(port, () => {
  console.log(`Mini battle viewer at http://localhost:${port}`);
});
