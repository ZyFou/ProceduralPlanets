// Localhost receiver for preview screenshots (occluded Claude-Preview tab → rAF
// frozen, canvas 1px → preview_screenshot unusable). The page renders a frame
// manually, encodes the canvas to base64 JPEG and POSTs it here; saved to
// .claude/shots/<name>.jpg for Read-back. Must be .cjs ("type":"module" repo).
// Run: node .claude/shot-receiver.cjs  (listens 127.0.0.1:5199)
const http = require('http');
const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, 'shots');
fs.mkdirSync(OUT, { recursive: true });

http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
  if (req.method !== 'POST') { res.writeHead(405); res.end('POST only'); return; }
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    try {
      const { name = 'shot', dataUrl } = JSON.parse(body);
      const b64 = String(dataUrl).replace(/^data:image\/\w+;base64,/, '');
      const file = path.join(OUT, `${name.replace(/[^a-z0-9_-]/gi, '_')}.jpg`);
      fs.writeFileSync(file, Buffer.from(b64, 'base64'));
      res.writeHead(200); res.end(file);
      console.log('saved', file);
    } catch (e) {
      res.writeHead(400); res.end(String(e));
    }
  });
}).listen(5199, '127.0.0.1', () => console.log('shot-receiver on http://127.0.0.1:5199'));
