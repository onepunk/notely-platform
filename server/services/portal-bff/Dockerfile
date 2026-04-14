FROM node:18-alpine

RUN npm install -g npm@10.8.2

WORKDIR /workspace

COPY packages ./packages
WORKDIR /workspace/packages
RUN npm install --omit=dev

WORKDIR /workspace/services/portal-bff

COPY services/portal-bff/package.json ./
RUN npm install --omit=dev

COPY services/portal-bff/ ./

EXPOSE 3215

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:3215/health', (r) => process.exit(r.statusCode === 200 ? 0 : 1))"

CMD ["npm", "start"]
