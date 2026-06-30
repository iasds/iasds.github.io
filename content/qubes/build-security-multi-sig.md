---
title: "Build Security Doesn't Need Full Determinism — A Practical Multi-Sig + Transparency Log Approach"
description: "不等完全确定性构建就引入多重签名验证：三层方案（Stage0 引导链、7 人多数共识、透明日志）实现无需 100% 可重现构建的发布安全保障。"
source_name: "Qubes Forum"
source_url: "https://forum.qubes-os.org/t/build-security-multi-sig-and-transparency-log-approach/42039"
date: 2026-06-11
---

Qubes' current release signing flow relies on a single point of trust — one person holds the release key. It's worked for over a decade, but "hasn't been compromised yet" isn't the same as "can't be compromised."

Everyone agrees deterministic builds + multi-signature is the right direction. Issue #816 has been open for years, which shows the community knows its value. But full determinism is a heavy lift — getting thousands of packages across dozens of upstream projects to produce bit-identical output is a massive undertaking.

This post explores a question: **Can we build a multi-signature verification system without waiting for 100% determinism?**

---

## Two Problems to Solve

1. **Single point of failure in the build process.** If the signing key is stolen or the build server is compromised, a malicious ISO can be signed and distributed without users knowing.

2. **Compiler trust.** Ken Thompson (1984) showed that reviewing source code isn't enough — a compromised compiler can inject backdoors during compilation and then erase its own traces. Your "trusted source" can produce untrusted binaries.

These are different problems, but they can be addressed together.

---

## The Approach: Three Layers

### Layer 1: Trust Anchor → 512 Bytes

The [Stage0](https://github.com/oriansj/stage0) project provides a bootstrap chain starting from a 512-byte hex monitor, building up to a full C compiler:

```
hex monitor (512 bytes)
  → Stage0 → hex2 (ELF file generator)
  → M2-Planet (minimal C compiler)
  → tcc (full C compiler, ~100KB)
  → compile gcc with tcc
  → compile Qubes with gcc
```

512 bytes — about a dozen lines of assembly. You can read it all and understand what it does.

Then use **DDC (Diverse Double Compilation)**: compile the same source with two independent compiler implementations (tcc and gcc). If outputs match → neither compiler is compromised. If they differ → something is wrong, trigger manual review.

DDC doesn't need to run every release — once a quarter is enough. A compiler backdoor doesn't self-destruct and doesn't change every three months.

### Layer 2: Seven People Each Build — Outputs Don't Need to Match

The conventional wisdom is "make everything deterministic first, then add multi-sig." But full determinism for a project as large as Qubes is a long road — timestamps, filesystem ordering, CPU instruction differences, compiler versions. It's real work.

Alternative framing: **We don't need determinism. We need consensus.**

Seven independent builders (different continents, different organizations) each run the same locked build container and source manifest, then sign their own ISO hash.

The result might look like this:

| Builder | Output Hash | Signed |
|---|---|---|
| Alice | a1b2c3 | ✅ |
| Bob | a1b2c3 | ✅ |
| Carol | d4e5f6 | ✅ |
| Dave | a1b2c3 | ✅ |
| Eve | a1b2c3 | ✅ |
| Frank | d4e5f6 | ✅ |
| Grace | a1b2c3 | ✅ |

`a1b2c3` has 5 signatures, `d4e5f6` has 2. Threshold = 4 → publish `a1b2c3`. Carol and Frank get a diffoscope report to find their discrepancy.

**You don't need uniform output. You need majority consensus.**

Math: if each builder has a 1% compromise probability, threshold 4/7, the probability of a successful forgery is ~3×10⁻⁸. Several orders of magnitude better than single-signer.

### Layer 3: Transparency Log — Public, Append-Only

Signatures need a public, tamper-evident record that anyone can query.

Implementation: Merkle tree + multi-medium publishing. Each log entry:

```
version | prev_hash | release_id | builder_id | output_hash | Ed25519_sig
```

The Merkle root (32 bytes) is published regularly to multiple independent channels:

- **DNS TXT record (DNSSEC-signed)**
- **Bitcoin OP_RETURN**
- **IPFS**
- **Fediverse**

Tampering with history requires compromising DNS infrastructure, the Bitcoin network, IPFS gateways, and Fediverse accounts simultaneously. The engineering difficulty is high enough to be meaningful.

User workflow: download ISO → compute SHA256 → query transparency log for ≥4 matching signatures → found → install. Not found → file a report.

---

## User Experience

Ideally, one command:

```bash
qubes-verify --iso Qubes-4.4.0-x86_64.iso
```

Behind the scenes:
1. Compute ISO SHA256
2. Query transparency log for matching signatures
3. Verify each signature's validity
4. Check signature count ≥ threshold
5. Verify Merkle root against DNS/blockchain records
6. All pass → green ✅

The log is public. Anyone can run a monitor bot. If something's wrong, the whole community knows.

---

## Implementation Path

Four phases, each producing independently useful output:

**Phase 0 (3-6 months): Infrastructure**
- Containerize the build environment with locked versions
- Standardize the build manifest format
- Deploy transparency log server

No changes to existing build workflow — just adding a recording and verification layer around it.

**Phase 1 (3-6 months): Protocol**
- Build verification distribution and signature collection
- User-facing verification tool
- Log monitor bot

**Phase 2 (timeline depends on community): Verification Farm**
- Recruit 5-7 independent signing nodes
- Open witness nodes for the community (anyone can run verification and submit witness hashes)
- Run traditional signing and multi-signing in parallel, gradually transition

**Phase 3 (ongoing): DDC Bootstrap Chain**
- Port Stage0 → tcc → gcc bootstrap chain
- Run quarterly cross-compilation verification
- Results public, community oversight

---

## Relationship to Existing Work

Marek and the team have done solid work on qubes-builder: sandboxed builds, Tor routing, source signature verification. Containerized build environments are a natural extension of this work, not a replacement.

This proposal isn't about discarding the determinism goal. It's about **not waiting for full determinism before adding multi-sig verification.** Both efforts can proceed in parallel, and the transparency log + multi-sig infrastructure is valuable even before determinism is complete.

---

## Caveats

- **Does not protect against targeted attacks.** An attacker who bypasses the transparency log and hands you a fake ISO directly can still succeed. This requires user-side multi-channel verification.
- **DDC doesn't cover CPU microcode or hardware backdoors.** That's an industry-wide problem, not unique to Qubes.
- **Transparency log requires ongoing maintenance.** Merkle tree server, multi-medium publishing, monitor bots — all need someone to maintain them.
- **The hardest part might not be technical.** Finding 5-7 reliable signing nodes across different organizations requires community participation. That's an organizational challenge.

---

Discussion welcome. I can go deeper on the technical details — the organizational side is up to the community.

---

## References

- [Trusting Trust - Ken Thompson, 1984](https://www.cs.cmu.edu/~rdriley/487/papers/Thompson_1984_ReflectionsonTrustingTrust.pdf)
- [Reproducible Builds](https://reproducible-builds.org/)
- [Security challenges for the Qubes build process](https://www.qubes-os.org/news/2016/05/30/build-security/)
- [Qubes Issue #816](https://github.com/QubesOS/qubes-issues/issues/816)
- [Stage0: 512-byte bootstrap](https://github.com/oriansj/stage0)
- [M2-Planet](https://github.com/oriansj/m2-planet)
- [Certificate Transparency (RFC 6962)](https://datatracker.ietf.org/doc/html/rfc6962)
- [Diffoscope](https://diffoscope.org/)
