const GOOGLE_WEBHOOK_URL = "https://script.google.com/macros/s/AKfycbwXqrBV2LPrBAbn_2Uz9khBBkGpXKbibkJOUiUvJ0UPV332xcjB9vUTVAilXP_xksmf/exec";

async function enviarAGoogle(data) {
  const response = await fetch(GOOGLE_WEBHOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(data),
  });
  const result = await response.json();
  if (result.result !== 'success') {
    throw new Error(result.error || 'Google rechazó el envío');
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/api/reservar' && request.method === 'POST') {
      try {
        const data = await request.json();

        if (data.website) {
          return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }

        const requeridos = ['nombre', 'cargo', 'empresa', 'whatsapp'];
        for (const campo of requeridos) {
          if (!data[campo]) {
            return new Response(JSON.stringify({ ok: false, error: 'Falta el campo ' + campo }), { status: 400, headers: { 'Content-Type': 'application/json' } });
          }
        }

        const timestamp = new Date().toISOString();
        const recordId = timestamp + '-' + crypto.randomUUID();

        await env.LEADS_KV.put(recordId, JSON.stringify({ ...data, timestamp, synced: false, intentos: 0 }));

        let enviado = false;
        for (let i = 0; i < 3; i++) {
          try {
            await enviarAGoogle(data);
            enviado = true;
            break;
          } catch (e) {
            await new Promise((r) => setTimeout(r, 400));
          }
        }

        if (enviado) {
          await env.LEADS_KV.put(recordId, JSON.stringify({ ...data, timestamp, synced: true, intentos: 1 }));
        }

        return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });

      } catch (error) {
        return new Response(JSON.stringify({ ok: false, error: error.toString() }), { status: 500, headers: { 'Content-Type': 'application/json' } });
      }
    }

    if (url.pathname === '/api/leads' && request.method === 'GET') {
      if (url.searchParams.get('key') !== env.ADMIN_KEY) {
        return new Response('No autorizado', { status: 401 });
      }
      const lista = await env.LEADS_KV.list();
      const registros = [];
      for (const key of lista.keys) {
        const valor = await env.LEADS_KV.get(key.name);
        registros.push(JSON.parse(valor));
      }
      registros.sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1));
      const pendientes = registros.filter((r) => !r.synced);
      const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Leads — Tekorá</title>
        <style>body{font-family:sans-serif;padding:24px;max-width:900px;margin:0 auto;}
        table{width:100%;border-collapse:collapse;margin-top:16px;}
        td,th{border:1px solid #ddd;padding:8px;text-align:left;font-size:13px;}
        .pendiente{background:#fff3cd;} .ok{background:#d4edda;}</style></head>
        <body>
        <h1>Estado de leads</h1>
        <p>${pendientes.length} pendiente(s) de sincronizar, de ${registros.length} total.</p>
        <table><tr><th>Fecha</th><th>Nombre</th><th>Empresa</th><th>WhatsApp</th><th>Estado</th></tr>
        ${registros.map(r => `<tr class="${r.synced ? 'ok' : 'pendiente'}">
          <td>${r.timestamp}</td><td>${r.nombre}</td><td>${r.empresa}</td><td>${r.whatsapp}</td>
          <td>${r.synced ? 'Sincronizado' : 'Pendiente'}</td></tr>`).join('')}
        </table></body></html>`;
      return new Response(html, { headers: { 'Content-Type': 'text/html;charset=utf-8' } });
    }

    return env.ASSETS.fetch(request);
  },

  async scheduled(event, env) {
    const lista = await env.LEADS_KV.list();
    for (const key of lista.keys) {
      const raw = await env.LEADS_KV.get(key.name);
      const registro = JSON.parse(raw);
      if (!registro.synced) {
        try {
          await enviarAGoogle(registro);
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
