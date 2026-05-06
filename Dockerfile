FROM node:20-alpine

WORKDIR /app

COPY server/package.json server/package-lock.json* ./server/
RUN cd server && npm install --omit=dev

COPY server/ ./server/
COPY index.html app.js data.js styles.css ./public/
COPY favicon.ico favicon.svg favicon-32.png ./public/

ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD wget -q -O - http://localhost:8080/healthz >/dev/null || exit 1

CMD ["node", "server/server.js"]
