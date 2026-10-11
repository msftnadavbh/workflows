import hashlib
import importlib.util
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from zipfile import ZipFile

SPEC = importlib.util.spec_from_file_location("stage_package", Path(__file__).resolve().parent.parent / "scripts" / "package-stage.py")
PACKAGE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(PACKAGE)


class StagePackageTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="launch-rescue-package-")
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        for name in set(PACKAGE.FILES + PACKAGE.EXTRA + PACKAGE.NATIVE_VERIFICATION_FILES):
            path = PACKAGE.artifact_path(self.root, name)
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text("Fixture", encoding="utf-8")
        (self.root / "demo" / "core.ts").write_text('export const VERSION = "fixture-v1";', encoding="utf-8")
        (self.root / "Launch-Rescue.pdf").write_bytes(b"%PDF-1.7\nFixture")
        with ZipFile(self.root / "Launch-Rescue.pptx", "w") as archive:
            for index in range(1, 27):
                archive.writestr(f"ppt/slides/slide{index}.xml", "<slide />")
        (self.root / "sources").mkdir(exist_ok=True)
        (self.root / "sources" / "research.json").write_text(json.dumps({"sources": [str(index) for index in range(20)]}), encoding="utf-8")
        (self.root / ".impeccable" / "hook.cache.json").write_text('{"session_id":"must-not-ship"}', encoding="utf-8")
        fingerprints = {name: hashlib.sha256(PACKAGE.artifact_path(self.root, name).read_bytes()).hexdigest()
                        for name in PACKAGE.NATIVE_VERIFICATION_FILES}
        live = {
            "status": "completed", "sameRunResume": True, "agentsAddedOnResume": 0,
            "actualWorkflowOwnedAgents": [{"status": "completed", "requestedModel": model, "resolvedModel": model}
                                         for model in ["gpt-6.1-sol", "gpt-6.1-sol", "claude-sonnet-5.5"]],
            "sdkRuntime": {"version": "1.0.95"},
            "report": {"version": "fixture-v1", "scenario": "mixed"},
            "nativeBuild": {"algorithm": "sha256", "files": fingerprints},
        }
        rehearsal = {
            "pausedStatus": "paused", "resumedStatus": "completed", "workflowOwnedAgents": 0,
            "nativeBuild": live["nativeBuild"],
        }
        (self.root / "evidence").mkdir(exist_ok=True)
        (self.root / "evidence" / "native-live-proof.json").write_text(json.dumps(live), encoding="utf-8")
        (self.root / "evidence" / "native-runtime-proof.json").write_text(json.dumps(rehearsal), encoding="utf-8")

    def package(self):
        with patch.object(PACKAGE, "ROOT", self.root):
            PACKAGE.main()

    def test_session_cache_is_excluded_and_all_entries_match_the_manifest(self):
        self.package()
        with ZipFile(self.root / "Launch-Rescue-Stage-Kit.zip") as archive:
            self.assertNotIn(".impeccable/hook.cache.json", archive.namelist())
            self.assertIn(".impeccable/design-system.json", archive.namelist())
            for name in ["demo/core.ts", "native/extension.ts", "evidence/native-live-proof.json",
                         "sources/research.json", "presentation/slide-manifest.json"]:
                self.assertIn(name, archive.namelist())
            self.assertFalse(any("\\" in name for name in archive.namelist()))
            manifest = json.loads(archive.read("stage-manifest.json"))
            for entry in manifest["files"]:
                self.assertEqual(hashlib.sha256(archive.read(entry["path"])).hexdigest(), entry["sha256"])

    def test_source_changes_invalidate_proof_even_if_the_workflow_version_is_unchanged(self):
        self.package()
        before = (self.root / "Launch-Rescue-Stage-Kit.zip").read_bytes()
        (self.root / "native" / "extension.ts").write_text("Changed native code", encoding="utf-8")
        with self.assertRaisesRegex(RuntimeError, "proof is stale"):
            self.package()
        self.assertEqual((self.root / "Launch-Rescue-Stage-Kit.zip").read_bytes(), before)

    def test_private_runtime_folders_and_python_temporary_files_are_excluded(self):
        for name in ["runs", "node_modules", "session-state", "installed-plugins"]:
            directory = self.root / name
            directory.mkdir()
            (directory / "private.json").write_text("Private fixture", encoding="utf-8")
        cache = self.root / "scripts" / "__pycache__"
        cache.mkdir(parents=True)
        (cache / "private.pyc").write_bytes(b"Private cache")
        (self.root / "scripts" / "private.tmp").write_text("Temporary fixture", encoding="utf-8")
        self.package()
        with ZipFile(self.root / "Launch-Rescue-Stage-Kit.zip") as archive:
            self.assertFalse(any(name.startswith(("runs/", "node_modules/", "session-state/", "installed-plugins/"))
                                 or "__pycache__" in name or name.endswith((".pyc", ".tmp"))
                                 for name in archive.namelist()))

    def test_missing_fingerprints_are_not_accepted_as_verification(self):
        path = self.root / "evidence" / "native-live-proof.json"
        proof = json.loads(path.read_text(encoding="utf-8"))
        del proof["nativeBuild"]
        path.write_text(json.dumps(proof), encoding="utf-8")
        with self.assertRaisesRegex(RuntimeError, "not bound to the current build"):
            self.package()
        self.assertFalse((self.root / "Launch-Rescue-Stage-Kit.zip").exists())


if __name__ == "__main__":
    unittest.main()
