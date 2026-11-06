# Aberturas – Sistema de gestión

Web app estática (HTML + JS, sin compilación) con **Supabase** como base de datos y autenticación.
Se puede publicar gratis con **GitHub Pages**.

## Funcionalidades actuales
- Ingreso con **usuario y contraseña**.
- **Olvidé mi contraseña**: el usuario deja una solicitud; el administrador la ve en el panel (con un contador en el menú) y le asigna una clave temporal.
- **Cambio de clave obligatorio** en el primer ingreso y cada vez que el admin asigna una clave temporal.
- Menú lateral:
  - **Usuarios** (solo administrador): alta, edición (nombre, rol, activo/inactivo) y cambio de clave.
  - **Cambiar mi clave** (todos).
- Roles: `admin` y `user`.

Administrador inicial: **usuario `felipe` / clave `1234`** (el usuario no distingue mayúsculas: `Felipe` también funciona). Pide cambio de clave al entrar.

## Estructura
```
index.html            Pantallas (login, olvidé clave, cambio obligatorio, panel)
styles.css            Estilos
js/config.js          URL y anon key de Supabase  <-- completar
js/app.js             Lógica
supabase/schema.sql   Tablas, seguridad (RLS), funciones y usuario admin inicial
serve.ps1             Servidor local para probar (no requiere instalar nada)
```

## Puesta en marcha

### 1. Supabase
1. Crear un proyecto en https://supabase.com.
2. **SQL Editor → New query** → pegar todo `supabase/schema.sql` → **Run**.
3. **Authentication → Sign In / Providers**:
   - Desactivar **“Allow new users to sign up”** (los usuarios los crea solo el administrador desde la app).
   - El proveedor **Email** tiene que quedar habilitado (se usa internamente).
4. **Project Settings → API**: copiar **Project URL** y **anon public key** en `js/config.js`.

### 2. Probar en la PC
```powershell
powershell -ExecutionPolicy Bypass -File serve.ps1
```
Abrir http://localhost:5500 e ingresar con `felipe` / `1234`.

### 3. GitHub + GitHub Pages
1. Crear un repositorio en GitHub y subir estos archivos (con git o con “Add file → Upload files”).
2. **Settings → Pages → Branch: main / (root) → Save**.
3. La app queda en `https://<tu-usuario>.github.io/<repositorio>/`.

## Notas técnicas
- Supabase Auth exige email: internamente cada usuario es `<usuario>@aberturas.local`. El usuario nunca lo ve.
- Las altas y cambios de clave se hacen con funciones SQL `security definer` que verifican que quien llama sea admin; así no hace falta exponer la *service role key* ni tener servidor propio.
- Desactivar un usuario lo bloquea también en Supabase Auth (`banned_until`).
- Contraseñas nuevas: mínimo 6 caracteres y distinta del nombre de usuario.
