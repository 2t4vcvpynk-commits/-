// KOBUSHI 3D サーバー: 静的ファイル配信 + WebSocket でのルーム対戦
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { Room } from './public/js/shared/room.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const THREE_DIR = path.join(__dirname, 'node_modules', 'three', 'build');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

function serveFile(res, baseDir, rel) {
  const file = path.normalize(path.join(baseDir, rel));
  if (!file.startsWith(baseDir + path.sep)) {
    res.writeHead(403).end();
    return;
  }
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not found');
      return;
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(data);
  });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  let pathname = decodeURIComponent(url.pathname);
  if (pathname === '/healthz') {
    res.writeHead(200, { 'Content-Type': 'text/plain' }).end('ok');
    return;
  }
  if (pathname.startsWith('/vendor/three/')) {
    serveFile(res, THREE_DIR, pathname.slice('/vendor/three/'.length));
    return;
  }
  if (pathname === '/') pathname = '/index.html';
  serveFile(res, PUBLIC_DIR, pathname.slice(1));
});

// ---- ルーム管理 ----
const rooms = new Map();
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function newCode() {
  for (;;) {
    let c = '';
    for (let i = 0; i < 4; i++) c += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
    if (!rooms.has(c)) return c;
  }
}

function leaveRoom(ws) {
  const room = ws.room;
  if (!room) return;
  room.remove(ws.player);
  ws.room = null;
  if (room.count === 0) {
    room.dispose();
    rooms.delete(room.code);
  }
}

const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 4096 });

wss.on('connection', (ws) => {
  ws.isAlive = true;
  ws.room = null;
  ws.player = {
    profile: null,
    send(msg) {
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
    },
  };
  ws.on('pong', () => { ws.isAlive = true; });

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    if (!msg || typeof msg !== 'object') return;

    switch (msg.t) {
      case 'create': {
        leaveRoom(ws);
        const room = new Room(newCode());
        rooms.set(room.code, room);
        ws.player.profile = msg.profile;
        ws.room = room;
        room.add(ws.player);
        break;
      }
      case 'join': {
        leaveRoom(ws);
        const code = String(msg.code || '').toUpperCase().trim();
        const room = rooms.get(code);
        if (!room) {
          ws.player.send({ t: 'error', msg: `ルーム「${code}」が見つかりません` });
          return;
        }
        if (room.count >= 2) {
          ws.player.send({ t: 'error', msg: 'そのルームは満員です' });
          return;
        }
        ws.player.profile = msg.profile;
        ws.room = room;
        room.add(ws.player);
        break;
      }
      case 'leave':
        leaveRoom(ws);
        break;
      case 'ping':
        ws.player.send({ t: 'pong', t0: msg.t0 });
        break;
      default:
        if (ws.room) ws.room.handle(ws.player, msg);
    }
  });

  ws.on('close', () => leaveRoom(ws));
});

// タイムアップ判定
setInterval(() => {
  const now = Date.now();
  for (const room of rooms.values()) room.tick(now);
}, 200);

// 切断検知
setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) {
      ws.terminate();
      continue;
    }
    ws.isAlive = false;
    ws.ping();
  }
}, 20000);

server.listen(PORT, () => {
  console.log(`KOBUSHI 3D サーバー起動: http://localhost:${PORT}`);
});
