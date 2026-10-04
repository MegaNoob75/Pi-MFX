export type TunerCourse = string[];
export type TuningPreset = { id: string; label: string; courses: TunerCourse[] };
export type InstrumentProfile = {
    id: string;
    label: string;
    family: "chromatic" | "guitar" | "bass";
    stringLabel: string;
    extendedRange?: boolean;
    presets: TuningPreset[];
};

const single = (...notes: string[]): TunerCourse[] => notes.map((note) => [note]);
const preset = (id: string, label: string, courses: TunerCourse[]): TuningPreset => ({ id, label, courses });

export const INSTRUMENTS: InstrumentProfile[] = [
    { id: "chromatic", label: "Chromatic", family: "chromatic", stringLabel: "Note", presets: [] },
    { id: "guitar6", label: "6-string guitar", family: "guitar", stringLabel: "String", presets: [
        preset("standard", "Standard", single("E2", "A2", "D3", "G3", "B3", "E4")),
        preset("dropD", "Drop D", single("D2", "A2", "D3", "G3", "B3", "E4")),
        preset("ebStandard", "Eb Standard", single("D#2", "G#2", "C#3", "F#3", "A#3", "D#4")),
        preset("dStandard", "D Standard", single("D2", "G2", "C3", "F3", "A3", "D4")),
        preset("dropC", "Drop C", single("C2", "G2", "C3", "F3", "A3", "D4")),
        preset("cStandard", "C Standard", single("C2", "F2", "A#2", "D#3", "G3", "C4")),
        preset("dadgad", "DADGAD", single("D2", "A2", "D3", "G3", "A3", "D4")),
        preset("openG", "Open G", single("D2", "G2", "D3", "G3", "B3", "D4")),
        preset("openD", "Open D", single("D2", "A2", "D3", "F#3", "A3", "D4")),
        preset("openE", "Open E", single("E2", "B2", "E3", "G#3", "B3", "E4")),
        preset("baritoneB", "Baritone B", single("B1", "E2", "A2", "D3", "F#3", "B3"))
    ]},
    { id: "guitar7", label: "7-string guitar", family: "guitar", stringLabel: "String", presets: [
        preset("standard7", "Standard", single("B1", "E2", "A2", "D3", "G3", "B3", "E4")),
        preset("dropA7", "Drop A", single("A1", "E2", "A2", "D3", "G3", "B3", "E4")),
        preset("eb7", "Half-step down", single("A#1", "D#2", "G#2", "C#3", "F#3", "A#3", "D#4")),
        preset("dStandard7", "D Standard", single("A1", "D2", "G2", "C3", "F3", "A3", "D4")),
        preset("dropG7", "Drop G", single("G1", "D2", "G2", "C3", "F3", "A3", "D4"))
    ]},
    { id: "guitar8", label: "8-string guitar", family: "guitar", stringLabel: "String", extendedRange: true, presets: [
        preset("standard8", "Standard", single("F#1", "B1", "E2", "A2", "D3", "G3", "B3", "E4")),
        preset("dropE8", "Drop E", single("E1", "B1", "E2", "A2", "D3", "G3", "B3", "E4")),
        preset("halfDown8", "Half-step down", single("F1", "A#1", "D#2", "G#2", "C#3", "F#3", "A#3", "D#4"))
    ]},
    { id: "guitar9", label: "9-string guitar", family: "guitar", stringLabel: "String", extendedRange: true, presets: [
        preset("standard9", "Standard", single("C#1", "F#1", "B1", "E2", "A2", "D3", "G3", "B3", "E4")),
        preset("dropB9", "Drop B", single("B0", "F#1", "B1", "E2", "A2", "D3", "G3", "B3", "E4"))
    ]},
    { id: "guitar12", label: "12-string guitar", family: "guitar", stringLabel: "Course", presets: [
        preset("standard12", "Standard", [["E2", "E3"], ["A2", "A3"], ["D3", "D4"], ["G3", "G4"], ["B3", "B3"], ["E4", "E4"]]),
        preset("dropD12", "Drop D", [["D2", "D3"], ["A2", "A3"], ["D3", "D4"], ["G3", "G4"], ["B3", "B3"], ["E4", "E4"]]),
        preset("halfDown12", "Half-step down", [["D#2", "D#3"], ["G#2", "G#3"], ["C#3", "C#4"], ["F#3", "F#4"], ["A#3", "A#3"], ["D#4", "D#4"]])
    ]},
    { id: "bass4", label: "4-string bass", family: "bass", stringLabel: "String", presets: [
        preset("bass4Standard", "Standard", single("E1", "A1", "D2", "G2")),
        preset("bass4DropD", "Drop D", single("D1", "A1", "D2", "G2")),
        preset("bass4Eb", "Eb Standard", single("D#1", "G#1", "C#2", "F#2")),
        preset("bass4D", "D Standard", single("D1", "G1", "C2", "F2")),
        preset("bass4Bead", "BEAD", single("B0", "E1", "A1", "D2"))
    ]},
    { id: "bass5", label: "5-string bass", family: "bass", stringLabel: "String", extendedRange: true, presets: [
        preset("bass5Standard", "Standard low B", single("B0", "E1", "A1", "D2", "G2")),
        preset("bass5HighC", "High C", single("E1", "A1", "D2", "G2", "C3")),
        preset("bass5DropA", "Drop A", single("A0", "E1", "A1", "D2", "G2")),
        preset("bass5HalfDown", "Half-step down", single("A#0", "D#1", "G#1", "C#2", "F#2"))
    ]},
    { id: "bass6", label: "6-string bass", family: "bass", stringLabel: "String", extendedRange: true, presets: [
        preset("bass6Standard", "Standard", single("B0", "E1", "A1", "D2", "G2", "C3")),
        preset("bass6DropA", "Drop A", single("A0", "E1", "A1", "D2", "G2", "C3")),
        preset("bass6FSharp", "Low F#", single("F#0", "B0", "E1", "A1", "D2", "G2"))
    ]},
    { id: "bass7", label: "7-string bass", family: "bass", stringLabel: "String", extendedRange: true, presets: [
        preset("bass7HighF", "Standard high F", single("B0", "E1", "A1", "D2", "G2", "C3", "F3")),
        preset("bass7LowFSharp", "Standard low F#", single("F#0", "B0", "E1", "A1", "D2", "G2", "C3")),
        preset("bass7DropE", "Drop E", single("E0", "B0", "E1", "A1", "D2", "G2", "C3"))
    ]},
    { id: "bass8", label: "8-string bass", family: "bass", stringLabel: "Course", presets: [
        preset("bass8Octave", "Octave courses", [["E1", "E2"], ["A1", "A2"], ["D2", "D3"], ["G2", "G3"]])
    ]}
];

export function instrumentById(id: string): InstrumentProfile {
    return INSTRUMENTS.find((item) => item.id === id) ?? INSTRUMENTS[0];
}

export function presetFor(profile: InstrumentProfile, id: string, custom: TuningPreset[] = []): TuningPreset | undefined {
    return [...profile.presets, ...custom].find((item) => item.id === id) ?? profile.presets[0] ?? custom[0];
}

export function isNoteName(value: string): boolean {
    return /^[A-G](?:#|b)?-?\d$/.test(value.trim());
}

export function normalizeNote(value: string): string {
    const note = value.trim();
    const match = /^([A-G])([#b]?)(-?\d)$/.exec(note);
    if (!match) return note;
    const base: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
    const names = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
    const midi = (Number(match[3]) + 1) * 12 + base[match[1]] + (match[2] === "#" ? 1 : match[2] === "b" ? -1 : 0);
    return `${names[((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}`;
}

export function noteMidi(note: string): number {
    const normalized = normalizeNote(note);
    const match = /^([A-G])(#?)(-?\d)$/.exec(normalized);
    if (!match) return 69;
    const base: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
    return (Number(match[3]) + 1) * 12 + base[match[1]] + (match[2] ? 1 : 0);
}

export function transposeNote(note: string, semitones: number): string {
    const midi = noteMidi(note) + semitones;
    const names = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
    return `${names[((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}`;
}

export function tuningSummary(preset: TuningPreset): string {
    return preset.courses.map((course) => course.join("/")).join(" ");
}
