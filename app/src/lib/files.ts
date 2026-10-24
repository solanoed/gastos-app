import { Directory, File, Paths } from 'expo-file-system';

import { uid } from './uid';

function appDir(folder: string): Directory {
  const dir = new Directory(Paths.document, folder);
  dir.create({ idempotent: true, intermediates: true });
  return dir;
}

/** Copia una imagen elegida (cache temporal del picker) a almacenamiento permanente de la app. */
export async function persistImage(sourceUri: string, folder = 'adjuntos'): Promise<string> {
  const src = new File(sourceUri);
  const ext = (src.extension || '.jpg').toLowerCase();
  const dest = new File(appDir(folder), `${uid()}${ext}`);
  await src.copy(dest);
  return dest.uri;
}

export function deleteImage(uri: string) {
  try {
    const f = new File(uri);
    if (f.exists) f.delete();
  } catch {
    // Si el archivo ya no está, no hay nada que borrar.
  }
}
