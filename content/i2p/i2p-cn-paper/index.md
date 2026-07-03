---
title: "Coordinated Deployment and Reachability Asymmetry of Chinese I2P Routers"
date: 2026-07-03
draft: false
---

We are releasing a preprint that characterizes a cluster of Chinese I2P routers discovered via passive DHT scanning.

## Key Findings

Across five i2pd 2.60.0 floodfill instances, we scanned the I2P network over multiple collection rounds (June 29 – July 1, 2026) and discovered **20,701 unique routers**.

**The matched CN cluster** (58 routers) exhibits:

- **2–3× elevated floodfill declaration rate** (27–36% vs. 14–20% global baseline) in their RouterCaps — yet zero were observed participating as active floodfills.
- **Version lock on 0.9.66** (79.3% of CN routers vs. 1.8% globally) — a 43× enrichment.
- **82.8% share a high-bandwidth XfR/XRG RouterCaps template**; 32.8% explicitly carry the floodfill flag (f) via XfR.
- Concentrated on **Alibaba Cloud (AS37963, 46.2%)**, with no `knownRouters` or family declarations, and ongoing IP rotation.
- **Four China-vantage-only routers** — observed only from inside China's GFW, unreachable from Singapore and Tor exit paths — with TCP RST/timeout behavior consistent with selective reachability filtering along the path.

## Our Approach

We distinguish **three separate concepts** throughout the paper:

1. **Observed active floodfill participation** (operationally defined by our local i2pd instances)
2. **Explicit `f` flag declarations** in RouterCaps
3. **Broader XfR/XRG template matching** (a high-bandwidth RouterCaps pattern, not equivalent to floodfill behavior)

We also parse the binary RouterInfo format at two distinct caps layers (AddressCaps per transport vs. global RouterCaps) — a distinction that prior I2P measurement studies did not disentangle.

## What This Is — and Isn't

We describe the evidence as **consistent with coordinated, template-based provisioning**, not as definitive attribution to a specific actor. We do not claim to have identified who operates these routers.

The reachability asymmetry we observe (China-vantage-only nodes) is a measured fact; the underlying mechanism — host firewall, cloud security group, or network-level filtering — cannot be localized from TCP connect probes alone.

## Preprint & Code

- **Preprint (Zenodo, open access)**: [10.5281/zenodo.21169969](https://doi.org/10.5281/zenodo.21169969)
- **Scanner source code (MIT)**: [github.com/iasds/i2p-network-scanner](https://github.com/iasds/i2p-network-scanner)

---

*Preprint. Licensed under CC BY-NC-SA 4.0. Raw measurement datasets are available upon request under a responsible-use agreement.*
