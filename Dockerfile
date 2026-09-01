FROM node:22.14-alpine AS build

WORKDIR /app

ENV NEXT_TELEMETRY_DISABLED=1

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

FROM node:22.14-alpine AS runtime

WORKDIR /app

ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY --from=build /app/.next ./.next
COPY --from=build /app/config ./config
COPY --from=build /app/drizzle ./drizzle
COPY --from=build /app/fixtures ./fixtures
COPY --from=build /app/src ./src
COPY --from=build /app/next.config.ts /app/tsconfig.json ./

EXPOSE 3000

CMD ["npm", "start"]
