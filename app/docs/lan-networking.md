# Connecting from your LAN to your public server (NAT loopback)

Some home routers do not support NAT loopback (hairpin NAT). When a device inside your network tries to reach your public domain (e.g. pokettrpg.duckdns.org), the connection may time out even though the server works from the internet.

## Symptoms
- Your Pi (or server) shows Caddy listening on 443 and Node on 3000; certs are valid.
- HTTPS/WSS to the public hostname works from outside your network.
- From Windows on the same LAN, connecting to your public hostname:443 times out.

## Quick fixes

Pick either and you can connect immediately from inside your LAN.

1) Windows hosts override (best for LAN dev)
- Find your server's LAN IP (e.g. 192.168.1.50).
- Edit `C:\Windows\System32\drivers\etc\hosts` as Administrator and add:
  
  `192.168.1.50  pokettrpg.duckdns.org`

- Use the same hostname with HTTPS/WSS:
  - API: `https://pokettrpg.duckdns.org/api/rooms`
  - Socket: `wss://pokettrpg.duckdns.org`

Why it works: you keep the correct SNI/host for TLS, but route directly to the Pi on your LAN.

2) Tunnel for development (no router changes)
- Cloudflare quick tunnel (on the Pi):
  - `cloudflared tunnel --url http://localhost:3000`
  - Use the printed `https://…trycloudflare.com` URL with WSS.
- Or use ngrok: `ngrok http 3000` (after installing and logging in).

## Local validation
- From the Pi, force SNI to the hostname while targeting localhost:
  - `curl -vk --resolve pokettrpg.duckdns.org:443:127.0.0.1 https://pokettrpg.duckdns.org/api/rooms`
- From Windows after the hosts entry:
  - `Test-NetConnection pokettrpg.duckdns.org -Port 443`
  - `Invoke-WebRequest https://pokettrpg.duckdns.org/api/rooms -UseBasicParsing`

## App client notes
- Use `wss://` (not `ws://`) when connecting to your public hostname.
- Prefer WebSocket-only transport for best behavior.

If your router supports it, enabling "NAT loopback"/"NAT reflection" will also fix LAN access without a hosts file. Otherwise consider split-horizon DNS on your router to map your hostname to the LAN IP for LAN clients.