---
title: "Clash Gateway — Transparent Proxy Guide"
description: "在 Qubes OS 上搭建透明代理网关的完整指南 — 零配置代理所有下游 AppVM，支持 GeoIP 智能分流。"
source_name: "Qubes Forum"
source_url: "https://forum.qubes-os.org/t/clash-gateway-transparent-proxy-guide/41016"
date: 2026-05-15
---

## Intro

This guide explains how to set up a transparent proxy gateway on Qubes OS using [qubes-clash-gateway](https://github.com/iasds/qubes-clash-gateway), powered by [mihomo](https://github.com/MetaCubeX/mihomo) (formerly Clash Meta).

Unlike per-AppVM proxy configurations, this approach turns a single NetVM into a proxy gateway. All downstream AppVMs get proxied automatically with **zero configuration** — just set the NetVM and go.

**What it does:**
- Transparent proxy for all TCP/UDP traffic
- DNS fake-ip to prevent DNS pollution
- GeoIP rule-based routing (CN direct, foreign proxy)
- Subscription parser supporting Clash YAML, vmess/vless/ss/ssr/trojan/hy2/tuic/wireguard
- Terminal controller `clashctl` + Web UI for management

**How it works:**
```
AppVM → vif* interface → nftables redirect → mihomo
                                           ├→ DNS :53 → :1053 (fake-ip)
                                           ├→ TCP  → :7892 (redir-port)
                                           └→ UDP  → :7893 (tproxy-port)

mihomo routing:
  ├→ CN domains/IPs → direct
  └→ Foreign → proxy nodes → internet
```

## Prerequisites

- Qubes OS 4.2+
- A proxy subscription (Clash format, or vmess/vless/ss/trojan/hy2/tuic URI)
- Basic familiarity with terminal commands

## Setup

### NetVM Creation

Create a dedicated NetVM to serve as the proxy gateway:

1. In Qubes Manager, create a new qube:
   - **Name:** `sys-proxy` (or whatever you prefer)
   - **Type:** Standalone (recommended) or AppVM based on Fedora/Debian template
   - **Networking:** `sys-firewall` (or your upstream NetVM)
   - **Check:** "Provides network to other qubes" ← **Important**

2. In qube settings:
   - **Memory:** 512 MB minimum (800 MB recommended for Web UI)
   - **Services:** Add `qubes-firewall`

3. Start the qube and open a terminal

### Installation

[[SSH]] into the NetVM (or use Qubes terminal):

```bash
# Clone the project
git clone https://github.com/iasds/qubes-clash-gateway.git
cd qubes-clash-gateway

# One-click install
sudo bash setup.sh
```

The installer will:
- Install mihomo binary
- Create systemd service
- Configure nftables for transparent proxy
- Set up auto-reload for new VM connections
- Install `clashctl` command

After installation, `clashctl` is ready to use.

### Subscription Configuration

Add your proxy subscription:

```bash
# Add subscription URL
clashctl /sub add <your-subscription-url>

# Update subscription to fetch nodes
clashctl /sub update

# Select rule-based routing (recommended)
clashctl /mode rule
```

### Assign AppVMs

In dom0, set any AppVM to use the proxy gateway:

```bash
# Check current NetVM
qvm-prefs <appvm-name> netvm

# Set to proxy gateway
qvm-prefs <appvm-name> netvm sys-proxy
```

That's it. The AppVM now routes all traffic through the proxy — no configuration needed inside the AppVM.

## Usage

### Terminal Commands

```bash
clashctl /status              # Show status, traffic, node count
clashctl /mode rule           # Rule-based routing (CN direct, foreign proxy)
clashctl /mode global         # Global proxy (all traffic through proxy)
clashctl /mode direct         # Direct connection (bypass proxy)

clashctl /sub add <url>       # Add subscription
clashctl /sub update          # Update all subscriptions
clashctl /sub list            # List subscriptions

clashctl /node                # List all nodes
clashctl /node <name>         # Select specific node

clashctl /test                # Speed test all nodes
clashctl /test <name>         # Speed test single node

clashctl /dns fake-ip         # Switch DNS mode (fake-ip recommended)
clashctl /restart             # Restart mihomo

clashctl /web                 # Start Web UI (default port 9091)
```

Aliases: `/s`=`/status`, `/m`=`/mode`, `/n`=`/node`, `/t`=`/test`

### Web UI

```bash
clashctl /web                 # Start with auto-generated token
clashctl /web --secret <pass> # Start with custom token
```

Open `http://<netvm-ip>:9091` in any AppVM browser, enter the token.

The Web UI provides:
- Dashboard with traffic stats and exit IP
- Node list with per-group speed testing
- Connection viewer with exit node resolution
- Subscription management
- DNS cache flush

### Verify Connectivity

```bash
# On the AppVM
curl -s https://api.ipify.org          # Should show proxy server IP
curl -s https://www.baidu.com          # CN sites should work (direct)
curl -s https://www.google.com         # Foreign sites should work (proxy)
```

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                     AppVM (zero config)                 │
│   Browser, Telegram, etc. → default gateway = sys-proxy │
└─────────────────────┬───────────────────────────────────┘
                      │ vif* interface
                      ▼
┌─────────────────────────────────────────────────────────┐
│  sys-proxy (NetVM)                                      │
│  ┌───────────────────────────────────────────────────┐  │
│  │ nftables (qcg_proxy table)                        │  │
│  │   DNS :53    → redirect to :1053                  │  │
│  │   TCP *:port → redirect to :7892 (redir-port)    │  │
│  │   UDP *:port → redirect to :7893 (tproxy-port)   │  │
│  └─────────────────────┬─────────────────────────────┘  │
│                        ▼                                │
│  ┌───────────────────────────────────────────────────┐  │
│  │ mihomo                                            │  │
│  │   DNS server (fake-ip mode, :1053)                │  │
│  │   Redir server (TCP transparent proxy, :7892)     │  │
│  │   Tproxy server (UDP transparent proxy, :7893)    │  │
│  │                                                   │  │
│  │   Routing rules:                                  │  │
│  │     CN domains/IPs → direct                       │  │
│  │     Foreign → proxy nodes → internet              │  │
│  └───────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
```

## Persistence

Qubes AppVMs lose `/etc/` on reboot. These paths persist on `/rw/config/`:

| Path | Content |
|------|---------|
| `/rw/config/clash/config.yaml` | mihomo configuration |
| `/rw/config/clash/clashctl-preferences.json` | clashctl preferences |
| `/rw/config/clash/clashctl-subscriptions.json` | Subscription URLs |
| `/rw/config/clash/nftables-proxy.sh` | nftables rules (auto-loaded) |
| `/rw/config/qubes-firewall-user-script` | Auto-reload on VM connect |
| `/rw/config/rc.local` | Boot-time startup script |

## Multiple NetVMs

You can run multiple proxy gateways for different purposes:

```bash
# Create separate NetVMs
sys-proxy-cn    # China-optimized nodes
sys-proxy-us    # US nodes
sys-proxy-uk    # UK nodes

# Assign AppVMs to different gateways
qvm-prefs work-appvm netvm sys-proxy-us
qvm-prefs personal-appvm netvm sys-proxy-cn
```

Each NetVM has independent subscriptions, nodes, and routing rules.

## Troubleshooting

### AppVM can't connect

1. Check if mihomo is running:
   ```bash
   ssh user@sys-proxy "systemctl status mihomo"
   ```

2. Check nftables rules:
   ```bash
   ssh user@sys-proxy "sudo nft list set inet qcg_proxy vif_interfaces"
   ```
   Should list all connected VM interfaces (e.g., `vif8.0`, `vif11.0`).

3. If a new VM can't connect, reload nftables:
   ```bash
   ssh user@sys-proxy "sudo /rw/config/clash/nftables-proxy.sh"
   ```

### DNS not resolving

1. Check DNS mode:
   ```bash
   clashctl /status
   ```
   Should show `fake-ip` mode.

2. Flush DNS cache:
   ```bash
   clashctl /dns flush
   ```

### Slow speed / high latency

1. Speed test nodes:
   ```bash
   clashctl /test
   ```

2. Switch to a faster node:
   ```bash
   clashctl /node <faster-node-name>
   ```

3. Check exit IP:
   ```bash
   curl -s https://api.ipify.org
   ```

### Web UI not accessible

1. Check if Web UI is running:
   ```bash
   clashctl /web
   ```

2. The token is printed when starting. If lost, restart:
   ```bash
   clashctl /web --secret <your-password>
   ```

## Advanced: Killswitch

To block non-proxy traffic (prevent leaks if mihomo fails):

```bash
# Add to /rw/config/qubes-firewall-user-script
nft add rule ip qubes forward iifname "vif*" oifname != "vif*" drop
```

⚠️ **Warning:** This blocks all direct traffic. If mihomo is down, AppVMs lose connectivity entirely.

## Advanced: Custom Rules

Add custom routing rules in `/rw/config/clash/config.yaml`:

```yaml
rules:
  # Direct CN traffic
  - DOMAIN-SUFFIX,baidu.com,DIRECT
  - DOMAIN-SUFFIX,qq.com,DIRECT
  - GEOIP,CN,DIRECT

  # Proxy specific sites
  - DOMAIN-SUFFIX,google.com,auto
  - DOMAIN-SUFFIX,youtube.com,auto
  - DOMAIN-SUFFIX,twitter.com,auto

  # Fallback
  - MATCH,auto
```

After editing, restart mihomo:
```bash
clashctl /restart
```

## Links

- **GitHub:** https://github.com/iasds/qubes-clash-gateway
- **mihomo:** https://github.com/MetaCubeX/mihomo
- **Issues:** https://github.com/iasds/qubes-clash-gateway/issues

---

*This guide is maintained by the qubes-clash-gateway community. For questions or contributions, open an issue on GitHub.*
