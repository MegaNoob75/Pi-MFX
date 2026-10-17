"""Pi host checks with mocked tools/devices; no compilation or USB writes.
Run: python3 -B -m unittest discover -s scripts/tests -p test_controller_first_install.py
"""
import contextlib
import importlib.util
import json
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch


def load(name, filename):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).parents[1] / filename)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


fw = load("first_install_firmware", "controller_firmware.py")
ports = load("first_install_ports", "controller_ports.py")


class FirstInstallTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.recipe = json.loads((Path(__file__).parents[2] / "firmware/controller-build.json").read_text())

    def test_auto_selects_only_a_single_native_download_port(self):
        native = SimpleNamespace(device="/dev/ttyACM0", description="Espressif", serial_number="123", vid=0x303A, pid=0x1001)
        generic = SimpleNamespace(device="/dev/ttyUSB0", description="USB Serial", serial_number=None, vid=0x10C4, pid=0xEA60)
        other = SimpleNamespace(device="/dev/ttyACM1", description="Espressif", serial_number="456", vid=0x303A, pid=0x1001)
        self.assertEqual(ports.discover([native, generic])["suggested"], native.device)
        self.assertEqual(ports.discover([native, other])["suggested"], "")
        self.assertEqual(ports.discover([generic])["suggested"], "")
        self.assertEqual(ports.discover([])["suggested"], "")

    def test_rejects_non_usb_or_non_character_ports(self):
        with self.assertRaises(ValueError):
            fw.first_install_port(str(self.root))

    def test_rejects_unsupported_chip_and_partition_recipe(self):
        for replacement in ("esp32:esp32:esp32:PartitionScheme=min_spiffs,FlashSize=4M",
                            "esp32:esp32:esp32s3:PartitionScheme=no_ota,FlashSize=4M",
                            "esp32:esp32:esp32s3:PartitionScheme=min_spiffs,FlashSize=4M,EraseFlash=all"):
            with self.assertRaises(ValueError):
                fw.first_install_recipe({**self.recipe, "fqbn": replacement})

    def build_fixture(self, fail_compile=False, omit_bootloader=False, changed_port=False):
        cache = self.root / "cache"
        cache.mkdir()
        (cache / ("arduino-cli-" + self.recipe["arduinoCli"])).touch()
        fw.atomic_json(cache / "dependencies.json", self.recipe)
        output = cache / "output"
        output.mkdir()
        for suffix in ("bin", "partitions.bin", "bootloader.bin"):
            if not (omit_bootloader and suffix == "bootloader.bin"):
                (output / ("PiMFX_Controller.ino." + suffix)).write_bytes(b"test")
        port = self.root / "port"
        port.touch()
        other_port = self.root / "other-port"
        other_port.touch()
        def command(args, **kwargs):
            if fail_compile and "compile" in args:
                raise RuntimeError("compile failed")
        with patch.object(fw.os, "geteuid", return_value=1000), \
             patch.object(fw, "first_install_port", side_effect=[port, other_port if changed_port else port]), \
             patch.object(fw, "build_recipe", return_value=self.recipe), \
             patch.object(fw.subprocess, "run", side_effect=command) as run:
            try:
                fw.build(self.root, cache, "/dev/ttyACM0")
            except RuntimeError:
                return run.call_args_list, False
        return run.call_args_list, True

    def test_compile_failure_never_uploads_stale_images(self):
        calls, success = self.build_fixture(fail_compile=True)
        self.assertFalse(success)
        self.assertFalse(any("upload" in call.args[0] for call in calls))

    def test_missing_bootloader_never_uploads(self):
        calls, success = self.build_fixture(omit_bootloader=True)
        self.assertFalse(success)
        self.assertFalse(any("upload" in call.args[0] for call in calls))

    def test_changed_usb_device_never_uploads(self):
        calls, success = self.build_fixture(changed_port=True)
        self.assertFalse(success)
        self.assertFalse(any("upload" in call.args[0] for call in calls))

    def test_initial_upload_uses_full_build_directory_and_verification(self):
        calls, success = self.build_fixture()
        self.assertTrue(success)
        upload = [call.args[0] for call in calls if "upload" in call.args[0]][0]
        self.assertIn("--input-dir", upload)
        self.assertIn("--verify", upload)
        self.assertNotIn("--input-file", upload)

    def verify_fixture(self, device_id, version=(1, 1), capacity=1024):
        import pwd
        def build(command, log_path):
            log_path.write_text("MAC: 11:22:33:44:55:66\n")
        link = Mock()
        link.info.return_value = {"deviceId": device_id, "version": version, "capacity": capacity}
        with patch.object(fw, "target_version", return_value=(1, 1)), \
             patch.object(fw, "build_recipe", return_value=self.recipe), \
             patch.object(fw, "first_install_port"), \
             patch.object(fw, "engine_request", return_value={"controller": {}}), \
             patch.object(pwd, "getpwnam", return_value=SimpleNamespace(pw_uid=1000, pw_gid=1000)), \
             patch.object(fw.os, "chown"), \
             patch.object(fw, "readable_build_source", return_value=contextlib.nullcontext(self.root)), \
             patch.object(fw, "run_logged_build", side_effect=build), \
             patch.object(fw, "midi_backend"), patch.object(fw, "candidates", return_value=["ESP32 24:0"]), \
             patch.object(fw, "share_controller_port"), patch.object(fw, "Link", return_value=link), \
             patch.object(fw.time, "monotonic", side_effect=[0, 0, 61]), patch.object(fw.time, "sleep"):
            fw.first_install(self.root, self.root, "pimfx", "/dev/ttyACM0")

    def test_midi_verification_requires_the_flashed_chip(self):
        with self.assertRaisesRegex(RuntimeError, "expected identity"):
            self.verify_fixture("AABBCCDDEEFF")
        self.assertEqual(fw.read_json(self.root / "controller-firmware-status.json")["state"], "failed")

    def test_matching_identity_version_and_ota_slot_complete_install(self):
        self.verify_fixture("665544332211")
        self.assertEqual(fw.read_json(self.root / "controller-firmware-status.json")["state"], "current")

    def test_wrong_version_or_missing_ota_slot_cannot_report_success(self):
        for options in ({"version": (0, 9)}, {"capacity": 0}):
            with self.assertRaisesRegex(RuntimeError, "expected identity"):
                self.verify_fixture("665544332211", **options)
            self.assertEqual(fw.read_json(self.root / "controller-firmware-status.json")["state"], "failed")


if __name__ == "__main__":
    unittest.main()
