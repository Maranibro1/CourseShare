# Kazikwanza: the web app, the sync API and live updates in one small service.
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# Where the welcome screen's "Download for Android" button points.
ARG VITE_APK_URL=https://github.com/Maranibro1/CourseShare/releases/download/android-latest/kazikwanza.apk
ENV VITE_SYNC=server VITE_APK_URL=$VITE_APK_URL
RUN npm run build && npm run build:server

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts
COPY --from=build /app/dist ./dist
COPY --from=build /app/dist-server ./dist-server
# With DATABASE_URL set, the server creates its tables from the same SQL as the Supabase setup.
COPY supabase/schema.sql ./supabase/schema.sql
# Without DATABASE_URL, data is kept here; mount a volume to keep it across deploys.
ENV DATA_DIR=/data
RUN mkdir -p /data && chown node:node /data
USER node
EXPOSE 8080
CMD ["node", "dist-server/index.js"]
