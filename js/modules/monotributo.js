// MONOTRIBUTO: cuota del mes + facturas emitidas/recibidas con su archivo (PDF o foto), mes a mes.
const BUCKET = 'facturas';

export async function render(el, ctx) {
  const { sb, esc, money, date, must } = ctx;
  let month = ctx.monthNow();
  let facturas = [];
  let mes = null;

  el.innerHTML = `
    ${ctx.backLink}
    <div class="page-head">
      <h1>Monotributo</h1>
      <button class="btn primary" data-new>+ Cargar factura</button>
    </div>
    <div class="toolbar">
      <div class="month-nav">
        <button class="btn small" data-prev>‹</button>
        <b data-month-label></b>
        <button class="btn small" data-next>›</button>
      </div>
    </div>
    <div class="stats" data-stats></div>
    <div class="card" data-cuota></div>
    <div class="card">
      <div class="section-title"><h3>Facturas emitidas</h3></div>
      <table class="table"><thead><tr>
        <th>Fecha</th><th>Número</th><th>Cliente</th><th class="num">Monto</th><th>Archivo</th><th></th>
      </tr></thead><tbody data-emitidas></tbody></table>
    </div>
    <div class="card">
      <div class="section-title"><h3>Facturas recibidas</h3></div>
      <table class="table"><thead><tr>
        <th>Fecha</th><th>Número</th><th>Proveedor</th><th class="num">Monto</th><th>Archivo</th><th></th>
      </tr></thead><tbody data-recibidas></tbody></table>
    </div>`;

  const q = (s) => el.querySelector(s);
  const periodo = (ym) => `${ym}-01`;

  async function load() {
    q('[data-month-label]').textContent = ctx.monthName(month);
    const desde12 = periodo(ctx.addMonths(month, -11));
    const [fs, m, anual] = await Promise.all([
      sb.from('facturas').select('*').eq('periodo', periodo(month)).order('fecha').order('id'),
      sb.from('monotributo_meses').select('*').eq('periodo', periodo(month)).maybeSingle(),
      sb.from('facturas').select('monto').eq('tipo', 'emitida').gte('periodo', desde12).lte('periodo', periodo(month)),
    ]);
    facturas = must(fs);
    mes = must(m);
    const anualTotal = must(anual).reduce((a, r) => a + Number(r.monto), 0);

    const emit = facturas.filter((f) => f.tipo === 'emitida');
    const reci = facturas.filter((f) => f.tipo === 'recibida');
    const sum = (l) => l.reduce((a, r) => a + Number(r.monto), 0);

    q('[data-stats]').innerHTML = `
      <div class="stat"><span>Facturado en el mes</span><b>${money(sum(emit))}</b></div>
      <div class="stat"><span>Recibido en el mes</span><b>${money(sum(reci))}</b></div>
      <div class="stat"><span>Facturado últimos 12 meses</span><b>${money(anualTotal)}</b></div>`;

    q('[data-cuota]').innerHTML = `
      <div class="section-title">
        <h3>Cuota del mes</h3>
        <button class="btn small" data-cuota-edit>${mes ? 'Editar' : 'Cargar cuota'}</button>
      </div>
      ${mes ? `
        <p style="margin:0">
          <b style="font-size:20px">${money(mes.cuota)}</b>
          ${mes.pagado ? `<span class="tag ok">Pagada${mes.fecha_pago ? ' el ' + date(mes.fecha_pago) : ''}</span>`
                       : '<span class="tag off">Sin pagar</span>'}
          ${mes.comprobante_path ? `· <button class="link-btn" data-file="${esc(mes.comprobante_path)}">Ver comprobante</button>` : ''}
        </p>
        ${mes.notas ? `<p class="hint" style="margin:6px 0 0">${esc(mes.notas)}</p>` : ''}`
      : '<p class="hint" style="margin:0">Todavía no cargaste la cuota de este mes.</p>'}`;

    const rowsHtml = (list, tipo) => list.length ? list.map((f) => `
      <tr>
        <td>${date(f.fecha)}</td>
        <td>${esc(f.numero)}</td>
        <td>${esc(f.contraparte)}</td>
        <td class="num">${money(f.monto)}</td>
        <td>${f.archivo_path ? `<button class="link-btn" data-file="${esc(f.archivo_path)}">${esc(f.archivo_nombre || 'Ver')}</button>` : '<span class="muted">—</span>'}</td>
        <td class="actions">
          <button class="btn small" data-edit="${f.id}">Editar</button>
          <button class="btn small danger" data-del="${f.id}">Borrar</button>
        </td>
      </tr>`).join('')
      : `<tr><td colspan="6" class="empty">No hay facturas ${tipo} en este mes.</td></tr>`;
    q('[data-emitidas]').innerHTML = rowsHtml(emit, 'emitidas');
    q('[data-recibidas]').innerHTML = rowsHtml(reci, 'recibidas');
  }

  async function upload(file) {
    const safe = file.name.normalize('NFD').replace(/[^\w.-]+/g, '_').slice(-80);
    const path = `${month}/${crypto.randomUUID()}-${safe}`;
    must(await sb.storage.from(BUCKET).upload(path, file, { contentType: file.type || undefined }));
    return { path, name: file.name };
  }

  async function openFile(path) {
    const win = window.open('', '_blank'); // se abre antes para que el navegador no la bloquee
    try {
      const { signedUrl } = must(await sb.storage.from(BUCKET).createSignedUrl(path, 300));
      if (win) win.location = signedUrl; else window.location.href = signedUrl;
    } catch (err) {
      win?.close();
      ctx.toast(err.message);
    }
  }

  el.onclick = async (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.matches('[data-prev]')) { month = ctx.addMonths(month, -1); return load(); }
    if (b.matches('[data-next]')) { month = ctx.addMonths(month, 1); return load(); }
    if (b.matches('[data-new]')) return editFactura(null);
    if (b.matches('[data-cuota-edit]')) return editCuota();
    if (b.dataset.file) return openFile(b.dataset.file);
    if (b.dataset.edit) return editFactura(facturas.find((f) => f.id === Number(b.dataset.edit)));
    if (b.dataset.del) {
      const f = facturas.find((x) => x.id === Number(b.dataset.del));
      if (!ctx.confirm(`¿Borrar la factura ${f.numero || ''} de ${money(f.monto)}? También se borra el archivo.`)) return;
      try {
        if (f.archivo_path) await sb.storage.from(BUCKET).remove([f.archivo_path]);
        must(await sb.from('facturas').delete().eq('id', f.id));
        ctx.toast('Factura borrada');
        load();
      } catch (err) { ctx.toast(err.message); }
    }
  };

  async function editFactura(f) {
    const defFecha = month === ctx.monthNow() ? ctx.today() : `${month}-01`;
    await ctx.openForm({
      title: f ? 'Editar factura' : `Cargar factura · ${ctx.monthName(month)}`,
      html: `
        <div class="grid2">
          <label>Tipo
            <select name="tipo">
              <option value="emitida" ${f?.tipo !== 'recibida' ? 'selected' : ''}>Emitida (a un cliente)</option>
              <option value="recibida" ${f?.tipo === 'recibida' ? 'selected' : ''}>Recibida (de un proveedor)</option>
            </select>
          </label>
          <label>Fecha <input name="fecha" type="date" value="${f?.fecha ?? defFecha}" /></label>
          <label>Número <input name="numero" value="${esc(f?.numero ?? '')}" placeholder="Ej: C 0001-00000123" /></label>
          <label>Monto <input name="monto" inputmode="decimal" placeholder="$ 0" value="${f?.monto ?? ''}" /></label>
        </div>
        <label>Cliente / proveedor <input name="contraparte" value="${esc(f?.contraparte ?? '')}" /></label>
        <label>Archivo (PDF o foto) ${f?.archivo_nombre ? `<small class="muted">· actual: ${esc(f.archivo_nombre)}</small>` : ''}
          <input name="archivo" type="file" accept="application/pdf,image/*" />
        </label>`,
      async submit(form) {
        if (!form.fecha.value) throw new Error('Poné la fecha.');
        const data = {
          tipo: form.tipo.value,
          fecha: form.fecha.value,
          periodo: form.fecha.value.slice(0, 7) + '-01',
          numero: form.numero.value.trim(),
          contraparte: form.contraparte.value.trim(),
          monto: ctx.num(form.monto.value),
        };
        const file = form.archivo.files[0];
        if (file) {
          if (file.size > 10 * 1024 * 1024) throw new Error('El archivo supera 10 MB.');
          const up = await upload(file);
          data.archivo_path = up.path;
          data.archivo_nombre = up.name;
        }
        if (f) {
          must(await sb.from('facturas').update(data).eq('id', f.id));
          if (file && f.archivo_path) await sb.storage.from(BUCKET).remove([f.archivo_path]);
        } else {
          must(await sb.from('facturas').insert(data));
        }
        ctx.toast('Factura guardada');
        month = data.fecha.slice(0, 7);
      },
    }) && load();
  }

  async function editCuota() {
    await ctx.openForm({
      title: `Cuota de monotributo · ${ctx.monthName(month)}`,
      html: `
        <div class="grid2">
          <label>Monto de la cuota <input name="cuota" inputmode="decimal" placeholder="$ 0" value="${mes?.cuota ?? ''}" /></label>
          <label>Fecha de pago <input name="fecha_pago" type="date" value="${mes?.fecha_pago ?? ''}" /></label>
        </div>
        <label class="check"><input name="pagado" type="checkbox" ${mes?.pagado ? 'checked' : ''} /> Pagada</label>
        <label>Comprobante de pago ${mes?.comprobante_nombre ? `<small class="muted">· actual: ${esc(mes.comprobante_nombre)}</small>` : ''}
          <input name="archivo" type="file" accept="application/pdf,image/*" />
        </label>
        <label>Notas <input name="notas" value="${esc(mes?.notas ?? '')}" placeholder="Ej: categoría A" /></label>`,
      init(form) {
        form.pagado.onchange = () => {
          if (form.pagado.checked && !form.fecha_pago.value) form.fecha_pago.value = ctx.today();
        };
      },
      async submit(form) {
        const data = {
          periodo: periodo(month),
          cuota: ctx.num(form.cuota.value),
          pagado: form.pagado.checked,
          fecha_pago: form.fecha_pago.value || null,
          notas: form.notas.value.trim(),
        };
        const file = form.archivo.files[0];
        if (file) {
          const up = await upload(file);
          data.comprobante_path = up.path;
          data.comprobante_nombre = up.name;
        }
        must(await sb.from('monotributo_meses').upsert(data));
        if (file && mes?.comprobante_path) await sb.storage.from(BUCKET).remove([mes.comprobante_path]);
        ctx.toast('Cuota guardada');
      },
    }) && load();
  }

  await load();
}
