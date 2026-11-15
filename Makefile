.PHONY: run run-env test check build
run:
	go run ./cmd/server
# Loads variables from .env (gitignored) before starting the server.
run-env:
	set -a; . ./.env; set +a; go run ./cmd/server
test:
	go test -race ./...
check:
	go vet ./...
	go test -race ./...
build:
	go build -o bin/lovelab ./cmd/server
