// GASTOS HORMIGA: gastos chicos del día a día, con total mensual y por categoría.
const CATEGORIAS = ['Comida / café', 'Nafta / transporte', 'Ferretería', 'Librería', 'Limpieza', 'Herramientas', 'Otros'];

export async function render(el, ctx) {
  const { sb, esc, money, date, must } = ctx;
  let month = ctx.monthNow();
  let rows = [];

  el.innerHTML = `
    ${ctx.backLink}
    <div class="page-head">
      <h1>Gastos hormiga</h1>
      <button class="btn primary" data-new>+ Nuevo gasto</button>
    </div>
    <div class="toolbar">
      <div class="month-nav">
        <button class="btn small" data-prev>‹</button>
        <b data-month-label></b>
        <button class="btn small" data-next>›</button>
      </div>
    </div>
    <div class="stats" data-stats></div>
    <div class="chips" data-chips></div>
    <div class="card">
      <table class="table">
        <thead><tr><th>Fecha</th><th>Descripción</th><th>Categoría</th><th class="num">Monto</th><th></th></tr></thead>
        <tbody data-rows></tbody>
      </table>
    </div>
    <datalist id="dl-categorias">${CATEGORIAS.map((c) => `<option value="${c}">`).join('')}</datalist>`;

  const q = (s) => el.querySelector(s);

  async function load() {
    q('[data-month-label]').textContent = ctx.monthName(month);
    const { from, to } = ctx.monthRange(month);
    const prev = ctx.monthRange(ctx.addMonths(month, -1));
    const [cur, ant] = await Promise.all([
      sb.from('gastos').select('*').gte('fecha', from).lt('fecha', to)
        .order('fecha', { ascending: false }).order('id', { ascending: false }),
      sb.from('gastos').select('monto').gte('fecha', prev.from).lt('fecha', prev.to),
    ]);
    rows = must(cur);
    const total = rows.reduce((a, r) => a + Number(r.monto), 0);
    const totalAnt = must(ant).reduce((a, r) => a + Number(r.monto), 0);
    const dias = month === ctx.monthNow() ? Number(ctx.today().slice(8, 10))
      : new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0).getDate();

    q('[data-stats]').innerHTML = `
      <div class="stat"><span>Total del mes</span><b>${money(total)}</b></div>
      <div class="stat"><span>Promedio por día</span><b>${money(total / dias)}</b></div>
      <div class="stat"><span>Mes anterior</span><b class="muted">${money(totalAnt)}</b></div>
      <div class="stat"><span>Cantidad</span><b>${rows.length}</b></div>`;

    const byCat = {};
    rows.forEach((r) => { byCat[r.categoria] = (byCat[r.categoria] || 0) + Number(r.monto); });
    q('[data-chips]').innerHTML = Object.entries(byCat).sort((a, b) => b[1] - a[1])
      .map(([c, m]) => `<span class="chip">${esc(c)}<b>${money(m)}</b></span>`).join('');

    q('[data-rows]').innerHTML = rows.length ? rows.map((r) => `
      <tr>
        <td>${date(r.fecha)}</td>
        <td>${esc(r.descripcion)}</td>
        <td><span class="tag">${esc(r.categoria)}</span></td>
        <td class="num">${money(r.monto)}</td>
        <td class="actions">
          <button class="btn small" data-edit="${r.id}">Editar</button>
          <button class="btn small danger" data-del="${r.id}">Borrar</button>
        </td>
      </tr>`).join('')
      : '<tr><td colspan="5" class="empty">No hay gastos en este mes.</td></tr>';
  }

  el.onchange = null;
  el.onclick = async (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.matches('[data-prev]')) { month = ctx.addMonths(month, -1); return load(); }
    if (b.matches('[data-next]')) { month = ctx.addMonths(month, 1); return load(); }
    if (b.matches('[data-new]')) return edit(null);
    if (b.dataset.edit) return edit(rows.find((r) => r.id === Number(b.dataset.edit)));
    if (b.dataset.del) {
      const r = rows.find((x) => x.id === Number(b.dataset.del));
      if (!ctx.confirm(`¿Borrar el gasto "${r.descripcion}" de ${money(r.monto)}?`)) return;
      try { must(await sb.from('gastos').delete().eq('id', r.id)); ctx.toast('Gasto borrado'); load(); }
      catch (err) { ctx.toast(err.message); }
    }
  };

  async function edit(g) {
    await ctx.openForm({
      title: g ? 'Editar gasto' : 'Nuevo gasto',
      html: `
        <div class="grid2">
          <label>Fecha <input name="fecha" type="date" value="${g?.fecha ?? ctx.today()}" /></label>
          <label>Monto <input name="monto" inputmode="decimal" placeholder="$ 0" value="${g?.monto ?? ''}" /></label>
        </div>
        <label>Descripción <input name="descripcion" value="${esc(g?.descripcion ?? '')}" placeholder="Ej: tornillos, café, estacionamiento" /></label>
        <label>Categoría <input name="categoria" list="dl-categorias" value="${esc(g?.categoria ?? '')}" placeholder="Elegí o escribí una" /></label>`,
      async submit(f) {
        const data = {
          fecha: f.fecha.value,
          monto: ctx.num(f.monto.value),
          descripcion: f.descripcion.value.trim(),
          categoria: f.categoria.value.trim() || 'Otros',
        };
        if (!data.fecha) throw new Error('Poné la fecha.');
        if (!data.monto) throw new Error('Poné el monto.');
        if (g) must(await sb.from('gastos').update(data).eq('id', g.id));
        else must(await sb.from('gastos').insert(data));
        ctx.toast(g ? 'Gasto actualizado' : 'Gasto guardado');
        month = data.fecha.slice(0, 7);
      },
    }) && load();
  }

  await load();
}
