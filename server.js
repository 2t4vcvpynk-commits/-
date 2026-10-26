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
  if (pathname === '/onope') {
    res.writeHead(301, { Location: '/onope/' }).end();
    return;
  }
  if (pathname.endsWith('/')) pathname += 'index.html';
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

const wss = new WebSocketServer({ noServer: true, maxPayload: 4096 });
const onopeWss = new WebSocketServer({ noServer: true, maxPayload: 16384 });

server.on('upgrade', (req, socket, head) => {
  const { pathname } = new URL(req.url, 'http://localhost');
  const target = pathname === '/ws' ? wss : pathname === '/onope-ws' ? onopeWss : null;
  if (!target) {
    socket.destroy();
    return;
  }
  target.handleUpgrade(req, socket, head, (ws) => target.emit('connection', ws, req));
});

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

// ---- ワンオペ食堂: ルーム中継 (各自の入力をそのまま相手に配るだけ。ゲームの計算は両者の端末でロックステップ) ----
const onopeRooms = new Map();
const ONOPE_MAX_PEERS = 4;
let onopeSeq = 0;

function onopeBroadcastPeers(room) {
  const peers = [...room].map((c) => ({ peer: c.peerId, presence: c.presence }));
  const data = JSON.stringify({ t: 'peers', peers });
  for (const c of room) if (c.readyState === c.OPEN) c.send(data);
}

function onopeLeave(ws) {
  const room = ws.onopeRoom;
  if (!room) return;
  room.delete(ws);
  ws.onopeRoom = null;
  if (room.size === 0) onopeRooms.delete(ws.onopeRoomName);
  else onopeBroadcastPeers(room);
}

onopeWss.on('connection', (ws) => {
  ws.isAlive = true;
  ws.peerId = `p${++onopeSeq}`;
  ws.presence = null;
  ws.onopeRoom = null;
  ws.on('pong', () => { ws.isAlive = true; });
  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    if (!msg || typeof msg !== 'object') return;
    if (msg.t === 'join') {
      if (ws.onopeRoom) return;
      const name = String(msg.room || '').slice(0, 32);
      if (!/^ope-\d{4}$/.test(name)) return;
      let room = onopeRooms.get(name);
      if (!room) onopeRooms.set(name, (room = new Set()));
      if (room.size >= ONOPE_MAX_PEERS) {
        ws.send(JSON.stringify({ t: 'full' }));
        return;
      }
      room.add(ws);
      ws.onopeRoom = room;
      ws.onopeRoomName = name;
      ws.send(JSON.stringify({ t: 'joined', id: ws.peerId }));
      onopeBroadcastPeers(room);
      return;
    }
    const room = ws.onopeRoom;
    if (!room) return;
    if (msg.t === 'presence') {
      ws.presence = msg.data ?? null;
      onopeBroadcastPeers(room);
    } else if (msg.t === 'emit' && typeof msg.topic === 'string' && msg.topic.length <= 16) {
      const data = JSON.stringify({ t: 'msg', topic: msg.topic, peer: ws.peerId, data: msg.data });
      for (const c of room) if (c !== ws && c.readyState === c.OPEN) c.send(data);
    }
  });
  ws.on('close', () => onopeLeave(ws));
});

// 切断検知
setInterval(() => {
  for (const ws of [...wss.clients, ...onopeWss.clients]) {
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
  console.log(`ワンオペ食堂: http://localhost:${PORT}/onope/`);
});
