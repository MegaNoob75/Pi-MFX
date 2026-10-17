"""Run on the Pi: python3 -B -m unittest discover -s scripts/tests -p test_backup.py

No service, apt, USB or live rig is touched. Temporary fixtures exercise archive
authentication, dependency checks and durable data replacement/rollback.
"""
import contextlib
import copy
import getpass
import importlib.util
import io
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest
from unittest.mock import Mock, patch
import zipfile

spec = importlib.util.spec_from_file_location("pimfx_recovery", Path(__file__).parents[1] / "backup.py")
backup = importlib.util.module_from_spec(spec)
spec.loader.exec_module(backup)


class RecoveryTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        base = Path(self.temporary.name)
        self.data = base / "data"
        self.state = base / "recovery"
        self.data.mkdir()
        self.state.mkdir()
        self.patchers = [patch.object(backup, "DATA", self.data), patch.object(backup, "STATE", self.state),
                         patch.object(backup, "USER", getpass.getuser()), patch.object(backup, "system_identity", return_value={}),
                         patch.object(backup, "stopped_engine", side_effect=lambda job: contextlib.nullcontext()),
                         patch.object(backup, "chown_tree"), patch.object(backup, "apply_installation"),
                         patch.object(backup, "service_running", return_value=True), patch.object(backup.time, "sleep"),
                         patch.object(backup, "command", return_value=subprocess.CompletedProcess([], 0, "", ""))]
        for item in self.patchers:
            item.start()
            self.addCleanup(item.stop)
        self.job = "a" * 32
        self.source = "b" * 32
        backup.job_dir(self.job).mkdir(parents=True)
        backup.job_dir(self.source).mkdir(parents=True)
        self.settings = {"version": 4, "activeBankId": "bank-old", "activePresetId": "preset-old",
                         "audio": {"sampleRate": 48000}, "controller": {"presetAssignments": {"bank-old": {"switch": "preset-old"}}}, "ui": {"scale": 1}}
        backup.write_json(self.data / "settings.json", self.settings)
        backup.write_json(self.data / "banks/bank-old.json", self.bank("bank-old", ["preset-old"]))

    @staticmethod
    def bank(identity, presets):
        return {"id": identity, "name": identity, "order": 0,
                "presets": [{"id": p, "name": p, "routingFormat": 1, "chain": [], "routing": {}, "snapshots": []} for p in presets]}

    def fixture(self, files, categories):
        manifest = {"format": "pimfx-system-backup", "version": 1, "sourceRoot": str(self.data),
                    "system": {}, "categories": categories, "packages": [], "files": []}
        for name, value in files.items():
            target = backup.job_dir(self.source) / "verified" / name
            if isinstance(value, bytes):
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(value)
            else:
                backup.write_json(target, value)
            group = backup.category(name[5:]) if name.startswith("data/") else "plugins"
            manifest["files"].append({"path": name, "category": group, "bytes": target.stat().st_size, "sha256": backup.digest(target)})
        backup.write_json(backup.job_dir(self.source) / "manifest.json", manifest)
        return manifest

    def restore(self, categories, **options):
        backup.restore_backup(self.job, {"source": self.source, "trusted": True, "categories": categories, **options})

    def test_manifest_rejects_path_traversal(self):
        manifest = self.fixture({"data/models/a.nam": b"nam"}, ["models"])
        for name in ("../outside", "/etc/shadow", "data/../outside", "data\\models\\a.nam", "data//models/a.nam"):
            broken = copy.deepcopy(manifest)
            broken["files"][0]["path"] = name
            with self.subTest(name=name), self.assertRaises(ValueError):
                backup.validate_manifest(broken)

    def test_manifest_rejects_unapproved_system_files(self):
        manifest = self.fixture({"data/models/a.nam": b"nam"}, ["models"])
        manifest["files"][0].update(path="system/ssh-authorized-keys", category="models")
        with self.assertRaises(ValueError):
            backup.validate_manifest(manifest)

    def test_manifest_rejects_mislabeled_credentials(self):
        manifest = self.fixture({"data/models/a.nam": b"nam"}, ["models"])
        manifest["files"][0]["path"] = "data/credentials.json"
        with self.assertRaises(ValueError):
            backup.validate_manifest(manifest)

    def test_manifest_rejects_uninventoried_package(self):
        manifest = self.fixture({"packages/00000.deb": b"package"}, ["plugins"])
        with self.assertRaises(ValueError):
            backup.validate_manifest(manifest)

    def test_unsupported_archive_version(self):
        manifest = self.fixture({}, ["banks"])
        manifest["version"] = 99
        with self.assertRaises(ValueError):
            backup.validate_manifest(manifest)

    @staticmethod
    def online_package():
        return {"name": "example-lv2", "version": "1.2-3", "architecture": "arm64", "pinned": True,
                "download": {"url": "https://packages.example.org/example-lv2_1.2-3_arm64.deb",
                             "bytes": 7, "sha256": backup.hashlib.sha256(b"package").hexdigest()}}

    def test_v2_supports_mixed_download_records_and_embedded_packages(self):
        manifest = self.fixture({"packages/00000.deb": b"package"}, ["plugins"])
        manifest.update(version=2, pluginMode="online", packages=[self.online_package(),
                        {"name": "private-lv2", "version": "1.0", "architecture": "arm64", "path": "packages/00000.deb"}])
        backup.validate_manifest(manifest)
        self.assertEqual(backup.plugin_recovery_summary(manifest)["onlinePackages"], 1)
        self.assertEqual(backup.plugin_recovery_summary(manifest)["bundledPackages"], 1)
        legacy = copy.deepcopy(manifest)
        legacy["version"] = 1
        legacy.pop("pluginMode")
        legacy["packages"].pop(0)
        backup.validate_manifest(legacy)

    def test_download_inventory_rejects_unsafe_inconsistent_records(self):
        manifest = self.fixture({}, ["plugins"])
        manifest.update(version=2, pluginMode="online", packages=[self.online_package()])
        changes = [{"version": 1}, {"pluginMode": "self-contained"}, {"categories": ["banks"]}]
        for change in changes:
            with self.subTest(change=change), self.assertRaises(ValueError):
                backup.validate_manifest({**manifest, **change})
        for field, value in [("url", "file:///etc/shadow"), ("url", "https://user:secret@example.org/pkg.deb"),
                             ("url", "https://example.org/pkg.deb\n"), ("sha256", "wrong"), ("bytes", -1)]:
            broken = copy.deepcopy(manifest)
            broken["packages"][0]["download"][field] = value
            with self.subTest(field=field, value=value), self.assertRaises(ValueError):
                backup.validate_manifest(broken)
        broken = copy.deepcopy(manifest)
        broken["packages"].append(copy.deepcopy(broken["packages"][0]))
        with self.assertRaises(ValueError):
            backup.validate_manifest(broken)

    def test_repository_record_requires_exact_metadata_and_strong_hash(self):
        package = self.online_package()
        metadata = ("Package: example-lv2\nVersion: 1.2-3\nArchitecture: arm64\nSize: 7\n"
                    "Filename: pool/main/e/example-lv2_1.2-3_arm64.deb\nSHA256: " + package["download"]["sha256"] + "\n")
        uri = "'" + package["download"]["url"] + "' example-lv2.deb 7 MD5Sum:ignored\n"
        for body, expected in [(metadata, package["download"]), (metadata.replace("Version: 1.2-3", "Version: 1.2-4"), None),
                               (metadata.replace("SHA256:", "MD5sum:"), None)]:
            with self.subTest(expected=expected), patch.object(backup, "command", side_effect=[
                    subprocess.CompletedProcess([], 0, uri, ""), subprocess.CompletedProcess([], 0, body, "")]):
                self.assertEqual(backup.package_download_record(package), expected)

    def test_compact_backup_keeps_unavailable_packages_and_offline_keeps_all(self):
        packages = [self.online_package(), {"name": "private-lv2", "version": "1.0", "architecture": "arm64"}]
        packages[0].pop("download")
        for mode in ("online", "self-contained"):
            specs = copy.deepcopy(packages)
            with self.subTest(mode=mode), patch.object(backup, "package_download_record", side_effect=[self.online_package()["download"], None]) as records, patch.object(backup, "download_packages") as embed:
                backup.collect_package_sources(self.state, self.job, specs, mode)
                expected = specs[1:] if mode == "online" else specs
                embed.assert_called_once_with(self.state, self.job, expected)
                self.assertEqual(records.call_count, 2 if mode == "online" else 0)
                self.assertEqual("download" in specs[0], mode == "online")

    def test_download_rejects_corrupt_short_and_oversized_bytes(self):
        record = self.online_package()["download"]
        target = self.state / "download.deb"
        for payload in (b"package", b"packagE", b"short", b"toolong-package"):
            target.unlink(missing_ok=True)
            opener = Mock()
            opener.open.return_value = io.BytesIO(payload)
            with self.subTest(payload=payload), patch.object(backup.urllib.request, "build_opener", return_value=opener):
                if payload == b"package":
                    backup.fetch_recorded_package(record, target)
                    self.assertEqual(target.read_bytes(), payload)
                else:
                    with self.assertRaises(ValueError):
                        backup.fetch_recorded_package(record, target)
                    self.assertFalse(target.exists())
                self.assertFalse(target.with_suffix(".part").exists())

    def test_failed_plugin_download_never_stops_engine_or_replaces_rig(self):
        manifest = self.fixture({"data/banks/bank-new.json": self.bank("bank-new", ["preset-new"])}, ["banks", "plugins"])
        manifest.update(version=2, pluginMode="online", packages=[self.online_package()])
        backup.write_json(backup.job_dir(self.source) / "manifest.json", manifest)
        with patch.object(backup, "fetch_recorded_package", side_effect=OSError("offline")), patch.object(backup, "stopped_engine") as stop:
            with self.assertRaisesRegex(ValueError, "Rig data has not been replaced"):
                self.restore(["banks", "plugins"])
            stop.assert_not_called()
        self.assertTrue((self.data / "banks/bank-old.json").exists())
        self.assertFalse((self.data / "banks/bank-new.json").exists())

    def test_installed_exact_package_does_not_need_internet(self):
        with patch.object(backup, "command", return_value=subprocess.CompletedProcess([], 0, "installed\t1.2-3", "")), patch.object(backup, "fetch_recorded_package") as fetch:
            self.assertEqual(backup.prepare_package_files(self.job, backup.job_dir(self.source), [self.online_package()], "replace"), [])
            fetch.assert_not_called()

    def test_wrong_downloaded_package_identity_never_stops_engine(self):
        manifest = self.fixture({}, ["plugins"])
        manifest.update(version=2, pluginMode="online", packages=[self.online_package()])
        backup.write_json(backup.job_dir(self.source) / "manifest.json", manifest)
        def command(args, **kwargs):
            output = "Package: example-lv2\nVersion: 9.9\nArchitecture: arm64\n" if args[0] == "dpkg-deb" else ""
            return subprocess.CompletedProcess(args, 0, output, "")
        with patch.object(backup, "command", side_effect=command), patch.object(backup, "fetch_recorded_package"), patch.object(backup, "stopped_engine") as stop:
            with self.assertRaisesRegex(ValueError, "identity does not match"):
                self.restore(["plugins"])
            stop.assert_not_called()
        self.assertTrue((self.data / "banks/bank-old.json").exists())

    def test_replace_pins_plugin_version_while_keep_retains_newer(self):
        def command(args, **kwargs):
            output = ""
            if args[0] == "dpkg-query":
                output = "installed\t2.0"
            elif args[0] == "dpkg-deb":
                output = "Package: example-lv2\nVersion: 1.2-3\nArchitecture: arm64\n"
            return subprocess.CompletedProcess(args, 0, output, "")
        for mode, expected_downloads in [("replace", 1), ("keep", 0), ("copy", 0)]:
            with self.subTest(mode=mode), patch.object(backup, "command", side_effect=command), patch.object(backup, "fetch_recorded_package") as fetch:
                paths = backup.prepare_package_files(self.job, backup.job_dir(self.source), [self.online_package()], mode)
                self.assertEqual(len(paths), expected_downloads)
                self.assertEqual(fetch.call_count, expected_downloads)

    def test_individual_preset_includes_record_only_plugin_dependencies(self):
        manifest = self.fixture({"data/banks/bank-new.json": self.bank("bank-new", ["preset-new"])}, ["banks", "plugins"])
        manifest.update(version=2, pluginMode="online", packages=[self.online_package()])
        backup.write_json(backup.job_dir(self.source) / "manifest.json", manifest)
        rows = backup.selectable_files(backup.job_dir(self.source), manifest, "banks")
        token = next(row["path"] for row in rows if row.get("preset") == "preset-new")
        with patch.object(backup, "prepare_package_files", return_value=[]) as prepare:
            self.restore(["banks", "plugins"], files=[token])
            self.assertEqual(prepare.call_args.args[2], manifest["packages"])

    def test_encryption_crosses_record_boundary_and_rejects_wrong_password(self):
        source, encrypted, output = [self.state / name for name in ("raw", "encrypted", "output")]
        source.write_bytes(os.urandom(backup.BLOCK + 17))
        backup.crypt_file(source, encrypted, "test password", True)
        backup.crypt_file(encrypted, output, "test password", False)
        self.assertEqual(source.read_bytes(), output.read_bytes())
        with self.assertRaises(ValueError):
            backup.crypt_file(encrypted, output, "wrong password", False)

    def test_encryption_rejects_truncated_end_record(self):
        source, encrypted, output = [self.state / name for name in ("raw", "encrypted", "output")]
        source.write_bytes(b"saved rig")
        backup.crypt_file(source, encrypted, "test password", True)
        encrypted.write_bytes(encrypted.read_bytes()[:-20])
        with self.assertRaises(ValueError):
            backup.crypt_file(encrypted, output, "test password", False)

    def test_encryption_rejects_tampering(self):
        source, encrypted, output = [self.state / name for name in ("raw", "encrypted", "output")]
        source.write_bytes(b"saved rig" * 100)
        backup.crypt_file(source, encrypted, "test password", True)
        payload = bytearray(encrypted.read_bytes())
        payload[80] ^= 1
        encrypted.write_bytes(payload)
        with self.assertRaises(ValueError):
            backup.crypt_file(encrypted, output, "test password", False)

    def test_archive_create_and_verify_keeps_exact_model_bytes(self):
        model = self.data / "models/a.nam"
        model.parent.mkdir()
        model.write_bytes(b'{"weights":[1,2,3]}')
        backup.create_backup(self.job, {"categories": ["models"]})
        state = backup.read_json(backup.job_dir(self.job) / "status.json")
        self.assertFalse(state["result"]["exported"])
        output = backup.job_dir(self.job) / state["result"]["name"]
        shutil.copyfile(output, backup.job_dir(self.source) / "upload")
        manifest = backup.verified_archive(self.source, "")
        self.assertEqual(manifest["categories"], ["models"])
        self.assertEqual((backup.job_dir(self.source) / "verified/data/models/a.nam").read_bytes(), model.read_bytes())

    def test_archive_rejects_checksum_mismatch(self):
        manifest = self.fixture({"data/models/a.nam": b"original"}, ["models"])
        with zipfile.ZipFile(backup.job_dir(self.source) / "upload", "w") as archive:
            archive.writestr("manifest.json", json.dumps(manifest))
            archive.writestr("data/models/a.nam", b"modified")
        with self.assertRaises(ValueError):
            backup.verified_archive(self.source, "")

    def test_selective_banks_preserve_models_settings_and_old_exports(self):
        (self.data / "models").mkdir()
        (self.data / "models/keep.nam").write_bytes(b"keep")
        backup.write_json(self.data / "backups/old.json", {"keep": True})
        self.fixture({"data/banks/bank-new.json": self.bank("bank-new", ["preset-new"])}, ["banks"])
        self.restore(["banks"])
        self.assertEqual((self.data / "models/keep.nam").read_bytes(), b"keep")
        self.assertTrue((self.data / "backups/old.json").exists())
        self.assertEqual(backup.read_json(self.data / "settings.json")["audio"], self.settings["audio"])
        self.assertFalse((self.data / "banks/bank-old.json").exists())

    def test_settings_only_preserves_bank_selection_and_assignments(self):
        incoming = {**self.settings, "activeBankId": "foreign", "activePresetId": "foreign", "audio": {"sampleRate": 96000}, "controller": {}}
        self.fixture({"data/settings.json": incoming}, ["settings"])
        self.restore(["settings"])
        restored = backup.read_json(self.data / "settings.json")
        self.assertEqual(restored["activePresetId"], "preset-old")
        self.assertEqual(restored["controller"]["presetAssignments"], self.settings["controller"]["presetAssignments"])
        self.assertEqual(restored["audio"]["sampleRate"], 96000)

    def test_corrupt_staging_never_replaces_current_rig(self):
        self.fixture({"data/banks/bank-new.json": self.bank("bank-new", ["preset-new"])}, ["banks"])
        (backup.job_dir(self.source) / "verified/data/banks/bank-new.json").write_text("corrupt")
        with self.assertRaises(ValueError):
            self.restore(["banks"])
        self.assertTrue((self.data / "banks/bank-old.json").exists())

    def test_missing_model_never_replaces_current_rig(self):
        bank = self.bank("bank-new", ["preset-new"])
        bank["presets"][0]["chain"] = [{"state": {"properties": {"model": str(self.data / "models/missing.nam")}}}]
        self.fixture({"data/banks/bank-new.json": bank}, ["banks"])
        with self.assertRaisesRegex(ValueError, "missing referenced file"):
            self.restore(["banks"])
        self.assertTrue((self.data / "banks/bank-old.json").exists())

    def test_full_restore_preserves_intentional_empty_library(self):
        self.fixture({"data/settings.json": {**self.settings, "activeBankId": "", "activePresetId": ""}}, list(backup.CATEGORIES))
        self.restore(list(backup.CATEGORIES), full=True)
        self.assertEqual(list((self.data / "banks").glob("*.json")), [])
        self.assertEqual(backup.read_json(self.data / "settings.json")["activePresetId"], "")

    def test_copied_bank_has_new_identity_and_matching_storage_filename(self):
        self.fixture({"data/banks/bank-old.json": self.bank("bank-old", ["preset-old"])}, ["banks"])
        self.restore(["banks"], conflicts="copy")
        paths = list((self.data / "banks").glob("*.json"))
        self.assertEqual(len(paths), 2)
        for path in paths:
            self.assertEqual(path.stem, backup.read_json(path)["id"])
        presets = [bank["presets"][0]["id"] for bank in map(backup.read_json, paths)]
        self.assertEqual(len(set(presets)), 2)

    def test_individual_preset_restore_preserves_other_presets(self):
        backup.write_json(self.data / "banks/bank-old.json", self.bank("bank-old", ["preset-old", "keep-me"]))
        incoming = self.bank("bank-old", ["preset-old", "do-not-import"])
        incoming["presets"][0]["name"] = "restored name"
        manifest = self.fixture({"data/banks/bank-old.json": incoming}, ["banks"])
        rows = backup.selectable_files(backup.job_dir(self.source), manifest, "banks")
        token = next(row["path"] for row in rows if row.get("preset") == "preset-old")
        self.restore(["banks"], files=[token])
        presets = backup.read_json(self.data / "banks/bank-old.json")["presets"]
        self.assertEqual([p["id"] for p in presets], ["preset-old", "keep-me"])
        self.assertEqual(presets[0]["name"], "restored name")

    def test_legacy_restore_keeps_audio_and_banks(self):
        backup.import_legacy(self.source, {"contents": {"format": "pimfx-ui-backup", "version": 1, "ui": {"scale": 1.4}}})
        self.restore(["settings"])
        value = backup.read_json(self.data / "settings.json")
        self.assertEqual(value["audio"], self.settings["audio"])
        self.assertEqual(value["ui"]["scale"], 1.4)
        self.assertTrue((self.data / "banks/bank-old.json").exists())

    def test_rollback_recovers_previous_data_and_is_idempotent(self):
        self.fixture({"data/banks/bank-new.json": self.bank("bank-new", ["preset-new"])}, ["banks"])
        self.restore(["banks"])
        journal = backup.read_json(self.state / "restore-journal.json")
        backup.rollback(journal)
        backup.rollback(journal)
        self.assertTrue((self.data / "banks/bank-old.json").exists())
        self.assertFalse((self.data / "banks/bank-new.json").exists())

    def test_library_link_cannot_read_external_secrets(self):
        secret = self.state / "secret"
        secret.write_text("private")
        (self.data / "model-link").symlink_to(secret)
        with self.assertRaises(ValueError):
            list(backup.regular_files(self.data))


if __name__ == "__main__":
    unittest.main()
