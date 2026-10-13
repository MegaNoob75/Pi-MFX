export type CabinetRange = { index: number; min: number; max: number };

export function blendRange(cabinets: CabinetRange[], weights: number[]) {
    return {
        min: cabinets.length ? Math.min(...cabinets.map((c, i) => weights[i] > 0 ? c.min - 20 * Math.log10(weights[i]) : Infinity)) : -40,
        max: cabinets.length ? Math.min(...cabinets.map((c, i) => weights[i] > 0 ? c.max - 20 * Math.log10(weights[i]) : Infinity)) : 20
    };
}

export function blendLevels(cabinets: CabinetRange[], weights: number[], amplitude: number, previous: number[]) {
    const scale = Math.min(amplitude, 10 ** (blendRange(cabinets, weights).max / 20));
    const values = [...previous];
    cabinets.forEach((c, i) => {
        values[c.index] = weights[i] <= 0 || scale === 0 ? c.min : Math.max(c.min, 20 * Math.log10(scale * weights[i]));
    });
    return { values, amplitude: scale };
}
