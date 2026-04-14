import type { BondAxes } from '../../../api/types';

type Props = {
  axes: BondAxes;
  size?: number;
};

const AXIS_ORDER: Array<keyof BondAxes> = ['time', 'depth', 'momentum', 'alignment', 'autonomy'];
const AXIS_LABELS: Record<keyof BondAxes, string> = {
  time: 'Time',
  depth: 'Depth',
  momentum: 'Momentum',
  alignment: 'Alignment',
  autonomy: 'Autonomy',
};

export function BondRadar({ axes, size = 320 }: Props) {
  const labelPad = 70;
  const cx = size / 2;
  const cy = size / 2;
  const radius = size * 0.32;
  const nAxes = AXIS_ORDER.length;

  const angleFor = (i: number) => -Math.PI / 2 + (i * 2 * Math.PI) / nAxes;
  const pointAt = (i: number, value: number) => {
    const angle = angleFor(i);
    const r = (value / 100) * radius;
    return { x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) };
  };

  const axisEnds = AXIS_ORDER.map((_, i) => pointAt(i, 100));
  const dataPoints = AXIS_ORDER.map((axis, i) => pointAt(i, axes[axis]));
  const dataPath = dataPoints.map((p) => `${p.x},${p.y}`).join(' ');
  const grid = [25, 50, 75, 100].map((level) =>
    AXIS_ORDER.map((_, i) => pointAt(i, level))
      .map((p) => `${p.x},${p.y}`)
      .join(' '),
  );

  return (
    <svg
      width={size + labelPad * 2}
      height={size}
      viewBox={`${-labelPad} 0 ${size + labelPad * 2} ${size}`}
      className="text-accent max-w-full h-auto"
    >
      {grid.map((pts, i) => (
        <polygon
          key={i}
          points={pts}
          fill="none"
          stroke="currentColor"
          strokeOpacity={0.12 + i * 0.03}
          strokeWidth={1}
        />
      ))}
      {axisEnds.map((p, i) => (
        <line
          key={i}
          x1={cx}
          y1={cy}
          x2={p.x}
          y2={p.y}
          stroke="currentColor"
          strokeOpacity={0.2}
          strokeWidth={1}
        />
      ))}
      <polygon
        points={dataPath}
        fill="currentColor"
        fillOpacity={0.2}
        stroke="currentColor"
        strokeWidth={2}
      />
      {dataPoints.map((p, i) => (
        <circle key={i} cx={p.x} cy={p.y} r={3.5} fill="currentColor" />
      ))}
      {AXIS_ORDER.map((axis, i) => {
        const labelPoint = pointAt(i, 125);
        const textAnchor =
          Math.abs(labelPoint.x - cx) < 5
            ? 'middle'
            : labelPoint.x < cx
              ? 'end'
              : 'start';
        return (
          <text
            key={axis}
            x={labelPoint.x}
            y={labelPoint.y}
            textAnchor={textAnchor}
            dominantBaseline="central"
            fill="currentColor"
            fontSize={12}
            opacity={0.75}
          >
            {AXIS_LABELS[axis]}{' '}
            <tspan fontWeight="bold" fill="currentColor">
              {axes[axis]}
            </tspan>
          </text>
        );
      })}
    </svg>
  );
}
