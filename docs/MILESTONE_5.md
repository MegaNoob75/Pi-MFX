# Milestone 5 — Community preset catalog

Milestone 5 adds a feature-gated Community Presets view and a strict declarative
package boundary. Catalog activity is control-plane work and never enters
`Engine::processAudio()`.

## Device workflow

1. Opening Community Presets, or selecting its Catalog tab, fetches the fixed
   public catalog index over verified HTTPS. Offline use falls back to a visibly
   marked v2 cache.
2. The selected manifest path and SHA-256 must match the protected index.
3. The manifest is validated against strict size, count, field, URL, filename,
   compatibility, dependency, and checksum rules.
4. Pi-MFX displays every effect and asset requirement before making changes.
5. Missing effects can only use an approved `PluginStore` catalog identifier.
6. TONE3000 assets are resolved again by tone/model ID; package-supplied URLs
   are never used. Creator/source-license attribution is retained and the
   downloaded bytes must match the declared SHA-256.
7. NAM and cabinet IR dependencies must use TooB Neural Amp Modeler and TooB
   Cab IR. Assets without trusted TONE3000 provenance cannot be published.
8. Confirmation is tied to a short-lived installation-plan token.
9. The preset is imported into a new Community bank. If requirements remain,
   the bank is visibly marked `INCOMPLETE` and retains provenance metadata.

## Sharing

The Share Preset tab lists locally-created presets from every bank and excludes
presets installed from the Community catalog. Runtime snapshot selections and
local absolute paths are removed. TONE3000 downloads are recorded in a local
checksum-keyed provenance registry so tone/model IDs, architecture, creator,
source license, and expected filename can be added automatically. The manifest
license is always MIT and the default author is stored in Pi-owned UI settings.

Both the device and publishing guard reject a duplicate case-insensitive name
or a duplicate content fingerprint. The fingerprint covers the actual preset,
snapshots, assignments, LV2 URIs, settings, and dependencies while ignoring
display metadata, so renaming cannot bypass duplicate detection.

The public catalog never accepts direct device writes. Sharing downloads the
validated manifest locally and opens the catalog's GitHub submission form. The
contributor attaches that JSON file to a Preset submission; it remains outside the
catalog while GitHub validates it as untrusted data. A maintainer with repository
write access must apply the `approved-for-pr` label before automation creates an
isolated pull request with the manifest, index entry, and checksum. The catalog
checks must pass and a human must merge the pull request. Merging closes the
Preset submission and deletes its temporary branch. This submission -> approval
label -> pull request -> human merge path is the free quarantine boundary, and
no GitHub credential belongs on a Pi.

## Validation

- `pimfx_community_package_test` exercises the native package boundary.
- `ui/tests/communityPresetCatalog.test.cjs` protects the gate, plan, token,
  incomplete-import, and unsafe-content paths.
- `ui/tests/menuNavigation.test.cjs` includes Community Presets in shared menu
  and shortcut navigation.
- Raspberry Pi sign-off still requires option 0 validation of catalog refresh,
  install planning, TONE3000 authentication/download, touch layout, offline
  cache behavior, ordinary preset use, CPU load, and XRuns.
