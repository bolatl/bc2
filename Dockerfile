FROM golang:1.26 AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY cmd ./cmd
COPY internal ./internal
RUN CGO_ENABLED=0 go build -trimpath -o /lovelab ./cmd/server

FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=build /lovelab /lovelab
EXPOSE 8080
ENTRYPOINT ["/lovelab"]
