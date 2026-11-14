.PHONY: run test check build
run:
	go run ./cmd/server
test:
	go test -race ./...
check:
	go vet ./...
	go test -race ./...
build:
	go build -o bin/lovelab ./cmd/server
