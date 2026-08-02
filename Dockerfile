ARG BUILD_FROM
FROM ${BUILD_FROM}

# Node.js und Build-Tools installieren
RUN apk add --no-cache nodejs npm git python3 make g++

# Setze das Arbeitsverzeichnis auf den finalen App-Ort
WORKDIR /app

# Kopiere package.json und installiere alle Abhängigkeiten (inkl. devDependencies,
# werden für den Build-Step unten gebraucht)
COPY package.json package-lock.json ./
RUN npm install

# Kopiere den gesamten App-Code
COPY . .

# Baut das LIT-Components-Bundle (js_automations/public/js/dist/) — schlägt das fehl,
# schlägt der gesamte Image-Build fehl, es entsteht kein neues Image und bereits
# laufende Installationen sind davon nicht betroffen.
RUN npm run build

# devDependencies (eslint, esbuild, typescript, ...) werden zur Laufzeit nicht
# gebraucht — nach dem Build wieder raus, damit das Image schlank bleibt.
RUN npm prune --production

# Setze den Port frei
EXPOSE 3000

# Node direkt als PID 1 starten (s6-overlay wird nicht verwendet)
ENTRYPOINT ["node", "js_automations/server.js"]
