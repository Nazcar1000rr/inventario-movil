# Instalación

Hay dos instalaciones independientes: **iPhone (PWA)** y **Android (APK)**. Cada teléfono guarda sus propios datos, y no se comparten ni se sincronizan.

---

## A. iPhone: app web instalable (PWA)

### Paso 1 (una sola vez): publicar la app en una dirección HTTPS

Safari solo instala apps web servidas por HTTPS. Lo que se publica son **los archivos de la app, no sus datos**: los datos de cada persona quedan en su teléfono.

> En esta entrega la PWA **no está publicada**: no hubo un alojamiento disponible desde el entorno de desarrollo. Hay que hacer este paso una vez.

**Opción recomendada: GitHub Pages (gratis, con el flujo incluido)**

1. Cree una cuenta en github.com y un repositorio nuevo (por ejemplo, `inventario-movil`). GitHub Pages gratis requiere un repositorio público. El código no contiene datos ni claves.
2. Suba el contenido de la carpeta del proyecto, **sin** `node_modules`, `dist` ni la carpeta de firma (el `.gitignore` ya excluye esas carpetas y las claves).
3. En el repositorio, vaya a **Settings → Pages → Build and deployment → Source** y elija **GitHub Actions**.
4. Vaya a **Actions → "PWA en GitHub Pages" → Run workflow**. Al terminar, la dirección aparece en el resumen: `https://SU-USUARIO.github.io/inventario-movil/`.

**Opción alternativa: cualquier alojamiento estático con HTTPS** (Netlify, Cloudflare Pages, un hosting propio)

- Suba el **contenido** de `pwa-lista-para-publicar.zip` (la carpeta `dist` compilada). Por ejemplo, en Netlify: entre a <https://app.netlify.com/drop> y arrastre la carpeta descomprimida. Necesita una cuenta gratuita para que el sitio no expire.
- La app usa rutas relativas, así que funciona también en una subcarpeta.

### Paso 2: instalar en el iPhone

1. Abra la dirección HTTPS en **Safari**.
2. Toque **Compartir** (cuadro con flecha) → **Añadir a pantalla de inicio** → **Añadir**.
3. Abra la app **siempre desde el icono** de la pantalla de inicio.

Necesita iOS 15.4 o superior; se recomienda iOS 17 o superior.

### Cosas importantes en iPhone

- **Use solo la app instalada.**
  - Si usa la página en una pestaña de Safari, iOS puede borrar sus datos tras 7 días sin uso.
  - Los datos de la pestaña de Safari y los de la app instalada están separados.
  - Si ya registró algo en Safari, páselo a la app con *Respaldo → Exportar* en Safari y *Respaldo → Importar* en la app.
- **Quitar el icono de la pantalla de inicio borra los datos de la app.** Haga un respaldo antes.
- **Sin conexión:** después de abrirla una vez con internet, la app funciona sin conexión.
- **Actualizaciones:** cuando se publica una versión nueva, al abrir la app con internet aparece el aviso "Hay una versión nueva" y el botón **Actualizar ahora**. Los datos se conservan.
- **Respaldos:** en *Respaldo → Guardar o compartir* se abre el menú de iOS (Guardar en Archivos, AirDrop, WhatsApp, Correo…).

---

## B. Android: APK instalable

> En esta entrega el APK **no está compilado**: la red del entorno de desarrollo bloquea el Android SDK y los repositorios de Google y Maven. El proyecto Android está completo. Hay dos formas de compilarlo.

### La firma (léalo antes de compilar)

El APK se firma con la clave entregada **por separado**, en la carpeta `firma-android`:

| Archivo | Para qué sirve |
|---|---|
| `inventario-release.jks` | La clave de firma |
| `keystore.properties` | Contraseñas y alias |
| `inventario-release.jks.base64.txt` | La misma clave en texto, para GitHub |

**Guarde esa carpeta en un lugar seguro y privado, y nunca la suba a un repositorio.**

Android solo permite **actualizar** la app si la versión nueva está firmada con **la misma clave**. Si la pierde, para instalar una versión nueva tendrá que desinstalar la anterior, y desinstalar **borra los datos**. En ese caso, haga un respaldo antes y luego impórtelo.

### Opción 1: compilar en GitHub, sin instalar nada (recomendada)

1. Use el mismo repositorio de GitHub de la sección A, o cree uno.
2. En **Settings → Secrets and variables → Actions → New repository secret**, cree estos 4 secretos:

   | Nombre | Valor |
   |---|---|
   | `ANDROID_KEYSTORE_BASE64` | Todo el texto de `inventario-release.jks.base64.txt` |
   | `ANDROID_KEYSTORE_PASSWORD` | El valor de `storePassword` en `keystore.properties` |
   | `ANDROID_KEY_ALIAS` | `inventario` |
   | `ANDROID_KEY_PASSWORD` | El valor de `keyPassword` en `keystore.properties` |

3. Vaya a **Actions → "APK Android" → Run workflow**. Tarda unos minutos.
4. Al terminar, abra la ejecución y descargue el artefacto **inventario-movil-apk**. Es un ZIP que contiene el `.apk`.

El flujo ejecuta las pruebas, compila, firma el APK y verifica la firma.

### Opción 2: compilar en su computador con Android Studio

Requisitos:
- Node.js 22 o superior.
- JDK 21.
- Android Studio Otter (2025.2.1) o superior, con Android SDK 36.

```bash
# 1. Copie la clave al proyecto (estos archivos están en .gitignore)
cp firma-android/inventario-release.jks   inventario-movil/android/
cp firma-android/keystore.properties      inventario-movil/android/

# 2. Compile
cd inventario-movil
npm ci
npm run build
npx cap sync android
cd android
./gradlew assembleRelease          # en Windows: gradlew.bat assembleRelease

# 3. El APK queda en:
#    android/app/build/outputs/apk/release/app-release.apk
```

Para cada versión nueva, aumente `VERSION_CODE` (por ejemplo, `VERSION_CODE=2 ./gradlew assembleRelease`) y la versión en `package.json`.

### Instalar el APK en el teléfono

1. Pase el archivo `.apk` al teléfono: por WhatsApp a usted mismo, Google Drive, cable USB o Bluetooth.
2. Ábralo desde *Archivos* o *Descargas*.
3. Si Android lo pide, toque **Configuración** y active **Permitir desde esta fuente** para la app con la que abrió el archivo (Archivos, Chrome, WhatsApp…). Luego vuelva atrás.
4. Toque **Instalar**. Si Play Protect avisa que la app es desconocida, toque **Más detalles → Instalar de todas formas**. Es normal en apps instaladas fuera de Google Play; hágalo solo con un APK que usted mismo compiló.
5. Después de instalar, puede volver a desactivar el permiso del paso 3.

Necesita Android 7.0 o superior, con *Android System WebView* o Chrome actualizado (versión 90 o superior).

### Cosas importantes en Android

- **Para actualizar,** instale el APK nuevo encima del anterior, **sin desinstalar**. Los datos se conservan si la firma es la misma.
- **Desinstalar la app o "Borrar datos" en Ajustes elimina la base de datos.** La app desactiva la copia automática a la nube de Google para cumplir "sin nube", así que la única copia es su archivo de respaldo.
- **Respaldos** desde *Respaldo*:
  - **Compartir / guardar…** abre el menú de Android (WhatsApp, Drive, Gmail, Bluetooth, Quick Share).
  - **Guardar en Documentos** deja una copia en `Documentos/InventarioMovil/`, que no se borra al desinstalar la app.

---

## C. Pasar los datos de un teléfono a otro (copia manual)

1. En el teléfono de origen: **Más → Respaldo → Preparar respaldo**. Puede proteger el archivo con una contraseña. Luego **Compartir / guardar**.
2. Envíe el archivo al otro teléfono (AirDrop, WhatsApp, correo, Drive…).
3. En el teléfono de destino: **Más → Respaldo → Elegir archivo de respaldo**. Revise el resumen y confirme.

Tenga en cuenta:
- Funciona entre iPhone y Android en cualquier dirección: el formato es el mismo.
- **No es una sincronización.** Después de importar, cada teléfono sigue cambiando por separado.
- Si el teléfono de destino ya tiene datos, la importación los **reemplaza**. Se pide escribir REEMPLAZAR y se guarda una copia interna para **deshacer**.
- No se combinan dos instalaciones, para evitar duplicar existencias o dinero.
- Un archivo dañado, incompleto o con la contraseña equivocada se rechaza sin tocar los datos actuales.

**Si olvida la contraseña de un respaldo cifrado, no hay forma de abrirlo.**

---

## D. Probar en desarrollo (opcional)

```bash
npm ci
npm run dev            # http://localhost:5173 en el computador
npm run build && npm run preview -- --host   # servir la compilación en la red local
```

Desde un teléfono en la misma red Wi-Fi puede abrir `http://IP-DEL-COMPUTADOR:4173` para ver la interfaz. Sin HTTPS, el service worker y la instalación como app no se activan. Para eso use la URL HTTPS del paso A.1.
