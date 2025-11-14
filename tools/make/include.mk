include $(DRUIDFI_TOOLS_MAKE_DIR)common.mk

ifeq ($(call has,docker),yes)
include $(DRUIDFI_TOOLS_MAKE_DIR)docker.mk
endif