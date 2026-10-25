// Saca el texto de un extracto en PDF, línea por línea, conservando el orden de las columnas.

import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

export class PdfPasswordError extends Error {
  constructor(public wrong: boolean) {
    super(wrong ? 'La contraseña del PDF no es correcta' : 'El PDF tiene contraseña');
  }
}

type TextItem = { str: string; transform: number[] };

/** Devuelve las líneas de texto de cada página (agrupa por altura y ordena de izquierda a derecha). */
export async function pdfLines(data: Uint8Array, password?: string): Promise<string[][]> {
  const task = getDocument({ data, password: password || undefined, useSystemFonts: false });
  let doc;
  try {
    doc = await task.promise;
  } catch (e) {
    const err = e as { name?: string; code?: number };
    // pdf.js: code 1 = necesita contraseña, 2 = contraseña incorrecta.
    if (err.name === 'PasswordException') throw new PdfPasswordError(err.code === 2);
    throw new Error('No pude leer el PDF');
  }
  try {
    const pages: string[][] = [];
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const content = await page.getTextContent();
      const rows: { y: number; items: { x: number; s: string }[] }[] = [];
      for (const it of content.items as TextItem[]) {
        if (!('str' in it) || !it.str.trim()) continue;
        const x = it.transform[4];
        const y = it.transform[5];
        // Mismo renglón si la altura difiere menos de 3 puntos.
        let row = rows.find((r) => Math.abs(r.y - y) < 3);
        if (!row) rows.push((row = { y, items: [] }));
        row.items.push({ x, s: it.str.trim() });
      }
      rows.sort((a, b) => b.y - a.y);
      pages.push(rows.map((r) => r.items.sort((a, b) => a.x - b.x).map((i) => i.s).join('  ')));
      page.cleanup();
    }
    return pages;
  } finally {
    await task.destroy();
  }
}
