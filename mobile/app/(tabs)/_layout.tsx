import { Tabs } from 'expo-router';
import Svg, { Circle, Path, Rect } from 'react-native-svg';
import { colors } from '../../src/ui';

const stroke = (color: string) =>
  ({ stroke: color, strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round', fill: 'none' }) as const;

function HomeIcon({ color }: { color: string }) {
  return (
    <Svg width={20} height={20} viewBox="0 0 24 24">
      <Rect x={4} y={4} width={7} height={7} rx={2} {...stroke(color)} />
      <Rect x={13} y={4} width={7} height={7} rx={2} {...stroke(color)} />
      <Rect x={4} y={13} width={7} height={7} rx={2} {...stroke(color)} />
      <Rect x={13} y={13} width={7} height={7} rx={2} {...stroke(color)} />
    </Svg>
  );
}
function ActivityIcon({ color }: { color: string }) {
  return (
    <Svg width={20} height={20} viewBox="0 0 24 24">
      <Path d="M5 7h14M5 12h14M5 17h9" {...stroke(color)} />
    </Svg>
  );
}
function InsightsIcon({ color }: { color: string }) {
  return (
    <Svg width={20} height={20} viewBox="0 0 24 24">
      <Path d="M5 19V11M12 19V5M19 19v-8" {...stroke(color)} />
    </Svg>
  );
}
function SettingsIcon({ color }: { color: string }) {
  return (
    <Svg width={20} height={20} viewBox="0 0 24 24">
      <Circle cx={12} cy={12} r={3.2} {...stroke(color)} />
      <Path
        d="M12 4v2.4M12 17.6V20M4 12h2.4M17.6 12H20M6.3 6.3L8 8M16 16l1.7 1.7M17.7 6.3L16 8M8 16l-1.7 1.7"
        {...stroke(color)}
      />
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
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.ghost,
        tabBarLabelStyle: { fontSize: 10, fontWeight: '600', letterSpacing: 0.3 },
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'Home', tabBarIcon: HomeIcon }} />
      <Tabs.Screen name="transactions" options={{ title: 'Activity', tabBarIcon: ActivityIcon }} />
      <Tabs.Screen name="analytics" options={{ title: 'Insights', tabBarIcon: InsightsIcon }} />
      <Tabs.Screen name="settings" options={{ title: 'Settings', tabBarIcon: SettingsIcon }} />
    </Tabs>
  );
}
