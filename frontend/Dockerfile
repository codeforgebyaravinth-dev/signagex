FROM node:22-alpine AS build

WORKDIR /app/frontend

COPY frontend/package.json frontend/yarn.lock ./
RUN corepack enable && yarn install --frozen-lockfile

COPY frontend /app/frontend

ARG REACT_APP_BACKEND_URL=
ENV REACT_APP_BACKEND_URL=${REACT_APP_BACKEND_URL}

RUN yarn build

FROM nginx:1.27-alpine

COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/frontend/build /usr/share/nginx/html

EXPOSE 80
