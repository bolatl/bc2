FROM node:24-bookworm-slim AS frontend
WORKDIR /frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
# Public display labels only. API keys must NEVER be passed as build arguments.
ARG VITE_LLM_MODE=unknown
ARG VITE_PAYMENT_MODE=unknown
RUN VITE_API_ORIGIN='' npm run build

FROM golang:1.26 AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY cmd ./cmd
COPY internal ./internal
RUN CGO_ENABLED=0 go build -trimpath -ldflags='-s -w' -o /lovelab ./cmd/server
RUN mkdir -p /runtime-data && chown 65532:65532 /runtime-data

FROM gcr.io/distroless/static-debian12:nonroot
WORKDIR /app
COPY --from=build /lovelab /lovelab
COPY --from=frontend /frontend/dist /app/frontend
COPY --from=build --chown=65532:65532 /runtime-data /data
ENV STATIC_DIR=/app/frontend
EXPOSE 8080
USER 65532:65532
ENTRYPOINT ["/lovelab"]
