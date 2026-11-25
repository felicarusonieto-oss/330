// RECORDATORIOS: los ven y escriben todos los usuarios. Cada uno muestra quién lo escribió y cuándo.
// Lo puede borrar quien lo escribió o el administrador.
export async function render(el, ctx) {
  const { sb, esc, must } = ctx;
  await ctx.loadUsersBasic();
  const nombre = (id) => { const n = ctx.userName(id); return n.charAt(0).toUpperCase() + n.slice(1); };
  const hora = (ts) => new Date(ts).toLocaleString('es-AR',
    { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

  // Lo que había sin ver antes de entrar (para resaltarlo)
  const vistoAntes = localStorage.getItem(`rec_visto_${ctx.me.id}`) || '1970-01-01T00:00:00Z';

  el.innerHTML = `
    ${ctx.backLink}
    <div class="page-head"><h1>📝 Recordatorios</h1></div>
    <div class="card reminders">
      <form class="reminder-form" data-form autocomplete="off">
        <input name="texto" maxlength="500" placeholder="Escribí un recordatorio para todos…" />
        <button type="submit" class="btn primary">Agregar</button>
      </form>
      <ul class="reminder-list" data-list></ul>
    </div>`;

  const q = (s) => el.querySelector(s);

  async function load() {
    const data = must(await sb.from('recordatorios')
      .select('id, texto, creado_por, created_at').order('created_at', { ascending: false }).limit(200));
    if (data.some((r) => !ctx.usersBasic.find((u) => u.id === r.creado_por))) await ctx.loadUsersBasic();
    q('[data-list]').innerHTML = data.length ? data.map((r) => {
      const nuevo = r.created_at > vistoAntes && r.creado_por !== ctx.me.id;
      return `
      <li class="${nuevo ? 'nuevo' : ''}">
        <div>
          <div class="reminder-text">${nuevo ? '<span class="tag pending">Nuevo</span> ' : ''}${esc(r.texto)}</div>
          <small class="muted">— <b>${esc(r.creado_por === ctx.me.id ? 'Vos' : nombre(r.creado_por))}</b> · ${hora(r.created_at)}</small>
        </div>
        ${ctx.isAdmin || r.creado_por === ctx.me.id
          ? `<button class="x" data-del="${r.id}" title="Borrar recordatorio">✕</button>` : ''}
      </li>`;
    }).join('')
      : '<li class="muted">No hay recordatorios. ¡Escribí el primero!</li>';
    ctx.marcarRecordatoriosVistos?.();
  }

  q('[data-form]').onsubmit = async (e) => {
    e.preventDefault();
    const f = e.currentTarget;
    const texto = f.texto.value.trim();
    if (!texto) return f.texto.focus();
    f.querySelector('button').disabled = true;
    try {
      must(await sb.from('recordatorios').insert({ texto }));
      f.reset();
      ctx.toast('Recordatorio agregado');
      await load();
    } catch (err) { ctx.toast(err.message); }
    finally { f.querySelector('button').disabled = false; f.texto.focus(); }
  };

  el.onclick = async (e) => {
    const b = e.target.closest('[data-del]');
    if (!b || !ctx.confirm('¿Borrar este recordatorio?')) return;
    try { must(await sb.from('recordatorios').delete().eq('id', Number(b.dataset.del))); load(); }
    catch (err) { ctx.toast(err.message); }
  };

  await load();
  q('[name=texto]').focus();
}
