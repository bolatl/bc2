**Please allow about 1 minute, sometimes longer, for the app to load after inactivity. Render's free server goes to sleep when idle and needs time to wake up. This delay is normal.**

# Kintsugi

Kintsugi helps couples prepare for a conversation after an argument: understand their feelings, find the first words, and understand each other. Each partner prepares separately, and their personal answers stay private.

## Current features

- Short onboarding, a personal profile, and an optional "About me" questionnaire with results in "My space."
- Questions tailored to the situation and previous answers, before-and-after mood ratings, and speech-to-text in supported browsers.
- Personal reflections, opening-line rehearsal, and a conversation plan.
- Partner invitations by link and a view of their readiness to talk.
- A journal of current and past conversations, new conversations, and shared follow-up ratings.
- Demo checkout with a prefilled test card. Access covers both partners and carries over to future conversations; no real charges are made.

## Local requirements

- **Go 1.26**.
- **Node.js 24** and **npm**.
- **Make** and a Bash / POSIX shell. On Windows, use **WSL2**.

No database is required. By default, data stays in memory until the server restarts. An API key is optional: without one, the app uses a local mock with predefined responses.

## Run locally

From the repository root, install dependencies and create the local configuration files. `cp -n` preserves any existing `.env` files:

```bash
go mod download
npm --prefix frontend ci
cp -n .env.example .env
cp -n frontend/.env.example frontend/.env
```

Start the backend in the first terminal:

```bash
make run-env
```

Start the frontend in a second terminal, also from the repository root:

```bash
npm --prefix frontend run dev
```

Open **http://localhost:5173**. The API runs at **http://localhost:8080**. To test a partner invitation, open its link in another browser or an incognito window.

To use Claude, set `LLM_PROVIDER=anthropic` and your `LLM_API_KEY` in the **root `.env`**, then restart the backend. The key belongs only on the server; do not put it in `frontend/.env`.

To preserve data across local restarts, set `DATA_FILE=./data/kintsugi.json` and a fixed, randomly generated `SESSION_SECRET` of at least 32 characters in the root `.env`. On Render's free tier, local data can be lost when the service stops ([free-tier limitations](https://render.com/docs/free)).

For development, run `make check` for the backend, and `npm --prefix frontend run lint` and `npm --prefix frontend run build` for the frontend. Go's `-race` checks require a C compiler. Optional Python tools need Python 3.10+ with `venv`/`pip` (`make setup-python`); browser tests need Chromium (`make setup-browser`). The API contract is in [`api/openapi.yaml`](api/openapi.yaml).
