ARG BUILDPLATFORM
FROM --platform=${BUILDPLATFORM} node:24-alpine
WORKDIR /app
# System-Tools für NPM (wichtig für manche Pakete)
RUN apk add --no-cache git python3 make g++
COPY package.json package-lock.json ./
RUN npm install --production
COPY js_automations ./js_automations
EXPOSE 3000
# Startet Node direkt als PID 1 mit dem neuen Pfad im js_automations-Verzeichnis
CMD ["node", "js_automations/server.js"]