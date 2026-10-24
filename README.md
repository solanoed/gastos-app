# Mis Cuentas

App personal de finanzas (Android) para registrar gastos, ingresos, gastos fijos, tarjetas de crédito a cuotas y deudas con personas, con un chat que entiende texto libre y una IA que responde preguntas sobre tus datos.

## Estructura

- `app/`: app móvil (Expo SDK 58 + React Native + SQLite local, offline-first).
- `server/`: API (Fastify + Postgres + Caddy) desplegada en una VPS de Oracle Cloud con Docker Compose.

## App

```bash
cd app
npm install
npx expo start          # probar con Expo Go
npx eas-cli@latest build -p android --profile preview   # generar APK
```

## Servidor

```bash
cd server
cp .env.example .env    # completar secretos (nunca subir .env)
docker-compose up -d --build
docker exec cuentas_api node dist/scripts/create-user.js <usuario> <contraseña>
```

Funciones del servidor:
- Usuario y contraseña (JWT) y cambio de contraseña.
- Sincronización: el celular sube una foto completa de sus datos y las fotos.
- IA (NVIDIA NIM, compatible con OpenAI) con herramientas que consultan los datos del usuario.
- Lectura de correo por IMAP: detecta pagos y facturas y los deja en la bandeja "Por aprobar".
