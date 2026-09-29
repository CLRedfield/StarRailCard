"""Package built static files for Toy, with index.html at the ZIP root."""
from __future__ import annotations

import hashlib
import json
import posixpath
import re
import sys
import zipfile
from pathlib import Path
from urllib.parse import unquote, urlsplit

ROOT = Path(__file__).resolve().parents[1]
DIST = ROOT / "dist"
OUT = ROOT / "release"
ARCHIVE = OUT / "星穹骰局-Toy.zip"
MAX_BYTES = 50_000_000  # Meet both decimal MB and binary MiB interpretations.


def main() -> None:
    index = DIST / "index.html"
    if not index.is_file():
        raise SystemExit("Run npm run build before packaging.")
    html = index.read_text(encoding="utf-8")
    for link in re.findall(r'(?:src|href)=[\"\']([^\"\']+)', html):
        if link.startswith("/"):
            raise SystemExit(f"Root-absolute URL is not safe for Toy: {link}")
        if not re.match(r"(?:[a-z]+:|#)", link, re.I):
            resource = DIST / link.split("?", 1)[0].split("#", 1)[0]
            if not resource.is_file():
                raise SystemExit(f"Missing entry resource: {link}")
    # Every shipped original asset must accompany the build; no runtime Wiki fetches.
    original_assets = [p for p in (ROOT / "public").rglob("*") if p.is_file()]
    for asset in original_assets:
        target = DIST / asset.relative_to(ROOT / "public")
        if not target.is_file() or target.read_bytes() != asset.read_bytes():
            raise SystemExit(f"Build contains a missing or stale asset: {target}")
    # Mirror src/lib/assets.ts: a stable canonical path for each original SHA.
    manifest = json.loads((ROOT / "src/data/assetManifest.json").read_text(encoding="utf-8"))
    by_hash: dict[str, str] = {}
    aliases: dict[str, str] = {}
    for item in sorted(manifest, key=lambda item: item["path"]):
        content = (DIST / item["path"]).read_bytes()
        if hashlib.sha256(content).hexdigest() != item["sha256"]:
            raise SystemExit(f"Original asset hash mismatch: {item['path']}")
        aliases[item["path"]] = by_hash.setdefault(item["sha256"], item["path"])

    # CSS references do not call asset(); preserve their exact resolved paths too.
    direct_references: set[str] = set()
    for css in DIST.rglob("*.css"):
        for raw in re.findall(r'url\(\s*[\"\']?([^\)\"\']+)', css.read_text(encoding="utf-8")):
            url = urlsplit(raw.strip())
            if url.scheme or url.netloc or not url.path:
                continue
            if url.path.startswith("/"):
                raise SystemExit(f"Root-absolute CSS URL: {raw}")
            relative = posixpath.normpath(posixpath.join(css.relative_to(DIST).parent.as_posix(), unquote(url.path)))
            if not (DIST / relative).resolve().is_relative_to(DIST.resolve()) or not (DIST / relative).is_file():
                raise SystemExit(f"Missing or unsafe CSS resource: {raw}")
            direct_references.add(relative)

    all_files = sorted(p for p in DIST.rglob("*") if p.is_file())
    files = [p for p in all_files if (relative := p.relative_to(DIST).as_posix()) not in aliases
             or aliases[relative] == relative or relative in direct_references]
    OUT.mkdir(exist_ok=True)
    staged_archive = OUT / ".toy-package.tmp.zip"
    with zipfile.ZipFile(staged_archive, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for file in files:
            relative = file.relative_to(DIST).as_posix()
            if any(part in {"node_modules", ".git", "src", ".cache"} for part in Path(relative).parts):
                raise SystemExit(f"Unexpected source directory in build: {relative}")
            archive.write(file, relative)
    with zipfile.ZipFile(staged_archive) as archive:
        if "index.html" not in archive.namelist() or archive.testzip() is not None:
            raise SystemExit("ZIP root/CRC verification failed.")
        # Every original game path still resolves to exactly its original pixels.
        for item in manifest:
            if hashlib.sha256(archive.read(aliases[item["path"]])).hexdigest() != item["sha256"]:
                raise SystemExit(f"Packaged asset resolution failed: {item['path']}")
        if not direct_references.issubset(archive.namelist()):
            raise SystemExit("ZIP is missing a CSS image.")
    unpacked_bytes = sum(p.stat().st_size for p in files)
    if max(staged_archive.stat().st_size, unpacked_bytes) >= MAX_BYTES:
        raise SystemExit(f"Toy package exceeds the strict {MAX_BYTES:,}-byte limit; previous ZIP preserved.")
    staged_archive.replace(ARCHIVE)
    report = {
        "name": "星穹骰局",
        "suggestedSlug": "xingqiong-dice",
        "archive": ARCHIVE.name,
        "entry": "index.html",
        "orientation": "portrait-responsive",
        "files": len(files),
        "bytes": ARCHIVE.stat().st_size,
        "uncompressedBytes": unpacked_bytes,
        "maxBytes": MAX_BYTES,
        "optimization": "SHA-256 deduplication only; original PNG bytes and all game content preserved",
        "originalAssetPaths": len(manifest),
        "uniqueAssetContents": len(by_hash),
        "duplicateFilesOmitted": len(all_files) - len(files),
        "duplicateBytesOmitted": sum(p.stat().st_size for p in all_files) - unpacked_bytes,
        "assetAliases": {source: target for source, target in aliases.items() if source != target},
        "sha256": hashlib.sha256(ARCHIVE.read_bytes()).hexdigest(),
        "network": "Local single-player; multiplayer uses wss://broker.emqx.io:8084/mqtt",
    }
    (OUT / "package-manifest.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({key: value for key, value in report.items() if key != "assetAliases"}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    main()
