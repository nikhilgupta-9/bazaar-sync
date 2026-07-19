// Small hand-authored payoff-shape previews for the Ready-Made Strategies
// cards — approximate curve shapes (green = profit zone, red = loss zone),
// not computed from real data. Mirrors stockmojo's strategy picker icons.
const SHAPES = {
    "long-straddle": {
        green: [[5, 10], [22, 30]],
        red: [[22, 30], [35, 38], [50, 44], [65, 38], [78, 30]],
        green2: [[78, 30], [95, 10]],
    },
    "short-straddle": {
        red: [[5, 44], [22, 30]],
        green: [[22, 30], [50, 8], [78, 30]],
        red2: [[78, 30], [95, 44]],
    },
    "long-strangle": {
        green: [[5, 10], [25, 30]],
        red: [[25, 30], [40, 42], [60, 42], [75, 30]],
        green2: [[75, 30], [95, 10]],
    },
    "short-iron-condor": {
        red: [[0, 40], [15, 40], [25, 30]],
        green: [[25, 30], [35, 15], [65, 15], [75, 30]],
        red2: [[75, 30], [85, 40], [100, 40]],
    },
    "bull-call-spread": {
        red: [[0, 40], [30, 40], [45, 30]],
        green: [[45, 30], [60, 12], [100, 12]],
    },
    "bear-put-spread": {
        green: [[0, 12], [40, 12], [55, 30]],
        red: [[55, 30], [70, 40], [100, 40]],
    },
    "long-call-butterfly": {
        red: [[0, 40], [25, 40], [37, 30]],
        green: [[37, 30], [50, 12], [63, 30]],
        red2: [[63, 30], [75, 40], [100, 40]],
    },
    "long-iron-condor": {
        green: [[0, 15], [15, 15], [25, 30]],
        red: [[25, 30], [35, 40], [65, 40], [75, 30]],
        green2: [[75, 30], [85, 15], [100, 15]],
    },
    "long-iron-butterfly": {
        green: [[0, 15], [30, 15], [42, 32]],
        red: [[42, 32], [50, 40], [58, 32]],
        green2: [[58, 32], [70, 15], [100, 15]],
    },
    "call-ratio-spread": {
        red: [[0, 34], [30, 34], [40, 22]],
        green: [[40, 22], [55, 10], [65, 22]],
        red2: [[65, 22], [80, 40], [100, 46]],
    },
    "put-ratio-spread": {
        red: [[0, 46], [20, 40], [35, 22]],
        green: [[35, 22], [45, 10], [60, 22]],
        red2: [[60, 22], [70, 34], [100, 34]],
    },
};

function pointsToStr(points) {
    return points.map(([x, y]) => `${x},${y}`).join(" ");
}

export default function PayoffIcon({ shape }) {
    const s = SHAPES[shape];
    if (!s) return null;
    return (
        <svg viewBox="0 0 100 50" className="h-12 w-full" preserveAspectRatio="none">
            {s.red && <polyline points={pointsToStr(s.red)} fill="none" stroke="#f43f5e" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />}
            {s.red2 && <polyline points={pointsToStr(s.red2)} fill="none" stroke="#f43f5e" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />}
            {s.green && <polyline points={pointsToStr(s.green)} fill="none" stroke="#10b981" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />}
            {s.green2 && <polyline points={pointsToStr(s.green2)} fill="none" stroke="#10b981" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />}
        </svg>
    );
}
