NODE_FRESH_TARGETS := up post-install
NODE_POST_INSTALL_TARGETS := npm-install hav-init-db

PHONY += fresh
fresh: ## Build fresh development environment and sync
	@$(MAKE) $(NODE_FRESH_TARGETS)

PHONY += post-install
post-install: ## Run post-install actions
	@$(MAKE) $(NODE_POST_INSTALL_TARGETS)

PHONY += npm-install
npm-install: ## Run npm install
	$(call step,Run npm install...\n)
	$(call npm,install)

PHONY += hav-init-db
hav-init-db: ## Run database updates
	$(call step,Run database updates...\n)
	$(call npm,run hav:init-mongodb)

PHONY += lint
lint:
	$(call npm,run lint:check)

PHONY += fix
fix:
	$(call npm,run lint)

PHONY += test
test: ## Run tests
	$(call npm,run test)


ifeq ($(RUN_ON),docker)
define npm
	$(call docker_compose_exec,npm $(1),$(2))
endef
else
define npm
	@npm $(1)
endef
endif
