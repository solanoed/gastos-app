import { config } from '../config.js';

/** Pide a la IA una respuesta en JSON (prueba el modelo principal y luego el de respaldo). */
export async function completeJson<T>(system: string, user: string, maxTokens = 1200): Promise<T | null> {
  for (const model of [config.ai.model, config.ai.fallbackModel].filter(Boolean)) {
    try {
      const res = await fetch(`${config.ai.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${config.ai.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          temperature: 0,
          max_tokens: maxTokens,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user },
          ],
        }),
        signal: AbortSignal.timeout(120_000),
      });
      if (!res.ok) continue;
      const data = (await res.json()) as { choices: { message: { content: string | null } }[] };
      const parsed = parseJson<T>(data.choices[0].message.content ?? '');
      if (parsed) return parsed;
    } catch {
      // probar con el modelo de respaldo
    }
  }
  return null;
}

export function parseJson<T>(s: string): T | null {
  const clean = s.replace(/<think>[\s\S]*?<\/think>/g, '');
  const start = clean.indexOf('{');
  const end = clean.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(clean.slice(start, end + 1)) as T;
  } catch {
    return null;
  }
}

/** Monto que puede venir como número o texto ("152.300", "$ 1,500.00"): pesos enteros, positivo. */
export function toAmount(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) && v !== 0 ? Math.abs(Math.round(v)) : null;
  if (typeof v !== 'string') return null;
  let s = v.replace(/[^\d.,-]/g, '');
  // Decimales al final (",00" o ".00") se descartan; el resto de separadores son de miles.
  s = s.replace(/[.,]\d{1,2}$/, '').replace(/[.,]/g, '');
  const n = Math.abs(Number(s));
  return Number.isFinite(n) && n > 0 ? n : null;
}
