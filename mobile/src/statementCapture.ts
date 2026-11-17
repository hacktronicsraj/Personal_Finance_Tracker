import * as DocumentPicker from 'expo-document-picker';
import { Alert } from 'react-native';
import { parseStatement, type StatementDetail } from './api/client';
import { clearStatementReminders } from './notify/notifications';
import { extractPdfText, PdfPasswordError, pdfToolsAvailable } from './pdf';

/** Ask for the PDF password with a native prompt (iOS-style; Android uses Alert). */
function promptPassword(): Promise<string | null> {
  return new Promise((resolve) => {
    Alert.prompt?.(
      'Password protected',
      'Enter the statement password.',
      [
        { text: 'Cancel', style: 'cancel', onPress: () => resolve(null) },
        { text: 'Unlock', onPress: (v?: string) => resolve(v ?? '') },
      ],
      'secure-text',
    ) ?? resolve(null);
  });
}

/**
 * Turn a bank-statement PDF (already at `uri`, or picked here) into a parsed +
 * reconciled statement. Extraction runs ON DEVICE (PDFBox); only the resulting
 * text is uploaded. Handles password-protected PDFs by asking for the password
 * and retrying locally. On success it clears this week's statement reminders.
 */
export async function processStatementPdf(
  uri: string,
  fileName: string | undefined,
  onStatus?: (s: string) => void,
): Promise<StatementDetail | null> {
  if (!pdfToolsAvailable()) throw new Error('PDF reading needs a fresh build of the app.');
  onStatus?.('Reading the PDF…');
  let pages: string[] | null = null;
  try {
    pages = await extractPdfText(uri);
  } catch (e) {
    if (e instanceof PdfPasswordError) {
      const pw = await promptPassword();
      if (pw == null) return null;
      onStatus?.('Unlocking…');
      pages = await extractPdfText(uri, pw); // throws again if the password is wrong
    } else {
      throw e;
    }
  }
  const nonEmpty = (pages ?? []).filter((p) => p.trim().length > 0);
  if (nonEmpty.length === 0) {
    throw new Error('This PDF has no readable text (it may be a scan). Try sharing it as an image.');
  }
  onStatus?.('Matching against your ledger…');
  const detail = await parseStatement({ fileName, pages });
  await clearStatementReminders().catch(() => {});
  return detail;
}

/** Pick a PDF from the device and process it. */
export async function pickStatementPdf(onStatus?: (s: string) => void): Promise<StatementDetail | null> {
  const res = await DocumentPicker.getDocumentAsync({ type: 'application/pdf', copyToCacheDirectory: true });
  if (res.canceled || !res.assets?.[0]?.uri) return null;
  return processStatementPdf(res.assets[0].uri, res.assets[0].name, onStatus);
}
