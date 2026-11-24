// VENTAS: monto total de la venta, quién la hizo, formas de pago con montos,
// compras asociadas y la diferencia (venta − compras asociadas) calculada sola.
export async function render(el, ctx) {
  const { sb, esc, money, date, must } = ctx;
  let month = ctx.monthNow();
  let rows = [];

  el.innerHTML = `
    ${ctx.backLink}
    <div class="page-head">
      <h1>Ventas</h1>
      <button class="btn primary" data-new>+ Nueva venta</button>
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
        <thead><tr>
          <th>Fecha</th><th>Cliente</th><th>Venta de</th>
          <th class="num">Total venta</th><th class="num">Compras</th><th class="num">Diferencia</th>
          <th>Formas de pago</th><th></th>
        </tr></thead>
        <tbody data-rows></tbody>
      </table>
    </div>`;

  const q = (s) => el.querySelector(s);
  const pagado = (r) => (r.pagos || []).reduce((a, p) => a + Number(p.monto || 0), 0);

  async function load() {
    q('[data-month-label]').textContent = ctx.monthName(month);
    const { from, to } = ctx.monthRange(month);
    rows = must(await sb.from('ventas_resumen').select('*')
      .gte('fecha', from).lt('fecha', to)
      .order('fecha', { ascending: false }).order('id', { ascending: false }));

    const tot = rows.reduce((a, r) => ({
      venta: a.venta + Number(r.precio_final), compra: a.compra + Number(r.compra_total),
      dif: a.dif + Number(r.utilidad), cobrado: a.cobrado + pagado(r),
    }), { venta: 0, compra: 0, dif: 0, cobrado: 0 });
    const pendiente = tot.venta - tot.cobrado;

    q('[data-stats]').innerHTML = `
      <div class="stat"><span>Ventas del mes</span><b>${money(tot.venta)}</b></div>
      <div class="stat"><span>Compras asociadas</span><b>${money(tot.compra)}</b></div>
      <div class="stat"><span>Diferencia</span><b class="${tot.dif < 0 ? 'neg' : 'pos'}">${money(tot.dif)}</b></div>
      <div class="stat"><span>Cobrado</span><b>${money(tot.cobrado)}</b>
        ${pendiente > 0.009 ? `<small class="neg"> · falta ${money(pendiente)}</small>` : ''}</div>`;

    // Totales por forma de pago y por quién vendió
    const byMedio = {}, byVend = {};
    rows.forEach((r) => {
      (r.pagos || []).forEach((p) => { const k = ctx.MEDIOS_PAGO[p.medio] || p.medio; byMedio[k] = (byMedio[k] || 0) + Number(p.monto); });
      const v = r.vendedor || 'Sin indicar';
      byVend[v] = (byVend[v] || 0) + Number(r.precio_final);
    });
    const chips = (o) => Object.entries(o).sort((a, b) => b[1] - a[1])
      .map(([k, m]) => `<span class="chip">${esc(k)}<b>${money(m)}</b></span>`).join('');
    q('[data-chips]').innerHTML = rows.length ? `
      <div class="chips-row"><small class="muted">Cobrado por:</small>${chips(byMedio) || '<small class="muted">—</small>'}</div>
      <div class="chips-row"><small class="muted">Venta de:</small>${chips(byVend)}</div>` : '';

    q('[data-rows]').innerHTML = rows.length ? rows.map((r) => {
      const falta = Number(r.precio_final) - pagado(r);
      return `
      <tr>
        <td>${date(r.fecha)}</td>
        <td><b>${esc(r.cliente) || '<span class="muted">—</span>'}</b>${r.descripcion ? `<br><small>${esc(r.descripcion.slice(0, 60))}</small>` : ''}</td>
        <td>${esc(r.vendedor) || '<span class="muted">—</span>'}</td>
        <td class="num"><b>${money(r.precio_final)}</b></td>
        <td class="num">${money(r.compra_total)} <small>(${r.compras_cant})</small></td>
        <td class="num"><b class="${r.utilidad < 0 ? 'neg' : 'pos'}">${money(r.utilidad)}</b></td>
        <td>${ctx.pagosResumen(r.pagos)}${falta > 0.009 ? `<br><small class="neg">Falta ${money(falta)}</small>` : ''}</td>
        <td class="actions">
          <button class="btn small" data-edit="${r.id}">Editar</button>
          <button class="btn small danger" data-del="${r.id}">Borrar</button>
        </td>
      </tr>`;
    }).join('')
      : '<tr><td colspan="8" class="empty">No hay ventas cargadas en este mes.</td></tr>';
  }

  el.onclick = async (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.matches('[data-prev]')) { month = ctx.addMonths(month, -1); return load(); }
    if (b.matches('[data-next]')) { month = ctx.addMonths(month, 1); return load(); }
    if (b.matches('[data-new]')) return edit(null);
    if (b.dataset.edit) return edit(rows.find((r) => r.id === Number(b.dataset.edit)));
    if (b.dataset.del) {
      const r = rows.find((x) => x.id === Number(b.dataset.del));
      if (!ctx.confirm(`¿Borrar la venta a "${r.cliente || 'sin cliente'}" por ${money(r.precio_final)}?\nSus compras quedan en Compras, sin vincular.`)) return;
      try { must(await sb.from('ventas').delete().eq('id', r.id)); ctx.toast('Venta borrada'); load(); }
      catch (err) { ctx.toast(err.message); }
    }
  };

  // ---------------------------------------------------------- formulario
  async function edit(venta) {
    const [asociadas, libres] = [
      venta ? must(await sb.from('compras').select('*').eq('venta_id', venta.id).order('fecha')) : [],
      must(await sb.from('compras').select('*').is('venta_id', null).order('fecha', { ascending: false }).limit(200)),
    ];
    let sel = [...asociadas];   // compras asociadas a esta venta
    let pool = [...libres];     // compras sin vincular, para sumar

    const compraTxt = (c) => `${date(c.fecha)} · <b>${esc(c.proveedor)}</b>${c.cliente ? ' · ' + esc(c.cliente) : ''}${c.detalle ? ' · ' + esc(c.detalle) : ''}`;
    const selHtml = () => sel.length
      ? `<ul class="assoc-list">${sel.map((c) => `
          <li><span>${compraTxt(c)}</span>
            <span><b>${money(c.monto)}</b> <button type="button" class="btn small ghost" data-unlink="${c.id}" title="Quitar de esta venta">✕</button></span></li>`).join('')}</ul>`
      : '<p class="assoc-empty">Todavía no hay compras asociadas a esta venta.</p>';
    const poolHtml = () => pool.length ? `
      <div class="unassigned">
        <b>Compras sin vincular</b> <small class="muted">— tocá “Asociar” para sumarlas a esta venta</small>
        <ul>${pool.map((c) => `
          <li><span>${compraTxt(c)} · ${money(c.monto)}</span>
              <button type="button" class="btn small" data-link="${c.id}">Asociar</button></li>`).join('')}
        </ul>
      </div>` : '<p class="assoc-empty">No hay compras sin vincular. Cargalas en <b>Compras</b>.</p>';

    await ctx.openForm({
      title: venta ? 'Editar venta' : 'Nueva venta',
      wide: true,
      html: `
        <div class="grid3">
          <label>Fecha <input name="fecha" type="date" value="${venta?.fecha ?? ctx.today()}" /></label>
          <label>Cliente <input name="cliente" value="${esc(venta?.cliente ?? '')}" /></label>
          <label>Venta de
            <select name="vendedor">
              <option value="">— Elegí —</option>
              ${ctx.VENDEDORES.map((v) => `<option ${v === venta?.vendedor ? 'selected' : ''}>${esc(v)}</option>`).join('')}
            </select>
          </label>
        </div>
        <div class="grid2">
          <label>Monto total de la venta <input name="precio_final" inputmode="decimal" placeholder="$ 0" value="${venta?.precio_final ?? ''}" /></label>
          <label>Descripción <small class="muted">(opcional)</small> <input name="descripcion" value="${esc(venta?.descripcion ?? '')}" placeholder="Ej: ventana corrediza 1,50 x 1,10" /></label>
        </div>

        ${ctx.pagosHtml(venta?.pagos || [], 'Cobrado')}

        <div class="section-title"><h3>Compras asociadas</h3></div>
        <div data-sel>${selHtml()}</div>
        <div data-pool>${poolHtml()}</div>

        <div class="totals-box">
          <div><span>Total venta</span><b data-t-venta>$ 0</b></div>
          <div><span>Compras asociadas</span><b data-t-compra>$ 0</b></div>
          <div><span>Diferencia</span><b data-t-dif>$ 0</b></div>
        </div>`,
      init(f) {
        const total = () => ctx.num(f.precio_final.value);
        const updPagos = ctx.bindPagos(f, total);
        const recalc = () => {
          const compra = sel.reduce((a, c) => a + Number(c.monto), 0);
          const dif = total() - compra;
          f.querySelector('[data-t-venta]').textContent = money(total());
          f.querySelector('[data-t-compra]').textContent = money(compra);
          const d = f.querySelector('[data-t-dif]');
          d.textContent = money(dif);
          d.className = dif < 0 ? 'neg' : 'pos';
          updPagos();
        };
        f.oninput = recalc;
        f.onclick = (e) => {
          const b = e.target.closest('button');
          if (!b) return;
          if (b.dataset.link) {
            const c = pool.find((x) => x.id === Number(b.dataset.link));
            pool = pool.filter((x) => x !== c); sel.push(c);
          } else if (b.dataset.unlink) {
            const c = sel.find((x) => x.id === Number(b.dataset.unlink));
            sel = sel.filter((x) => x !== c); pool.unshift(c);
          } else return;
          f.querySelector('[data-sel]').innerHTML = selHtml();
          f.querySelector('[data-pool]').innerHTML = poolHtml();
          recalc();
        };
        recalc();
      },
      async submit(f) {
        if (!f.fecha.value) throw new Error('Poné la fecha de la venta.');
        const total = ctx.num(f.precio_final.value);
        if (!total) throw new Error('Poné el monto total de la venta.');
        const pagos = ctx.readPagos(f);
        ctx.validarPagos(pagos);
        must(await sb.rpc('guardar_venta', { p: {
          id: venta?.id ?? null,
          fecha: f.fecha.value,
          cliente: f.cliente.value,
          descripcion: f.descripcion.value,
          precio_final: total,
          vendedor: f.vendedor.value,
          pagos,
          compra_ids: sel.map((c) => c.id),
        } }));
        ctx.toast(venta ? 'Venta actualizada' : 'Venta guardada');
        month = f.fecha.value.slice(0, 7);
      },
    }) && load();
  }

  await load();
}
