import Svg, { Circle, Path, Rect } from 'react-native-svg';
import { colors } from '../ui';

/**
 * Ink icon set — same visual grammar as the tab bar icons: 24-unit viewBox,
 * 1.7 stroke, round caps/joins, outline-only. One family, one stroke weight,
 * so icons read as a system (no emoji, no mixed styles).
 */
type IconProps = { size?: number; color?: string };

const stroke = (color: string) =>
  ({ stroke: color, strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round', fill: 'none' }) as const;

export function CameraIcon({ size = 16, color = colors.sub }: IconProps) {
  const s = stroke(color);
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path d="M4 8.5A1.5 1.5 0 0 1 5.5 7H8l1.4-2h5.2L16 7h2.5A1.5 1.5 0 0 1 20 8.5v9A1.5 1.5 0 0 1 18.5 19h-13A1.5 1.5 0 0 1 4 17.5z" {...s} />
      <Circle cx={12} cy={13} r={3.2} {...s} />
    </Svg>
  );
}

export function GalleryIcon({ size = 16, color = colors.sub }: IconProps) {
  const s = stroke(color);
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Rect x={4} y={5} width={16} height={14} rx={2} {...s} />
      <Circle cx={9} cy={10} r={1.6} {...s} />
      <Path d="M4.5 17l4.5-4.5 3 3 3.5-3.5 4 4" {...s} />
    </Svg>
  );
}

export function FileIcon({ size = 16, color = colors.sub }: IconProps) {
  const s = stroke(color);
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path d="M6.5 4.5h7L18 9v9A1.5 1.5 0 0 1 16.5 19.5h-10A1.5 1.5 0 0 1 5 18V6a1.5 1.5 0 0 1 1.5-1.5z" {...s} />
      <Path d="M13.5 4.5V9H18" {...s} />
    </Svg>
  );
}

export function FilterIcon({ size = 16, color = colors.sub }: IconProps) {
  const s = stroke(color);
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path d="M5 7h14M8 12h8M10.5 17h3" {...s} />
    </Svg>
  );
}

export function SearchIcon({ size = 16, color = colors.ghost }: IconProps) {
  const s = stroke(color);
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Circle cx={11} cy={11} r={5.5} {...s} />
      <Path d="M15.5 15.5L20 20" {...s} />
    </Svg>
  );
}

export function PencilIcon({ size = 13, color = colors.accent }: IconProps) {
  const s = stroke(color);
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path d="M14.5 5.5l4 4L8 20H4v-4z" {...s} />
      <Path d="M12.5 7.5l4 4" {...s} />
    </Svg>
  );
}

export function ChevronLeftIcon({ size = 16, color = colors.sub }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path d="M14.5 6L9 12l5.5 6" {...stroke(color)} />
    </Svg>
  );
}

export function ChevronRightIcon({ size = 16, color = colors.sub }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path d="M9.5 6L15 12l-5.5 6" {...stroke(color)} />
    </Svg>
  );
}

export function CloseIcon({ size = 12, color = colors.sub }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path d="M6.5 6.5l11 11M17.5 6.5l-11 11" {...stroke(color)} />
    </Svg>
  );
}

export function BackspaceIcon({ size = 22, color = colors.sub }: IconProps) {
  const s = stroke(color);
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path d="M8.5 6h10A1.5 1.5 0 0 1 20 7.5v9a1.5 1.5 0 0 1-1.5 1.5h-10L3.5 12z" {...s} />
      <Path d="M11.5 9.5l5 5M16.5 9.5l-5 5" {...s} />
    </Svg>
  );
}

export function FingerprintIcon({ size = 22, color = colors.sub }: IconProps) {
  const s = stroke(color);
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path d="M7 6.3A8 8 0 0 1 20 12.5c0 2.5-.3 4.6-.9 6.5" {...s} />
      <Path d="M4.6 9.5A8 8 0 0 0 4 12.5c0 2 .4 3.6 1 5" {...s} />
      <Path d="M8.5 19.8c-.6-1.6-1-3.9-1-7.3A4.5 4.5 0 0 1 12 8a4.5 4.5 0 0 1 4.5 4.5c0 1.4-.1 2.7-.3 3.8" {...s} />
      <Path d="M12 12.5c0 3-.3 5.4-1 7.3" {...s} />
    </Svg>
  );
}
