# Tekora Consultoria — sitio web

Sitio construido en [Astro](https://astro.build), salida estática, desplegado en Cloudflare Workers (assets estáticos) conectado a un repositorio de GitHub.

Sin backend: los contactos van directo por `mailto:` y WhatsApp (`wa.me`) — no hay formulario ni función serverless que mantener.

## Estructura

```
src/
  layouts/
    BaseLayout.astro      → header + footer completos (sitio normal)
    LandingLayout.astro   → sin header/footer (tráfico pago: /lp/*)
  components/
    Header.astro           → sin "Sobre mí"; Contactar = mailto
    Footer.astro            → incluye Sobre mí; sin /contacto (no existe)
  styles/
    global.css             → tokens de color, tipografía, .cta-group (WhatsApp + correo)
  content/
    blog/                  → artículos de Recursos (Markdown)
  pages/
    index.astro             → Home: 4 secciones (posicionamiento general + problemas que resolvemos)
    costos.astro
    inventarios.astro
    sobre-mi.astro
    recursos/index.astro
    recursos/[...slug].astro
    lp/costos.astro         → versión sin chrome para Meta Ads
    lp/inventarios.astro
wrangler.jsonc              → requerido por Cloudflare Workers para servir /dist como sitio estático
```

## Contacto — a dónde va cada botón

- **Header / Footer / Sobre mí — "Contactar"**: `mailto:mvillalobos356@gmail.com`
- **Costos / Inventarios / landings pagas — "Solicitar diagnóstico"**: dos botones — WhatsApp (`+591 74177475`, mensaje precargado según la línea) y correo.
- **Home — "Contactar"**: mailto general, sin distinción de línea.

## Desarrollo local

```
npm install
npm run dev
```

## Agregar un artículo nuevo a Recursos

Crear un archivo `.md` en `src/content/blog/` con este formato de cabecera:

```
---
title: "Título del artículo"
summary: "Resumen de una línea."
publishDate: 2026-09-01
relatedLine: costos   # o inventarios
draft: false
---

Cuerpo del artículo en Markdown.
```

Aparece automáticamente en `/recursos` y en `/recursos/[slug]` — no hace falta tocar código.

## Desplegar en Cloudflare Workers

1. Subir este repositorio a GitHub — **los archivos deben quedar en la raíz del repo**, no dentro de una subcarpeta (si se arrastra la carpeta completa en vez de su contenido, el build falla porque no encuentra `package.json`).
2. En Cloudflare: **Workers & Pages → Create → Connect to Git** y seleccionar el repositorio.
3. Build command: `npm run build`. El archivo `wrangler.jsonc` ya incluido le indica a Cloudflare que sirva `./dist` como sitio estático.
4. Cada push a la rama principal despliega automáticamente.

## Pendientes abiertos (fuera del código, decisiones de negocio)

- **Imágenes**: la sección de posicionamiento en Home usa una ilustración geométrica provisional (SVG inline) — pendiente de reemplazo cuando se defina el estilo visual de imágenes del sitio.
- Los dos artículos de Recursos que siguen pendientes de redactar.
- Registrar el dominio y actualizarlo en `astro.config.mjs` (`site`).
- Confirmar si "Sobre mí" se queda solo en el footer de forma permanente, o si en algún momento vuelve al header.
