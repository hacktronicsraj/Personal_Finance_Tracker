import { Tabs } from 'expo-router';
import Svg, { Circle, Path, Rect } from 'react-native-svg';
import { colors } from '../../src/ui';

// Active tab: white label (tint) but emerald icon — the accent marks "you are here".
const stroke = (color: string) =>
  ({ stroke: color, strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round', fill: 'none' }) as const;
const iconColor = (color: string, focused: boolean) => (focused ? colors.accent : color);

type IconProps = { color: string; focused: boolean };

function HomeIcon({ color, focused }: IconProps) {
  const s = stroke(iconColor(color, focused));
  return (
    <Svg width={21} height={21} viewBox="0 0 24 24">
      <Rect x={4} y={4} width={7} height={7} rx={2} {...s} />
      <Rect x={13} y={4} width={7} height={7} rx={2} {...s} />
      <Rect x={4} y={13} width={7} height={7} rx={2} {...s} />
      <Rect x={13} y={13} width={7} height={7} rx={2} {...s} />
    </Svg>
  );
}
function ActivityIcon({ color, focused }: IconProps) {
  return (
    <Svg width={21} height={21} viewBox="0 0 24 24">
      <Path d="M5 7h14M5 12h14M5 17h9" {...stroke(iconColor(color, focused))} />
    </Svg>
  );
}
function InsightsIcon({ color, focused }: IconProps) {
  return (
    <Svg width={21} height={21} viewBox="0 0 24 24">
      <Path d="M5 19V11M12 19V5M19 19v-8" {...stroke(iconColor(color, focused))} />
    </Svg>
  );
}
function SettingsIcon({ color, focused }: IconProps) {
  const s = stroke(iconColor(color, focused));
  return (
    <Svg width={21} height={21} viewBox="0 0 24 24">
      <Circle cx={12} cy={12} r={3.2} {...s} />
      <Path
        d="M12 4v2.4M12 17.6V20M4 12h2.4M17.6 12H20M6.3 6.3L8 8M16 16l1.7 1.7M17.7 6.3L16 8M8 16l-1.7 1.7"
        {...s}
      />
    </Svg>
  );
}

function ClipboardIcon({ color, focused }: IconProps) {
  const s = stroke(iconColor(color, focused));
  return (
    <Svg width={21} height={21} viewBox="0 0 24 24">
      <Rect x={5} y={4} width={14} height={17} rx={3} {...s} />
      <Path d="M9 4.5a3 3 0 0 1 6 0" {...s} />
      <Path d="M9 11h6M9 15h4" {...s} />
    </Svg>
  );
}

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false, // each screen renders its own AppHeader
        tabBarStyle: {
          backgroundColor: 'rgba(8,8,11,0.98)',
          borderTopColor: colors.hairline,
          borderTopWidth: 1,
        },
        tabBarActiveTintColor: colors.text,
        tabBarInactiveTintColor: colors.faint,
        tabBarLabelStyle: { fontSize: 10, fontWeight: '600', letterSpacing: 0.3 },
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'Home', tabBarIcon: HomeIcon }} />
      <Tabs.Screen name="transactions" options={{ title: 'Activity', tabBarIcon: ActivityIcon }} />
      <Tabs.Screen name="analytics" options={{ title: 'Insights', tabBarIcon: InsightsIcon }} />
      <Tabs.Screen name="clipboard" options={{ title: 'Clipboard', tabBarIcon: ClipboardIcon }} />
      <Tabs.Screen name="settings" options={{ title: 'Settings', tabBarIcon: SettingsIcon }} />
    </Tabs>
  );
}
