FROM node:22.23.2-slim AS build
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
RUN npm ci --ignore-scripts
COPY . .
ARG SOURCE_COMMIT
RUN node -e "const fs=require('fs'); const commit=process.env.SOURCE_COMMIT || JSON.parse(fs.readFileSync('source-manifest.json')).sourceCommit; if(!/^[a-f0-9]{40}$/.test(commit)) throw Error('Use a reviewed source package'); fs.writeFileSync('build-source.json',JSON.stringify({sourceCommit:commit}));"
RUN npm run build

FROM node:22.23.2-slim
WORKDIR /app
ARG SOURCE_COMMIT
LABEL org.opencontainers.image.title="SpentOn" org.opencontainers.image.revision=$SOURCE_COMMIT
ENV NODE_ENV=production \
    SPENTON_DEPLOYMENT_MODE=self-hosted \
    SPENTON_STATIC_DIRECTORY=/app/dist \
    SPENTON_HOST=0.0.0.0 \
    SPENTON_PORT=8787 \
    SPENTON_SECURE_COOKIES=1 \
    SPENTON_DB_PATH=/data/spenton.sqlite \
    SPENTON_SOURCE_COMMIT=$SOURCE_COMMIT
COPY package.json package-lock.json .npmrc ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY src/engine.ts src/shared-purchase.ts src/group-bill-plan.ts src/recurring.ts src/subscriptions.ts ./src/
COPY server/*.mjs ./server/
COPY tools/restore-database-backup.mjs ./tools/
COPY self-hosted/reset-password.mjs ./self-hosted/
COPY --from=build /app/dist ./dist
COPY --from=build /app/build-source.json ./build-source.json
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s \
    CMD node -e "fetch('http://127.0.0.1:8787/api/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "server/container-entry.mjs"]
