# ---- xray-core binary ----
FROM alpine:3.20 AS xray
ARG XRAY_VERSION=v26.3.27
RUN apk add --no-cache curl unzip \
 && curl -fsSL -o /tmp/xray.zip "https://github.com/XTLS/Xray-core/releases/download/${XRAY_VERSION}/Xray-linux-64.zip" \
 && unzip -o /tmp/xray.zip xray -d /usr/local/bin \
 && chmod +x /usr/local/bin/xray

# ---- runtime ----
FROM oven/bun:1.3-alpine
RUN apk add --no-cache curl ca-certificates
COPY --from=xray /usr/local/bin/xray /usr/local/bin/xray
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY . .
CMD ["bun", "start"]
