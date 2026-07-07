import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { listReviews, removeReview, type ReviewItem } from '../src/db/database';
import { Button, Card, colors, H2, Muted, Screen } from '../src/ui';

/**
 * Bank SMS that looked financial but couldn't be parsed — surfaced here so a
 * missed spend can be completed by hand instead of vanishing silently.
 */
export default function ReviewScreen() {
  const [items, setItems] = useState<ReviewItem[]>([]);

  const load = useCallback(() => {
    listReviews().then(setItems).catch(() => {});
  }, []);
  useFocusEffect(load);

  function complete(item: ReviewItem) {
    router.push({
      pathname: '/add',
      params: { reviewId: item.id, rawText: item.raw_text, source: 'sms' },
    });
  }
  async function dismiss(item: ReviewItem) {
    await removeReview(item.id).catch(() => {});
    load();
  }

  if (items.length === 0) {
    return (
      <Screen>
        <Card>
          <H2>Nothing to review</H2>
          <Muted style={{ marginTop: 6 }}>
            Messages that look like a transaction but can’t be read automatically show up here so you can add
            them by hand. You’re all caught up.
          </Muted>
        </Card>
      </Screen>
    );
  }

  return (
    <Screen>
      <Muted style={{ paddingHorizontal: 4 }}>
        {items.length} message{items.length > 1 ? 's' : ''} looked financial but couldn’t be parsed.
      </Muted>
      {items.map((item) => (
        <Card key={item.id}>
          <Text style={styles.body} numberOfLines={4}>
            {item.raw_text}
          </Text>
          {!!item.sender && <Muted style={{ marginTop: 4 }}>from {item.sender}</Muted>}
          <View style={styles.row}>
            <View style={{ flex: 1 }}>
              <Button title="Add it" onPress={() => complete(item)} />
            </View>
            <Pressable onPress={() => dismiss(item)} hitSlop={8} style={styles.dismiss}>
              <Text style={styles.dismissText}>Dismiss</Text>
            </Pressable>
          </View>
        </Card>
      ))}
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { color: colors.text, fontSize: 13.5, lineHeight: 20 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 12 },
  dismiss: { paddingVertical: 12, paddingHorizontal: 8 },
  dismissText: { color: colors.sub, fontSize: 13, fontWeight: '600' },
});
