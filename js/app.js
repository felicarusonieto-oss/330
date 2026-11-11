import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
// config.js se pide con la misma versión que app.js para que tampoco quede en caché
const { SUPABASE_URL, SUPABASE_ANON_KEY, EMAIL_DOMAIN } =
  await import('./config.js' + new URL(import.meta.url).search);

const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

let me = null;      // perfil del usuario logueado
let users = [];     // cache de usuarios (admin)

// ---------------------------------------------------------------- utilidades
const toEmail = (username) => `${username.trim().toLowerCase()}@${EMAIL_DOMAIN}`;

function setMsg(form, text, type = 'error') {
  const el = $('[data-msg]', form);
  el.textContent = text || '';
  el.className = `msg ${text ? type : ''}`;
}

function busy(form, on) {
  $$('button', form).forEach((b) => (b.disabled = on));
}

function toast(text) {
  const t = $('#toast');
  t.textContent = text;
  t.classList.remove('hidden');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.add('hidden'), 3000);
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function friendlyError(err) {
  const m = err?.message || String(err);
  if (/invalid login credentials/i.test(m)) return 'Usuario o contraseña incorrectos.';
  if (/banned/i.test(m)) return 'El usuario está desactivado. Consultá con el administrador.';
  if (/failed to fetch/i.test(m)) return 'No se pudo conectar con el servidor.';
  return m;
}

function checkNewPassword(form) {
  const p1 = form.password.value;
  const p2 = form.password2.value;
  if (p1.length < 6) return 'La contraseña debe tener al menos 6 caracteres.';
  if (p1 !== p2) return 'Las contraseñas no coinciden.';
  return null;
}

// ---------------------------------------------------------------- navegación
function showAuth(viewId) {
  $('#app-screen').classList.add('hidden');
  $('#auth-screen').classList.remove('hidden');
  $$('.auth-view').forEach((v) => v.classList.toggle('hidden', v.id !== viewId));
  $$('.auth-view').forEach((v) => setMsg(v, ''));
  $(`#${viewId} input`)?.focus();
}

function showApp() {
  $('#auth-screen').classList.add('hidden');
  $('#app-screen').classList.remove('hidden');
  const isAdmin = me.role === 'admin';
  $$('.admin-only').forEach((el) => el.classList.toggle('hidden', !isAdmin));
  $('#current-user').innerHTML =
    `<b>${escapeHtml(me.full_name || me.username)}</b><br><small>${isAdmin ? 'Administrador' : 'Usuario'}</small>`;
  toggleSettings(false);
  showPage('home');
  if (isAdmin) refreshResetCount();
}

function toggleSettings(open) {
  const menu = $('#settings-menu');
  const show = open ?? menu.classList.contains('hidden');
  menu.classList.toggle('hidden', !show);
  $('#btn-settings').setAttribute('aria-expanded', String(show));
}

async function refreshResetCount() {
  const { count } = await sb.from('password_reset_requests')
    .select('id', { count: 'exact', head: true }).is('resolved_at', null);
  setResetBadge(count || 0);
}

function setResetBadge(n) {
  $('#reset-badge').textContent = n;
  $('#reset-badge').classList.toggle('hidden', n === 0);
  $('#gear-badge').classList.toggle('hidden', n === 0);
  $('#tile-badge').textContent = n;
  $('#tile-badge').classList.toggle('hidden', n === 0);
}

function showPage(name) {
  toggleSettings(false);
  if (name === 'users' && me?.role !== 'admin') name = 'home'; // solo administradores
  $$('.page').forEach((p) => p.classList.toggle('hidden', p.id !== `page-${name}`));
  $$('#menu a').forEach((a) => a.classList.toggle('active', a.dataset.page === name));
  if (name === 'home' && me) refreshTaskBadges();
  if (name === 'users') loadUsers();
  if (name === 'my-password') { $('#my-password-form').reset(); setMsg($('#my-password-form'), ''); }
}

// ---------------------------------------------------------------- módulos
// Cada módulo vive en js/modules/<archivo>.js y exporta render(contenedor, ctx, opciones)
const V = new URL(import.meta.url).search;
const MODULES = {
  ventas:           { file: 'ventas',      admin: true },
  compras:          { file: 'compras',     admin: true },
  monotributo:      { file: 'monotributo', admin: true },
  gastos:           { file: 'gastos',      admin: true },
  'tareas-taller':  { file: 'tareas',      opts: { area: 'taller' } },
  'tareas-oficina': { file: 'tareas',      opts: { area: 'oficina' } },
};

async function openModule(name) {
  const mod = MODULES[name];
  if (!mod || (mod.admin && me?.role !== 'admin')) return showPage('home');
  showPage('module');
  const el = $('#page-module');
  el.onclick = el.onchange = el.oninput = null; // limpia eventos del módulo anterior
  el.innerHTML = '<p class="hint">Cargando…</p>';
  try {
    const m = await import(`./modules/${mod.file}.js${V}`);
    await m.render(el, ctx, mod.opts || {});
  } catch (e) {
    el.innerHTML = `${ctx.backLink}<div class="card"><p class="msg error">${escapeHtml(friendlyError(e))}</p></div>`;
  }
}

async function refreshTaskBadges() {
  for (const area of ['taller', 'oficina']) {
    const { count } = await sb.from('tareas').select('id', { count: 'exact', head: true })
      .eq('area', area).eq('asignado_a', me.id).neq('estado', 'hecha');
    const b = $(`#badge-tareas-${area}`);
    b.textContent = count || 0;
    b.classList.toggle('hidden', !count);
  }
}

// --- herramientas compartidas con los módulos
const moneyFmt = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' });
const isoDate = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);

const ctx = {
  sb,
  $, $$,
  esc: escapeHtml,
  toast,
  get me() { return me; },
  get isAdmin() { return me?.role === 'admin'; },
  backLink: '<a href="#" class="back" data-page="home">← Inicio</a>',
  money: (n) => moneyFmt.format(Number(n) || 0),
  // "15/11/2026" a partir de "2026-11-15"
  date: (d) => { if (!d) return ''; const [y, m, dd] = String(d).slice(0, 10).split('-'); return `${dd}/${m}/${y}`; },
  today: () => isoDate(new Date()),
  monthNow: () => isoDate(new Date()).slice(0, 7),
  // "2026-11" -> { from: "2026-11-01", to: "2026-12-01" } (to excluido)
  monthRange: (ym) => {
    const [y, m] = ym.split('-').map(Number);
    return { from: `${ym}-01`, to: isoDate(new Date(y, m, 1)) };
  },
  addMonths: (ym, n) => { const [y, m] = ym.split('-').map(Number); return isoDate(new Date(y, m - 1 + n, 1)).slice(0, 7); },
  monthName: (ym) => {
    const [y, m] = ym.split('-').map(Number);
    const s = new Date(y, m - 1, 1).toLocaleDateString('es-AR', { month: 'long', year: 'numeric' });
    return s.charAt(0).toUpperCase() + s.slice(1);
  },
  // Acepta "1500", "1500,50", "1.500,50", "1500.5", "$ 1.500"
  num: (s) => {
    let t = String(s ?? '').replace(/[^\d.,-]/g, '');
    if (!t) return 0;
    if (t.includes(',')) t = t.replace(/\./g, '').replace(',', '.');
    else if (/^-?\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, '');
    const n = parseFloat(t);
    return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
  },
  // Devuelve los datos o lanza el error de Supabase
  must: (res) => { if (res.error) throw res.error; return res.data; },
  usersBasic: [],
  async loadUsersBasic() {
    const { data } = await sb.rpc('list_users_basic');
    this.usersBasic = data || [];
    return this.usersBasic;
  },
  userName(id) {
    const u = this.usersBasic.find((x) => x.id === id);
    return u ? (u.full_name || u.username) : '—';
  },
  async loadProveedores() {
    const { data } = await sb.from('compras').select('proveedor').order('proveedor').limit(2000);
    const list = [...new Set((data || []).map((r) => r.proveedor))];
    $('#dl-proveedores').innerHTML = list.map((p) => `<option value="${escapeHtml(p)}">`).join('');
    return list;
  },
  confirm: (msg) => window.confirm(msg),
  openForm,
};

// Abre el formulario genérico. submit(form) debe lanzar un error si algo falla.
function openForm({ title, html, submitLabel = 'Guardar', wide = false, init, submit }) {
  const dlg = $('#dlg-form');
  const f = $('#form-generic');
  dlg.classList.toggle('wide', wide);
  f.innerHTML = `<h2>${escapeHtml(title)}</h2>${html}
    <p class="msg" data-msg></p>
    <div class="modal-actions">
      <button type="button" class="btn ghost" data-close>Cancelar</button>
      <button type="submit" class="btn primary">${escapeHtml(submitLabel)}</button>
    </div>`;
  return new Promise((resolve) => {
    f.onsubmit = async (e) => {
      e.preventDefault();
      setMsg(f, '');
      busy(f, true);
      try {
        const r = await submit(f);
        dlg.close();
        resolve(r ?? true);
      } catch (err) {
        setMsg(f, friendlyError(err));
      } finally {
        busy(f, false);
      }
    };
    dlg.onclose = () => resolve(false);
    dlg.showModal();
    init?.(f);
    f.querySelector('input:not([type=hidden]), select, textarea')?.focus();
  });
}

// ---------------------------------------------------------------- sesión
async function loadMe() {
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return null;
  const { data, error } = await sb.from('profiles').select('*').eq('id', user.id).single();
  if (error) throw error;
  return data;
}

async function route() {
  try {
    me = await loadMe();
  } catch (e) {
    me = null;
  }
  if (!me) return showAuth('login-form');
  if (!me.active) {
    await sb.auth.signOut();
    showAuth('login-form');
    return setMsg($('#login-form'), 'El usuario está desactivado.');
  }
  if (me.must_change_password) return showAuth('force-change-form');
  showApp();
}

async function logout() {
  await sb.auth.signOut();
  me = null;
  showAuth('login-form');
}

// ---------------------------------------------------------------- formularios de acceso
$('#login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.currentTarget;
  setMsg(f, '');
  busy(f, true);
  const { error } = await sb.auth.signInWithPassword({
    email: toEmail(f.username.value),
    password: f.password.value,
  });
  busy(f, false);
  if (error) return setMsg(f, friendlyError(error));
  f.reset();
  await route();
});

$('#forgot-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.currentTarget;
  busy(f, true);
  const { error } = await sb.rpc('request_password_reset', { p_username: f.username.value });
  busy(f, false);
  if (error) return setMsg(f, friendlyError(error));
  f.reset();
  setMsg(f, 'Listo. El administrador recibió tu solicitud y te va a dar una clave temporal.', 'ok');
});

$('#force-change-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.currentTarget;
  const bad = checkNewPassword(f);
  if (bad) return setMsg(f, bad);
  busy(f, true);
  const { error } = await sb.rpc('change_own_password', { p_new_password: f.password.value });
  busy(f, false);
  if (error) return setMsg(f, friendlyError(error));
  f.reset();
  toast('Contraseña actualizada');
  await route();
});

$('#my-password-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.currentTarget;
  const bad = checkNewPassword(f);
  if (bad) return setMsg(f, bad);
  busy(f, true);
  const { error } = await sb.rpc('change_own_password', { p_new_password: f.password.value });
  busy(f, false);
  if (error) return setMsg(f, friendlyError(error));
  f.reset();
  setMsg(f, 'Contraseña actualizada.', 'ok');
});

// ---------------------------------------------------------------- usuarios (admin)
async function loadUsers() {
  const [{ data: list, error }, { data: reqs }] = await Promise.all([
    sb.from('profiles').select('*').order('username'),
    sb.from('password_reset_requests')
      .select('id, created_at, profile_id').is('resolved_at', null).order('created_at'),
  ]);
  if (error) return toast(friendlyError(error));
  users = list;
  renderUsers();
  renderRequests(reqs || []);
}

function renderUsers() {
  $('#users-tbody').innerHTML = users.map((u) => `
    <tr class="${u.active ? '' : 'inactive'}">
      <td><b>${escapeHtml(u.username)}</b></td>
      <td>${escapeHtml(u.full_name)}</td>
      <td>
        <select class="role-select ${u.role}" data-role="${u.id}" ${u.id === me.id ? 'disabled title="No podés cambiar tu propio rol"' : ''}>
          <option value="user" ${u.role === 'user' ? 'selected' : ''}>Usuario</option>
          <option value="admin" ${u.role === 'admin' ? 'selected' : ''}>Administrador</option>
        </select>
      </td>
      <td>${u.active ? '<span class="tag ok">Activo</span>' : '<span class="tag off">Inactivo</span>'}</td>
      <td>${u.must_change_password ? '<span class="tag pending">Debe cambiarla</span>' : '—'}</td>
      <td class="actions">
        <button class="btn small" data-edit="${u.id}">Editar</button>
        <button class="btn small" data-pass="${u.id}">Cambiar clave</button>
      </td>
    </tr>`).join('');
}

function renderRequests(reqs) {
  const byId = Object.fromEntries(users.map((u) => [u.id, u]));
  $('#reset-requests').classList.toggle('hidden', reqs.length === 0);
  setResetBadge(reqs.length);
  $('#reset-list').innerHTML = reqs.map((r) => {
    const u = byId[r.profile_id] || {};
    const when = new Date(r.created_at).toLocaleString('es-AR');
    return `<li>
      <span><b>${escapeHtml(u.username)}</b> ${escapeHtml(u.full_name || '')} <small>· ${when}</small></span>
      <span>
        <button class="btn small primary" data-pass="${r.profile_id}">Asignar clave</button>
        <button class="btn small ghost" data-dismiss="${r.id}">Descartar</button>
      </span>
    </li>`;
  }).join('');
}

// Delegación de clicks en la página de usuarios
$('#page-users').addEventListener('click', async (e) => {
  const t = e.target.closest('button');
  if (!t) return;
  if (t.dataset.edit) openUserDialog(users.find((u) => u.id === t.dataset.edit));
  if (t.dataset.pass) openPasswordDialog(users.find((u) => u.id === t.dataset.pass));
  if (t.dataset.dismiss) {
    const { error } = await sb.rpc('admin_dismiss_request', { p_request_id: Number(t.dataset.dismiss) });
    if (error) return toast(friendlyError(error));
    loadUsers();
  }
});

// Cambio de rol directo desde la tabla
$('#page-users').addEventListener('change', async (e) => {
  const sel = e.target.closest('[data-role]');
  if (!sel) return;
  const u = users.find((x) => x.id === sel.dataset.role);
  const role = sel.value;
  const label = role === 'admin' ? 'Administrador' : 'Usuario';
  if (!confirmRole(u, label)) { sel.value = u.role; return; }
  sel.disabled = true;
  const { error } = await sb.rpc('admin_update_user', {
    p_user_id: u.id, p_full_name: u.full_name, p_role: role, p_active: u.active,
  });
  sel.disabled = false;
  if (error) { sel.value = u.role; return toast(friendlyError(error)); }
  toast(`${u.username} ahora es ${label}`);
  loadUsers();
});

function confirmRole(u, label) {
  return window.confirm(`¿Cambiar a "${u.username}" a ${label}?`);
}

$('#btn-new-user').addEventListener('click', () => openUserDialog(null));

// --- modal usuario (alta / edición)
let editing = null;
function openUserDialog(user) {
  editing = user;
  const dlg = $('#dlg-user');
  const f = $('#user-form');
  f.reset();
  setMsg(f, '');
  $('[data-title]', f).textContent = user ? `Editar usuario` : 'Nuevo usuario';
  $$('.only-new', f).forEach((el) => el.classList.toggle('hidden', !!user));
  $$('.only-edit', f).forEach((el) => el.classList.toggle('hidden', !user));
  f.username.disabled = !!user;
  f.password.required = !user;
  if (user) {
    f.username.value = user.username;
    f.full_name.value = user.full_name;
    f.role.value = user.role;
    f.active.checked = user.active;
  }
  dlg.showModal();
}

$('#user-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.currentTarget;
  busy(f, true);
  let error;
  if (editing) {
    ({ error } = await sb.rpc('admin_update_user', {
      p_user_id: editing.id,
      p_full_name: f.full_name.value,
      p_role: f.role.value,
      p_active: f.active.checked,
    }));
  } else {
    ({ error } = await sb.rpc('admin_create_user', {
      p_username: f.username.value,
      p_full_name: f.full_name.value,
      p_password: f.password.value,
      p_role: f.role.value,
    }));
  }
  busy(f, false);
  if (error) return setMsg(f, friendlyError(error));
  $('#dlg-user').close();
  toast(editing ? 'Usuario actualizado' : 'Usuario creado');
  loadUsers();
});

// --- modal clave temporal
let passTarget = null;
function openPasswordDialog(user) {
  if (!user) return;
  passTarget = user;
  const f = $('#password-form');
  f.reset();
  setMsg(f, '');
  $('[data-username]', f).textContent = user.username;
  $('#dlg-password').showModal();
}

$('#password-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.currentTarget;
  busy(f, true);
  const { error } = await sb.rpc('admin_set_password', {
    p_user_id: passTarget.id,
    p_password: f.password.value,
  });
  busy(f, false);
  if (error) return setMsg(f, friendlyError(error));
  $('#dlg-password').close();
  toast(`Clave temporal asignada a ${passTarget.username}`);
  loadUsers();
});

// ---------------------------------------------------------------- actualizaciones
// Cada vez que se publica un cambio se sube el número en version.json.
// La app lo revisa cada minuto (y al volver a la pestaña) y avisa con un globito.
let latestVersion = window.APP_VERSION;

async function checkForUpdate() {
  try {
    const r = await fetch(`version.json?t=${Date.now()}`, { cache: 'no-store' });
    const { version, notes } = await r.json();
    latestVersion = version;
    const hasUpdate = window.APP_VERSION && version !== window.APP_VERSION;
    $('#update-badge').classList.toggle('hidden', !hasUpdate);
    $('#update-bubble').classList.toggle('hidden', !hasUpdate);
    $('#update-notes').textContent = notes || '';
    $('#btn-update').title = hasUpdate ? 'Hay una versión nueva: tocá para actualizar' : `Actualizar (versión ${window.APP_VERSION})`;
  } catch (e) { /* sin conexión: se reintenta en el próximo ciclo */ }
}

function forceUpdate() {
  $('#btn-update').classList.add('spinning');
  // URL nueva => el navegador vuelve a pedir todo al servidor
  const url = new URL(location.href);
  url.searchParams.set('v', latestVersion || Date.now());
  location.replace(url);
}

setInterval(checkForUpdate, 60_000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) checkForUpdate(); });
checkForUpdate();

// ---------------------------------------------------------------- eventos generales
document.addEventListener('click', (e) => {
  if (e.target.closest('#btn-update, #update-bubble')) return forceUpdate();
  if (e.target.closest('#btn-settings')) return toggleSettings();
  if (!e.target.closest('#settings-menu')) toggleSettings(false);

  const go = e.target.closest('[data-go]');
  if (go) { e.preventDefault(); showAuth(go.dataset.go); }

  const page = e.target.closest('[data-page]');
  if (page) { e.preventDefault(); showPage(page.dataset.page); }

  const mod = e.target.closest('[data-module]');
  if (mod) { e.preventDefault(); openModule(mod.dataset.module); }

  if (e.target.closest('[data-action="logout"]')) { e.preventDefault(); toggleSettings(false); logout(); }

  const close = e.target.closest('[data-close]');
  if (close) close.closest('dialog').close();
});

route();
