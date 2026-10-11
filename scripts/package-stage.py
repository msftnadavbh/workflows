import hashlib
import json
import re
from uuid import uuid4
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile

ROOT = Path(__file__).resolve().parent.parent
FILES = [
    "Launch-Rescue.pptx", "Launch-Rescue.pdf", "Launch-Rescue-Demo.html",
    "Launch-Demo.ps1", "README.md", "Presenter-Runbook.md", "Feature-Research.md",
    "PRODUCT.md", "DESIGN.md", "package.json", "package-lock.json", "tsconfig.json",
    "playwright.config.mjs", ".gitignore", ".gitattributes",
]
FOLDERS = [
    r".github", r"demo", r"native", r"dist", r"tests",
    r"sources", r"evidence", r"scripts", r"presentation\assets",
]
EXTRA = [r"presentation\build-deck.mjs", r"presentation\slide-manifest.json",
         r".impeccable\design-system.json"]
NATIVE_VERIFICATION_FILES = [
    r"demo\core.ts", r"native\extension.ts", r"native\io.ts", r"native\reconcile.ts",
    r"native\checkpoint.mjs", r"native\cost.mjs", r"native\Run-Sdk.mjs", r"native\verification.mjs",
    r".github\agents\launch-analyst.agent.md", r".github\agents\launch-reviewer.agent.md",
    r".github\extensions\launch-rescue\extension.mjs",
    r"dist\core.mjs", r"dist\io.mjs", r"dist\reconcile.mjs",
]


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


def artifact_path(root, identifier):
    return root.joinpath(*identifier.split("\\"))


def verify_native_build(proof, label):
    build = proof.get("nativeBuild")
    require(isinstance(build, dict) and build.get("algorithm") == "sha256",
            f"{label} proof is not bound to the current build. Re-run native verification.")
    files = build.get("files")
    require(isinstance(files, dict) and set(files) == set(NATIVE_VERIFICATION_FILES),
            f"{label} proof has an incomplete build fingerprint.")
    for filename in NATIVE_VERIFICATION_FILES:
        actual = hashlib.sha256(artifact_path(ROOT, filename).read_bytes()).hexdigest()
        require(files[filename] == actual,
                f"{label} proof is stale for {filename}. Rebuild and re-run native verification.")


def main():
    version = re.search(
        r'export const VERSION = "([^"]+)"',
        artifact_path(ROOT, r"demo\core.ts").read_text(encoding="utf-8"),
    ).group(1)
    live = json.loads(artifact_path(ROOT, r"evidence\native-live-proof.json").read_text(encoding="utf-8"))
    runtime = json.loads(artifact_path(ROOT, r"evidence\native-runtime-proof.json").read_text(encoding="utf-8"))
    research = json.loads(artifact_path(ROOT, r"sources\research.json").read_text(encoding="utf-8"))
    require(live["status"] == "completed", "Actual live native verification is incomplete.")
    require(live["report"]["version"] == version, "Live proof belongs to an older workflow.")
    require(live["report"]["scenario"] == "mixed", "The actual adaptive scenario must be verified.")
    require(live["sameRunResume"] and live["agentsAddedOnResume"] == 0, "Native resume reuse was not verified.")
    require(len(live["actualWorkflowOwnedAgents"]) == 3, "Expected three actual completed agents.")
    require(all(a["status"] == "completed" and a["requestedModel"] == a["resolvedModel"]
                for a in live["actualWorkflowOwnedAgents"]), "Actual model resolution is not verified.")
    require(runtime["pausedStatus"] == "paused" and runtime["resumedStatus"] == "completed",
            "Native no-model checkpoint verification is incomplete.")
    require(runtime["workflowOwnedAgents"] == 0, "Rehearsal must not contain model agents.")
    verify_native_build(live, "Live")
    verify_native_build(runtime, "Rehearsal")
    require(len(research["sources"]) == 20, "Primary-source inventory is incomplete.")
    require((ROOT / "Launch-Rescue.pdf").read_bytes().startswith(b"%PDF"), "PDF backup is missing or invalid.")
    with ZipFile(ROOT / "Launch-Rescue.pptx") as deck:
        require(deck.testzip() is None, "PowerPoint archive is corrupt.")
        require(len([name for name in deck.namelist()
                     if re.fullmatch(r"ppt/slides/slide\d+\.xml", name)]) == 26, "PowerPoint must contain 26 slides.")

    paths = [artifact_path(ROOT, name) for name in FILES + EXTRA]
    for folder in FOLDERS:
        paths.extend(path for path in artifact_path(ROOT, folder).rglob("*")
                     if path.is_file() and "__pycache__" not in path.parts and path.suffix not in {".pyc", ".tmp"})
    paths = sorted(set(paths), key=lambda path: str(path.relative_to(ROOT)))
    require(all(path.is_file() for path in paths), "A required stage file is missing.")
    entries = []
    archive = ROOT / "Launch-Rescue-Stage-Kit.zip"
    temporary = archive.with_name(f".{archive.name}.{uuid4().hex}.tmp")
    try:
        with ZipFile(temporary, "w", ZIP_DEFLATED, compresslevel=6) as output:
            for path in paths:
                name = path.relative_to(ROOT).as_posix()
                data = path.read_bytes()
                entries.append({"path": name, "bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()})
                output.writestr(name, data)
            manifest = {
                "workflowVersion": version,
                "primarySources": len(research["sources"]),
                "nativeRuntime": live["sdkRuntime"]["version"],
                "liveAgentsVerified": len(live["actualWorkflowOwnedAgents"]),
                "agentsAddedOnResume": live["agentsAddedOnResume"],
                "nativeBuild": live["nativeBuild"],
                "files": entries,
                "excluded": ["node_modules", "runs", "user credentials", "session history", "test temporary output"],
            }
            output.writestr("stage-manifest.json", json.dumps(manifest, indent=2))
        with ZipFile(temporary) as output:
            require(output.testzip() is None, "Portable stage archive is corrupt.")
            names = set(output.namelist())
            require(".github/extensions/launch-rescue/extension.mjs" in names, "Native extension missing from ZIP.")
            require("Launch-Rescue-Demo.html" in names, "Standalone fallback missing from ZIP.")
            require(not any(name.startswith(("runs/", "node_modules/", "session-state/", "installed-plugins/")) for name in names),
                    "Private or temporary state leaked into ZIP.")
            require(not any(name.startswith(".impeccable/") and name != ".impeccable/design-system.json"
                            for name in names), "Private design-session cache leaked into ZIP.")
            for entry in entries:
                require(hashlib.sha256(output.read(entry["path"])).hexdigest() == entry["sha256"],
                        "Archive content mismatch.")
        temporary.replace(archive)
    finally:
        temporary.unlink(missing_ok=True)
    print(f"Packaged and verified {len(entries)} files: {archive.name} ({archive.stat().st_size / 1024 / 1024:.2f} MB).")


if __name__ == "__main__":
    main()
