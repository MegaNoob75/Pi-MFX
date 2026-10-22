# Theme settings: ownership and Pi validation

Source review: 2026-10-20. No Windows build, automated tests or Pi runtime tests were run for this review. This document describes the intended wiring and the device checks still required.

## One home for each setting

The visible tab names changed; stored session tab IDs and existing theme fields remain compatible.

| Tab | Settings and effect |
| --- | --- |
| Base palette | App background, panel bases, primary/secondary text, default borders and warnings; navigation accent/background/text; selection accent/background/text; icon colors; shortcut and menu-edit button colors. Palette-linked appearance fields follow these defaults. Explicit appearance overrides stay independent. Generated navigation/selection text may be adjusted for contrast. |
| App panels | Page, header, panel/analog card, dialog/enlarged control, notice/parameter feedback, and main menu backgrounds and borders. Text, secondary labels, highlights and shadows apply to the named area. Page highlight is hidden because it has no runtime consumer. |
| Tile colors | Inactive and active backgrounds, borders, control/hold labels, action names, indicators and shadows, separately for preset, bank navigation, utility, snapshot and bypass functions. Modified-preset light and controller idle LED color are here too. The delete target exposes its actual background/border and the separate controller warning LED color. |
| Control style | Switch, knob/slider and indicator appearance; tile shape; border width; corner radius; glow strength; unassigned analog-card opacity; glass highlight strength. Corner radius applies to rounded switches and analog cards; square/pill switches retain their selected shape. |
| Animation | Enable animations, device reduced-motion preference, active indicator animation and cycle time, parameter feedback message timeout. Animation choices depend on the switch/indicator style. Cycle time is shown only for a running animation. |
| Text & fonts | App interface, headings, field/status labels and values; switch labels/action names; analog control labels/functions/values; parameter feedback text. Enlarged-control size multiplies the analog text settings only in the enlarged control. Auto-fit status widgets fit text to their space rather than obeying a fixed font size. |
| Keyboard | One home for keyboard theme selection, editing and behavior. The left list uses the same grouped theme rows, badges and swatches as app themes. Choose Match app theme, a built-in, an app-derived custom theme or a saved keyboard theme. The right pane contains colors, key shape/text size, overlay size/placement, transparency, opening mode and touch vibration. APPLY KEYBOARD saves preferences; edited colors are saved as a custom keyboard theme when applied. SAVE CUSTOM saves reusable colors without changing behavior preferences. |

### Removed overlaps and ineffective controls

- Function light colors are edited in Tile colors, not again under Control style. On-screen inactive lights are per-function; the controller idle LED setting is separate and does not overwrite them.
- Indicator animation and its speed live together in Animation.
- Delete-target fields that have no consumer (text, shadow, active background/border) are hidden. Its warning LED setting remains available for controller actions such as recording.
- Glass backdrop blur is hidden: the current paint format uses opaque colors, so backdrop blur cannot show through. The saved field is retained for compatibility.
- Page highlight has no consumer and is hidden. The page shadow editor is also hidden because an outside shadow on the full-screen app is clipped at the viewport. Other highlight/shadow fields affect their named area, including main-menu brand text.
- Glass uses the function's tile shadow. Minimal respects the function's background and shadow. These styles no longer silently replace those settings.
- Shadows offer Off, Light, Medium, Deep and Custom. Invalid custom CSS shows an error and is rejected on save. A shadow of `none` renders as a transparent zero-size shadow so combining it with other shadows remains valid.

## Pi 5 acceptance checklist

Use a copy of a theme and avoid overwriting a theme you need while checking.

1. Check the seven tabs at the physical display size. Names and field labels should wrap without being cut off. Each editor should scroll independently.
2. For every palette group, change one color and inspect the named area. Set an explicit App panels or Tile colors override, then change the base palette: the override must survive.
3. In App panels, check every exposed background, border (solid and gradients), primary text, secondary label, highlight and shadow setting. Inspect an actual dialog, main menu, analog card, enlarged control and parameter feedback message.
4. Check inactive and active colors for each tile function on the live Performance screen. Exercise bypass, snapshot, bank navigation, utility actions and a modified preset. Check tile and physical controller LED colors separately after SET THEME.
5. Drag a preset over the delete target and inspect its background/border. Check controller warning colors on configured warning/recording actions.
6. Try every switch appearance, each supported tile shape, and every knob/slider appearance. Change border width, corner radius, glow, unassigned-card opacity and glass highlight. Use both assigned and unassigned controls and small/large tiles.
7. Try each offered indicator animation. Confirm Off, animation disable and reduced-motion preference suppress motion. Confirm cycle time changes speed and message timeout changes parameter feedback duration.
8. Change each font family and size on the real UI, including headers, bank/preset names, field labels, switch labels/action names, analog labels/functions/values, enlarged controls and parameter feedback. Confirm auto-fit widgets remain legible and inside their bounds.
9. In Themes > Keyboard, select each theme source from the left list; the app theme must stay unchanged. Edit every keyboard paint/color, change tabs and return: retain the draft. Apply and open the real keyboard. Check normal/pressed keys, text selection, labels, Done and Cancel. Check key shape/text size, full/large/compact size, top/center/bottom placement, transparency, opening mode and touch vibration. COPY UI THEME should explicitly replace the color draft. Restoring defaults should restore Auto mode and Match app theme in the draft; APPLY KEYBOARD commits it.
10. Save custom, SET THEME, REVERT, export/import, restart, and inspect a second connected screen. REVERT restores the saved active UI theme; keyboard themes have their own save/library controls.
11. Preview representative built-in Modern, Studio, Metal, Glass, Arcade and Minimal themes plus existing custom themes. Confirm their saved values survive and compare editor previews against Performance.
12. Check letters, symbols and numeric entry at all three keyboard sizes. Character keys must have equal width across short/long rows and layers; letter/number key heights must match. Shift, Backspace, layer switch, Space, Cancel and Done must be larger. Confirm numeric/symbol Backspace remains accessible and every key inserts or performs the correct action.
13. Restart and connect a second screen. Applied keyboard settings and custom themes should persist/synchronize. Old shared sessions pointing to the former Keyboard Settings route should open the consolidated Keyboard tab; no separate Keyboard Settings card should remain.
