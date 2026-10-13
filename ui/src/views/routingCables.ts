export type CablePoint = { x: number; y: number };
type Tile = CablePoint & { id: string };
type Edge = { from: string; to: string };
type Segment = { a: CablePoint; b: CablePoint };
const gap = 8;

export function roundedCablePath(points: CablePoint[]) {
    const route = points.filter((p, i) => i === 0 || p.x !== points[i - 1].x || p.y !== points[i - 1].y);
    if (!route.length) return "";
    let path = `M ${route[0].x} ${route[0].y}`;
    for (let i = 1; i < route.length; i++) {
        const p = route[i], before = route[i - 1], after = route[i + 1];
        if (!after) { path += ` L ${p.x} ${p.y}`; continue; }
        const dx = p.x - before.x, dy = p.y - before.y;
        const nextX = after.x - p.x, nextY = after.y - p.y;
        const incoming = Math.hypot(dx, dy), outgoing = Math.hypot(nextX, nextY);
        if (Math.abs(dx * nextY - dy * nextX) < .001) {
            path += ` L ${p.x} ${p.y}`; continue;
        }
        // Keep the existing lanes and endpoints, curving only the bends.
        // Short sections automatically get a smaller radius.
        const radius = Math.min(24, incoming / 2, outgoing / 2);
        const a = { x: p.x - dx / incoming * radius, y: p.y - dy / incoming * radius };
        const b = { x: p.x + nextX / outgoing * radius, y: p.y + nextY / outgoing * radius };
        path += ` L ${a.x} ${a.y} Q ${p.x} ${p.y} ${b.x} ${b.y}`;
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
        const start = { x: source.x + 24 + outIndex * gap,
            y: source.y + (outIndex - (outgoing.length - 1) / 2) * Math.min(gap, 80 / Math.max(1, outgoing.length - 1)) };
        const end = { x: Math.max(0, target.x - 24 - inIndex * gap),
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
            const scores = new Float64Array(count); scores.fill(Infinity);
            const parent = new Int32Array(count); parent.fill(-1);
            const visited = new Uint8Array(count);
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
            scores[startId] = 0; push({ id: startId, score: 0 });
            while (heap.length) {
                const id = pop();
                if (visited[id]) continue;
                if (id === endId) {
                    const route: CablePoint[] = [];
                    for (let at = id; at !== -1; at = parent[at]) route.push(point(at));
                    return route.reverse();
                }
                visited[id] = 1;
                const p = point(id), column = id % columns.length, row = Math.floor(id / columns.length);
                const next = [column > 0 ? id - 1 : -1, column + 1 < columns.length ? id + 1 : -1,
                    row > 0 ? id - columns.length : -1, row + 1 < rows.length ? id + columns.length : -1];
                for (const neighbor of next) {
                    if (neighbor < 0 || visited[neighbor]) continue;
                    const q = point(neighbor);
                    if (!clear(p, q, avoidTiles, clearance)) continue;
                    const distance = Math.abs(p.x - q.x) + Math.abs(p.y - q.y);
                    const score = scores[id] + distance;
                    if (score >= scores[neighbor]) continue;
                    scores[neighbor] = score; parent[neighbor] = id;
                    push({ id: neighbor, score: score + Math.abs(q.x - end.x) + Math.abs(q.y - end.y) });
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
    return result;
}
