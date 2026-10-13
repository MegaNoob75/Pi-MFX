export type CablePoint = { x: number; y: number };
type Tile = CablePoint & { id: string };
type Edge = { from: string; to: string };
type Segment = { a: CablePoint; b: CablePoint };
const gap = 8;

export function roundedCablePath(points: CablePoint[]) {
    const distinct = points.filter((p, i) => i === 0 || p.x !== points[i - 1].x || p.y !== points[i - 1].y);
    const route = distinct.filter((p, i) => {
        const before = distinct[i - 1], after = distinct[i + 1];
        if (!before || !after) return true;
        const dx = p.x - before.x, dy = p.y - before.y;
        const nx = after.x - p.x, ny = after.y - p.y;
        return Math.abs(dx * ny - dy * nx) > .001 || dx * nx + dy * ny <= 0;
    });
    if (!route.length) return "";
    let path = `M ${route[0].x} ${route[0].y}`;
    let current = route[0];
    const runTo = (end: CablePoint, direction: CablePoint, last = false) => {
        const length = Math.hypot(end.x - current.x, end.y - current.y);
        if (length < .001) return;
        const first = current === route[0];
        if (first || last) {
            // Leave OUT and enter IN horizontally, like a flexible patch lead,
            // even when separate connection lanes fan out above or below it.
            const handle = Math.min(80, length * .45);
            const unit = Math.hypot(direction.x, direction.y) || 1;
            const startX = first ? 1 : direction.x / unit;
            const startY = first ? 0 : direction.y / unit;
            const endX = last ? 1 : direction.x / unit;
            const endY = last ? 0 : direction.y / unit;
            path += ` C ${current.x + startX * handle} ${current.y + startY * handle}, ${end.x - endX * handle} ${end.y - endY * handle}, ${end.x} ${end.y}`;
        } else path += ` L ${end.x} ${end.y}`;
        current = end;
    };
    for (let i = 1; i < route.length; i++) {
        const p = route[i], before = route[i - 1], after = route[i + 1];
        if (!after) { runTo(p, { x: p.x - before.x, y: p.y - before.y }, true); continue; }
        const dx = p.x - before.x, dy = p.y - before.y;
        const nextX = after.x - p.x, nextY = after.y - p.y;
        const incoming = Math.hypot(dx, dy), outgoing = Math.hypot(nextX, nextY);
        if (Math.abs(dx * nextY - dy * nextX) < .001) {
            runTo(p, { x: dx, y: dy }); continue;
        }
        // Broad, soft turns rather than small rounded right angles. At the
        // connectors, use more of the short launch/arrival section for bending.
        const radius = Math.min(96, incoming * (i === 1 ? .85 : .5),
            outgoing * (i === route.length - 2 ? .85 : .5));
        const a = { x: p.x - dx / incoming * radius, y: p.y - dy / incoming * radius };
        const b = { x: p.x + nextX / outgoing * radius, y: p.y + nextY / outgoing * radius };
        runTo(a, { x: dx, y: dy });
        path += ` Q ${p.x} ${p.y} ${b.x} ${b.y}`;
        current = b;
    }
    return path;
}

// Separate orthogonal lanes allow crossings, but never share a cable segment.
// Coordinates are compressed around tiles and previous routes, so zoom and
// large empty stretches of canvas do not increase the search grid size.
export function routeCables(tiles: Tile[], edges: Edge[]) {
    const byId = new Map(tiles.map(tile => [tile.id, tile]));
    const occupied: Segment[] = [];
    const terminals = edges.map((edge, index) => {
        const from = byId.get(edge.from), to = byId.get(edge.to);
        if (!from || !to) return null;
        const outgoing = edges.map((e, i) => e.from === edge.from ? i : -1).filter(i => i >= 0);
        const incoming = edges.map((e, i) => e.to === edge.to ? i : -1).filter(i => i >= 0);
        const outIndex = outgoing.indexOf(index), inIndex = incoming.indexOf(index);
        const source = { x: from.x + 174, y: from.y + 111 };
        const target = { x: to.x, y: to.y + 111 };
        // Fixed 24px stubs can cross each other in a narrow gap, forcing
        // the router to reverse direction immediately before the connector.
        const forwardGap = target.x - source.x;
        const stubLimit = forwardGap > 0 ? forwardGap / 3 : Infinity;
        const start = { x: source.x + Math.min(24 + outIndex * gap, stubLimit),
            y: source.y + (outIndex - (outgoing.length - 1) / 2) * Math.min(gap, 80 / Math.max(1, outgoing.length - 1)) };
        const end = { x: Math.max(0, target.x - Math.min(24 + inIndex * gap, stubLimit)),
            y: target.y + (inIndex - (incoming.length - 1) / 2) * Math.min(gap, 80 / Math.max(1, incoming.length - 1)) };
        occupied.push({ a: source, b: start }, { a: end, b: target });
        return { source, target, start, end };
    });
    const right = Math.max(800, ...tiles.map(tile => tile.x + 174)) + 32;
    const bottom = Math.max(420, ...tiles.map(tile => tile.y + 140)) + 32;
    const boxes = tiles.map(tile => ({ left: tile.x - 12, right: tile.x + 186,
        top: tile.y - 12, bottom: tile.y + 152 }));
    const result = terminals.map((terminal, index) => {
        if (!terminal) return { points: [], path: "", label: { x: 0, y: 0 } };
        const { source, target, start, end } = terminal;
        // Close neighbours do not need launch lanes and miniature elbows.
        // Check the actual curve, rather than its enclosing rectangle: a
        // neighbouring block can touch that rectangle without blocking the wire.
        // Sample that same curve for number placement.
        const span = target.x - source.x;
        if (span > 0 && span <= 180) {
            const handle = span * .5;
            const points = Array.from({ length: 49 }, (_, i) => {
                const t = i / 48, u = 1 - t;
                return {
                    x: u * u * u * source.x + 3 * u * u * t * (source.x + handle)
                        + 3 * u * t * t * (target.x - handle) + t * t * t * target.x,
                    y: u * u * u * source.y + 3 * u * u * t * source.y
                        + 3 * u * t * t * target.y + t * t * t * target.y
                };
            });
            // The curve is monotonic in x and y, so each sample pair bounds
            // the entire intervening curve, not just the two sample points.
            const directClear = !tiles.some(tile => tile.id !== edges[index].from && tile.id !== edges[index].to
                && points.some((p, i) => {
                    if (!i) return false;
                    const previous = points[i - 1];
                    return tile.x - 4 < Math.max(previous.x, p.x) && tile.x + 178 > Math.min(previous.x, p.x)
                        && tile.y - 4 < Math.max(previous.y, p.y) && tile.y + 144 > Math.min(previous.y, p.y);
                }));
            if (directClear) {
                // Curve samples are for drawing/label geometry only. Feeding
                // all of them into the next routing grid multiplies its rows
                // and columns, making a small graph expensive to recompute.
                // Reserve a compact centre lane instead (at most 3 segments).
                if (source.y === target.y) occupied.push({ a: source, b: target });
                else {
                    const middleX = (source.x + target.x) / 2;
                    const a = { x: middleX, y: source.y }, b = { x: middleX, y: target.y };
                    occupied.push({ a: source, b: a }, { a, b }, { a: b, b: target });
                }
                return { points, label: points[24],
                    path: `M ${source.x} ${source.y} C ${source.x + handle} ${source.y}, ${target.x - handle} ${target.y}, ${target.x} ${target.y}` };
            }
        }
        const xs = [0, right + index * gap, start.x, end.x];
        const ys = [0, bottom + index * gap, start.y, end.y];
        boxes.forEach(box => { xs.push(box.left, box.right); ys.push(box.top, box.bottom); });
        occupied.forEach(({ a, b }) => {
            xs.push(a.x - gap, a.x, a.x + gap, b.x - gap, b.x, b.x + gap);
            ys.push(a.y - gap, a.y, a.y + gap, b.y - gap, b.y, b.y + gap);
        });
        const unique = (values: number[]) => [...new Set(values.filter(value => value >= 0))].sort((a, b) => a - b);
        const columns = unique(xs), rows = unique(ys), count = columns.length * rows.length;
        const point = (id: number) => ({ x: columns[id % columns.length], y: rows[Math.floor(id / columns.length)] });
        const startId = rows.indexOf(start.y) * columns.length + columns.indexOf(start.x);
        const endId = rows.indexOf(end.y) * columns.length + columns.indexOf(end.x);
        const clear = (a: CablePoint, b: CablePoint, avoidTiles: boolean, clearance: number) => {
            const horizontal = a.y === b.y;
            const low = horizontal ? Math.min(a.x, b.x) : Math.min(a.y, b.y);
            const high = horizontal ? Math.max(a.x, b.x) : Math.max(a.y, b.y);
            if (avoidTiles && boxes.some(box => horizontal
                ? a.y > box.top && a.y < box.bottom && high > box.left && low < box.right
                : a.x > box.left && a.x < box.right && high > box.top && low < box.bottom)) return false;
            return !occupied.some(segment => {
                if (segment.a.x !== segment.b.x && segment.a.y !== segment.b.y) return false;
                if (horizontal !== (segment.a.y === segment.b.y)) return false;
                const distance = horizontal ? Math.abs(a.y - segment.a.y) : Math.abs(a.x - segment.a.x);
                const otherLow = horizontal ? Math.min(segment.a.x, segment.b.x) : Math.min(segment.a.y, segment.b.y);
                const otherHigh = horizontal ? Math.max(segment.a.x, segment.b.x) : Math.max(segment.a.y, segment.b.y);
                return distance < clearance && high > otherLow && low < otherHigh;
            });
        };
        const search = (avoidTiles: boolean, clearance: number): CablePoint[] | null => {
            // Manually overlapping tiles can enclose a launch point. Detect
            // that before exploring an obstacle grid with no possible exit.
            if (avoidTiles && [start, end].some(p => boxes.some(box =>
                p.x > box.left && p.x < box.right && p.y > box.top && p.y < box.bottom))) return null;
            // Keep separate costs for each arrival direction. Without this,
            // an equally short zigzag can crowd out a route with fewer bends.
            const turnCost = 64;
            const scores = new Float64Array(count * 4); scores.fill(Infinity);
            const parent = new Int32Array(count * 4); parent.fill(-1);
            const visited = new Uint8Array(count * 4);
            const heap: { id: number; score: number }[] = [];
            const push = (entry: { id: number; score: number }) => {
                let i = heap.length; heap.push(entry);
                while (i > 0) {
                    const p = (i - 1) >> 1;
                    if (heap[p].score <= entry.score) break;
                    heap[i] = heap[p]; i = p;
                }
                heap[i] = entry;
            };
            const pop = () => {
                const first = heap[0], last = heap.pop()!;
                if (heap.length) {
                    let i = 0;
                    while (i * 2 + 1 < heap.length) {
                        let child = i * 2 + 1;
                        if (child + 1 < heap.length && heap[child + 1].score < heap[child].score) child++;
                        if (last.score <= heap[child].score) break;
                        heap[i] = heap[child]; i = child;
                    }
                    heap[i] = last;
                }
                return first.id;
            };
            // Directions: right, left, down, up. OUT leaves towards the right.
            const startState = startId * 4;
            scores[startState] = 0; push({ id: startState, score: 0 });
            while (heap.length) {
                const state = pop(), id = Math.floor(state / 4), direction = state % 4;
                if (visited[state]) continue;
                if (id === endId) {
                    const route: CablePoint[] = [];
                    for (let at = state; at !== -1; at = parent[at]) route.push(point(Math.floor(at / 4)));
                    return route.reverse();
                }
                visited[state] = 1;
                const p = point(id), column = id % columns.length, row = Math.floor(id / columns.length);
                const next = [column > 0 ? id - 1 : -1, column + 1 < columns.length ? id + 1 : -1,
                    row > 0 ? id - columns.length : -1, row + 1 < rows.length ? id + columns.length : -1];
                for (let step = 0; step < next.length; step++) {
                    const neighbor = next[step], nextDirection = [1, 0, 3, 2][step];
                    const nextState = neighbor * 4 + nextDirection;
                    if (neighbor < 0 || visited[nextState]) continue;
                    const q = point(neighbor);
                    if (!clear(p, q, avoidTiles, clearance)) continue;
                    const distance = Math.abs(p.x - q.x) + Math.abs(p.y - q.y);
                    const bend = nextDirection === direction ? 0 : turnCost;
                    // IN is approached towards the right as well.
                    const arrival = neighbor === endId && nextDirection !== 0 ? turnCost : 0;
                    const score = scores[state] + distance + bend + arrival;
                    if (score >= scores[nextState]) continue;
                    scores[nextState] = score; parent[nextState] = state;
                    push({ id: nextState, score: score + Math.abs(q.x - end.x) + Math.abs(q.y - end.y) });
                }
            }
            return null;
        };
        // Overlapping manually placed tiles can obstruct a connector. In that
        // case prioritize separate cable lanes over tile avoidance.
        const route = search(true, 6) ?? search(false, 6) ?? search(false, .1);
        const rawBody = route ?? [start, { x: right + index * gap, y: start.y },
            { x: right + index * gap, y: bottom + index * gap },
            { x: end.x, y: bottom + index * gap }, end];
        const body = rawBody.filter((p, i) => i === 0 || i === rawBody.length - 1
            || !((rawBody[i - 1].x === p.x && p.x === rawBody[i + 1].x)
                || (rawBody[i - 1].y === p.y && p.y === rawBody[i + 1].y)));
        for (let i = 1; i < body.length; i++) occupied.push({ a: body[i - 1], b: body[i] });
        const points = [source, ...body, target];
        let longest = 0, label = { x: start.x, y: start.y - 8 };
        for (let i = 1; i < body.length; i++) {
            const a = body[i - 1], b = body[i], length = Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
            if (length > longest) {
                longest = length;
                label = { x: (a.x + b.x) / 2 + (a.x === b.x ? 10 : 0), y: (a.y + b.y) / 2 - 7 };
            }
        }
        return { points, path: roundedCablePath(points), label };
    });
    // Keep numbers on or immediately beside their cable. Blocks and other
    // buttons are hard obstacles; nearby wires only affect the preference.
    const labels: CablePoint[] = [];
    const overlaps = (p: CablePoint, left: number, top: number, right: number, bottom: number) =>
        p.x + 24 > left && p.x - 24 < right && p.y + 24 > top && p.y - 24 < bottom;
    return result.map((route, index) => {
        const candidates: { point: CablePoint; anchor: CablePoint; score: number }[] = [];
        for (let i = 1; i < route.points.length; i++) {
            const a = route.points[i - 1], b = route.points[i];
            const length = Math.hypot(b.x - a.x, b.y - a.y);
            if (!length) continue;
            const nx = -(b.y - a.y) / length, ny = (b.x - a.x) / length;
            const samples = Math.max(2, Math.min(40, Math.ceil(length / 12)));
            for (let sample = 1; sample < samples; sample++) {
                const fraction = sample / samples;
                const anchor = { x: a.x + (b.x - a.x) * fraction, y: a.y + (b.y - a.y) * fraction };
                for (const offset of [0, 26, -26, 38, -38, 52, -52, 78, -78]) {
                    const point = { x: anchor.x + nx * offset, y: anchor.y + ny * offset };
                    if (point.x < 26 || point.y < 26) continue;
                    if (tiles.some(tile => overlaps(point, tile.x - 2, tile.y - 2, tile.x + 176, tile.y + 142))
                        || labels.some(label => overlaps(point, label.x - 24, label.y - 24, label.x + 24, label.y + 24))) continue;
                    let wireOverlaps = 0;
                    for (let other = 0; other < result.length; other++) {
                        if (other === index) continue;
                        const points = result[other].points;
                        for (let j = 1; j < points.length; j++) {
                            const c = points[j - 1], d = points[j];
                            if (overlaps(point, Math.min(c.x, d.x), Math.min(c.y, d.y), Math.max(c.x, d.x), Math.max(c.y, d.y))) {
                                wireOverlaps++; break;
                            }
                        }
                    }
                    candidates.push({ point, anchor,
                        score: -Math.abs(offset) - wireOverlaps * 32 - Math.abs(fraction - .5) * 8 + Math.min(length, 200) * .01 });
                }
            }
        }
        candidates.sort((a, b) => b.score - a.score);
        const best = candidates[0];
        const fallbackAnchor = candidates[0]?.anchor ?? route.label;
        const label = best?.point ?? {
            x: Math.max(26, fallbackAnchor.x),
            y: Math.max(bottom, ...result.flatMap(r => r.points.map(p => p.y)), ...labels.map(p => p.y)) + 60
        };
        labels.push(label);
        return { ...route, label, labelAnchor: best?.anchor ?? fallbackAnchor };
    });
}
