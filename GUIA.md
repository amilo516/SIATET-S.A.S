# SIATET · Guía de instalación

## 1. Preparar el computador
1. Instala **Node.js** (versión LTS) desde https://nodejs.org
2. Abre la terminal (Windows: "Símbolo del sistema") y ejecuta:
   ```
   npm install -g firebase-tools
   ```
3. Crea la carpeta `C:\SIATET\` y descomprime ahí el archivo `siatet-app.zip`.
   Debe quedar así:
   ```
   C:\SIATET\siatet-app\
     ├─ firebase.json
     ├─ .firebaserc
     ├─ firestore.rules
     ├─ firestore.indexes.json
     ├─ GUIA.md
     └─ public\
         ├─ index.html      (app del técnico)
         ├─ admin.html      (panel de administración)
         ├─ sw.js           (modo sin conexión)
         ├─ manifest.json
         ├─ css\  fonts\  icons\
         └─ js\  (firebase-config.js, app.js, admin.js, pdf.js...)
   ```
   Nota: `.firebaserc` empieza con punto y en Windows puede verse oculto.

## 2. Crear el proyecto en Firebase
1. Entra a https://console.firebase.google.com y crea un proyecto (ej. "siatet").
2. **Firestore Database** → Crear base de datos → modo producción → región `southamerica-east1`.
3. **Authentication** → Comenzar → activa **Correo electrónico/contraseña**.
4. ⚙ Configuración del proyecto → General → **Agregar app web** (ícono `</>`).
   Copia los valores de `firebaseConfig` y pégalos en `public/js/firebase-config.js`.
5. Abre `.firebaserc` y reemplaza `PEGA-AQUI-EL-ID-DE-TU-PROYECTO` por el ID del proyecto.

## 3. Publicar
En la terminal:
```
cd C:\SIATET\siatet-app
firebase login
firebase deploy
```
Al final aparece el enlace (Hosting URL), por ejemplo `https://siatet.web.app`.

## 4. Crear el administrador
1. Authentication → Usuarios → **Agregar usuario** (tu correo y contraseña). Copia el **UID**.
2. Firestore → Iniciar colección `usuarios` → ID del documento = tu UID. Campos (tipo texto):
   - `nombre`: tu nombre
   - `prefijo`: ej. `ADM`
   - `rol`: `admin`
3. Abre `https://TU-ENLACE/admin.html`, ingresa, sube el logo y toca **Publicar nueva versión**.

## 5. Agregar técnicos
1. Authentication → Agregar usuario (correo y contraseña del técnico). Copia el UID.
2. En el panel → pestaña **Técnicos** → pega el UID, nombre y prefijo (ej. `EL`) → Guardar.
3. El técnico abre el enlace en su celular **con internet**, ingresa y toca
   **Instalar la app** (en iPhone: Compartir → Agregar a inicio).
   Desde ahí puede trabajar sin conexión.

## 6. Uso diario
- Informes hechos sin señal aparecen como **Por enviar** y se suben solos al volver internet.
- No cerrar sesión con informes por enviar (la app lo impide).
- En el panel → **Informes**: buscar, descargar PDF o exportar a Excel (CSV).

## 7. Cambios
- **Cambiar el formato** (logo, campos, secciones, textos): solo desde `admin.html` → Publicar.
  Los celulares lo reciben al tener internet. Los informes viejos conservan su versión.
- **Cambiar el código de la app**: edita los archivos, sube el número `VERSION` en
  `public/sw.js` (ej. 1.0.0 → 1.0.1) y ejecuta `firebase deploy`.
  Los técnicos verán la barra "Hay una nueva versión" → Actualizar.

## Costos
El plan gratuito (Spark) de Firebase alcanza para este volumen
(50.000 lecturas y 20.000 escrituras por día, 1 GB de datos).
