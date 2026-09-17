FROM node:20-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:20-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --from=build /app/build ./build

# Render (and most PaaS free tiers) inject PORT at runtime; index.ts already
# reads process.env.PORT, falling back to 2567 for local `docker run`.
EXPOSE 2567
CMD ["node", "build/index.js"]
