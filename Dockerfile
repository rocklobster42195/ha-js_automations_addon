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

# s6-overlay Service-Scripts deployen und ausführbar machen
COPY rootfs /
RUN chmod a+x /etc/services.d/js_automations/run

# Setze den Port frei
EXPOSE 3000
