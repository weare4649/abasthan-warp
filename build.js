const fs = require('fs');
const path = require('path');
const https = require('https');
const { execSync } = require('child_process');

function getRedirectUrl(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        resolve(res.headers.location);
      } else {
        resolve(url);
      }
    }).on('error', reject);
  });
}

async function downloadFile(url, dest) {
  const finalUrl = await getRedirectUrl(url);
  return new Promise((resolve, reject) => {
    https.get(finalUrl, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        https.get(res.headers.location, (res2) => {
          const file = fs.createWriteStream(dest);
          res2.pipe(file);
          file.on('finish', () => file.close(resolve));
        }).on('error', reject);
      } else {
        const file = fs.createWriteStream(dest);
        res.pipe(file);
        file.on('finish', () => file.close(resolve));
      }
    }).on('error', reject);
  });
}

async function downloadSingBox() {
  const binDir = path.join(__dirname, 'bin');
  if (!fs.existsSync(binDir)) fs.mkdirSync(binDir, { recursive: true });
  const binPath = path.join(binDir, 'sing-box');
  if (fs.existsSync(binPath)) {
    console.log('sing-box already exists.');
    return;
  }

  console.log('Downloading sing-box for Linux amd64...');
  const url = 'https://github.com/SagerNet/sing-box/releases/download/v1.10.7/sing-box-1.10.7-linux-amd64.tar.gz';
  const tarPath = path.join(binDir, 'sb.tar.gz');

  await downloadFile(url, tarPath);
  console.log('Extracting sing-box...');
  execSync(`tar -xzf "${tarPath}" -C "${binDir}"`);
  
  const entries = fs.readdirSync(binDir);
  for (const entry of entries) {
    const full = path.join(binDir, entry);
    if (fs.statSync(full).isDirectory() && entry.startsWith('sing-box-')) {
      const src = path.join(full, 'sing-box');
      if (fs.existsSync(src)) {
        fs.renameSync(src, binPath);
      }
    }
  }

  try { fs.chmodSync(binPath, 0o755); } catch (e) {}
  console.log('sing-box prepared successfully at:', binPath);
}

downloadSingBox().catch(err => {
  console.error('Build warning:', err.message);
});
