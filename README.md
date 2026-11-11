# 330 – Sistema de gestión (aberturas de aluminio)

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

## Módulos (cuadrados del inicio)
| Módulo | Quién lo ve | Qué hace |
|---|---|---|
| **Ventas** | Admin | Precio final + compras de la venta (valor de compra total) → **utilidad automática**. Permite sumar compras “sin asignar”. |
| **Compras** | Admin | Monto, proveedor y detalle. Una compra nueva se asocia sola a la última venta (se puede cambiar). Totales por proveedor. |
| **Monotributo** | Admin | Mes a mes: cuota (pagada/no, comprobante) y facturas emitidas/recibidas con su PDF o foto. Facturado últimos 12 meses. |
| **Gastos hormiga** | Admin | Gastos chicos por categoría, total y promedio diario del mes. |
| **Tareas Taller / Oficina** | Todos | Se crean, se asignan a cualquier usuario y se marcan como hechas. Cada uno ve las suyas; el admin ve todas. |
| **Usuarios** | Admin | Alta, roles, activar/desactivar, claves. |

La base de datos de los módulos está en `supabase/02_modulos.sql` (ejecutar después de `schema.sql`).

## Estructura
```
index.html            Pantallas (login, olvidé clave, cambio obligatorio, panel)
styles.css            Estilos
js/config.js          URL y anon key de Supabase  <-- completar
js/app.js             Lógica general (ingreso, menú, usuarios, herramientas comunes)
js/modules/*.js       Un archivo por módulo (ventas, compras, monotributo, gastos, tareas)
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

## Publicar una versión nueva
1. Cambiar `version` (y `notes`) en `version.json`, por ejemplo `2026-11-07.1`.
2. Subir a GitHub. En ~1 minuto GitHub Pages publica.
3. Quien tenga la app abierta ve un globito naranja junto a las **flechitas**; al tocarlas se carga la versión nueva (sin caché).

## Notas técnicas
- Supabase Auth exige email: internamente cada usuario es `<usuario>@aberturas.local`. El usuario nunca lo ve.
- Las altas y cambios de clave se hacen con funciones SQL `security definer` que verifican que quien llama sea admin; así no hace falta exponer la *service role key* ni tener servidor propio.
- Desactivar un usuario lo bloquea también en Supabase Auth (`banned_until`).
- Contraseñas nuevas: mínimo 6 caracteres y distinta del nombre de usuario.
