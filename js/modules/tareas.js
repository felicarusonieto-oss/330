// TAREAS (Taller / Oficina)
// Pestañas: "General" (todas las tareas, la ven todos) + una pestaña por usuario.
// Cada tarea muestra cuándo se publicó y si la persona asignada ya la vio ("La vi").
// Si pasan 2 horas sin verla, queda marcada como demorada (y Felipe ve el aviso en el inicio).
const ESTADOS = { pendiente: 'Pendiente', en_curso: 'En curso', hecha: 'Hecha' };
export const DEMORA_MS = 2 * 60 * 60 * 1000;

export function hace(ms) {
  const min = Math.max(0, Math.round(ms / 60000));
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60), m = min % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

export function fechaHora(ts) {
  const d = new Date(ts);
  return d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' }) + ' ' +
         d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
}

export async function render(el, ctx, { area }) {
  const { sb, esc, date, must } = ctx;
  const titulo = area === 'taller' ? 'Tareas Taller' : 'Tareas Oficina';
  const meId = ctx.me.id;
  // Felipe (admin) ve General + todos los perfiles; el resto ve solo lo suyo
  let tab = ctx.isAdmin ? 'general' : meId;   // 'general' | id de usuario | 'asignadas'
  let estadoFiltro = 'abiertas';  // abiertas | hecha | todas
  let rows = [];

  await ctx.loadUsersBasic();
  const nombre = (id) => {
    const n = ctx.userName(id);
    return n.charAt(0).toUpperCase() + n.slice(1);
  };

  el.innerHTML = `
    ${ctx.backLink}
    <div class="page-head">
      <h1>${titulo}</h1>
      <button class="btn primary" data-new>+ Nueva tarea</button>
    </div>
    <div class="profile-tabs" data-tabs></div>
    <div class="toolbar">
      <div class="segmented" data-seg>
        <button data-v="abiertas" class="on">Pendientes</button>
        <button data-v="hecha">Hechas</button>
        <button data-v="todas">Todas</button>
      </div>
      <span class="hint" data-tab-hint style="margin:0"></span>
    </div>
    <div class="tasks" data-list></div>`;

  const q = (s) => el.querySelector(s);

  async function load() {
    // Todas las tareas abiertas del área (para los contadores de las pestañas)
    const abiertas = must(await sb.from('tareas').select('id, asignado_a, visto_at, asignada_at, estado')
      .eq('area', area).neq('estado', 'hecha'));

    const ahora = Date.now();
    const cuenta = {};
    abiertas.forEach((t) => {
      const k = t.asignado_a || 'none';
      cuenta[k] = cuenta[k] || { abiertas: 0, sinVer: 0, demoradas: 0 };
      cuenta[k].abiertas++;
      if (t.asignado_a && !t.visto_at) {
        cuenta[k].sinVer++;
        if (ahora - new Date(t.asignada_at) > DEMORA_MS) cuenta[k].demoradas++;
      }
    });

    const tabBtn = (id, label, c, extra = '') => `
      <button class="ptab ${tab === id ? 'on' : ''} ${extra}" data-tab="${id}">
        ${label}
        ${c?.demoradas ? `<span class="ptab-badge late" title="Sin ver hace más de 2 horas">${c.demoradas}</span>`
          : c?.sinVer ? `<span class="ptab-badge new" title="Sin ver">${c.sinVer}</span>`
          : c?.abiertas ? `<span class="ptab-badge">${c.abiertas}</span>` : ''}
      </button>`;
    if (ctx.isAdmin) {
      q('[data-tabs]').innerHTML =
        tabBtn('general', '📋 General', { abiertas: abiertas.length }, 'general') +
        ctx.usersBasic.map((u) => tabBtn(u.id, `${u.id === meId ? '👤 ' : ''}${esc(nombre(u.id))}`, cuenta[u.id], u.id === meId ? 'mine' : '')).join('');
    } else {
      const otros = abiertas.filter((t) => t.asignado_a !== meId).length;
      q('[data-tabs]').innerHTML =
        tabBtn(meId, '👤 Mis tareas', cuenta[meId], 'mine') +
        tabBtn('asignadas', '📤 Que les cargué a otros', { abiertas: otros });
    }

    q('[data-tab-hint]').textContent = tab === 'general'
      ? 'Todas las tareas de todos los perfiles.'
      : tab === 'asignadas' ? 'Tareas que vos les cargaste a otras personas.'
      : tab === meId ? 'Tus tareas. Las nuevas tenés que marcarlas con “La vi”.'
      : `Tareas asignadas a ${nombre(tab)}.`;

    let query = sb.from('tareas').select('*').eq('area', area)
      .order('asignada_at', { ascending: false }).order('id', { ascending: false });
    if (estadoFiltro === 'abiertas') query = query.neq('estado', 'hecha');
    if (estadoFiltro === 'hecha') query = query.eq('estado', 'hecha');
    if (tab === 'asignadas') query = query.eq('creado_por', meId).neq('asignado_a', meId);
    else if (tab !== 'general') query = query.eq('asignado_a', tab);
    rows = must(await query);

    // Primero las que yo todavía no vi
    rows.sort((a, b) => (isMineUnseen(b) - isMineUnseen(a)));

    const hoy = ctx.today();
    q('[data-list]').innerHTML = rows.length ? rows.map((t) => card(t, hoy, ahora)).join('')
      : '<div class="card empty">No hay tareas para mostrar.</div>';
  }

  const isMineUnseen = (t) => (t.asignado_a === meId && !t.visto_at ? 1 : 0);

  function vistoTag(t, ahora) {
    if (!t.asignado_a) return '<span class="tag">Sin asignar</span>';
    // Los horarios solo los ve Felipe (admin)
    if (!ctx.isAdmin) return t.visto_at ? '<span class="tag ok">✓ Vista</span>' : '<span class="tag prog">Sin ver</span>';
    if (t.visto_at) {
      const demora = new Date(t.visto_at) - new Date(t.asignada_at);
      return demora > DEMORA_MS
        ? `<span class="tag pending" title="La vio ${hace(demora)} después de publicada">✓ Vista ${fechaHora(t.visto_at)} · con demora (${hace(demora)})</span>`
        : `<span class="tag ok">✓ Vista ${fechaHora(t.visto_at)}</span>`;
    }
    const espera = ahora - new Date(t.asignada_at);
    return espera > DEMORA_MS
      ? `<span class="tag late">⚠ Sin ver hace ${hace(espera)}</span>`
      : `<span class="tag prog">⏳ Sin ver (${hace(espera)})</span>`;
  }

  function card(t, hoy, ahora) {
    const late = t.estado !== 'hecha' && t.fecha_limite && t.fecha_limite < hoy;
    const canEdit = ctx.isAdmin || t.creado_por === meId || t.asignado_a === meId;
    const canDelete = ctx.isAdmin || t.creado_por === meId;
    const mustSee = isMineUnseen(t) && t.estado !== 'hecha';
    return `
      <div class="task ${t.estado === 'hecha' ? 'done' : ''} ${mustSee ? 'unseen' : ''}">
        <input type="checkbox" data-done="${t.id}" ${t.estado === 'hecha' ? 'checked' : ''}
          ${canEdit ? '' : 'disabled'} title="Marcar como hecha" />
        <div>
          <div class="task-title">${esc(t.titulo)}</div>
          ${t.descripcion ? `<div class="task-desc">${esc(t.descripcion)}</div>` : ''}
          <div class="task-meta">
            <span class="tag ${t.asignado_a === meId ? 'admin' : ''}">👤 ${esc(t.asignado_a ? nombre(t.asignado_a) : 'Sin asignar')}</span>
            ${ctx.isAdmin
              ? `<span class="tag" title="Fecha de publicación">🕒 Publicada ${fechaHora(t.asignada_at || t.created_at)} por ${esc(nombre(t.creado_por))}</span>`
              : `<span class="tag">Cargada por ${esc(t.creado_por === meId ? 'vos' : nombre(t.creado_por))}</span>`}
            ${vistoTag(t, ahora)}
            ${t.fecha_limite ? `<span class="tag ${late ? 'late' : ''}">📅 ${late ? 'Venció' : 'Vence'} ${date(t.fecha_limite)}</span>` : ''}
            <span class="tag ${t.estado === 'hecha' ? 'ok' : t.estado === 'en_curso' ? 'prog' : 'pending'}">${ESTADOS[t.estado]}</span>
          </div>
        </div>
        <div class="task-actions">
          ${mustSee ? `<button class="btn small primary" data-seen="${t.id}">✓ La vi</button>` : ''}
          ${canEdit ? `<button class="btn small" data-edit="${t.id}">Editar</button>` : ''}
          ${canDelete ? `<button class="btn small danger" data-del="${t.id}">Borrar</button>` : ''}
        </div>
      </div>`;
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
    if (b.dataset.tab) { tab = b.dataset.tab; return load(); }
    if (b.closest('[data-seg]')) {
      b.closest('[data-seg]').querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
      estadoFiltro = b.dataset.v;
      return load();
    }
    if (b.dataset.seen) {
      b.disabled = true;
      try {
        must(await sb.from('tareas').update({ visto_at: new Date().toISOString() }).eq('id', Number(b.dataset.seen)));
        ctx.toast('Marcada como vista');
        ctx.refreshUnseen?.();
        load();
      } catch (err) { b.disabled = false; ctx.toast(err.message); }
      return;
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
    // Tarea nueva: se puede asignar a varias personas (se crea una por persona,
    // así cada una marca su propio "La vi"). En la pestaña de un perfil, viene marcado ese perfil.
    const preselect = t ? t.asignado_a : (tab !== 'general' && tab !== 'asignadas' ? tab : null);
    const multi = !t;
    await ctx.openForm({
      title: t ? 'Editar tarea' : `Nueva tarea · ${area === 'taller' ? 'Taller' : 'Oficina'}`,
      html: `
        <label>Tarea <input name="titulo" value="${esc(t?.titulo ?? '')}" placeholder="Ej: Cortar perfiles para ventana de Pérez" /></label>
        <label>Detalle <textarea name="descripcion">${esc(t?.descripcion ?? '')}</textarea></label>
        ${multi ? `
          <div class="field-label">Asignar a <small class="muted">(podés marcar varias personas)</small></div>
          <div class="assign-options">
            ${ctx.usersBasic.map((u) => `
              <label class="assign-option">
                <input type="checkbox" name="asignar" value="${u.id}" ${u.id === preselect ? 'checked' : ''} />
                <span>${esc(nombre(u.id))}${u.id === meId ? ' (yo)' : ''}</span>
              </label>`).join('')}
          </div>` : ''}
        <div class="${multi ? 'grid2' : 'grid3'}">
          ${multi ? '' : `
          <label>Asignar a
            <select name="asignado_a">
              ${ctx.usersBasic.map((u) => `<option value="${u.id}" ${u.id === preselect ? 'selected' : ''}>
                ${esc(nombre(u.id))}${u.id === meId ? ' (yo)' : ''}</option>`).join('')}
            </select>
          </label>`}
          <label>Fecha límite <input name="fecha_limite" type="date" value="${t?.fecha_limite ?? ''}" /></label>
          <label>Estado
            <select name="estado">
              ${Object.entries(ESTADOS).map(([k, v]) => `<option value="${k}" ${(t?.estado ?? 'pendiente') === k ? 'selected' : ''}>${v}</option>`).join('')}
            </select>
          </label>
        </div>
        <p class="hint">Cada persona asignada va a tener que marcarla con “La vi”.</p>`,
      async submit(f) {
        const data = {
          titulo: f.titulo.value.trim(),
          descripcion: f.descripcion.value.trim(),
          fecha_limite: f.fecha_limite.value || null,
          estado: f.estado.value,
        };
        if (!data.titulo) throw new Error('Escribí la tarea.');
        if (t) {
          must(await sb.from('tareas').update({ ...data, asignado_a: f.asignado_a.value }).eq('id', t.id));
          ctx.toast('Tarea actualizada');
        } else {
          const ids = [...f.querySelectorAll('[name=asignar]:checked')].map((c) => c.value);
          if (!ids.length) throw new Error('Marcá al menos una persona.');
          must(await sb.from('tareas').insert(ids.map((id) => ({ ...data, area, asignado_a: id }))));
          ctx.toast(ids.length > 1 ? `Tarea publicada para ${ids.length} personas` : 'Tarea publicada');
        }
        ctx.refreshUnseen?.();
      },
    }) && load();
  }

  await load();
}
