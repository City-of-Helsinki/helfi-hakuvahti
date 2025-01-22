PHONY += up
up: ## Build and launch the environment
	$(call step,Build the container(s)...\n)
	$(call docker_compose,build)
	$(call step,Start up the container(s)...\n)
	$(call docker_compose,up --wait --remove-orphans)
