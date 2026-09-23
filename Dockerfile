FROM node:20-alpine AS builder

WORKDIR /usr/src/app

COPY package*.json ./
COPY prisma ./prisma/

RUN npm ci

COPY . .

ENV DATABASE_URL="postgresql://user:pass@localhost:5432/db?schema=chatvcb"
ENV DIRECT_URL="postgresql://user:pass@localhost:5432/db?schema=chatvcb"

RUN npx prisma generate
RUN rm -rf dist tsconfig.build.tsbuildinfo && npm run build
RUN npm prune --omit=dev

FROM node:20-alpine AS runner

WORKDIR /usr/src/app

RUN apk add --no-cache openssl

ENV NODE_ENV=production
ENV PORT=3010

COPY package*.json ./
COPY --from=builder /usr/src/app/prisma ./prisma/
COPY --from=builder /usr/src/app/node_modules ./node_modules
COPY --from=builder /usr/src/app/dist ./dist

EXPOSE 3010

CMD ["node", "dist/main.js"]
