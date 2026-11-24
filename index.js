const http = require('http');
const https = require('https');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const PORT = parseInt(process.env.PORT || '8080', 10);
const PROXY_PORT = 18090;

async function registerWarp() {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('x25519');
  const privB64 = privateKey.export({ type: 'pkcs8', format: 'der' }).subarray(16).toString('base64');
  const pubB64 = publicKey.export({ type: 'spki', format: 'der' }).subarray(12).toString('base64');

  const data = JSON.stringify({ key: pubB64, tos: new Date().toISOString() });
  return new Promise((resolve, reject) => {
    const req = https.request('https://api.cloudflareclient.com/v0a2158/reg', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
        'User-Agent': 'okhttp/3.12.1'
      }
    }, res => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(body);
          if (!json.config) throw new Error('No config returned: ' + body);
          const peer = json.config.peers[0];
          const iface = json.config.interface.addresses;
          let reserved = [0, 0, 0];
          if (json.config.client_id) {
            const buf = Buffer.from(json.config.client_id, 'base64');
            reserved = Array.from(buf.subarray(0, 3));
          }
          resolve({
            privateKey: privB64,
            publicKey: peer.public_key,
            v4: iface.v4,
            v6: iface.v6,
            reserved
          });
        } catch (e) {
          reject(e);
        }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

async function startWarp() {
  const binDir = path.join(__dirname, 'bin');
  const binPath = path.join(binDir, 'sing-box');

  if (!fs.existsSync(binPath)) {
    console.log('sing-box binary missing, running build step...');
    require('./build.js');
    await new Promise(r => setTimeout(r, 8000));
  }

  console.log('Registering Cloudflare WARP account...');
  const warp = await registerWarp();
  console.log('WARP registered! Assigned v4:', warp.v4);

  const config = {
    log: { level: 'info' },
    inbounds: [
      {
        type: 'mixed',
        tag: 'mixed-in',
        listen: '127.0.0.1',
        listen_port: PROXY_PORT
      }
    ],
    outbounds: [
      {
        type: 'wireguard',
        tag: 'warp-out',
        server: '162.159.192.1',
        server_port: 2408,
        system_interface: false,
        local_address: [
          warp.v4 + '/32',
          warp.v6 + '/128'
        ],
        private_key: warp.privateKey,
        peer_public_key: warp.publicKey,
        reserved: warp.reserved
      }
    ]
  };

  const configPath = path.join(__dirname, 'config.json');
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

  try { fs.chmodSync(binPath, 0o755); } catch (e) {}
  const child = spawn(binPath, ['run', '-c', configPath], { stdio: 'inherit' });
  child.on('exit', code => console.log('sing-box exited:', code));
}

let warpReady = false;

startWarp().then(() => {
  warpReady = true;
  console.log('WARP is ready and proxy is active on 127.0.0.1:' + PROXY_PORT);
}).catch(err => {
  console.error('Failed to start WARP:', err);
});

// HTTP Server for Healthchecks & HTTP Proxying
const server = http.createServer((req, res) => {
  if (req.url === '/' || req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'ok',
      service: 'abasthan-warp',
      warp: warpReady ? 'ready' : 'initializing',
      time: new Date().toISOString()
    }));
    return;
  }

  // Forward HTTP request to sing-box mixed proxy
  const proxyReq = http.request({
    host: '127.0.0.1',
    port: PROXY_PORT,
    path: req.url,
    method: req.method,
    headers: req.headers
  }, proxyRes => {
    res.writeHead(proxyRes.statusCode, proxyRes.headers);
    proxyRes.pipe(res);
  });
  proxyReq.on('error', err => {
    res.writeHead(502);
    res.end('Proxy forward error: ' + err.message);
  });
  req.pipe(proxyReq);
});

server.on('connect', (req, clientSocket, head) => {
  const net = require('net');
  const proxySocket = net.connect(PROXY_PORT, '127.0.0.1', () => {
    clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
    if (head && head.length) proxySocket.write(head);
    proxySocket.pipe(clientSocket);
    clientSocket.pipe(proxySocket);
  });
  proxySocket.on('error', () => clientSocket.end());
  clientSocket.on('error', () => proxySocket.end());
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Abasthan Web Service listening on 0.0.0.0:${PORT}`);
});
