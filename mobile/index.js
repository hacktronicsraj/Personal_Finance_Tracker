import { AppRegistry } from 'react-native';
import { ingestSms } from './src/sms/ingest';

// Runs when the native SmsReceiver fires — even if the app is killed. Classifies
// the transaction and posts the confirm-category notification in the background.
AppRegistry.registerHeadlessTask('SmsHeadlessTask', () => async (data) => {
  try {
    if (data?.body) await ingestSms(String(data.body), data.sender ? String(data.sender) : undefined);
  } catch {
    // swallow — a failed background ingest must not crash the task
  }
});

// Boot the expo-router UI as usual.
import 'expo-router/entry';
