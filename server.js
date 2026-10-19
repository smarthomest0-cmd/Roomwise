import http from 'node:http';
import fs from 'node:fs';
const TOKEN = process.env.SUPERVISOR_TOKEN, API = 'http://supervisor/core/api';
const LAYOUT = '/data/layout.json';
const H = { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' };
let cache = null, cacheAt = 0;

// Registry data (floors, areas, devices, entities) over the HA websocket
const registry = () => new Promise((res, rej) => {
  const types = ['floor', 'area', 'device', 'entity'].map(k => `config/${k}_registry/list`);
  const names = ['floors', 'areas', 'devices', 'entities'], out = {};
  const ws = new WebSocket('ws://supervisor/core/websocket');
  ws.onmessage = e => {
    const m = JSON.parse(e.data);
    if (m.type === 'auth_required') ws.send(JSON.stringify({ type: 'auth', access_token: TOKEN }));
    else if (m.type === 'auth_ok') types.forEach((t, i) => ws.send(JSON.stringify({ id: i + 1, type: t })));
    else if (m.type === 'result') {
      out[names[m.id - 1]] = m.result || [];
      if (Object.keys(out).length === 4) { ws.close(); res(out); }
    }
  };
  ws.onerror = rej;
});

const body = req => new Promise(r => { let b = ''; req.on('data', c => b += c); req.on('end', () => r(b ? JSON.parse(b) : {})); });
const json = (res, data, code = 200) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data)); };

http.createServer(async (req, res) => {
  const p = new URL(req.url, 'http://x').pathname.replace(/^\/+/, '');
  try {
    if (p === 'api/registry') {
      if (!cache || Date.now() - cacheAt > 60000) { cache = await registry(); cacheAt = Date.now(); }
      return json(res, cache);
    }
    if (p === 'api/states') return json(res, await (await fetch(`${API}/states`, { headers: H })).json());
    if (p === 'api/call') {
      const { domain, service, data } = await body(req);
      const r = await fetch(`${API}/services/${domain}/${service}`, { method: 'POST', headers: H, body: JSON.stringify(data || {}) });
      return json(res, { ok: r.ok });
    }
    if (p === 'api/layout') {
      if (req.method === 'POST') { fs.writeFileSync(LAYOUT, JSON.stringify(await body(req))); return json(res, { ok: true }); }
      return json(res, fs.existsSync(LAYOUT) ? JSON.parse(fs.readFileSync(LAYOUT)) : { hiddenRooms: [], hiddenEntities: [] });
    }
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(fs.readFileSync('web/index.html'));
  } catch (e) { json(res, { error: String(e) }, 500); }
}).listen(8099, () => console.log('Roomwise on :8099'));
