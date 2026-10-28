const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

const html = fs.readFileSync(path.join(__dirname, 'index.html'));
const server = http.createServer((req, res) => {
  if (req.url === '/health') { res.end('ok'); return; }
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
});
const wss = new WebSocketServer({ server, maxPayload: 4096 });
const rooms = new Map();
const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

function newCode() {
  let c;
  do { c = Array.from({ length: 5 }, () => LETTERS[Math.floor(Math.random() * 26)]).join(''); }
  while (rooms.has(c));
  return c;
}
const send = (ws, o) => { if (ws.readyState === 1) ws.send(JSON.stringify(o)); };
const bcast = (code, o) => { const r = rooms.get(code); if (r) r.forEach(c => send(c, o)); };
const users = code => [...rooms.get(code)].map(c => c.name);
const cleanName = n => String(n || '').replace(/[^\w .\-]/g, '').trim().slice(0, 20);

function enter(ws, code, name) {
  ws.name = name; ws.room = code;
  rooms.get(code).add(ws);
  send(ws, { type: 'joined', code, id: ws.id });
  bcast(code, { type: 'sys', text: name + ' joined' });
  bcast(code, { type: 'users', users: users(code) });
}
function leave(ws) {
  const code = ws.room; if (!code) return;
  const r = rooms.get(code); ws.room = null; if (!r) return;
  r.delete(ws);
  if (r.size === 0) { rooms.delete(code); return; }
  bcast(code, { type: 'sys', text: ws.name + ' left' });
  bcast(code, { type: 'users', users: users(code) });
}

wss.on('connection', ws => {
  ws.id = Math.random().toString(36).slice(2);
  ws.alive = true; ws.last = 0;
  ws.on('pong', () => { ws.alive = true; });
  ws.on('message', raw => {
    let m; try { m = JSON.parse(raw); } catch { return; }
    if (m.type === 'create' || m.type === 'join') {
      if (ws.room) return;
      const name = cleanName(m.name);
      if (!name) return send(ws, { type: 'error', text: 'Type a username first.' });
      if (m.type === 'create') {
        const code = newCode(); rooms.set(code, new Set()); enter(ws, code, name);
      } else {
        const code = String(m.code || '').toUpperCase();
        if (!/^[A-Z]{5}$/.test(code)) return send(ws, { type: 'error', text: 'Codes are 5 letters.' });
        const r = rooms.get(code);
        if (!r) return send(ws, { type: 'error', text: 'No lobby with that code.' });
        if (r.size >= 50) return send(ws, { type: 'error', text: 'That lobby is full.' });
        enter(ws, code, name);
      }
    } else if (m.type === 'msg' && ws.room) {
      const text = String(m.text || '').trim().slice(0, 500);
      const now = Date.now();
      if (!text || now - ws.last < 300) return;
      ws.last = now;
      bcast(ws.room, { type: 'msg', name: ws.name, text, from: ws.id });
    } else if (m.type === 'leave') {
      leave(ws);
    }
  });
  ws.on('close', () => leave(ws));
});

setInterval(() => {
  wss.clients.forEach(ws => { if (!ws.alive) return ws.terminate(); ws.alive = false; ws.ping(); });
}, 30000);

server.listen(process.env.PORT || 3000, () => console.log('Lobby Chat running'));
