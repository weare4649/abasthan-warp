# Abasthan WARP Node

Lightweight Cloudflare WARP egress node and healthcheck service designed for PaaS platforms (Abasthan, Render, Koyeb).

- **Runtime**: Node.js 22 / Docker
- **WARP Core**: sing-box userspace WireGuard (no root / TUN required)
- **Healthcheck**: GET `/` or `/health` returns 200 OK
- **Proxy Port**: Listens on `$PORT` (default 8080)
