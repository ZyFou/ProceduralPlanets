// Optional same-origin viewport fixture for the local ProceduralTerrains reference.
// Run its Vite server on 6061 first, then: node test/visual/reference-proxy.mjs
import http from 'node:http';
const fixture = `<!doctype html><html><head><title>Terrains viewport comparison</title><style>body{margin:0;background:#15191f;color:#ddd;font:14px system-ui}header{padding:12px;display:flex;gap:8px}button{background:#29374d;color:white;border:1px solid #45618a;padding:8px}iframe{display:block;border:1px solid #45618a;margin:0 12px 12px}</style></head><body><header><button data-width="1440" data-height="900">Terrains 1440 × 900</button><button data-width="1100" data-height="800">Terrains 1100 × 800</button><output>Terrains — 1440 × 900</output></header><iframe title="Reference workspace" width="1440" height="900" src="/"></iframe><script>document.querySelectorAll('button').forEach(b=>b.onclick=()=>{const f=document.querySelector('iframe');f.width=b.dataset.width;f.height=b.dataset.height;document.querySelector('output').textContent='Terrains — '+f.width+' × '+f.height;});</script></body></html>`;
const server = http.createServer((request, response) => {
  if (request.url === '/workspace-comparison') { response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); response.end(fixture); return; }
  const upstream = http.request({ hostname: '127.0.0.1', port: 6061, method: request.method, path: request.url,
    headers: { ...request.headers, host: 'localhost:6061' } }, incoming => {
    response.writeHead(incoming.statusCode, incoming.headers); incoming.pipe(response);
  });
  upstream.on('error', error => { response.writeHead(502); response.end(`Start the Terrains reference on 6061: ${error.message}`); });
  request.pipe(upstream);
});
server.listen(7074, '127.0.0.1', () => console.log('Reference comparison: http://127.0.0.1:7074/workspace-comparison'));
