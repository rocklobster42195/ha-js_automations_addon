ARG BUILDPLATFORM
FROM --platform=${BUILDPLATFORM} node:24-alpine

# System-Tools für NPM (wichtig für manche Pakete)
RUN apk add --no-cache git python3 make g++

# Setze das Arbeitsverzeichnis auf den finalen App-Ort
WORKDIR /app

# Kopiere package.json und installiere die Abhängigkeiten
COPY package.json package-lock.json ./
RUN npm install --production

# Kopiere den gesamten App-Code
COPY . .

# Setze den Port frei
EXPOSE 3000

# Starte den Server aus dem Unterordner
CMD ["node", "js_automations/server.js"]
