import { config } from '../config.js';

import { toDateKey } from './format.js';
import { TOOL_DEFS, TOOLS } from './tools.js';

type Msg =
  | { role: 'system' | 'user'; content: string }
  | { role: 'assistant'; content: string | null; tool_calls?: ToolCall[] }
  | { role: 'tool'; tool_call_id: string; content: string };

type ToolCall = { id: string; type: 'function'; function: { name: string; arguments: string } };

const MAX_STEPS = 6;

function systemPrompt() {
  const now = new Date();
  const days = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
  return `Eres el asistente de "Mis Cuentas", la app de finanzas personales de un usuario en Colombia.
Hoy es ${days[now.getDay()]} ${toDateKey(now)}. Moneda: pesos colombianos (COP), sin decimales, formato $1.234.567.
Reglas:
- Usa SIEMPRE las herramientas para obtener datos; nunca inventes cifras.
- "Este mes" = mes actual; "el mes pasado" = mes anterior. Las fechas van en formato YYYY-MM-DD y los meses YYYY-MM.
- Responde en español, corto y directo (máximo ~8 líneas), con viñetas "•" cuando listes cosas. Texto plano: sin markdown (nada de **, #, tablas).
- Escribe los montos completos: $1.500.000, no $1.5 M.
- Si te piden consejos (ahorrar, si alcanza para algo), básate en los datos reales: ingresos, gastos fijos, cuotas y lo que queda.
- Si algo no se puede saber con los datos, dilo.`;
}

async function complete(model: string, messages: Msg[]) {
  const res = await fetch(`${config.ai.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.ai.apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, messages, tools: TOOL_DEFS, tool_choice: 'auto', temperature: 0.2, max_tokens: 1200 }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw new Error(`IA ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = (await res.json()) as { choices: { message: { content: string | null; tool_calls?: ToolCall[] } }[] };
  return data.choices[0].message;
}

/** Ejecuta la conversación con herramientas y devuelve el texto final. */
export async function answer(userId: number, history: { role: 'user' | 'assistant'; content: string }[]) {
  if (!config.ai.apiKey) throw new Error('La IA no está configurada en el servidor (AI_API_KEY)');
  const messages: Msg[] = [{ role: 'system', content: systemPrompt() }, ...history.slice(-12)];
  const used: string[] = [];

  for (let step = 0; step < MAX_STEPS; step++) {
    let msg;
    try {
      msg = await complete(config.ai.model, messages);
    } catch (e) {
      if (!config.ai.fallbackModel) throw e;
      msg = await complete(config.ai.fallbackModel, messages);
    }
    if (!msg.tool_calls?.length) {
      return { text: stripThinking(msg.content ?? '').trim() || 'No tengo una respuesta para eso.', tools: used };
    }
    messages.push({ role: 'assistant', content: msg.content ?? null, tool_calls: msg.tool_calls });
    for (const call of msg.tool_calls) {
      const tool = TOOLS[call.function.name];
      let result: unknown;
      try {
        const args = call.function.arguments ? JSON.parse(call.function.arguments) : {};
        result = tool ? await tool.run(userId, args) : { error: 'Herramienta desconocida' };
        used.push(call.function.name);
      } catch (e) {
        result = { error: (e as Error).message };
      }
      messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(result) });
    }
  }
  return { text: 'Me enredé consultando tus datos. ¿Puedes preguntarlo de otra forma?', tools: used };
}

/** Algunos modelos de razonamiento devuelven <think>…</think> antes de la respuesta. */
function stripThinking(s: string) {
  // La app muestra texto plano: quitar también el markdown que se cuele.
  return s
    .replace(/<think>[\s\S]*?<\/think>/g, '')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/(^|\s)\*(\S.*?)\*(?=\s|$)/g, '$1$2')
    .replace(/^#+\s*/gm, '');
}
