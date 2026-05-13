# Shopify → Andreani 📦

App para exportar pedidos de Shopify en formato CSV listo para importar en Andreani.

---

## 🚀 Cómo deployar en Render (gratis)

### PASO 1 — Subir el código a GitHub

1. Entrá a [github.com](https://github.com) y creá una cuenta si no tenés
2. Clic en **"New repository"** → nombre: `shopify-andreani` → **Create repository**
3. Subí todos estos archivos al repositorio

### PASO 2 — Crear la app en Render

1. Entrá a [render.com](https://render.com) y creá una cuenta gratis
2. Clic en **"New +"** → **"Web Service"**
3. Conectá tu repositorio de GitHub
4. Configurá:
   - **Name:** shopify-andreani
   - **Runtime:** Node
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
5. Clic en **"Create Web Service"**
6. Render te da una URL tipo `https://shopify-andreani-xxxx.onrender.com` — **copiala**

### PASO 3 — Configurar variables de entorno en Render

En el dashboard de Render → tu app → **"Environment"** → agregá:

| Variable | Valor |
|----------|-------|
| `SHOPIFY_API_KEY` | Tu Client ID del Dev Dashboard |
| `SHOPIFY_API_SECRET` | Tu Secreto del Dev Dashboard |
| `HOST` | `https://tu-app.onrender.com` (la URL que te dio Render) |
| `SESSION_SECRET` | Cualquier texto largo aleatorio |

### PASO 4 — Configurar la app en Shopify Dev Dashboard

1. Entrá a `dev.shopify.com` → tu app **"andreani claude"**
2. En **Configuración** → **URLs de redirección permitidas** → agregá:
   ```
   https://tu-app.onrender.com/auth/callback
   ```
3. Guardá

### PASO 5 — ¡Listo!

Abrí `https://tu-app.onrender.com`, ingresá tu dominio de Shopify y autorizá la app.

---

## 📋 Variables de entorno

| Variable | Descripción |
|----------|-------------|
| `SHOPIFY_API_KEY` | Client ID de tu app en Shopify |
| `SHOPIFY_API_SECRET` | Secreto de tu app en Shopify |
| `HOST` | URL pública de tu app |
| `SESSION_SECRET` | Clave para encriptar sesiones |
| `PORT` | Puerto (Render lo setea automáticamente) |
