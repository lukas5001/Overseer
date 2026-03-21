.PHONY: help up down infra migrate seed dev-api dev-receiver dev-worker dev-frontend build test lint

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-20s\033[0m %s\n", $$1, $$2}'

# ==================== Docker ====================

up: ## Start all services
	docker compose up -d

down: ## Stop all services
	docker compose down

infra: ## Start only database + Redis
	docker compose up -d postgres redis

# ==================== Database ====================

migrate: ## Run database migrations
	psql -h localhost -U overseer -d overseer -f migrations/001_initial.sql

seed: ## Seed development data
	python scripts/seed_dev_data.py

reset-db: ## Drop and recreate database, run migrations, seed data
	docker compose exec postgres psql -U overseer -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"
	$(MAKE) migrate
	$(MAKE) seed

# ==================== Development ====================

dev-receiver: ## Start receiver in dev mode
	cd receiver && uvicorn app.main:app --reload --port 8001

dev-worker: ## Start worker in dev mode
	cd worker && python -m app.main

dev-api: ## Start API in dev mode
	cd api && uvicorn app.main:app --reload --port 8000

dev-frontend: ## Start frontend in dev mode
	cd frontend && npm run dev

# ==================== Build ====================

build: ## Build all Docker images
	docker compose build

build-collector: ## Build Go collector binary
	cd collector && go build -o overseer-collector ./cmd/

# ==================== Test & Lint ====================

test: ## Run all tests
	pytest tests/ -v

lint: ## Lint Python code
	ruff check receiver/ worker/ api/ shared/

lint-fix: ## Auto-fix Python lint issues
	ruff check --fix receiver/ worker/ api/ shared/
