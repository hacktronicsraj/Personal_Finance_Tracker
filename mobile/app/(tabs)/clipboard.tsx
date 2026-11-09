import { router } from 'expo-router';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { useEffect, useState } from 'react';
import { Alert, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { phoneClipboard, type PhoneClipboardItem } from '../../src/clipboardSync';
import { colors } from '../../src/ui';

/** The clipboard shared with the Mac: what the Mac sent, and ways to send back. */
export default function ClipboardScreen() {
  const [items, setItems] = useState<PhoneClipboardItem[]>(phoneClipboard.items);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void phoneClipboard.start();
    phoneClipboard.subscribe(setItems);
    return () => phoneClipboard.subscribe(null);
  }, []);

  async function sendImage() {
    const picked = await ImagePicker.launchImageLibraryAsync({ quality: 1 });
    if (picked.canceled || !picked.assets?.[0]) return;
    const asset = picked.assets[0];
    setBusy(true);
    try {
      await phoneClipboard.pushFile(asset.uri, asset.fileName ?? 'photo.jpg',
        asset.mimeType ?? 'image/jpeg', 'image');
      Alert.alert('Sent', 'The image is on your Mac’s clipboard now.');
    } catch (e: any) {
      Alert.alert('Could not send', e?.message ?? 'Try again');
    } finally {
      setBusy(false);
    }
  }

  async function sendFile() {
    const picked = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true });
    if (picked.canceled || !picked.assets?.[0]) return;
    const asset = picked.assets[0];
    setBusy(true);
    try {
      await phoneClipboard.pushFile(asset.uri, asset.name, asset.mimeType ?? 'application/octet-stream');
      Alert.alert('Sent', 'The file is on your Mac now.');
    } catch (e: any) {
      Alert.alert('Could not send', e?.message ?? 'Try again');
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.root}>
      <Text style={styles.title}>Clipboard</Text>
      <Text style={styles.caption}>
        Text you copy here goes to your Mac, and text copied there appears here. Images and files are sent when you tap.
      </Text>
      <View style={styles.row}>
        <Pressable style={styles.button} disabled={busy} onPress={sendImage}>
          <Text style={styles.buttonText}>Send image</Text>
        </Pressable>
        <Pressable style={styles.button} disabled={busy} onPress={sendFile}>
          <Text style={styles.buttonText}>Send file</Text>
        </Pressable>
      </View>
      {phoneClipboard.lastError ? <Text style={styles.error}>{phoneClipboard.lastError}</Text> : null}
      <FlatList
        data={items}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ paddingBottom: 40 }}
        ListEmptyComponent={<Text style={styles.empty}>Nothing from your Mac yet.</Text>}
        renderItem={({ item }) => (
          <Pressable
            style={styles.item}
            onPress={async () => {
              await phoneClipboard.receive(item);
              router.push('/(tabs)');
            }}
          >
            <Text style={styles.itemKind}>{item.kind === 'text' ? 'Text' : item.kind === 'image' ? 'Image' : item.fileName}</Text>
            <Text style={styles.itemBody} numberOfLines={3}>
              {item.kind === 'text' ? item.text : `${item.deviceName ?? 'Mac'} · ${new Date(item.createdAt).toLocaleTimeString()}`}
            </Text>
          </Pressable>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg, paddingTop: 64, paddingHorizontal: 18 },
  title: { color: colors.text, fontSize: 26, fontWeight: '700' },
  caption: { color: colors.faint, fontSize: 12, marginTop: 6, marginBottom: 14 },
  row: { flexDirection: 'row', gap: 10, marginBottom: 12 },
  button: { flex: 1, backgroundColor: colors.surface, borderRadius: 12, paddingVertical: 12, alignItems: 'center' },
  buttonText: { color: colors.text, fontWeight: '600', fontSize: 13 },
  error: { color: '#F87171', fontSize: 11, marginBottom: 8 },
  empty: { color: colors.faint, fontSize: 12, marginTop: 24, textAlign: 'center' },
  item: { backgroundColor: colors.surface, borderRadius: 12, padding: 12, marginBottom: 8 },
  itemKind: { color: colors.accent, fontSize: 10, fontWeight: '700', letterSpacing: 0.4, textTransform: 'uppercase' },
  itemBody: { color: colors.text, fontSize: 13, marginTop: 4 },
});
