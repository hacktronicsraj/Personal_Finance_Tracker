const { withDangerousMod, withMainApplication, withAppBuildGradle } = require('expo/config-plugins');
const fs = require('fs');
const path = require('path');

const PKG = 'com.personal.financetracker';

/**
 * On-device PDF text extraction (PDFBox-Android). The bank statement never leaves
 * the phone as a file — only the extracted text (and only after the user shares
 * it) is uploaded for reconciliation. Handles password-protected statements:
 * the password is typed on the phone and used to decrypt locally.
 *
 * `PdfTools.extractText(uri, password?)` → Promise<string[]> (one entry per page).
 * A page with no text layer comes back as "" so the caller can fall back to
 * sending page images to the vision model instead.
 */

const MODULE_KT = `package ${PKG}

import android.net.Uri
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.tom_roush.pdfbox.android.PDFBoxResourceLoader
import com.tom_roush.pdfbox.pdmodel.PDDocument
import com.tom_roush.pdfbox.text.PDFTextStripper

class PdfToolsModule(reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {
  init { PDFBoxResourceLoader.init(reactContext.applicationContext) }
  override fun getName(): String = "PdfTools"

  @ReactMethod
  fun extractText(uriString: String, password: String?, promise: Promise) {
    var doc: PDDocument? = null
    try {
      val stream = reactApplicationContext.contentResolver.openInputStream(Uri.parse(uriString))
        ?: run { promise.reject("PDF_OPEN", "Could not open the PDF"); return }
      doc = if (password.isNullOrEmpty()) PDDocument.load(stream) else PDDocument.load(stream, password)
      val stripper = PDFTextStripper()
      val pageCount = doc.numberOfPages
      val pages = Arguments.createArray()
      for (i in 1..pageCount) {
        stripper.startPage = i
        stripper.endPage = i
        stripper.sortByPosition = true
        pages.pushString(try { stripper.getText(doc) } catch (e: Exception) { "" })
      }
      promise.resolve(pages)
    } catch (e: com.tom_roush.pdfbox.pdmodel.encryption.InvalidPasswordException) {
      promise.reject("PDF_PASSWORD", "This statement is password protected.")
    } catch (e: Exception) {
      promise.reject("PDF_ERR", e.message ?: "Could not read the PDF")
    } finally {
      try { doc?.close() } catch (e: Exception) {}
    }
  }

  @ReactMethod
  fun isEncrypted(uriString: String, promise: Promise) {
    try {
      val stream = reactApplicationContext.contentResolver.openInputStream(Uri.parse(uriString))
      PDDocument.load(stream).use { promise.resolve(false) }
    } catch (e: com.tom_roush.pdfbox.pdmodel.encryption.InvalidPasswordException) {
      promise.resolve(true)
    } catch (e: Exception) {
      promise.resolve(false)
    }
  }
}
`;

const PACKAGE_KT = `package ${PKG}

import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.ViewManager

class PdfToolsPackage : ReactPackage {
  override fun createNativeModules(reactContext: ReactApplicationContext): List<NativeModule> =
    listOf(PdfToolsModule(reactContext))
  override fun createViewManagers(reactContext: ReactApplicationContext): List<ViewManager<*, *>> =
    emptyList()
}
`;

function withDependency(config) {
  return withAppBuildGradle(config, (cfg) => {
    if (!cfg.modResults.contents.includes('pdfbox-android')) {
      cfg.modResults.contents = cfg.modResults.contents.replace(
        /dependencies\s*\{/,
        'dependencies {\n    implementation("com.tom-roush:pdfbox-android:2.0.27.0")',
      );
    }
    return cfg;
  });
}

function withNativeFiles(config) {
  return withDangerousMod(config, [
    'android',
    (cfg) => {
      const javaDir = path.join(cfg.modRequest.platformProjectRoot, 'app/src/main/java', ...PKG.split('.'));
      fs.mkdirSync(javaDir, { recursive: true });
      fs.writeFileSync(path.join(javaDir, 'PdfToolsModule.kt'), MODULE_KT);
      fs.writeFileSync(path.join(javaDir, 'PdfToolsPackage.kt'), PACKAGE_KT);
      return cfg;
    },
  ]);
}

function withPackageRegistration(config) {
  return withMainApplication(config, (cfg) => {
    let src = cfg.modResults.contents;
    if (!src.includes('PdfToolsPackage()')) {
      src = src.replace(/(val packages = PackageList\(this\)\.packages)/, '$1\n            packages.add(PdfToolsPackage())');
    }
    cfg.modResults.contents = src;
    return cfg;
  });
}

module.exports = (config) => withPackageRegistration(withNativeFiles(withDependency(config)));
