ARG NODE_IMAGE=node:24-bookworm-slim
FROM ${NODE_IMAGE} AS dependencies
ARG NPM_REGISTRY=https://registry.npmjs.org
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/core/package.json packages/core/package.json
COPY packages/identity/package.json packages/identity/package.json
COPY packages/model/package.json packages/model/package.json
COPY packages/storage/package.json packages/storage/package.json
RUN npm ci --ignore-scripts --registry=${NPM_REGISTRY}

FROM dependencies AS build
COPY . .
RUN npm run check && npm run check:repo && npm run build

FROM build AS runtime
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000
USER node
EXPOSE 3000
CMD ["npm", "start"]

FROM build AS test
ENV NODE_ENV=test
USER node
CMD ["npm", "test"]
