# Documentation index

The current feature set is being stabilized for Pi-MFX 1.0.0. Documentation
describes the implementation; it does not certify device behavior. Start with
[1.0 readiness](V1_READINESS.md) for repair status and the pending Pi 5 checklist.

| Document | Purpose |
| --- | --- |
| [User guide](USER_GUIDE.md) | Current screens, routing/mixers, live drafts, and Save/Reload |
| [Features](FEATURES.md) | Implemented feature scope and availability boundaries |
| [Install](INSTALL.md) | Pi setup, kiosk, hotspot, updates, and data preservation |
| [Remote access](REMOTE_ACCESS.md) | Password setup, remembered browsers, and recovery |
| [Development](DEV_FLOW.md) | Windows editing and maintainer-run Pi builds/tests |
| [Technical](TECHNICAL.md) | Data paths/formats, ownership, thread and persistence contracts |
| [Low latency](LOW_LATENCY.md) | Driver estimates, limiter lookahead, DSP/CPU metrics, tuning |
| [DIY controller](DIY_CONTROLLER.md) | Firmware 1.1 wiring/flash workflow and device checks |
| [Controller protocol](CONTROLLER_PROTOCOL.md) | MIDI/SysEx identity, controls, and LEDs |
| [Screenshots](SCREENSHOTS.md) | Fixture gallery; image freshness not checked in this review |
| [Roadmap](ROADMAP.md) | 1.0 stabilization priority and deferred feature work |
| [Community Presets](COMMUNITY_PRESETS.md) | Catalog, dependencies, sharing, and publishing |
| [Routing validation](ROUTING_VALIDATION.md) | Current routing/mixer regression checklist |
| [Third-party](THIRD_PARTY.md) | Dependency inventory and pending packaging review |
| [Plugin licenses](PLUGIN_LICENSES.md) | Installed plugin/assets and export boundaries |

All documented features belong to `dev`. Record the exact build and fresh
observations in the readiness checklist. Repository notices
are in [NOTICE.md](../NOTICE.md); dependency texts/notes are indexed in
[licenses](../licenses/README.md). Screenshot regeneration and GitHub workflow
inspection remain outside this review because those paths are excluded.
