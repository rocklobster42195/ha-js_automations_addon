FROM node:24-alpine
WORKDIR /app
# System-Tools für NPM (wichtig für manche Pakete)
RUN apk add --no-cache git python3 make g++
COPY package.json .
RUN npm install --production
COPY . .
EXPOSE 3000
# Startet Node direkt als PID 1
CMD ["node", "server.js"]