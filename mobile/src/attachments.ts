import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system';
import * as ImageManipulator from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { PermissionsAndroid, Platform } from 'react-native';

export interface PickedFile {
  base64: string;
  mime: string;
  name?: string;
}

/** Compress + downscale an image and return it as base64 JPEG (keeps uploads small). */
async function compressImage(uri: string): Promise<PickedFile> {
  const out = await ImageManipulator.manipulateAsync(
    uri,
    [{ resize: { width: 1600 } }],
    { compress: 0.7, format: ImageManipulator.SaveFormat.JPEG, base64: true },
  );
  return { base64: out.base64 ?? '', mime: 'image/jpeg' };
}

export async function pickImageFromLibrary(): Promise<PickedFile | null> {
  const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) return null;
  const res = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ImagePicker.MediaTypeOptions.Images,
    quality: 1,
  });
  if (res.canceled || !res.assets?.[0]?.uri) return null;
  return compressImage(res.assets[0].uri);
}

export async function pickImageFromCamera(): Promise<PickedFile | null> {
  // expo-image-picker's requestCameraPermissionsAsync() can hang indefinitely on
  // Android (its permission-result callback never fires), which is what left the
  // blanket / receipt capture stuck on "Working…". Use React Native's core
  // PermissionsAndroid — it resolves reliably — then launch the camera.
  if (Platform.OS === 'android') {
    const already = await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.CAMERA);
    if (!already) {
      const r = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.CAMERA, {
        title: 'Camera access',
        message: 'Finance Tracker needs the camera to take the photo.',
        buttonPositive: 'Allow',
      });
      if (r !== PermissionsAndroid.RESULTS.GRANTED) return null;
    }
  } else {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) return null;
  }
  const res = await ImagePicker.launchCameraAsync({ quality: 0.7 });
  if (res.canceled || !res.assets?.[0]?.uri) return null;
  return compressImage(res.assets[0].uri);
}

/** Pick a PDF or image document; images are left as-is (already compressed by source). */
export async function pickDocument(): Promise<PickedFile | null> {
  const res = await DocumentPicker.getDocumentAsync({
    type: ['application/pdf', 'image/*'],
    copyToCacheDirectory: true,
  });
  if (res.canceled || !res.assets?.[0]?.uri) return null;
  const asset = res.assets[0];
  const base64 = await FileSystem.readAsStringAsync(asset.uri, {
    encoding: FileSystem.EncodingType.Base64,
  });
  return { base64, mime: asset.mimeType ?? 'application/octet-stream', name: asset.name };
}
