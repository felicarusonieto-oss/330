// COMPRAS: montos por proveedor, asociadas a una venta.
export async function render(el, ctx) {
  const { sb, esc, money, date, must } = ctx;
  let month = ctx.monthNow();
  let proveedor = '';
  let rows = [];

  el.innerHTML = `
    ${ctx.backLink}
    <div class="page-head">
      <h1>Compras</h1>
      <button class="btn primary" data-new>+ Nueva compra</button>
    </div>
    <div class="toolbar">
      <div class="month-nav">
        <button class="btn small" data-prev>‹</button>
        <b data-month-label></b>
        <button class="btn small" data-next>›</button>
      </div>
      <label class="inline">Proveedor
        <select data-prov><option value="">Todos</option></select>
      </label>
    </div>
    <div class="stats" data-stats></div>
    <div class="chips" data-chips></div>
    <div class="card">
      <table class="table">
        <thead><tr>
          <th>Fecha</th><th>Proveedor</th><th>Detalle</th><th class="num">Monto</th><th>Venta asociada</th><th></th>
        </tr></thead>
        <tbody data-rows></tbody>
      </table>
    </div>`;

  const q = (s) => el.querySelector(s);

  async function fillProveedores() {
    const list = await ctx.loadProveedores();
    q('[data-prov]').innerHTML = '<option value="">Todos</option>' +
      list.map((p) => `<option ${p === proveedor ? 'selected' : ''}>${esc(p)}</option>`).join('');
  }

  async function load() {
    q('[data-month-label]').textContent = ctx.monthName(month);
    const { from, to } = ctx.monthRange(month);
    let query = sb.from('compras').select('*, ventas(id, cliente, descripcion, fecha)')
      .gte('fecha', from).lt('fecha', to)
      .order('fecha', { ascending: false }).order('id', { ascending: false });
    if (proveedor) query = query.eq('proveedor', proveedor);
    rows = must(await query);

    const total = rows.reduce((a, r) => a + Number(r.monto), 0);
    const sinVenta = rows.filter((r) => !r.venta_id);
    q('[data-stats]').innerHTML = `
      <div class="stat"><span>Compras del mes</span><b>${money(total)}</b></div>
      <div class="stat"><span>Cantidad</span><b>${rows.length}</b></div>
      <div class="stat"><span>Sin venta asociada</span><b class="${sinVenta.length ? 'neg' : ''}">${sinVenta.length}</b></div>`;

    // Total por proveedor
    const byProv = {};
    rows.forEach((r) => { byProv[r.proveedor] = (byProv[r.proveedor] || 0) + Number(r.monto); });
    q('[data-chips]').innerHTML = Object.entries(byProv).sort((a, b) => b[1] - a[1])
      .map(([p, m]) => `<span class="chip">${esc(p)}<b>${money(m)}</b></span>`).join('');

    q('[data-rows]').innerHTML = rows.length ? rows.map((r) => `
      <tr>
        <td>${date(r.fecha)}</td>
        <td><b>${esc(r.proveedor)}</b></td>
        <td>${esc(r.detalle)}</td>
        <td class="num">${money(r.monto)}</td>
        <td>${r.ventas
          ? `${date(r.ventas.fecha)} · ${esc(r.ventas.cliente || r.ventas.descripcion || 'Venta #' + r.ventas.id)}`
          : '<span class="tag pending">Sin asignar</span>'}</td>
        <td class="actions">
          <button class="btn small" data-edit="${r.id}">Editar</button>
          <button class="btn small danger" data-del="${r.id}">Borrar</button>
        </td>
      </tr>`).join('')
      : '<tr><td colspan="6" class="empty">No hay compras en este mes.</td></tr>';
  }

  el.onchange = (e) => {
    if (e.target.matches('[data-prov]')) { proveedor = e.target.value; load(); }
  };

  el.onclick = async (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.matches('[data-prev]')) { month = ctx.addMonths(month, -1); return load(); }
    if (b.matches('[data-next]')) { month = ctx.addMonths(month, 1); return load(); }
    if (b.matches('[data-new]')) return edit(null);
    if (b.dataset.edit) return edit(rows.find((r) => r.id === Number(b.dataset.edit)));
    if (b.dataset.del) {
      const r = rows.find((x) => x.id === Number(b.dataset.del));
      if (!ctx.confirm(`¿Borrar la compra a "${r.proveedor}" por ${money(r.monto)}?`)) return;
      try { must(await sb.from('compras').delete().eq('id', r.id)); ctx.toast('Compra borrada'); load(); }
      catch (err) { ctx.toast(err.message); }
    }
  };

  async function edit(c) {
    const ventas = must(await sb.from('ventas').select('id, fecha, cliente, descripcion')
      .order('fecha', { ascending: false }).order('id', { ascending: false }).limit(200));
    await ctx.loadProveedores();
    // Compra nueva: se asocia sola a la última venta cargada (se puede cambiar)
    const selected = c ? c.venta_id : ventas[0]?.id ?? null;
    const opt = (v) => `<option value="${v.id}" ${v.id === selected ? 'selected' : ''}>
      ${date(v.fecha)} · ${esc(v.cliente || 'Sin cliente')} ${v.descripcion ? '— ' + esc(v.descripcion.slice(0, 40)) : ''}</option>`;

    await ctx.openForm({
      title: c ? 'Editar compra' : 'Nueva compra',
      html: `
        <div class="grid2">
          <label>Fecha <input name="fecha" type="date" value="${c?.fecha ?? ctx.today()}" /></label>
          <label>Monto <input name="monto" inputmode="decimal" placeholder="$ 0" value="${c?.monto ?? ''}" /></label>
        </div>
        <label>Proveedor <input name="proveedor" list="dl-proveedores" value="${esc(c?.proveedor ?? '')}" placeholder="Ej: Aluar, Vidriería Centro…" /></label>
        <label>Detalle <input name="detalle" value="${esc(c?.detalle ?? '')}" placeholder="Ej: perfiles, vidrio, herrajes" /></label>
        <label>Venta asociada
          <select name="venta_id">
            <option value="" ${selected ? '' : 'selected'}>— Sin asignar —</option>
            ${ventas.map(opt).join('')}
          </select>
        </label>`,
      async submit(f) {
        const data = {
          fecha: f.fecha.value,
          proveedor: f.proveedor.value.trim(),
          detalle: f.detalle.value.trim(),
          monto: ctx.num(f.monto.value),
          venta_id: f.venta_id.value ? Number(f.venta_id.value) : null,
        };
        if (!data.proveedor) throw new Error('Poné el proveedor.');
        if (!data.fecha) throw new Error('Poné la fecha.');
        if (c) must(await sb.from('compras').update(data).eq('id', c.id));
        else must(await sb.from('compras').insert(data));
        ctx.toast(c ? 'Compra actualizada' : 'Compra guardada');
        month = data.fecha.slice(0, 7);
      },
    }) && (await fillProveedores(), load());
  }

  await fillProveedores();
  await load();
}
