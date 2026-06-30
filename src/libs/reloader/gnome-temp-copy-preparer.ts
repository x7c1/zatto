/**
 * Production implementation of {@link TempCopyPreparer}, backed by
 * `Gio.File` and `GLib`. Owns the dev-only side effect of cloning the
 * installed extension into `/tmp/<newUuid>/` so GNOME Shell can load it as
 * a distinct extension during `npm run dev`.
 *
 * Lifted out of `reloader.ts` so the orchestration logic in `Reloader` can
 * be unit-tested with a fake; the production behaviour is unchanged.
 */

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import type { TempCopyPreparer } from './ports.js';

// Declare TextEncoder/TextDecoder for TypeScript (GJS provides them globally).
declare class TextDecoder {
  constructor(encoding: string);
  decode(data: Uint8Array): string;
}
declare class TextEncoder {
  encode(text: string): Uint8Array;
}

function getErrorMessage(e: unknown): string {
  if (e instanceof Error) {
    return e.message;
  }
  return String(e);
}

export class GnomeTempCopyPreparer implements TempCopyPreparer {
  private readonly baseUuid: string;
  private readonly extensionDir: string;

  constructor(baseUuid: string) {
    this.baseUuid = baseUuid;
    this.extensionDir = `${GLib.get_home_dir()}/.local/share/gnome-shell/extensions/${baseUuid}`;
  }

  prepare(newUuid: string): unknown {
    const tmpDir = `/tmp/${newUuid}`;
    const tmpDirFile = this.copyFilesToTemp(tmpDir);
    this.updateMetadata(tmpDirFile, newUuid);
    return tmpDirFile;
  }

  cleanupOtherTempDirs(currentTmpDir: string): void {
    const currentTmpName = currentTmpDir.split('/').pop();
    const cleanupCommand = `sh -c "cd /tmp && ls -d ${this.baseUuid}-reload-* 2>/dev/null | grep -v '${currentTmpName}' | xargs rm -rf"`;
    try {
      GLib.spawn_command_line_async(cleanupCommand);
    } catch (e: unknown) {
      console.log(`[TempCopyPreparer] cleanupOtherTempDirs failed: ${getErrorMessage(e)}`);
    }
  }

  private copyFilesToTemp(tmpDir: string): Gio.File {
    GLib.mkdir_with_parents(tmpDir, 0o755);

    const sourceDir = Gio.File.new_for_path(this.extensionDir);
    const tmpDirFile = Gio.File.new_for_path(tmpDir);

    const enumerator = sourceDir.enumerate_children(
      'standard::name,standard::type',
      Gio.FileQueryInfoFlags.NONE,
      null
    );

    while (true) {
      const fileInfo = enumerator.next_file(null);
      if (fileInfo === null) {
        break;
      }
      const name = fileInfo.get_name();
      const fileType = fileInfo.get_file_type();

      const sourceFile = sourceDir.get_child(name);
      const destFile = tmpDirFile.get_child(name);

      if (fileType === Gio.FileType.REGULAR) {
        sourceFile.copy(destFile, Gio.FileCopyFlags.OVERWRITE, null, null);
      } else if (fileType === Gio.FileType.DIRECTORY) {
        this.copyDirectoryRecursive(sourceFile, destFile);
      }
    }

    return tmpDirFile;
  }

  private copyDirectoryRecursive(sourceDir: Gio.File, destDir: Gio.File): void {
    if (!destDir.query_exists(null)) {
      destDir.make_directory_with_parents(null);
    }

    const enumerator = sourceDir.enumerate_children(
      'standard::name,standard::type',
      Gio.FileQueryInfoFlags.NONE,
      null
    );

    while (true) {
      const fileInfo = enumerator.next_file(null);
      if (fileInfo === null) {
        break;
      }
      const name = fileInfo.get_name();
      const fileType = fileInfo.get_file_type();

      const sourceFile = sourceDir.get_child(name);
      const destFile = destDir.get_child(name);

      if (fileType === Gio.FileType.REGULAR) {
        sourceFile.copy(destFile, Gio.FileCopyFlags.OVERWRITE, null, null);
      } else if (fileType === Gio.FileType.DIRECTORY) {
        this.copyDirectoryRecursive(sourceFile, destFile);
      }
    }
  }

  private updateMetadata(tmpDirFile: Gio.File, newUuid: string): void {
    const metadataFile = tmpDirFile.get_child('metadata.json');

    if (!metadataFile.query_exists(null)) {
      throw new Error('metadata.json not found');
    }

    const [success, contents] = metadataFile.load_contents(null);
    if (!success) {
      throw new Error('Failed to load metadata.json');
    }

    const metadataText = new TextDecoder('utf-8').decode(contents);
    const metadata = JSON.parse(metadataText);
    metadata.uuid = newUuid;

    const newContents = new TextEncoder().encode(JSON.stringify(metadata, null, 2));
    metadataFile.replace_contents(
      newContents,
      null,
      false,
      Gio.FileCreateFlags.REPLACE_DESTINATION,
      null
    );
  }
}
