# LV2 plugins, NAM models, and impulse responses

Pi-MFX is a **host**. The effects you actually hear are LV2 plugins, NAM
captures, and impulse responses that you install. They are separate works with
their own licenses. This page explains the boundary and what it means for you.

## Pi-MFX ships no plugins

There are no plugin binaries in this repository and none in any Pi-MFX release
artifact. After install, **Plugins → Install** can run `apt` for well-known
plugin packages, install recommended Raspberry Pi `.deb` packs such as
[ToobAmp](https://github.com/rerdavies/ToobAmp) and
[Guitarix LV2](https://github.com/brummer10/GxPlugins.lv2), and download LV2
builds from PatchStorage — but that installs them onto your Pi under their own
licenses,
exactly as if you had typed the command yourself. Skip that and Pi-MFX still
runs; the chain simply starts empty.

## Why hosting a GPL plugin is fine

Pi-MFX loads plugins at runtime through the LV2 ABI: `dlopen`, read the
descriptor, call `instantiate()` and `run()`. Plugin code is never compiled into
Pi-MFX and Pi-MFX code is never compiled into a plugin. This is the same
arrangement every LV2 host uses, and it is why an MIT-licensed host can load a
GPL-licensed plugin. What Pi-MFX must not do — and does not do — is copy plugin
source into the engine or redistribute plugin binaries as part of itself.

If you build a distribution image that bundles GPL plugins alongside Pi-MFX,
that is your redistribution: you must then honour those plugins' licenses,
including offering their source.

## Where Pi-MFX looks for plugins

Standard LV2 search paths, plus anything in `LV2_PATH`, plus user bundles in
`/var/lib/pimfx/lv2` (PatchStorage installs land here):

```
/var/lib/pimfx/lv2
~/.lv2
/usr/lib/lv2
/usr/local/lib/lv2
/usr/lib/aarch64-linux-gnu/lv2
```

Anything lilv can see, Pi-MFX can list.

## PatchStorage

The Plugins page can search [PatchStorage](https://patchstorage.com) for LV2
plugins with an `rpi-aarch64` build and extract a bundle you asked for into
`/var/lib/pimfx/lv2`. Pi-MFX does not vendor those files in git. Each plugin
keeps the license its author published on PatchStorage.

## Plugins commonly used with Pi-MFX

Named for your convenience. Verify the license of whatever you install; these
are the licenses at the time of writing and they can change.

| Plugin set | Typical use | License |
| --- | --- | --- |
| Neural Amp Modeler LV2 | Amp captures (`.nam`) | Usually MIT or GPL depending on the port |
| Aidadsp / RTNeural LV2 | Neural captures | Check the specific port |
| Convolution / IR loaders | Cabinet impulse responses | Usually GPL |
| ToobAmp | Raspberry Pi guitar pack (NAM, cab, delay, EQ, …) | See [rerdavies/ToobAmp](https://github.com/rerdavies/ToobAmp) |
| Calf Studio Gear | Modulation, dynamics, EQ | LGPL-2.1+ |
| GxPlugins.lv2, Guitarix | Amps, drives, cabinets | GPL-2.0+ |
| ZamPlugins | Compressors, EQ, gates | GPL-2.0+ |
| x42-plugins | Utilities, meters | GPL-2.0+ |
| swh-plugins, TAP, Invada | Classic effects | GPL-2.0+ |

## NAM captures

`.nam` files are trained captures of real amplifiers. Each one is authored by a
person and carries whatever license that person chose. Pi-MFX ships none, and
downloading one through the TONE3000 browser does not change its license or
transfer any rights to you beyond what the author granted. Commercial use of a
capture is between you and its author.

Pi-MFX contains no NAM DSP code. Credit for the format and the ecosystem goes to
Steven Atkinson and the Neural Amp Modeler community.

## Impulse responses

Same rule. IRs you load are yours or licensed to you; Pi-MFX bundles none.
Many commercial IR packs forbid redistribution — keep that in mind before
sharing a preset bundle that embeds IR files rather than referencing them.

## Presets

Pi-MFX presets are plain JSON: a plugin URI, port values, and **paths** to model
and IR files. Sharing a preset shares your settings, not the models. If you
export a bundle with the "include referenced files" option, you are
redistributing those files and are responsible for having the right to do so —
the export dialog says so before it writes the archive.

## Reporting a licensing problem

If you believe Pi-MFX ships something it should not, or credits something
incorrectly, open an issue. Licensing mistakes are treated as bugs and fixed
rather than argued about.
