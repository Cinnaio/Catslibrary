"""Check the bundled reducer before Xcode builds, without installing npm dependencies."""

from hashlib import sha256
from pathlib import Path

repo = Path(__file__).resolve().parents[2]
source = (repo / "web/src/lib/edge.ts").read_text(encoding="utf-8")
adapter = (repo / "ios/scripts/reader-edge-adapter.js").read_text(encoding="utf-8")
resource = (repo / "ios/ZhiZhou/Resources/ReaderEdgeRuntime.js").read_text(encoding="utf-8")
header, source_line, runtime_line, body = resource.split("\n", 3)
expected_source = sha256((source + adapter).encode("utf-8")).hexdigest()
expected_runtime = sha256(body.encode("utf-8")).hexdigest()
if source_line != f"// Source SHA-256: {expected_source}" or runtime_line != f"// Runtime SHA-256: {expected_runtime}":
    raise SystemExit("Reader edge resource is stale or modified. Run: node ios/scripts/sync-reader-edge.mjs")
print("Bundled reader edge resource: source and runtime checksums verified.")
