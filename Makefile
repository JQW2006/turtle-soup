PY ?= python
NPM ?= npm

.PHONY: install dev backend frontend build test lint start

install:            ## install backend and frontend dependencies
	$(PY) -m pip install -r backend/requirements-dev.txt
	cd frontend && $(NPM) ci

backend:            ## run the API with auto-reload on :8000
	cd backend && $(PY) -m uvicorn app.main:app --reload --port 8000

frontend:           ## run the Vite dev server on :5173 (proxies /api to :8000)
	cd frontend && $(NPM) run dev

dev:                ## run backend and frontend together
	$(MAKE) -j2 backend frontend

build:              ## build the web app into frontend/dist
	cd frontend && $(NPM) run build

start: build        ## serve the built app and API on :8000
	cd backend && $(PY) -m uvicorn app.main:app --host 0.0.0.0 --port 8000

test:               ## run backend tests
	cd backend && $(PY) -m pytest -q

lint:               ## lint and type-check everything
	cd backend && $(PY) -m ruff check .
	cd frontend && $(NPM) run lint && $(NPM) run typecheck
