# Publicar Ruta en tu cuenta Cloudflare

El código ya tiene el backend, la autenticación, las migraciones y el comando de publicación. Este documento indica las configuraciones externas que deben existir para completar el despliegue.

## 1. Cuenta y dirección pública

En Cloudflare, usa **Workers & Pages** y determina el subdominio `workers.dev` de tu cuenta. La primera dirección puede ser:

`https://gas-consume-tracker.TU-SUBDOMINIO.workers.dev`

Sustituye `TU-SUBDOMINIO` por el real. No es necesario comprar un dominio. Para usar un dominio propio más adelante habrá que actualizar el origen y la URL de retorno de Google.

## 2. Cliente OAuth de Google

En [Google Cloud Console](https://console.cloud.google.com/), configura una aplicación OAuth para usuarios externos y crea un cliente de tipo **Aplicación web**. Solo se piden `openid`, `email` y `profile`.

Configura el retorno autorizado **exacto**:

`https://gas-consume-tracker.TU-SUBDOMINIO.workers.dev/api/auth/callback`

Completa los datos de marca y contacto que solicite Google. Mientras la aplicación esté en modo de pruebas, agrega los correos de las cuentas con las que probarás el acceso. Antes de abrirla a la gente, habilita el acceso de producción según el proceso de Google. No crees credenciales de tipo cuenta de servicio.

Conserva el **Client ID** y el **Client secret** para guardarlos como secretos de Workers. No los incluyas en el repositorio, en capturas públicas ni en archivos de demostración.

## 3. Preparar la base y el Worker

Desde una computadora con Node.js 24 y pnpm 11.25.0:

```sh
git clone https://github.com/adlihs/gas-consume-tracker.git
cd gas-consume-tracker
pnpm install --frozen-lockfile
pnpm exec wrangler login
pnpm run cf:setup -- --origin https://gas-consume-tracker.TU-SUBDOMINIO.workers.dev
```

El comando de configuración busca la base D1 `gas-consume-tracker`, crea una si no existe y escribe su ID real y el origen en `wrangler.jsonc`. Revisa la cuenta seleccionada por Wrangler antes de continuar.

Si ya creaste D1 desde el panel, puedes evitar el aprovisionamiento automático:

```sh
pnpm run cf:setup -- --origin https://gas-consume-tracker.TU-SUBDOMINIO.workers.dev --database-id ID-REAL-DE-D1
```

Configura los secretos interactivos:

```sh
pnpm exec wrangler secret put GOOGLE_CLIENT_ID --config wrangler.jsonc
pnpm exec wrangler secret put GOOGLE_CLIENT_SECRET --config wrangler.jsonc
```

Si es la primera operación sobre ese Worker, Wrangler puede pedir crear un Worker de ese nombre para almacenar los secretos. También puedes crear inicialmente el Worker desde el panel y agregar los dos secretos en su configuración. No uses una variable pública de frontend para el Client secret.

## 4. Publicar

```sh
pnpm run cf:deploy
```

El comando valida la configuración, confirma los secretos, ejecuta pruebas, comprueba tipos, compila, prueba el Worker con D1 local, aplica las migraciones remotas y publica el código compilado. Después consulta `/api/auth/session` en el origen configurado. No anuncia éxito si esa comprobación no confirma que el acceso está configurado.

Antes de invitar a más personas:

1. Entra con una cuenta Google y registra un vehículo y una carga.
2. Cierra sesión y entra con otra cuenta: el primer vehículo no debe aparecer.
3. Registra un vehículo en la segunda cuenta y confirma que la primera solo ve el suyo.
4. Recarga la página para confirmar persistencia.
5. Prueba una carga parcial y otra completa; consulta la auditoría de intervalos.

Las pruebas automatizadas ya cubren el aislamiento, pero este paso verifica las credenciales Google y el despliegue real.

## 5. Despliegue automático desde GitHub

En el Worker de Cloudflare, conecta el repositorio `adlihs/gas-consume-tracker` a **Workers Builds**, con rama de producción `main`.

Configura Node.js 24, pnpm 11.25.0 y estas variables del entorno de compilación (no son secretos):

| Variable | Valor |
|---|---|
| `APP_ORIGIN` | Tu URL pública HTTPS, sin ruta |
| `CLOUDFLARE_D1_DATABASE_ID` | ID de la base D1 creada |

Comandos:

| Paso | Comando |
|---|---|
| Instalación | `pnpm install --frozen-lockfile` |
| Build | `pnpm run cf:setup` |
| Deploy | `pnpm run cf:deploy` |

El comando de deploy realiza la compilación y todas las pruebas. Los permisos del token de compilación deben permitir publicar ese Worker, listar sus secretos y aplicar migraciones en D1. Si el token generado por Cloudflare solo permite publicar el Worker, configura uno con esos permisos y restringido a tu cuenta. No hace falta permitir leer el contenido de los secretos.

Los secretos Google son **secretos de runtime del Worker**, no variables de compilación. `APP_ORIGIN` se incorpora a la configuración del Worker mediante `cf:setup`. No actives `ALLOW_HTTP_LOCALHOST` en producción.

Referencia: [Workers Builds](https://developers.cloudflare.com/workers/ci-cd/builds/) y [secretos de Workers](https://developers.cloudflare.com/workers/configuration/secrets/).

## Si algo falla

- **El acceso está en preparación:** faltan secretos Google o el origen es inválido.
- **redirect_uri_mismatch:** la URL de Google debe coincidir exactamente con `APP_ORIGIN + /api/auth/callback`.
- **Solo entran algunas personas:** revisa el modo de pruebas y usuarios autorizados en Google.
- **Error D1 / tabla inexistente:** revisa el binding `DB` y las migraciones remotas.
- **Error de origen:** confirma HTTPS, el dominio configurado y que el navegador esté usando ese mismo origen.
- **Límite de intentos:** espera la siguiente ventana de 10 minutos. El límite evita generar indefinidamente intentos OAuth.

El plan gratuito puede servir para comenzar, pero sus cuotas de CPU, solicitudes y D1 deben comprobarse con el uso real. Consulta [Workers](https://developers.cloudflare.com/workers/platform/pricing/) y [D1](https://developers.cloudflare.com/d1/platform/pricing/). Esta preparación no contrata un plan de pago.

## Despliegue automático desde GitHub (Workers Builds)

El Worker `gas-consume-tracker` está conectado al repositorio `adlihs/gas-consume-tracker`. Cada push a `main` compila y publica automáticamente:

- Variable de compilación: `NODE_VERSION=24`.
- Comando de compilación: `pnpm run build`.
- Comando de despliegue: `pnpm run cf:ci-deploy` (aplica migraciones D1 pendientes y publica `dist/server/wrangler.json`).

`wrangler.jsonc` contiene la configuración de producción. Los valores de desarrollo local van en `.dev.vars`. Los secretos de Google se conservan en el Worker y no se tocan en el despliegue. El estado y los registros de cada compilación aparecen en Cloudflare → Workers & Pages → gas-consume-tracker → Deployments.
