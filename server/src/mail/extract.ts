// Usa la IA para sacar los datos de un correo bancario o de facturación.

import { config } from '../config.js';

export type Extracted = {
  es_movimiento: boolean;
  tipo: 'gasto' | 'ingreso' | 'pago_fijo' | 'factura_por_pagar' | 'otro';
  monto: number | null;
  comercio: string | null;
  concepto: string | null;
  fecha: string | null;
  vence: string | null;
  tarjeta_ultimos4: string | null;
  categoria_sugerida: string | null;
  gasto_fijo_relacionado: string | null;
};

const PROMPT = `Analiza este correo de un usuario en Colombia y responde SOLO con un objeto JSON (sin texto extra) con estas claves:
- es_movimiento: true solo si el correo informa una transacción real con monto (compra, pago realizado, transferencia, retiro, ingreso recibido) o una factura/cobro concreto por pagar. Publicidad, promociones, extractos generales sin un monto puntual o avisos de seguridad = false.
- tipo: "gasto" (compra/débito/retiro/transferencia enviada), "ingreso" (dinero recibido), "pago_fijo" (confirmación de pago de una obligación como ICETEX, crédito, servicio), "factura_por_pagar" (factura o cobro pendiente) u "otro".
- monto: número en pesos sin puntos ni símbolo (ej 152300), o null.
- comercio: dónde/a quién (ej "Rappi", "ICETEX", "Movistar"), o null.
- concepto: descripción corta en español (máx 6 palabras).
- fecha: fecha de la transacción YYYY-MM-DD, o null.
- vence: fecha límite de pago YYYY-MM-DD si es factura, o null.
- tarjeta_ultimos4: últimos 4 dígitos de la tarjeta/cuenta si aparecen, o null.
- categoria_sugerida: UNA de estas categorías del usuario o null: {CATEGORIAS}
- gasto_fijo_relacionado: si corresponde a uno de estos gastos fijos del usuario, su nombre exacto; si no, null: {FIJOS}`;

export async function extractFromEmail(
  mail: { from: string; subject: string; date: string; text: string },
  categories: string[],
  fixed: string[],
): Promise<Extracted | null> {
  const system = PROMPT.replace('{CATEGORIAS}', categories.join(', ') || '(ninguna)').replace('{FIJOS}', fixed.join(', ') || '(ninguno)');
  const user = `De: ${mail.from}\nFecha del correo: ${mail.date}\nAsunto: ${mail.subject}\n\n${mail.text.slice(0, 3500)}`;
  for (const model of [config.ai.model, config.ai.fallbackModel].filter(Boolean)) {
    try {
      const res = await fetch(`${config.ai.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${config.ai.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          temperature: 0,
          max_tokens: 600,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user },
          ],
        }),
        signal: AbortSignal.timeout(60_000),
      });
      if (!res.ok) continue;
      const data = (await res.json()) as { choices: { message: { content: string | null } }[] };
      const parsed = parseJson(data.choices[0].message.content ?? '');
      if (parsed) return parsed;
    } catch {
      // probar con el modelo de respaldo
    }
  }
  return null;
}

function parseJson(s: string): Extracted | null {
  const clean = s.replace(/<think>[\s\S]*?<\/think>/g, '');
  const start = clean.indexOf('{');
  const end = clean.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    const o = JSON.parse(clean.slice(start, end + 1)) as Extracted;
    if (typeof o.monto === 'string') o.monto = Number(String(o.monto).replace(/[^\d]/g, '')) || null;
    return o;
  } catch {
    return null;
  }
}
