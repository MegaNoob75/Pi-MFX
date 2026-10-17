"""Pi-only host regression checks; no downloads, services, MIDI or flashing.
Run: python3 -B -m unittest discover -s scripts/tests -p test_controller_firmware.py
"""
import importlib.util
import contextlib
import io
from pathlib import Path
import subprocess
import tempfile
import threading
import unittest
from unittest.mock import Mock, patch

spec = importlib.util.spec_from_file_location("controller_firmware", Path(__file__).parents[1] / "controller_firmware.py")
fw = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fw)


class FirmwareTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.image = self.root / "app.bin"
        self.image.write_bytes(bytes([0xE9]) + bytes(range(256)))
        self.info = {"capacity": 2048, "busy": False}

    def test_binary_roundtrip_and_usb_packet_limit(self):
        original = bytes(range(256))
        for start in range(0, len(original), 42):
            chunk = original[start:start + 42]
            encoded = fw.pack(chunk)
            self.assertLessEqual(12 + len(encoded), 64)
            self.assertTrue(all(v < 128 for v in encoded))
            decoded = []
            for offset in range(0, len(encoded), 8):
                group = encoded[offset:offset + 8]
                decoded.extend(v | (((group[0] >> i) & 1) << 7) for i, v in enumerate(group[1:]))
            self.assertEqual(bytes(decoded), chunk)

    def test_receiver_query_uses_connected_not_virtual_ports(self):
        backend = Mock()
        def open_port(name, **options):
            self.assertNotIn("client_name", options)  # RtMidi turns this into a virtual port.
            self.assertFalse(options.get("virtual"))
            port = Mock()
            def reply(message):
                payload = (1, 1, 2, 1, *fw.number(1966080), *b"012345ABCDEF", 0)
                options["callback"](Mock(type="sysex", data=(*fw.PREFIX, fw.INFO, *message.data[4:6], *payload)))
            port.send.side_effect = reply
            return port
        backend.open_ioport.side_effect = open_port
        backend.Message.side_effect = lambda kind, data: Mock(type=kind, data=data)
        link = fw.Link(backend, "ESP32 28:0")
        try:
            info = link.info()
        finally:
            link.close()
        self.assertEqual(info["version"], (2, 1))
        self.assertEqual(info["capacity"], 1966080)

    def test_discovery_excludes_engine_and_virtual_ports(self):
        backend = Mock()
        backend.get_ioport_names.return_value = ["ESP32 28:0", "Pi-MFX:controller 128:0", "Midi Through 14:0"]
        with patch.object(fw, "raw_port", side_effect=lambda name: "hw:3,0,0" if name.startswith("ESP32") else ""):
            self.assertEqual(fw.candidates(backend), ["ESP32 28:0"])

    def test_build_output_streams_before_exit_and_keeps_failure_log(self):
        for failed in (False, True):
            with self.subTest(failed=failed):
                seen = threading.Event()
                class Console(io.StringIO):
                    def write(self, text):
                        count = super().write(text)
                        if "downloading tools" in text: seen.set()
                        return count
                console = Console()
                log_path = self.root / "build.log"
                log_path.write_text("previous status\n")
                def run(command, **options):
                    options["stdout"].write("downloading tools\n")
                    options["stdout"].flush()
                    self.assertTrue(seen.wait(2), "build output was withheld until process exit")
                    options["stdout"].write("build failed\n" if failed else "build complete\n")
                    options["stdout"].flush()
                    if failed: raise subprocess.CalledProcessError(1, command)
                with contextlib.redirect_stdout(console), patch.object(fw.subprocess, "run", side_effect=run):
                    if failed:
                        with self.assertRaisesRegex(RuntimeError, "build failed"):
                            fw.run_logged_build(["fake-build"], log_path)
                    else:
                        fw.run_logged_build(["fake-build"], log_path)
                expected = "build failed" if failed else "build complete"
                self.assertIn(expected, console.getvalue())
                self.assertNotIn("previous status", console.getvalue())
                self.assertIn(expected, log_path.read_text())

    def test_bad_image_or_capacity_never_starts_flash(self):
        link = Mock()
        for blob, capacity in [(b"not firmware", 2048), (b"", 2048), (b"\xe9" * 100, 99)]:
            self.image.write_bytes(blob)
            with self.assertRaises(RuntimeError):
                fw.transfer(link, self.image, {"capacity": capacity, "busy": False}, (2, 1), Mock())
        link.exchange.assert_not_called()

    def test_hardware_setup_blocks_flash(self):
        link = Mock()
        with self.assertRaisesRegex(RuntimeError, "Hardware Setup"):
            fw.transfer(link, self.image, {**self.info, "busy": True}, (2, 1), Mock())
        link.exchange.assert_not_called()

    def test_transfer_failure_aborts_and_never_finishes(self):
        link = Mock()
        def exchange(command, *args, **kwargs):
            if command == fw.DATA:
                raise TimeoutError("connection lost")
        link.exchange.side_effect = exchange
        with self.assertRaises(TimeoutError):
            fw.transfer(link, self.image, self.info, (2, 1), Mock())
        link.send.assert_called_once_with(fw.ABORT)
        self.assertNotIn(fw.FINISH, [call.args[0] for call in link.exchange.call_args_list])

    def test_final_ack_loss_requires_external_readback(self):
        link = Mock()
        link.exchange.side_effect = lambda command, *a, **kw: (_ for _ in ()).throw(TimeoutError()) if command == fw.FINISH else None
        report = Mock()
        fw.transfer(link, self.image, self.info, (2, 1), report)
        self.assertNotIn("current", [call.args[0] for call in report.call_args_list])

    def test_disconnected_controller_stays_pending_without_build(self):
        with patch.object(fw, "target_version", return_value=(2, 1)), \
             patch.object(fw, "midi_backend", return_value=Mock()), \
             patch.object(fw, "candidates", return_value=[]), \
             patch.object(fw.subprocess, "run") as run:
            fw.perform("unused", self.root, "unused")
        self.assertEqual(fw.read_json(self.root / "controller-firmware-status.json")["state"], "pending")
        run.assert_not_called()

    def test_pending_retry_keeps_selected_firmware_source(self):
        selected = str(self.root / "controller-source")
        fw.atomic_json(self.root / "controller-firmware-policy.json",
                       {"enabled": True, "sourceRepo": selected})
        manager = fw.Manager(lambda: "app-checkout", self.root, "pimfx", busy=lambda: False)
        with patch.object(fw, "update_locked", return_value=False), \
             patch.object(fw.subprocess, "Popen") as launch:
            manager.start(arm=True)
        command = launch.call_args.args[0]
        self.assertEqual(command[command.index("--repo") + 1], selected)
        self.assertEqual(fw.read_json(self.root / "controller-firmware-policy.json")["sourceRepo"], selected)

    def raw_controller(self):
        fw.atomic_json(self.root / "settings.json", {"controller": {"midiPort": "hw:3,0,0"}})
        return {"connected": True, "activePort": "hw:3,0,0",
                "ports": [{"id": "seq:28:0", "input": True, "output": True}]}

    def test_raw_controller_moves_to_matching_shared_port(self):
        ports = self.raw_controller()
        with patch.object(fw, "raw_port", return_value="hw:3,0,0"), \
             patch.object(fw, "engine_request", side_effect=[ports, {"controller": {}}, {}]) as request:
            fw.share_controller_port(self.root, ["ESP32 28:0"], Mock())
        request.assert_called_with("controller/connect", {"port": "seq:28:0"})

    def test_other_raw_controller_is_not_changed(self):
        self.raw_controller()
        with patch.object(fw, "raw_port", return_value="hw:4,0,0"), \
             patch.object(fw, "engine_request") as request:
            fw.share_controller_port(self.root, ["ESP32 28:0"], Mock())
        request.assert_not_called()

    def test_hardware_setup_prevents_connection_change(self):
        ports = self.raw_controller()
        state = {"controller": {"boardSetup": {"phase": "review"}}}
        with patch.object(fw, "raw_port", return_value="hw:3,0,0"), \
             patch.object(fw, "engine_request", side_effect=[ports, state]) as request:
            with self.assertRaisesRegex(RuntimeError, "Hardware Setup"):
                fw.share_controller_port(self.root, ["ESP32 28:0"], Mock())
        self.assertEqual(request.call_count, 2)

    def test_failed_shared_connection_restores_raw_port(self):
        ports = self.raw_controller()
        with patch.object(fw, "raw_port", return_value="hw:3,0,0"), \
             patch.object(fw, "engine_request", side_effect=[ports, {"controller": {}}, RuntimeError("connect failed"), {}]) as request:
            with self.assertRaisesRegex(RuntimeError, "connect failed"):
                fw.share_controller_port(self.root, ["ESP32 28:0"], Mock())
        request.assert_called_with("controller/connect", {"port": "hw:3,0,0"})

    def test_bundled_version_is_read_from_source_not_old_status(self):
        fw.atomic_json(self.root / "controller-firmware-status.json", {"state": "pending", "targetVersion": "1.1"})
        manager = fw.Manager(lambda: "app-checkout", self.root, "pimfx")
        with patch.object(fw, "target_version", return_value=(2, 2)):
            status = manager.status()
        self.assertEqual(status["bundledVersion"], "2.2")
        self.assertEqual(status["targetVersion"], "1.1")

    def test_newer_installed_version_is_never_downgraded(self):
        link = Mock()
        link.info.return_value = {"version": (3, 0)}
        with patch.object(fw, "target_version", return_value=(2, 1)), \
             patch.object(fw, "midi_backend", return_value=Mock()), \
             patch.object(fw, "candidates", return_value=["ESP32 24:0"]), \
             patch.object(fw, "Link", return_value=link), \
             patch.object(fw.subprocess, "run") as run:
            fw.perform("unused", self.root, "unused")
        run.assert_not_called()
        self.assertEqual(fw.read_json(self.root / "controller-firmware-status.json")["installedVersion"], "3.0")

    def test_failed_build_never_opens_transfer(self):
        link = Mock()
        link.info.return_value = {"version": (2, 0), "capacity": 2048, "deviceId": "000000000001"}
        import pwd
        with patch.object(fw, "target_version", return_value=(2, 1)), \
             patch.object(fw, "midi_backend", return_value=Mock()), \
             patch.object(fw, "candidates", return_value=["ESP32 24:0"]), \
             patch.object(fw, "raw_port", return_value="hw:1,0,0"), \
             patch.object(fw, "Link", return_value=link), \
             patch.object(pwd, "getpwnam", return_value=Mock(pw_uid=1000, pw_gid=1000)), \
             patch.object(fw.os, "chown"), \
             patch.object(fw.subprocess, "run", side_effect=RuntimeError("compile failed")), \
             patch.object(fw, "transfer") as transfer:
            with self.assertRaisesRegex(RuntimeError, "compile failed"):
                fw.perform("unused", self.root, "unused")
        transfer.assert_not_called()
        self.assertEqual(fw.read_json(self.root / "controller-firmware-status.json")["state"], "failed")


if __name__ == "__main__":
    unittest.main()
