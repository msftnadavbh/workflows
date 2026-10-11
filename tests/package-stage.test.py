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
            path = self.root / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text("Fixture", encoding="utf-8")
        (self.root / r"demo\core.ts").write_text('export const VERSION = "fixture-v1";', encoding="utf-8")
        (self.root / "Launch-Rescue.pdf").write_bytes(b"%PDF-1.7\nFixture")
        with ZipFile(self.root / "Launch-Rescue.pptx", "w") as archive:
            for index in range(1, 27):
                archive.writestr(f"ppt/slides/slide{index}.xml", "<slide />")
        (self.root / "sources").mkdir(exist_ok=True)
        (self.root / r"sources\research.json").write_text(json.dumps({"sources": [str(index) for index in range(20)]}), encoding="utf-8")
        (self.root / ".impeccable" / "hook.cache.json").write_text('{"session_id":"must-not-ship"}', encoding="utf-8")
        fingerprints = {name: hashlib.sha256((self.root / name).read_bytes()).hexdigest()
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
        (self.root / r"evidence\native-live-proof.json").write_text(json.dumps(live), encoding="utf-8")
        (self.root / r"evidence\native-runtime-proof.json").write_text(json.dumps(rehearsal), encoding="utf-8")

    def package(self):
        with patch.object(PACKAGE, "ROOT", self.root):
            PACKAGE.main()

    def test_session_cache_is_excluded_and_all_entries_match_the_manifest(self):
        self.package()
        with ZipFile(self.root / "Launch-Rescue-Stage-Kit.zip") as archive:
            self.assertNotIn(".impeccable/hook.cache.json", archive.namelist())
            self.assertIn(".impeccable/design-system.json", archive.namelist())
            manifest = json.loads(archive.read("stage-manifest.json"))
            for entry in manifest["files"]:
                self.assertEqual(hashlib.sha256(archive.read(entry["path"])).hexdigest(), entry["sha256"])

    def test_source_changes_invalidate_proof_even_if_the_workflow_version_is_unchanged(self):
        self.package()
        before = (self.root / "Launch-Rescue-Stage-Kit.zip").read_bytes()
        (self.root / r"native\extension.ts").write_text("Changed native code", encoding="utf-8")
        with self.assertRaisesRegex(RuntimeError, "proof is stale"):
            self.package()
        self.assertEqual((self.root / "Launch-Rescue-Stage-Kit.zip").read_bytes(), before)

    def test_missing_fingerprints_are_not_accepted_as_verification(self):
        path = self.root / r"evidence\native-live-proof.json"
        proof = json.loads(path.read_text(encoding="utf-8"))
        del proof["nativeBuild"]
        path.write_text(json.dumps(proof), encoding="utf-8")
        with self.assertRaisesRegex(RuntimeError, "not bound to the current build"):
            self.package()
        self.assertFalse((self.root / "Launch-Rescue-Stage-Kit.zip").exists())


if __name__ == "__main__":
    unittest.main()
