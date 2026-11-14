FROM node:22-alpine AS dependencies
WORKDIR /app
COPY package.json yarn.lock ./
RUN yarn install --production --frozen-lockfile --ignore-scripts

FROM node:22-alpine AS build
WORKDIR /app
COPY package.json yarn.lock ./
RUN yarn install --frozen-lockfile
COPY tsconfig.json nest-cli.json ./
COPY src ./src
RUN yarn build

FROM node:22-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
RUN addgroup -S app && adduser -S -G app -u 10001 app
COPY --from=dependencies --chown=app:app /app/node_modules ./node_modules
COPY --from=build --chown=app:app /app/dist ./dist
COPY --from=build --chown=app:app /app/package.json ./
USER 10001
EXPOSE 3000
CMD ["node", "dist/main.js"]
