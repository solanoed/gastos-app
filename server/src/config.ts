function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Falta la variable de entorno ${name}`);
  return v;
}

export const config = {
  port: Number(process.env.PORT ?? 3100),
  databaseUrl: required('DATABASE_URL'),
  jwtSecret: required('JWT_SECRET'),
  filesDir: process.env.FILES_DIR ?? '/data/files',
  ai: {
    baseUrl: process.env.AI_BASE_URL ?? 'https://integrate.api.nvidia.com/v1',
    apiKey: process.env.AI_API_KEY ?? '',
    model: process.env.AI_MODEL ?? 'nvidia/nemotron-3.5-lightning-30b-a3b',
    fallbackModel: process.env.AI_FALLBACK_MODEL ?? 'openai/gpt-oss-20b',
  },
  mail: {
    host: process.env.IMAP_HOST ?? 'imap.gmail.com',
    address: process.env.IMAP_EMAIL_ADDRESS ?? '',
    // Gmail muestra la contraseña de aplicación con espacios; no hacen parte de ella.
    password: (process.env.IMAP_APP_PASSWORD ?? '').replace(/\s+/g, ''),
    /** Usuario de la app al que se asignan los movimientos detectados. */
    username: process.env.MAIL_APP_USER ?? 'david',
    pollMinutes: Number(process.env.MAIL_POLL_MINUTES ?? 10),
  },
  timezone: process.env.TZ ?? 'America/Bogota',
};
