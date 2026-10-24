import * as SecureStore from 'expo-secure-store';

export const DEFAULT_SERVER = 'https://157-137-202-209.sslip.io';

const TOKEN_KEY = 'auth_token';
const USER_KEY = 'auth_username';
const SERVER_KEY = 'server_url';

// Cache en memoria para no leer SecureStore en cada petición.
let session: { token: string | null; username: string | null; server: string } | null = null;

export async function getSession() {
  if (!session) {
    const [token, username, server] = await Promise.all([
      SecureStore.getItemAsync(TOKEN_KEY),
      SecureStore.getItemAsync(USER_KEY),
      SecureStore.getItemAsync(SERVER_KEY),
    ]);
    session = { token, username, server: server || DEFAULT_SERVER };
  }
  return session;
}

export async function saveSession(token: string, username: string, server: string) {
  await Promise.all([
    SecureStore.setItemAsync(TOKEN_KEY, token),
    SecureStore.setItemAsync(USER_KEY, username),
    SecureStore.setItemAsync(SERVER_KEY, server),
  ]);
  session = { token, username, server };
}

export async function clearSession() {
  await Promise.all([SecureStore.deleteItemAsync(TOKEN_KEY), SecureStore.deleteItemAsync(USER_KEY)]);
  session = { token: null, username: null, server: session?.server ?? DEFAULT_SERVER };
}

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

/** Petición JSON al servidor con el token de la sesión. */
export async function api<T>(path: string, init: RequestInit & { json?: unknown; server?: string; timeoutMs?: number } = {}): Promise<T> {
  const s = await getSession();
  const headers: Record<string, string> = { ...(init.headers as Record<string, string>) };
  if (s.token) headers.Authorization = `Bearer ${s.token}`;
  let body = init.body;
  if (init.json !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(init.json);
  }
  let res: Response;
  try {
    res = await fetch(`${init.server ?? s.server}${path}`, {
      ...init,
      headers,
      body,
      signal: AbortSignal.timeout(init.timeoutMs ?? 30_000),
    });
  } catch {
    throw new ApiError('No hay conexión con el servidor', 0);
  }
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) {
    if (res.status === 401 && s.token && path !== '/auth/login') await clearSession();
    throw new ApiError(data.error ?? `Error ${res.status}`, res.status);
  }
  return data as T;
}

export async function login(username: string, password: string, server: string) {
  const r = await api<{ token: string; username: string }>('/auth/login', {
    method: 'POST',
    json: { username, password },
    server,
  });
  await saveSession(r.token, r.username, server);
  return r;
}
