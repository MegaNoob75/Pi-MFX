export type Json =
    | null
    | boolean
    | number
    | string
    | Json[]
    | { [key: string]: Json };

export type JsonObject = { [key: string]: Json };

export function isObj(value: Json | undefined): value is JsonObject {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function obj(value: Json | undefined): JsonObject {
    return isObj(value) ? value : {};
}

export function arr(value: Json | undefined): Json[] {
    return Array.isArray(value) ? value : [];
}

export function str(value: Json | undefined, fallback = ""): string {
    return typeof value === "string" ? value : fallback;
}

export function num(value: Json | undefined, fallback = 0): number {
    return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export function bool(value: Json | undefined, fallback = false): boolean {
    return typeof value === "boolean" ? value : fallback;
}

export function objects(value: Json | undefined): JsonObject[] {
    return arr(value).filter(isObj);
}
