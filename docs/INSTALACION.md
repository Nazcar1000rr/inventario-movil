# Instalación

Hay dos instalaciones independientes: **iPhone (PWA)** y **Android (APK)**. Cada teléfono guarda sus propios datos, y no se comparten ni se sincronizan.

| | Dirección |
|---|---|
| App para iPhone (PWA) | <https://nazcar1000rr.github.io/inventario-movil/> |
| APK para Android (última versión) | <https://github.com/Nazcar1000rr/inventario-movil/releases/latest/download/inventario-movil.apk> |

Ambas se publican solas con GitHub Actions cada vez que se sube un cambio al repositorio.

---

## A. iPhone: app web instalable (PWA)

### Instalar

1. Abre la dirección de arriba en **Safari**.
2. Toca **Compartir** (cuadro con flecha) → **Añadir a pantalla de inicio** → **Añadir**.
3. Abre la app **siempre desde el icono** de la pantalla de inicio.

Necesita iOS 15.4 o superior; se recomienda iOS 17 o superior.

### Actualizar (por ejemplo, de la v1 a la v2)

1. **Antes:** en la app, Más → Respaldo → Preparar respaldo → guárdalo fuera del teléfono.
2. Abre la app con internet. Aparece "Hay una versión nueva de la app": toca **Actualizar ahora**.
3. Verás "¡Novedades!". Tus datos se convierten solos a la versión nueva y se conservan.

### Cosas importantes en iPhone

- **Usa solo la app instalada.** Si usas la página en una pestaña de Safari, iOS puede borrar sus datos tras 7 días sin uso, y los datos de Safari y los de la app instalada están separados. Si registraste algo en Safari, pásalo con *Respaldo* (preparar en Safari, importar en la app).
- **Quitar el icono de la pantalla de inicio borra los datos de la app.** Haz un respaldo antes.
- **Sin conexión:** después de abrirla una vez con internet, la app funciona sin conexión (incluida la ayuda y el manual en PDF).
- **Compartir:** el respaldo, el resumen mensual (imagen o PDF) y el manual se comparten con el menú de iOS (Archivos, AirDrop, WhatsApp, Correo…).

### Publicar tu propia copia (opcional)

Si algún día quieres publicarla en otro lugar: en el repositorio, **Settings → Pages → Source: GitHub Actions** y ejecuta **Actions → "PWA en GitHub Pages"**. También sirve cualquier alojamiento estático con HTTPS: sube el contenido de la carpeta `dist` compilada (usa rutas relativas, funciona en una subcarpeta). Lo que se publica son **los archivos de la app, no sus datos**.

---

## B. Android: APK instalable

### Instalar

1. Descarga el APK de la dirección de arriba (o pásalo al teléfono por WhatsApp, Drive, cable o Bluetooth).
2. Ábrelo desde *Archivos* o *Descargas*.
3. Si Android lo pide, toca **Configuración** y activa **Permitir desde esta fuente** para la app con la que abriste el archivo. Luego vuelve atrás.
4. Toca **Instalar**. Si Play Protect avisa que la app es desconocida, toca **Más detalles → Instalar de todas formas** (es normal fuera de Google Play; hazlo solo con el APK de tu repositorio).
5. Después puedes volver a desactivar el permiso del paso 3.

Necesita Android 7.0 o superior, con *Android System WebView* o Chrome actualizado (versión 90 o superior).

### Actualizar (por ejemplo, de la v1 a la v2)

1. **Antes:** Más → Respaldo → Preparar respaldo → guárdalo fuera del teléfono (o "Guardar en Documentos").
2. Instala el APK nuevo **encima** del anterior, **sin desinstalar**. Los datos se conservan porque la firma es la misma.
3. Al abrir verás "¡Novedades!". Tus datos se convierten solos.

### Cosas importantes en Android

- **Desinstalar la app o "Borrar datos" en Ajustes elimina la base de datos.** La app desactiva la copia automática a la nube de Google (sin nube), así que la única copia es tu archivo de respaldo.
- **Respaldos** desde *Respaldo*: **Compartir / guardar…** abre el menú de Android (WhatsApp, Drive, Gmail, Bluetooth, Quick Share) y **Guardar en Documentos** deja una copia en `Documentos/InventarioMovil/`, que no se borra al desinstalar.

### La firma (léela antes de compilar por tu cuenta)

El APK se firma con la clave entregada **por separado**, en la carpeta `firma-android`:

| Archivo | Para qué sirve |
|---|---|
| `inventario-release.jks` | La clave de firma |
| `keystore.properties` | Contraseñas y alias |
| `inventario-release.jks.base64.txt` | La misma clave en texto, para GitHub |

**Guarda esa carpeta en un lugar seguro y privado, y nunca la subas a un repositorio.**

Android solo permite **actualizar** la app si la versión nueva está firmada con **la misma clave**. Si la pierdes, para instalar una versión nueva tendrás que desinstalar la anterior, y desinstalar **borra los datos**: en ese caso haz un respaldo antes y luego impórtalo.

### Compilar en GitHub (así se hace hoy)

El repositorio tiene los 4 secretos de firma (**Settings → Secrets and variables → Actions**):

| Nombre | Valor |
|---|---|
| `ANDROID_KEYSTORE_BASE64` | Todo el texto de `inventario-release.jks.base64.txt` |
| `ANDROID_KEYSTORE_PASSWORD` | El valor de `storePassword` en `keystore.properties` |
| `ANDROID_KEY_ALIAS` | `inventario` |
| `ANDROID_KEY_PASSWORD` | El valor de `keyPassword` en `keystore.properties` |

Con cada cambio en `main`, el flujo **"APK Android"** ejecuta las pruebas, compila, firma, verifica la firma y publica el APK en *Releases* (enlace fijo de arriba). También se puede lanzar a mano en **Actions → "APK Android" → Run workflow**.

### Compilar en tu computador con Android Studio (alternativa)

Requisitos: Node.js 22 o superior, JDK 21 y Android Studio Otter (2025.2.1) o superior con Android SDK 36.

```bash
# 1. Copia la clave al proyecto (estos archivos están en .gitignore)
cp firma-android/inventario-release.jks   inventario-movil/android/
cp firma-android/keystore.properties      inventario-movil/android/

# 2. Compila
cd inventario-movil
npm ci
npm run build
npx cap sync android
cd android
./gradlew assembleRelease          # en Windows: gradlew.bat assembleRelease

# 3. El APK queda en:
#    android/app/build/outputs/apk/release/app-release.apk
```

Para cada versión nueva, aumenta `VERSION_CODE` (por ejemplo, `VERSION_CODE=2 ./gradlew assembleRelease`) y la versión en `package.json`.

---

## C. Pasar los datos de un teléfono a otro (copia manual)

1. En el teléfono de origen: **Más → Respaldo → Preparar respaldo**. Puedes protegerlo con contraseña. Luego **Guardar o compartir**.
2. Envía el archivo al otro teléfono (AirDrop, WhatsApp, correo, Drive…).
3. En el teléfono de destino: **Más → Respaldo → Elegir archivo de respaldo**. Revisa el resumen y confirma.

Ten en cuenta:
- Funciona entre iPhone y Android en cualquier dirección: el formato es el mismo. Un respaldo de la v1 se puede importar en la v2 (se convierte solo).
- **No es una sincronización.** Después de importar, cada teléfono sigue cambiando por separado.
- Si el teléfono de destino ya tiene datos, la importación los **reemplaza**. Se pide escribir REEMPLAZAR y se guarda una copia interna para **deshacer**.
- No se combinan dos instalaciones, para evitar duplicar existencias o dinero.
- Un archivo dañado, incompleto o con la contraseña equivocada se rechaza sin tocar los datos actuales.
- **Si olvidas la contraseña de un respaldo cifrado, no hay forma de abrirlo.**

---

## D. Probar en desarrollo (opcional)

```bash
npm ci
npm run dev            # http://localhost:5173 en el computador
npm run build && npm run preview -- --host   # servir la compilación en la red local
```

Desde un teléfono en la misma red Wi-Fi puedes abrir `http://IP-DEL-COMPUTADOR:4173` para ver la interfaz. Sin HTTPS, el service worker y la instalación como app no se activan.
