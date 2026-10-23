// La dirección del Apps Script ya no vive en el código: se guarda como variable
// secreta de Cloudflare con el nombre GOOGLE_WEBHOOK_URL.

// Checklists disponibles. El título debe coincidir con el del checklist real.
// 'pdf' es la ruta del archivo dentro del sitio (carpeta public del repositorio).
const CHECKLISTS = {
  costos: {
    servicio: 'Costos',
    titulo: '10 puntos para detectar si el costo de tus productos está desactualizado',
    pdf: '/checklist-costos.pdf',
  },
  inventarios: {
    servicio: 'Inventarios',
    titulo: '10 controles para detectar por qué tu inventario físico no coincide con el sistema',
    pdf: '/checklist-inventarios.pdf',
  },
};

const ID_RE = /^[0-9a-f-]{36}$/;
const MAX_CAMPO = 200;
const MAX_INTENTOS_EMAIL = 5;

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });
}

// Escapa texto antes de mostrarlo en una página HTML (evita que un visitante inyecte código)
function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function limpiar(v, max = MAX_CAMPO) {
  return String(v ?? '').trim().slice(0, max);
}

async function enviarAGoogle(data, env) {
  const response = await fetch(env.GOOGLE_WEBHOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(data),
  });
  const result = await response.json();
  if (result.result !== 'success') {
    throw new Error(result.error || 'Google rechazó el envío');
  }
  return result;
}

/* ---------- Checklist: registro, email y descarga ---------- */

async function sincronizarChecklist(registro, env) {
  const cfg = CHECKLISTS[registro.servicio];
  try {
    const r = await enviarAGoogle({
      tipo: 'checklist',
      id: registro.id,
      timestamp: registro.timestamp,
      nombre: registro.nombre,
      correo: registro.correo,
      empresa: registro.empresa,
      cargo: registro.cargo,
      whatsapp: registro.whatsapp || '',
      servicio: cfg.servicio,
      variante: registro.variante,
      origen: registro.origen,
      titulo: cfg.titulo,
      descarga_url: registro.sitio + '/api/descarga?id=' + registro.id,
    }, env);
    registro.synced = true;
    registro.email = r.email || 'Sin dato';
    registro.error = '';
    if (!String(registro.email).startsWith('Enviado')) registro.intentos = (registro.intentos || 0) + 1;
  } catch (e) {
    registro.intentos = (registro.intentos || 0) + 1;
    registro.error = String(e).slice(0, 200);
  }
  await env.LEADS_KV.put('chk:' + registro.id, JSON.stringify(registro));
}

async function sincronizarDescarga(registro, env) {
  try {
    await enviarAGoogle({ tipo: 'descarga', id: registro.id, servicio: CHECKLISTS[registro.servicio].servicio, fecha: registro.descargo }, env);
    registro.descargo_sync = true;
    await env.LEADS_KV.put('chk:' + registro.id, JSON.stringify(registro));
  } catch (e) {
    // Queda pendiente: lo reintenta el proceso programado
  }
}

async function registrarChecklist(request, env, ctx) {
  const data = await request.json();
  if (data.website) return json({ ok: true }); // honeypot

  const servicio = limpiar(data.servicio).toLowerCase();
  if (!CHECKLISTS[servicio]) return json({ ok: false, error: 'Servicio no válido' }, 400);

  const lead = {
    nombre: limpiar(data.nombre),
    correo: limpiar(data.correo).toLowerCase(),
    empresa: limpiar(data.empresa),
    cargo: limpiar(data.cargo),
    whatsapp: limpiar(data.whatsapp).replace(/[^0-9+()\s-]/g, ''),
    servicio,
    variante: limpiar(data.variante),
    origen: limpiar(data.origen),
  };
  for (const campo of ['nombre', 'correo', 'empresa', 'cargo']) {
    if (!lead[campo]) return json({ ok: false, error: 'Falta el campo ' + campo }, 400);
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(lead.correo)) return json({ ok: false, error: 'Correo no válido' }, 400);

  const id = crypto.randomUUID();
  const registro = {
    ...lead,
    id,
    timestamp: new Date().toISOString(),
    sitio: new URL(request.url).origin,
    synced: false,
    email: 'Pendiente',
    error: '',
    intentos: 0,
    descargo: null,
    descargo_sync: false,
  };
  await env.LEADS_KV.put('chk:' + id, JSON.stringify(registro));

  // Responde de inmediato; el envío a Google y el email siguen en segundo plano
  ctx.waitUntil(sincronizarChecklist(registro, env));
  return json({ ok: true, id });
}

async function registrarDescarga(url, request, env, ctx) {
  const id = url.searchParams.get('id') || '';
  let destino = '/';
  if (ID_RE.test(id)) {
    const raw = await env.LEADS_KV.get('chk:' + id);
    if (raw) {
      const registro = JSON.parse(raw);
      destino = CHECKLISTS[registro.servicio]?.pdf || '/';
      if (!registro.descargo) {
        registro.descargo = new Date().toISOString();
        registro.descargo_sync = false;
        await env.LEADS_KV.put('chk:' + id, JSON.stringify(registro));
        ctx.waitUntil(sincronizarDescarga(registro, env));
      }
    }
  }
  return Response.redirect(new URL(destino, request.url).toString(), 302);
}

/* ---------- Consultas (formulario de /contacto) ---------- */

async function sincronizarConsulta(registro, env) {
  try {
    const r = await enviarAGoogle({
      tipo: 'consulta',
      id: registro.id,
      timestamp: registro.timestamp,
      nombre: registro.nombre,
      correo: registro.correo,
      empresa: registro.empresa,
      whatsapp: registro.whatsapp || '',
      mensaje: registro.mensaje,
    }, env);
    registro.synced = true;
    registro.email = r.email || 'Sin dato';
    registro.error = '';
    if (!String(registro.email).startsWith('Enviado')) registro.intentos = (registro.intentos || 0) + 1;
  } catch (e) {
    registro.intentos = (registro.intentos || 0) + 1;
    registro.error = String(e).slice(0, 200);
  }
  await env.LEADS_KV.put('con:' + registro.id, JSON.stringify(registro));
}

async function registrarConsulta(request, env, ctx) {
  const data = await request.json();
  if (data.website) return json({ ok: true }); // honeypot

  const lead = {
    nombre: limpiar(data.nombre),
    correo: limpiar(data.correo).toLowerCase(),
    empresa: limpiar(data.empresa),
    whatsapp: limpiar(data.whatsapp, 30).replace(/[^0-9+()\s-]/g, ''),
    mensaje: limpiar(data.mensaje, 2000),
  };
  for (const campo of ['nombre', 'correo', 'empresa', 'mensaje']) {
    if (!lead[campo]) return json({ ok: false, error: 'Falta el campo ' + campo }, 400);
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(lead.correo)) return json({ ok: false, error: 'Correo no válido' }, 400);

  const id = crypto.randomUUID();
  const registro = {
    ...lead,
    id,
    timestamp: new Date().toISOString(),
    synced: false,
    email: 'Pendiente',
    error: '',
    intentos: 0,
  };
  await env.LEADS_KV.put('con:' + id, JSON.stringify(registro));
  ctx.waitUntil(sincronizarConsulta(registro, env));
  return json({ ok: true });
}

/* ---------- Páginas de administración ---------- */

function paginaAdmin(titulo, resumen, encabezados, filas) {
  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>${esc(titulo)} — Arakué</title>
    <style>body{font-family:sans-serif;padding:24px;max-width:1000px;margin:0 auto;}
    table{width:100%;border-collapse:collapse;margin-top:16px;}
    td,th{border:1px solid #ddd;padding:8px;text-align:left;font-size:13px;}
    .pendiente{background:#fff3cd;} .ok{background:#d4edda;}</style></head>
    <body><h1>${esc(titulo)}</h1><p>${esc(resumen)}</p>
    <table><tr>${encabezados.map((h) => `<th>${esc(h)}</th>`).join('')}</tr>
    ${filas.map((f) => `<tr class="${f.clase}">${f.celdas.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}
    </table></body></html>`;
  return new Response(html, { headers: { 'Content-Type': 'text/html;charset=utf-8' } });
}

async function leerRegistros(env, esChecklist) {
  const lista = await env.LEADS_KV.list();
  const registros = [];
  for (const key of lista.keys) {
    if (key.name.startsWith('con:')) continue;
    if (key.name.startsWith('chk:') !== esChecklist) continue;
    const valor = await env.LEADS_KV.get(key.name);
    if (valor) registros.push(JSON.parse(valor));
  }
  registros.sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1));
  return registros;
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // Formulario de reservas (sin cambios de lógica)
    if (url.pathname === '/api/reservar' && request.method === 'POST') {
      try {
        const data = await request.json();

        if (data.website) {
          return json({ ok: true });
        }

        const requeridos = ['nombre', 'cargo', 'empresa', 'whatsapp'];
        for (const campo of requeridos) {
          if (!data[campo]) {
            return json({ ok: false, error: 'Falta el campo ' + campo }, 400);
          }
        }

        const timestamp = new Date().toISOString();
        const recordId = timestamp + '-' + crypto.randomUUID();

        await env.LEADS_KV.put(recordId, JSON.stringify({ ...data, timestamp, synced: false, intentos: 0 }));

        let enviado = false;
        for (let i = 0; i < 3; i++) {
          try {
            await enviarAGoogle(data, env);
            enviado = true;
            break;
          } catch (e) {
            await new Promise((r) => setTimeout(r, 400));
          }
        }

        if (enviado) {
          await env.LEADS_KV.put(recordId, JSON.stringify({ ...data, timestamp, synced: true, intentos: 1 }));
        }

        return json({ ok: true });
      } catch (error) {
        return json({ ok: false, error: error.toString() }, 500);
      }
    }

    // Formulario del checklist
    if (url.pathname === '/api/checklist' && request.method === 'POST') {
      try {
        return await registrarChecklist(request, env, ctx);
      } catch (error) {
        return json({ ok: false, error: 'No se pudo procesar el formulario' }, 500);
      }
    }

    // Formulario de consulta (/contacto)
    if (url.pathname === '/api/contacto' && request.method === 'POST') {
      try {
        return await registrarConsulta(request, env, ctx);
      } catch (error) {
        return json({ ok: false, error: 'No se pudo procesar el formulario' }, 500);
      }
    }

    // Descarga rastreada del checklist (la usan el botón de gracias y el email)
    if (url.pathname === '/api/descarga' && request.method === 'GET') {
      return registrarDescarga(url, request, env, ctx);
    }

    // Administración: reservas
    if (url.pathname === '/api/leads' && request.method === 'GET') {
      if (url.searchParams.get('key') !== env.ADMIN_KEY) return new Response('No autorizado', { status: 401 });
      const registros = await leerRegistros(env, false);
      const pendientes = registros.filter((r) => !r.synced);
      return paginaAdmin(
        'Estado de leads — Reservas',
        `${pendientes.length} pendiente(s) de sincronizar, de ${registros.length} total.`,
        ['Fecha', 'Nombre', 'Empresa', 'WhatsApp', 'Estado'],
        registros.map((r) => ({
          clase: r.synced ? 'ok' : 'pendiente',
          celdas: [r.timestamp, r.nombre, r.empresa, r.whatsapp, r.synced ? 'Sincronizado' : 'Pendiente'],
        })),
      );
    }

    // Administración: checklist
    if (url.pathname === '/api/checklist-leads' && request.method === 'GET') {
      if (url.searchParams.get('key') !== env.ADMIN_KEY) return new Response('No autorizado', { status: 401 });
      const registros = await leerRegistros(env, true);
      const sinEmail = registros.filter((r) => !String(r.email).startsWith('Enviado'));
      const descargas = registros.filter((r) => r.descargo);
      return paginaAdmin(
        'Estado de leads — Checklist',
        `${registros.length} total · ${sinEmail.length} sin email confirmado · ${descargas.length} con descarga.`,
        ['Fecha', 'Nombre', 'Correo', 'Empresa', 'Servicio / variante', 'Origen', 'Hoja de Google', 'Email', 'Descargó'],
        registros.map((r) => ({
          clase: r.synced && String(r.email).startsWith('Enviado') ? 'ok' : 'pendiente',
          celdas: [r.timestamp, r.nombre, r.correo, r.empresa, `${r.servicio} / ${r.variante}`, r.origen,
            r.synced ? 'Sincronizado' : 'Pendiente', r.email + (r.error ? ' · ' + r.error : ''), r.descargo || '—'],
        })),
      );
    }

    return env.ASSETS.fetch(request);
  },

  async scheduled(event, env) {
    const lista = await env.LEADS_KV.list();
    for (const key of lista.keys) {
      const raw = await env.LEADS_KV.get(key.name);
      if (!raw) continue;
      const registro = JSON.parse(raw);

      if (key.name.startsWith('con:')) {
        const emailOk = String(registro.email).startsWith('Enviado');
        if (!registro.synced || (!emailOk && (registro.intentos || 0) < MAX_INTENTOS_EMAIL)) {
          await sincronizarConsulta(registro, env);
        }
        continue;
      }

      if (key.name.startsWith('chk:')) {
        const emailOk = String(registro.email).startsWith('Enviado');
        if (!registro.synced || (!emailOk && (registro.intentos || 0) < MAX_INTENTOS_EMAIL)) {
          await sincronizarChecklist(registro, env);
        }
        if (registro.descargo && !registro.descargo_sync) {
          await sincronizarDescarga(registro, env);
        }
        continue;
      }

      // Reservas (lógica original)
      if (!registro.synced) {
        try {
          await enviarAGoogle(registro, env);
          registro.synced = true;
          await env.LEADS_KV.put(key.name, JSON.stringify(registro));
        } catch (e) {
          registro.intentos = (registro.intentos || 0) + 1;
          await env.LEADS_KV.put(key.name, JSON.stringify(registro));
        }
      }
    }
  },
};
