// TAREAS (Taller / Oficina): se crean, se asignan a cualquier usuario y se marcan como hechas.
// Cada usuario ve las que le asignaron o creó; el administrador ve todas.
const ESTADOS = { pendiente: 'Pendiente', en_curso: 'En curso', hecha: 'Hecha' };

export async function render(el, ctx, { area }) {
  const { sb, esc, date, must } = ctx;
  const titulo = area === 'taller' ? 'Tareas Taller' : 'Tareas Oficina';
  let estadoFiltro = 'abiertas';   // abiertas | hecha | todas
  let quien = 'todas';             // mias | creadas | todas
  let rows = [];

  await ctx.loadUsersBasic();

  el.innerHTML = `
    ${ctx.backLink}
    <div class="page-head">
      <h1>${titulo}</h1>
      <button class="btn primary" data-new>+ Nueva tarea</button>
    </div>
    <div class="toolbar">
      <div class="segmented" data-seg="estado">
        <button data-v="abiertas" class="on">Pendientes</button>
        <button data-v="hecha">Hechas</button>
        <button data-v="todas">Todas</button>
      </div>
      <div class="segmented" data-seg="quien">
        <button data-v="mias">Asignadas a mí</button>
        <button data-v="creadas">Creadas por mí</button>
        <button data-v="todas" class="on">${ctx.isAdmin ? 'De todos' : 'Todas las mías'}</button>
      </div>
    </div>
    <div class="tasks" data-list></div>`;

  const q = (s) => el.querySelector(s);
  const meId = ctx.me.id;

  async function load() {
    let query = sb.from('tareas').select('*').eq('area', area)
      .order('fecha_limite', { ascending: true, nullsFirst: false })
      .order('id', { ascending: false });
    if (estadoFiltro === 'abiertas') query = query.neq('estado', 'hecha');
    if (estadoFiltro === 'hecha') query = query.eq('estado', 'hecha');
    if (quien === 'mias') query = query.eq('asignado_a', meId);
    if (quien === 'creadas') query = query.eq('creado_por', meId);
    rows = must(await query);

    const hoy = ctx.today();
    q('[data-list]').innerHTML = rows.length ? rows.map((t) => {
      const late = t.estado !== 'hecha' && t.fecha_limite && t.fecha_limite < hoy;
      const canDelete = ctx.isAdmin || t.creado_por === meId;
      return `
        <div class="task ${t.estado === 'hecha' ? 'done' : ''}">
          <input type="checkbox" data-done="${t.id}" ${t.estado === 'hecha' ? 'checked' : ''} title="Marcar como hecha" />
          <div>
            <div class="task-title">${esc(t.titulo)}</div>
            ${t.descripcion ? `<div class="task-desc">${esc(t.descripcion)}</div>` : ''}
            <div class="task-meta">
              <span class="tag ${t.asignado_a === meId ? 'admin' : ''}">👤 ${esc(t.asignado_a ? ctx.userName(t.asignado_a) : 'Sin asignar')}</span>
              ${t.fecha_limite ? `<span class="tag ${late ? 'late' : ''}">📅 ${late ? 'Venció' : 'Vence'} ${date(t.fecha_limite)}</span>` : ''}
              <span class="tag ${t.estado === 'hecha' ? 'ok' : t.estado === 'en_curso' ? 'prog' : 'pending'}">${ESTADOS[t.estado]}</span>
              <span class="tag">Creó: ${esc(ctx.userName(t.creado_por))}</span>
            </div>
          </div>
          <div class="task-actions">
            <button class="btn small" data-edit="${t.id}">Editar</button>
            ${canDelete ? `<button class="btn small danger" data-del="${t.id}">Borrar</button>` : ''}
          </div>
        </div>`;
    }).join('')
      : '<div class="card empty">No hay tareas para mostrar.</div>';
  }

  el.onchange = async (e) => {
    const cb = e.target.closest('[data-done]');
    if (!cb) return;
    const estado = cb.checked ? 'hecha' : 'pendiente';
    cb.disabled = true;
    try {
      must(await sb.from('tareas').update({ estado }).eq('id', Number(cb.dataset.done)));
      ctx.toast(estado === 'hecha' ? '¡Tarea hecha!' : 'Tarea reabierta');
      load();
    } catch (err) { cb.checked = !cb.checked; cb.disabled = false; ctx.toast(err.message); }
  };

  el.onclick = async (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    const seg = b.closest('[data-seg]');
    if (seg) {
      seg.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
      if (seg.dataset.seg === 'estado') estadoFiltro = b.dataset.v; else quien = b.dataset.v;
      return load();
    }
    if (b.matches('[data-new]')) return edit(null);
    if (b.dataset.edit) return edit(rows.find((t) => t.id === Number(b.dataset.edit)));
    if (b.dataset.del) {
      const t = rows.find((x) => x.id === Number(b.dataset.del));
      if (!ctx.confirm(`¿Borrar la tarea "${t.titulo}"?`)) return;
      try { must(await sb.from('tareas').delete().eq('id', t.id)); ctx.toast('Tarea borrada'); load(); }
      catch (err) { ctx.toast(err.message); }
    }
  };

  async function edit(t) {
    const assigned = t ? t.asignado_a : meId;
    await ctx.openForm({
      title: t ? 'Editar tarea' : `Nueva tarea · ${area === 'taller' ? 'Taller' : 'Oficina'}`,
      html: `
        <label>Tarea <input name="titulo" value="${esc(t?.titulo ?? '')}" placeholder="Ej: Cortar perfiles para ventana de Pérez" /></label>
        <label>Detalle <textarea name="descripcion">${esc(t?.descripcion ?? '')}</textarea></label>
        <div class="grid3">
          <label>Asignar a
            <select name="asignado_a">
              <option value="">— Sin asignar —</option>
              ${ctx.usersBasic.map((u) => `<option value="${u.id}" ${u.id === assigned ? 'selected' : ''}>
                ${esc(u.full_name || u.username)}${u.id === meId ? ' (yo)' : ''}</option>`).join('')}
            </select>
          </label>
          <label>Fecha límite <input name="fecha_limite" type="date" value="${t?.fecha_limite ?? ''}" /></label>
          <label>Estado
            <select name="estado">
              ${Object.entries(ESTADOS).map(([k, v]) => `<option value="${k}" ${(t?.estado ?? 'pendiente') === k ? 'selected' : ''}>${v}</option>`).join('')}
            </select>
          </label>
        </div>`,
      async submit(f) {
        const data = {
          titulo: f.titulo.value.trim(),
          descripcion: f.descripcion.value.trim(),
          asignado_a: f.asignado_a.value || null,
          fecha_limite: f.fecha_limite.value || null,
          estado: f.estado.value,
        };
        if (!data.titulo) throw new Error('Escribí la tarea.');
        if (t) must(await sb.from('tareas').update(data).eq('id', t.id));
        else must(await sb.from('tareas').insert({ ...data, area }));
        ctx.toast(t ? 'Tarea actualizada' : 'Tarea creada');
      },
    }) && load();
  }

  await load();
}
