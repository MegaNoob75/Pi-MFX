import type { Plugin } from "vite";
export function userGuidePlugin(): Plugin;
export function renderGuide(markdown: string): string;
export function headingId(text: string): string;
