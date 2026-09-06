export type KeyboardLayout = "text" | "numeric";
export type KeyboardLayer = "letters" | "symbols";

export const LETTER_ROWS = [
    ["q", "w", "e", "r", "t", "y", "u", "i", "o", "p"],
    ["a", "s", "d", "f", "g", "h", "j", "k", "l"],
    ["z", "x", "c", "v", "b", "n", "m"]
] as const;

export const SYMBOL_ROWS = [
    ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"],
    ["!", "@", "#", "$", "%", "&", "*", "(", ")"],
    ["-", "_", "+", "=", "/", "\\", ".", ",", ":", ";"],
    ["'", "\"", "?", "<", ">", "[", "]", "{", "}"]
] as const;

export const NUMERIC_ROWS = [
    ["1", "2", "3"],
    ["4", "5", "6"],
    ["7", "8", "9"],
    ["-", "0", "."]
] as const;
