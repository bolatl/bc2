PYTHON ?= python3
VENV_DIR ?= .venv

.PHONY: run run-env test check build setup setup-go setup-frontend setup-python setup-browser prepare-deploy secret-check
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

# Creates .env.deploy privately; existing deployment settings are never replaced.
prepare-deploy:
	$(PYTHON) scripts/prepare_deploy.py

secret-check:
	$(PYTHON) scripts/check_secrets.py --history

# Run after installing the system tools listed in README.md.
setup: setup-go setup-python setup-browser

setup-go:
	go mod download

setup-frontend:
	npm --prefix frontend ci

setup-python:
	$(PYTHON) -m venv "$(VENV_DIR)"
	"$(VENV_DIR)/bin/python" -m pip install -r requirements.txt

setup-browser: setup-frontend
	cd frontend && npx --no-install playwright install chromium
