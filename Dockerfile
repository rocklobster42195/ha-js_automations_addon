ARG BUILD_FROM
FROM ${BUILD_FROM}

# Node.js und Build-Tools installieren
RUN apk add --no-cache nodejs npm git python3 make g++

# Setze das Arbeitsverzeichnis auf den finalen App-Ort
WORKDIR /app

# Kopiere package.json und installiere die Abhängigkeiten
COPY package.json package-lock.json ./
RUN npm install --production

# Kopiere den gesamten App-Code
COPY . .

# Setze den Port frei
EXPOSE 3000

# Node direkt als PID 1 starten (s6-overlay wird nicht verwendet)
ENTRYPOINT ["node", "js_automations/server.js"]
