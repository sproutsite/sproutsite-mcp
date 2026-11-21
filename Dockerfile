FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build && npm prune --omit=dev

FROM node:24-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000 MCP_DATA_DIR=/data
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules/ ./node_modules/
COPY --from=build /app/dist/src/ ./dist/src/
COPY LICENSE ./
USER node
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=3s --start-period=5s --retries=3 \
  CMD ["node", "--eval", "fetch('http://127.0.0.1:' + process.env.PORT + '/healthz').then(r => { if (!r.ok) process.exitCode = 1 }).catch(() => { process.exitCode = 1 })"]
CMD ["node", "dist/src/main.js"]
