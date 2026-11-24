// COMPRAS: una carpeta por mes (desde mayo 2026, se agrega sola cada mes nuevo).
// Cada compra: proveedor, cliente, detalle, monto sin IVA, IVA 10,5%, IVA 21% y total.
// El total ("monto") es lo que se suma a la venta asociada.
const INICIO = '2026-05'; // primera carpeta

export async function render(el, ctx) {
  const { sb, esc, money, date, must } = ctx;
  let month = ctx.monthNow();
  let view = 'folders'; // folders | month
  let proveedor = '';
  let rows = [];

  el.innerHTML = `
    ${ctx.backLink}
    <div class="page-head">
      <h1>Compras</h1>
      <button class="btn primary" data-new>+ Nueva compra</button>
    </div>

    <!-- Carpetas -->
    <div data-folders-view>
      <div class="summary-bar" data-summary></div>
      <div class="folders" data-folders></div>
    </div>

    <!-- Dentro de un mes -->
    <div data-month-view class="hidden">
      <button type="button" class="back back-btn" data-to-folders>← Todas las carpetas</button>
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
        <table class="table compras-table">
          <thead><tr>
            <th>Fecha</th><th>Proveedor</th><th>Cliente</th><th>Detalle</th>
            <th class="num">Sin IVA</th><th class="num">IVA 10,5%</th><th class="num">IVA 21%</th><th class="num">Total</th>
            <th>Forma de pago</th><th>Venta de</th><th></th>
          </tr></thead>
          <tbody data-rows></tbody>
          <tfoot data-foot></tfoot>
        </table>
      </div>
    </div>`;

  const q = (s) => el.querySelector(s);
  const periodo = (ym) => `${ym}-01`;
  const neto = (r) => (r.neto ?? r.monto);

  function meses() {
    const list = [];
    for (let ym = INICIO; ym <= ctx.monthNow(); ym = ctx.addMonths(ym, 1)) list.push(ym);
    return list;
  }

  function show(v) {
    view = v;
    q('[data-folders-view]').classList.toggle('hidden', v !== 'folders');
    q('[data-month-view]').classList.toggle('hidden', v !== 'month');
    return v === 'folders' ? loadFolders() : loadMonth();
  }

  // ---------------------------------------------------------- carpetas
  async function loadFolders() {
    const list = meses();
    const data = must(await sb.from('compras').select('fecha, monto, neto, iva_105, iva_21').gte('fecha', periodo(INICIO)));
    const tot = {};
    list.forEach((ym) => { tot[ym] = { total: 0, neto: 0, iva: 0, cant: 0 }; });
    data.forEach((r) => {
      const t = tot[r.fecha.slice(0, 7)];
      if (!t) return;
      t.cant++;
      t.total += Number(r.monto);
      t.neto += Number(neto(r));
      t.iva += Number(r.iva_105) + Number(r.iva_21);
    });
    const sum = (k) => list.reduce((a, ym) => a + tot[ym][k], 0);
    const total = sum('total');
    const mejor = list.reduce((b, ym) => (tot[ym].total > tot[b].total ? ym : b), list[0]);

    q('[data-summary]').innerHTML = `
      <div><span>Total comprado</span><b>${money(total)}</b>
        <small>${ctx.monthName(INICIO)} a ${ctx.monthName(ctx.monthNow())}</small></div>
      <div><span>Promedio por mes</span><b>${money(total / list.length)}</b>
        <small>${list.length} ${list.length === 1 ? 'mes' : 'meses'}</small></div>
      <div><span>Total sin IVA</span><b>${money(sum('neto'))}</b><small>neto de las compras</small></div>
      <div><span>IVA de compras</span><b>${money(sum('iva'))}</b><small>10,5% + 21%</small></div>
      <div><span>Mes con más compras</span><b>${tot[mejor].total ? ctx.monthName(mejor) : '—'}</b>
        <small>${tot[mejor].total ? money(tot[mejor].total) : 'Sin compras todavía'}</small></div>`;

    const hoy = ctx.monthNow();
    q('[data-folders]').innerHTML = [...list].reverse().map((ym) => {
      const t = tot[ym];
      return `
        <button class="folder ${ym === hoy ? 'current' : ''}" data-folder="${ym}">
          <svg class="folder-ico" viewBox="0 0 24 24" width="44" height="44" aria-hidden="true">
            <path d="M3 6.5A1.5 1.5 0 0 1 4.5 5h4.38a1.5 1.5 0 0 1 1.06.44L11.5 7h8A1.5 1.5 0 0 1 21 8.5v9A1.5 1.5 0 0 1 19.5 19h-15A1.5 1.5 0 0 1 3 17.5z"/>
          </svg>
          <span class="folder-name">${ctx.monthName(ym)}${ym === hoy ? ' <em>actual</em>' : ''}</span>
          <span class="folder-total">${money(t.total)}</span>
          <span class="folder-meta">${t.cant} ${t.cant === 1 ? 'compra' : 'compras'} · sin IVA ${money(t.neto)}</span>
        </button>`;
    }).join('');
  }

  // ---------------------------------------------------------- un mes
  async function fillProveedores() {
    const list = await ctx.loadProveedores();
    q('[data-prov]').innerHTML = '<option value="">Todos</option>' +
      list.map((p) => `<option ${p === proveedor ? 'selected' : ''}>${esc(p)}</option>`).join('');
  }

  async function loadMonth() {
    await fillProveedores();
    q('[data-month-label]').textContent = ctx.monthName(month);
    const { from, to } = ctx.monthRange(month);
    let query = sb.from('compras').select('*, ventas(id, cliente, descripcion, fecha)')
      .gte('fecha', from).lt('fecha', to)
      .order('fecha', { ascending: false }).order('id', { ascending: false });
    if (proveedor) query = query.eq('proveedor', proveedor);
    rows = must(await query);

    const s = rows.reduce((a, r) => ({
      neto: a.neto + Number(neto(r)), i105: a.i105 + Number(r.iva_105),
      i21: a.i21 + Number(r.iva_21), total: a.total + Number(r.monto),
    }), { neto: 0, i105: 0, i21: 0, total: 0 });
    const sinVenta = rows.filter((r) => !r.venta_id).length;

    q('[data-stats]').innerHTML = `
      <div class="stat"><span>Total del mes</span><b>${money(s.total)}</b></div>
      <div class="stat"><span>Sin IVA</span><b>${money(s.neto)}</b></div>
      <div class="stat"><span>IVA 10,5%</span><b>${money(s.i105)}</b></div>
      <div class="stat"><span>IVA 21%</span><b>${money(s.i21)}</b></div>
      <div class="stat"><span>Compras</span><b>${rows.length}</b>${sinVenta ? ` <small class="neg">(${sinVenta} sin venta)</small>` : ''}</div>`;

    const byProv = {}, byVend = {};
    rows.forEach((r) => {
      byProv[r.proveedor] = (byProv[r.proveedor] || 0) + Number(r.monto);
      const v = r.vendedor || 'Sin indicar';
      byVend[v] = (byVend[v] || 0) + Number(r.monto);
    });
    const chips = (o) => Object.entries(o).sort((a, b) => b[1] - a[1])
      .map(([p, m]) => `<span class="chip">${esc(p)}<b>${money(m)}</b></span>`).join('');
    q('[data-chips]').innerHTML = rows.length
      ? `<div class="chips-row"><small class="muted">Por proveedor:</small>${chips(byProv)}</div>
         <div class="chips-row"><small class="muted">Venta de:</small>${chips(byVend)}</div>` : '';

    q('[data-rows]').innerHTML = rows.length ? rows.map((r) => `
      <tr>
        <td>${date(r.fecha)}</td>
        <td><b>${esc(r.proveedor)}</b></td>
        <td>${esc(r.cliente) || '<span class="muted">—</span>'}</td>
        <td>${esc(r.detalle)}</td>
        <td class="num">${money(neto(r))}</td>
        <td class="num">${Number(r.iva_105) ? money(r.iva_105) : '<span class="muted">—</span>'}</td>
        <td class="num">${Number(r.iva_21) ? money(r.iva_21) : '<span class="muted">—</span>'}</td>
        <td class="num"><b>${money(r.monto)}</b></td>
        <td>${ctx.pagosResumen(r.pagos)}</td>
        <td>${r.vendedor ? `<b>${esc(r.vendedor)}</b>` : '<span class="muted">—</span>'}
          ${r.ventas ? `<br><small>🔗 ${date(r.ventas.fecha)} · ${esc(r.ventas.cliente || r.ventas.descripcion || 'Venta #' + r.ventas.id)}</small>` : ''}</td>
        <td class="actions">
          <button class="btn small" data-edit="${r.id}">Editar</button>
          <button class="btn small danger" data-del="${r.id}">Borrar</button>
        </td>
      </tr>`).join('')
      : '<tr><td colspan="11" class="empty">No hay compras en este mes.</td></tr>';

    q('[data-foot]').innerHTML = rows.length ? `
      <tr class="total-row">
        <td colspan="4"><b>Totales del mes</b></td>
        <td class="num">${money(s.neto)}</td><td class="num">${money(s.i105)}</td>
        <td class="num">${money(s.i21)}</td><td class="num"><b>${money(s.total)}</b></td>
        <td colspan="3"></td>
      </tr>` : '';
  }

  el.onchange = (e) => {
    if (e.target.matches('[data-prov]')) { proveedor = e.target.value; loadMonth(); }
  };

  el.onclick = async (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.folder) { month = b.dataset.folder; proveedor = ''; return show('month'); }
    if (b.matches('[data-to-folders]')) return show('folders');
    if (b.matches('[data-prev]')) { month = ctx.addMonths(month, -1); return loadMonth(); }
    if (b.matches('[data-next]')) { month = ctx.addMonths(month, 1); return loadMonth(); }
    if (b.matches('[data-new]')) return edit(null);
    if (b.dataset.edit) return edit(rows.find((r) => r.id === Number(b.dataset.edit)));
    if (b.dataset.del) {
      const r = rows.find((x) => x.id === Number(b.dataset.del));
      if (!ctx.confirm(`¿Borrar la compra a "${r.proveedor}" por ${money(r.monto)}?`)) return;
      try { must(await sb.from('compras').delete().eq('id', r.id)); ctx.toast('Compra borrada'); show(view); }
      catch (err) { ctx.toast(err.message); }
    }
  };

  // ---------------------------------------------------------- formulario
  async function edit(c) {
    const ventas = must(await sb.from('ventas').select('id, fecha, cliente, descripcion')
      .order('fecha', { ascending: false }).order('id', { ascending: false }).limit(200));
    await ctx.loadProveedores();
    // Compra nueva: se asocia sola a la última venta cargada (se puede cambiar)
    const selected = c ? c.venta_id : ventas[0]?.id ?? null;
    const opt = (v) => `<option value="${v.id}" ${v.id === selected ? 'selected' : ''}>
      ${date(v.fecha)} · ${esc(v.cliente || 'Sin cliente')} ${v.descripcion ? '— ' + esc(v.descripcion.slice(0, 40)) : ''}</option>`;
    // Proveedor: si no está en la lista habitual, se muestra como "Otro"
    const provActual = c?.proveedor ?? '';
    const provOtro = !!provActual && !ctx.PROVEEDORES.includes(provActual);
    const defFecha = c?.fecha ?? (view === 'month' && month !== ctx.monthNow() ? `${month}-01` : ctx.today());

    await ctx.openForm({
      title: c ? 'Editar compra' : 'Nueva compra',
      wide: true,
      html: `
        <div class="grid3">
          <label>Fecha <input name="fecha" type="date" value="${defFecha}" /></label>
          <label>Proveedor
            <select name="prov_sel">
              <option value="">— Elegí —</option>
              ${ctx.PROVEEDORES.map((p) => `<option ${p === provActual ? 'selected' : ''}>${esc(p)}</option>`).join('')}
              <option value="__otro" ${provOtro ? 'selected' : ''}>Otro (escribir)…</option>
            </select>
            <input name="prov_otro" class="${provOtro ? '' : 'hidden'}" value="${esc(provOtro ? provActual : '')}" placeholder="Escribí el proveedor" />
          </label>
          <label>Cliente <input name="cliente" value="${esc(c?.cliente ?? '')}" placeholder="Para qué cliente es" /></label>
        </div>
        <label>Detalle <input name="detalle" value="${esc(c?.detalle ?? '')}" placeholder="Ej: perfiles, vidrio, herrajes" /></label>

        <div class="iva-grid">
          <label>Monto sin IVA <input name="neto" inputmode="decimal" placeholder="$ 0" value="${c ? (c.neto ?? c.monto) : ''}" /></label>
          <label>IVA 10,5%
            <span class="iva-input"><input name="iva_105" inputmode="decimal" placeholder="$ 0" value="${c && Number(c.iva_105) ? c.iva_105 : ''}" />
            <button type="button" class="btn small" data-calc="105" title="Calcular 10,5% del monto sin IVA">10,5%</button></span>
          </label>
          <label>IVA 21%
            <span class="iva-input"><input name="iva_21" inputmode="decimal" placeholder="$ 0" value="${c && Number(c.iva_21) ? c.iva_21 : ''}" />
            <button type="button" class="btn small" data-calc="21" title="Calcular 21% del monto sin IVA">21%</button></span>
          </label>
          <div class="iva-total"><span>Total</span><b data-total>$ 0</b></div>
        </div>
        <p class="hint" style="margin-top:-4px">Tocá <b>10,5%</b> o <b>21%</b> para calcular el IVA sobre el monto sin IVA. El total se suma solo.</p>

        <div class="grid2">
          <label>Venta de
            <select name="vendedor">
              <option value="">— Elegí —</option>
              ${ctx.VENDEDORES.map((v) => `<option ${v === c?.vendedor ? 'selected' : ''}>${esc(v)}</option>`).join('')}
            </select>
          </label>
          <label>Vincular a una venta <small class="muted">(opcional, para la utilidad)</small>
            <select name="venta_id">
              <option value="" ${selected ? '' : 'selected'}>— Sin vincular —</option>
              ${ventas.map(opt).join('')}
            </select>
          </label>
        </div>
        ${ctx.pagosHtml(c?.pagos || [], 'Pagado')}`,
      init(f) {
        const totalCompra = () => ctx.num(f.neto.value) + ctx.num(f.iva_105.value) + ctx.num(f.iva_21.value);
        const updPagos = ctx.bindPagos(f, totalCompra);
        const recalc = () => {
          f.querySelector('[data-total]').textContent = money(totalCompra());
          updPagos();
        };
        f.oninput = recalc;
        f.prov_sel.onchange = () => {
          const otro = f.prov_sel.value === '__otro';
          f.prov_otro.classList.toggle('hidden', !otro);
          if (otro) f.prov_otro.focus();
        };
        f.onclick = (e) => {
          const b = e.target.closest('[data-calc]');
          if (!b) return;
          const base = ctx.num(f.neto.value);
          const pct = b.dataset.calc === '105' ? 0.105 : 0.21;
          f[b.dataset.calc === '105' ? 'iva_105' : 'iva_21'].value = (Math.round(base * pct * 100) / 100).toFixed(2).replace('.', ',');
          recalc();
        };
        recalc();
      },
      async submit(f) {
        const n = ctx.num(f.neto.value), i105 = ctx.num(f.iva_105.value), i21 = ctx.num(f.iva_21.value);
        const data = {
          fecha: f.fecha.value,
          proveedor: (f.prov_sel.value === '__otro' ? f.prov_otro.value : f.prov_sel.value).trim(),
          vendedor: f.vendedor.value,
          cliente: f.cliente.value.trim(),
          detalle: f.detalle.value.trim(),
          neto: n, iva_105: i105, iva_21: i21,
          monto: Math.round((n + i105 + i21) * 100) / 100,
          venta_id: f.venta_id.value ? Number(f.venta_id.value) : null,
        };
        if (!data.proveedor) throw new Error(f.prov_sel.value === '__otro' ? 'Escribí el nombre del proveedor.' : 'Elegí el proveedor.');
        if (!data.fecha) throw new Error('Poné la fecha.');
        if (!data.monto) throw new Error('Poné el monto sin IVA.');
        data.pagos = ctx.readPagos(f);
        ctx.validarPagos(data.pagos);
        if (c) must(await sb.from('compras').update(data).eq('id', c.id));
        else must(await sb.from('compras').insert(data));
        ctx.toast(c ? 'Compra actualizada' : 'Compra guardada');
        month = data.fecha.slice(0, 7);
      },
    }) && show(view);
  }

  await show('folders');
}
