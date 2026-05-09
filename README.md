# Food Forest Simulation — Architecture & Rust Guide

A multiplayer food forest simulation set in Central Portugal. Players plant trees, manage soil, raise animals, and build regenerative ecosystems together across a voxelized terrain derived from real Portuguese GeoTIFF elevation data.

---

## Running Locally

### Prerequisites

```
rustc  >= 1.80   (check: rustc --version)
cargo  >= 1.80   (ships with rustc)
node   >= 18     (for serving the web client)
```

### 1. Build everything

```bash
cd foodforest-sim
cargo build --workspace
```

This produces three binaries in `target/debug/`:
- `ff-server` — the game server (one shard)
- `ff-shard-manager` — load balancer gateway
- `ff-tools` — dev diagnostics

### 2. Start the game server

```bash
cargo run -p ff-server
```

The server loads `voxel_data/central_portugal/voxels.bin`, spawns an initial ecosystem (50 trees, 100 herbs, 10 chickens, 5 deer), and listens for WebSocket connections on `0.0.0.0:9000`.

Environment variables:

| Variable | Default | Purpose |
|---|---|---|
| `LISTEN_ADDR` | `0.0.0.0:9000` | Server bind address |
| `SHARD_ID` | `1` | Shard identifier |
| `TERRAIN_PATH` | `voxel_data/central_portugal/voxels.bin` | Path to terrain |

### 3. Serve the web client

```bash
cd web
npx serve .
# or: python3 -m http.server 8080
```

Open `http://localhost:3000` (or 8080), enter a name, connect to `ws://localhost:9000`.

### 4. Regenerate terrain from GeoTIFF (optional)

If you have new DEM/landcover data for a Portuguese region:

```bash
cargo run -p ff-voxel --bin voxelize -- my_region data/dem.tif data/lc.tif
```

Output goes to `voxel_data/my_region/voxels.bin`.

### 5. Multi-shard setup

For testing shard routing:

```bash
# Terminal 1: shard manager (gateway on port 8000)
cargo run -p ff-shard-manager

# Terminal 2: shard 1 (port 9000)
SHARD_ID=1 LISTEN_ADDR=0.0.0.0:9000 cargo run -p ff-server

# Terminal 3: shard 2 (port 9001)
SHARD_ID=2 LISTEN_ADDR=0.0.0.0:9001 cargo run -p ff-server
```

Register additional shards in `crates/ff-shard-manager/src/main.rs`.

### 6. Dev tools

```bash
cargo run -p ff-tools -- info
```

### 7. Run tests

```bash
cargo test --workspace
```

The protocol codec has roundtrip tests for message encode/decode.

---