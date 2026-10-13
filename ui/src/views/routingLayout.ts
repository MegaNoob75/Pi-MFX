type Point = { x: number; y: number };
type Tile = Point & { id: string };
const width = 174, height = 140, gap = 20, limit = 10000;

export function freeRoutingPoint(wanted: Point, others: Point[], step = 0): Point {
    const free = (p: Point) => others.every(other =>
        p.x >= other.x + width + gap || p.x + width + gap <= other.x
        || p.y >= other.y + height + gap || p.y + height + gap <= other.y);
    if (free(wanted)) return wanted;
    const below = (v: number) => step ? Math.floor(v / step) * step : v;
    const above = (v: number) => step ? Math.ceil(v / step) * step : v;
    const xs = [wanted.x, 0], ys = [wanted.y, 0];
    for (const other of others) {
        xs.push(below(other.x - width - gap), above(other.x + width + gap));
        ys.push(below(other.y - height - gap), above(other.y + height + gap));
    }
    let best: Point | null = null, distance = Infinity;
    for (const x of xs) for (const y of ys) {
        if (x < 0 || y < 0 || x > limit || y > limit) continue;
        const score = (x - wanted.x) ** 2 + (y - wanted.y) ** 2;
        if (score >= distance || !free({ x, y })) continue;
        best = { x, y }; distance = score;
    }
    // At least one free boundary candidate exists for practical editor layouts.
    return best ?? wanted;
}

export function separateRoutingBlocks(tiles: Tile[], step = 0): Tile[] {
    const placed: Tile[] = [];
    for (const tile of tiles) placed.push({ id: tile.id, ...freeRoutingPoint(tile, placed, step) });
    return placed;
}
