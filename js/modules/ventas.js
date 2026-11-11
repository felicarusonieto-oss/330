// VENTAS: precio final, compras asociadas (valor de compra total) y utilidad automática.
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
    <div class="card">
      <table class="table">
        <thead><tr>
          <th>Fecha</th><th>Cliente</th><th>Descripción</th>
          <th class="num">Precio final</th><th class="num">Compra total</th><th class="num">Utilidad</th><th></th>
        </tr></thead>
        <tbody data-rows></tbody>
      </table>
    </div>`;

  const q = (s) => el.querySelector(s);

  async function load() {
    q('[data-month-label]').textContent = ctx.monthName(month);
    const { from, to } = ctx.monthRange(month);
    rows = must(await sb.from('ventas_resumen').select('*')
      .gte('fecha', from).lt('fecha', to)
      .order('fecha', { ascending: false }).order('id', { ascending: false }));

    const tot = rows.reduce((a, r) => ({
      venta: a.venta + Number(r.precio_final),
      compra: a.compra + Number(r.compra_total),
      util: a.util + Number(r.utilidad),
    }), { venta: 0, compra: 0, util: 0 });

    q('[data-stats]').innerHTML = `
      <div class="stat"><span>Ventas del mes</span><b>${money(tot.venta)}</b></div>
      <div class="stat"><span>Compras asociadas</span><b>${money(tot.compra)}</b></div>
      <div class="stat"><span>Utilidad</span><b class="${tot.util < 0 ? 'neg' : 'pos'}">${money(tot.util)}</b></div>
      <div class="stat"><span>Cantidad de ventas</span><b>${rows.length}</b></div>`;

    q('[data-rows]').innerHTML = rows.length ? rows.map((r) => `
      <tr>
        <td>${date(r.fecha)}</td>
        <td><b>${esc(r.cliente) || '<span class="muted">—</span>'}</b></td>
        <td>${esc(r.descripcion)}</td>
        <td class="num">${money(r.precio_final)}</td>
        <td class="num">${money(r.compra_total)} <small>(${r.compras_cant})</small></td>
        <td class="num"><b class="${r.utilidad < 0 ? 'neg' : 'pos'}">${money(r.utilidad)}</b></td>
        <td class="actions">
          <button class="btn small" data-edit="${r.id}">Editar</button>
          <button class="btn small danger" data-del="${r.id}">Borrar</button>
        </td>
      </tr>`).join('')
      : '<tr><td colspan="7" class="empty">No hay ventas cargadas en este mes.</td></tr>';
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
      if (!ctx.confirm(`¿Borrar la venta a "${r.cliente || 'sin cliente'}" por ${money(r.precio_final)}?\nSus compras quedan en Compras como "sin asignar".`)) return;
      try { must(await sb.from('ventas').delete().eq('id', r.id)); ctx.toast('Venta borrada'); load(); }
      catch (err) { ctx.toast(err.message); }
    }
  };

  // ---------------------------------------------------------- formulario
  async function edit(venta) {
    const [compras, sinAsignar] = await Promise.all([
      venta ? must(await sb.from('compras').select('*').eq('venta_id', venta.id).order('id')) : [],
      must(await sb.from('compras').select('*').is('venta_id', null).order('fecha', { ascending: false }).limit(100)),
      ctx.loadProveedores(),
    ]);
    let pool = sinAsignar; // compras sin venta que se pueden sumar

    const lineHtml = (c = {}) => `
      <div class="line" data-id="${c.id ?? ''}" data-fecha="${c.fecha ?? ''}">
        <input name="proveedor" list="dl-proveedores" placeholder="Proveedor" value="${esc(c.proveedor ?? '')}" />
        <input name="detalle" placeholder="Detalle (opcional)" value="${esc(c.detalle ?? '')}" />
        <input name="monto" inputmode="decimal" placeholder="$ Monto" value="${c.monto ?? ''}" />
        <button type="button" class="x" title="Quitar de la venta" data-remove>✕</button>
      </div>`;

    const poolHtml = () => pool.length ? `
      <div class="unassigned">
        <b>Compras sin asignar</b> <small class="muted">— tocá “Sumar” para asociarlas a esta venta</small>
        <ul>${pool.map((c) => `
          <li><span>${date(c.fecha)} · <b>${esc(c.proveedor)}</b> ${esc(c.detalle)} · ${money(c.monto)}</span>
              <button type="button" class="btn small" data-attach="${c.id}">Sumar</button></li>`).join('')}
        </ul>
      </div>` : '';

    await ctx.openForm({
      title: venta ? 'Editar venta' : 'Nueva venta',
      wide: true,
      html: `
        <div class="grid3">
          <label>Fecha <input name="fecha" type="date" value="${venta?.fecha ?? ctx.today()}" /></label>
          <label>Cliente <input name="cliente" value="${esc(venta?.cliente ?? '')}" /></label>
          <label>Precio final <input name="precio_final" inputmode="decimal" placeholder="$ 0" value="${venta?.precio_final ?? ''}" /></label>
        </div>
        <label>Descripción del trabajo <textarea name="descripcion" placeholder="Ej: ventana corrediza 1,50 x 1,10 línea Módena">${esc(venta?.descripcion ?? '')}</textarea></label>

        <div class="section-title"><h3>Compras de esta venta</h3>
          <button type="button" class="btn small" data-add-line>+ Agregar compra</button></div>
        <div class="lines-head"><span>Proveedor</span><span>Detalle</span><span>Monto</span></div>
        <div class="lines" data-lines>${compras.length ? compras.map(lineHtml).join('') : lineHtml()}</div>
        <div data-pool>${poolHtml()}</div>

        <div class="totals-box">
          <div><span>Precio final</span><b data-t-venta>$ 0</b></div>
          <div><span>Valor de compra total</span><b data-t-compra>$ 0</b></div>
          <div><span>Utilidad</span><b data-t-util>$ 0</b></div>
        </div>`,
      init(f) {
        const recalc = () => {
          const venta = ctx.num(f.precio_final.value);
          const compra = [...f.querySelectorAll('.line [name=monto]')].reduce((a, i) => a + ctx.num(i.value), 0);
          const util = venta - compra;
          f.querySelector('[data-t-venta]').textContent = money(venta);
          f.querySelector('[data-t-compra]').textContent = money(compra);
          const u = f.querySelector('[data-t-util]');
          u.textContent = money(util);
          u.className = util < 0 ? 'neg' : 'pos';
        };
        f.oninput = recalc;
        f.onclick = (e) => {
          const b = e.target.closest('button');
          if (!b) return;
          if (b.matches('[data-add-line]')) {
            f.querySelector('[data-lines]').insertAdjacentHTML('beforeend', lineHtml());
            f.querySelector('.line:last-child [name=proveedor]').focus();
          }
          if (b.matches('[data-remove]')) b.closest('.line').remove();
          if (b.dataset.attach) {
            const c = pool.find((x) => x.id === Number(b.dataset.attach));
            pool = pool.filter((x) => x !== c);
            // si hay una línea vacía la reemplaza
            const empty = [...f.querySelectorAll('.line')].find((l) =>
              !l.dataset.id && !l.querySelector('[name=proveedor]').value && !l.querySelector('[name=monto]').value);
            empty?.remove();
            f.querySelector('[data-lines]').insertAdjacentHTML('beforeend', lineHtml(c));
            f.querySelector('[data-pool]').innerHTML = poolHtml();
          }
          recalc();
        };
        recalc();
      },
      async submit(f) {
        const lines = [...f.querySelectorAll('.line')].map((l) => ({
          id: l.dataset.id || null,
          fecha: l.dataset.fecha || null,
          proveedor: l.querySelector('[name=proveedor]').value.trim(),
          detalle: l.querySelector('[name=detalle]').value.trim(),
          monto: ctx.num(l.querySelector('[name=monto]').value),
        })).filter((c) => c.id || c.proveedor || c.monto); // ignora líneas vacías
        if (lines.some((c) => !c.proveedor)) throw new Error('Cada compra necesita un proveedor.');
        if (!f.fecha.value) throw new Error('Poné la fecha de la venta.');
        must(await sb.rpc('save_venta', { p: {
          id: venta?.id ?? null,
          fecha: f.fecha.value,
          cliente: f.cliente.value,
          descripcion: f.descripcion.value,
          precio_final: ctx.num(f.precio_final.value),
          compras: lines,
        } }));
        ctx.toast(venta ? 'Venta actualizada' : 'Venta guardada');
        month = f.fecha.value.slice(0, 7);
      },
    }) && load();
  }

  await load();
}
