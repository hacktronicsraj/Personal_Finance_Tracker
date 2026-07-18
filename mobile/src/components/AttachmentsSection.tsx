import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Image, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import {
  AttachmentMeta,
  deleteAttachment,
  fetchAttachments,
  uploadAttachment,
} from '../api/client';
import { pickDocument, pickImageFromCamera, pickImageFromLibrary, type PickedFile } from '../attachments';
import { getSettings } from '../settings';
import { colors, ripple } from '../ui';
import { ConfirmDialog } from './ConfirmDialog';
import { CameraIcon, CloseIcon, FileIcon, GalleryIcon } from './icons';

const isImage = (mime: string | null) => !!mime && mime.startsWith('image/');

/**
 * Receipt attachments for a saved transaction (M6). Lists existing attachments,
 * adds from camera / gallery / file, and deletes. Thumbnails stream from the
 * authed Worker (RN <Image> with an auth header). Requires connectivity.
 */
export function AttachmentsSection({ txnId }: { txnId: string }) {
  const [items, setItems] = useState<AttachmentMeta[]>([]);
  const [auth, setAuth] = useState<{ base: string; headers: Record<string, string> } | null>(null);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [pendingRemove, setPendingRemove] = useState<string | null>(null);

  useEffect(() => {
    getSettings().then((s) =>
      setAuth({ base: s.backendUrl, headers: s.apiToken ? { authorization: `Bearer ${s.apiToken}` } : {} }),
    );
    fetchAttachments(txnId).then(setItems).catch(() => {});
  }, [txnId]);

  const src = (id: string) => (auth ? { uri: `${auth.base}/attachments/${id}`, headers: auth.headers } : undefined);

  async function add(pick: () => Promise<PickedFile | null>) {
    if (busy) return;
    setBusy(true);
    try {
      const f = await pick();
      if (f?.base64) {
        const meta = await uploadAttachment(txnId, f.base64, f.mime);
        setItems((prev) => [...prev, meta]);
      }
    } catch {
      Alert.alert('Upload failed', 'Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  async function doRemove() {
    const id = pendingRemove;
    setPendingRemove(null);
    if (!id) return;
    try {
      await deleteAttachment(id);
      setItems((prev) => prev.filter((a) => a.id !== id));
    } catch {
      Alert.alert('Could not delete', 'Check your connection and try again.');
    }
  }

  return (
    <View>
      {items.length > 0 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
          {items.map((a) => (
            <View key={a.id} style={styles.thumbWrap}>
              <Pressable
                onPress={() => isImage(a.mime) && setPreview(a.id)}
                accessibilityRole="button"
                accessibilityLabel={isImage(a.mime) ? 'View receipt image' : 'Attached file'}
                style={({ pressed }) => [styles.thumb, pressed && { opacity: 0.7 }]}
              >
                {isImage(a.mime) ? (
                  <Image source={src(a.id)} style={styles.thumbImg} />
                ) : (
                  <View style={styles.docThumb}>
                    <Text style={styles.docExt}>{(a.mime ?? '').includes('pdf') ? 'PDF' : 'FILE'}</Text>
                  </View>
                )}
              </Pressable>
              <Pressable
                onPress={() => setPendingRemove(a.id)}
                hitSlop={12}
                accessibilityRole="button"
                accessibilityLabel="Remove attachment"
                style={({ pressed }) => [styles.remove, pressed && { opacity: 0.6 }]}
              >
                <CloseIcon size={11} color={colors.text} />
              </Pressable>
            </View>
          ))}
        </ScrollView>
      )}

      <View style={styles.actions}>
        <AddBtn label="Camera" icon={<CameraIcon size={15} />} onPress={() => add(pickImageFromCamera)} disabled={busy} />
        <AddBtn label="Gallery" icon={<GalleryIcon size={15} />} onPress={() => add(pickImageFromLibrary)} disabled={busy} />
        <AddBtn label="File" icon={<FileIcon size={15} />} onPress={() => add(pickDocument)} disabled={busy} />
        {busy && <ActivityIndicator color={colors.accent} style={{ marginLeft: 4 }} />}
      </View>

      <ConfirmDialog
        visible={!!pendingRemove}
        title="Remove attachment?"
        message="This deletes the file and cannot be undone."
        confirmLabel="Remove"
        onCancel={() => setPendingRemove(null)}
        onConfirm={doRemove}
      />

      <Modal visible={!!preview} transparent animationType="fade" onRequestClose={() => setPreview(null)}>
        <Pressable
          style={styles.previewBackdrop}
          onPress={() => setPreview(null)}
          accessibilityRole="button"
          accessibilityLabel="Close preview"
        >
          {preview && <Image source={src(preview)} style={styles.previewImg} resizeMode="contain" />}
        </Pressable>
      </Modal>
    </View>
  );
}

function AddBtn({
  label,
  icon,
  onPress,
  disabled,
}: {
  label: string;
  icon: React.ReactNode;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      hitSlop={6}
      accessibilityRole="button"
      accessibilityLabel={`Add from ${label}`}
      accessibilityState={{ disabled: !!disabled }}
      android_ripple={ripple}
      style={({ pressed }) => [styles.addBtn, (pressed || disabled) && { opacity: 0.5 }]}
    >
      {icon}
      <Text style={styles.addBtnText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { gap: 10, paddingVertical: 4, paddingRight: 8 },
  thumbWrap: { position: 'relative' },
  thumb: { width: 72, height: 72, borderRadius: 12, overflow: 'hidden', backgroundColor: colors.surface2 },
  thumbImg: { width: '100%', height: '100%' },
  docThumb: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.hairline2,
    borderRadius: 12,
  },
  docExt: { color: colors.sub, fontSize: 12, fontWeight: '800', letterSpacing: 1 },
  remove: {
    position: 'absolute',
    top: -6,
    right: -6,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: '#000',
    borderWidth: 1,
    borderColor: colors.hairline2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10 },
  addBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minHeight: 36,
    paddingVertical: 8,
    paddingHorizontal: 13,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.hairline2,
    backgroundColor: colors.surface2,
    overflow: 'hidden',
  },
  addBtnText: { color: colors.sub, fontSize: 12.5, fontWeight: '600' },
  previewBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.92)', alignItems: 'center', justifyContent: 'center', padding: 16 },
  previewImg: { width: '100%', height: '100%' },
});
