import { NativeModules, Platform } from 'react-native';

/** Bridge to on-device PDF text extraction (plugins/withPdfText.js, PDFBox). */
const M = (NativeModules as any).PdfTools as
  | {
      extractText(uri: string, password: string | null): Promise<string[]>;
      isEncrypted(uri: string): Promise<boolean>;
    }
  | undefined;

export function pdfToolsAvailable(): boolean {
  return Platform.OS === 'android' && !!M;
}

export class PdfPasswordError extends Error {}

/** Returns one text string per page. Throws PdfPasswordError when a password is needed/wrong. */
export async function extractPdfText(uri: string, password?: string): Promise<string[]> {
  if (!M) throw new Error('PDF reader unavailable in this build');
  try {
    return await M.extractText(uri, password ?? null);
  } catch (e: any) {
    if (e?.code === 'PDF_PASSWORD') throw new PdfPasswordError(e?.message ?? 'Password required');
    throw new Error(e?.message ?? 'Could not read the PDF');
  }
}

export async function pdfIsEncrypted(uri: string): Promise<boolean> {
  try {
    return (await M?.isEncrypted(uri)) ?? false;
  } catch {
    return false;
  }
}
