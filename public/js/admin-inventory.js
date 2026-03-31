(() => {
  const toggleButton = document.getElementById("toggleBottleStock");
  const bottleStockRows = document.querySelectorAll("[data-bottle-stock]");
  if (!toggleButton || !bottleStockRows.length) return;

  const showLabel = toggleButton.getAttribute("data-show-label") || "Show bottle stock";
  const hideLabel = toggleButton.getAttribute("data-hide-label") || "Hide bottle stock";

  const applyState = (isVisible) => {
    bottleStockRows.forEach((row) => {
      row.classList.toggle("d-none", !isVisible);
    });
    toggleButton.textContent = isVisible ? hideLabel : showLabel;
    toggleButton.setAttribute("aria-pressed", isVisible ? "true" : "false");
  };

  let isVisible = false;
  applyState(isVisible);

  toggleButton.addEventListener("click", () => {
    isVisible = !isVisible;
    applyState(isVisible);
  });
})();

(() => {
  const stateKey = "adminInventoryUiState";
  const forms = document.querySelectorAll("form");
  const toggleInput = document.getElementById("lowStockAlertsEnabled");
  const toggleForm = document.getElementById("lowStockAlertsForm");
  const persistUiState = (form) => {
    const modalEl = form?.closest(".modal");
    const state = {
      scrollY: window.scrollY || 0,
      modalId: modalEl ? modalEl.id : null,
    };
    window.sessionStorage.setItem(stateKey, JSON.stringify(state));
  };

  if (toggleInput && toggleForm) {
    toggleInput.addEventListener("change", () => {
      persistUiState(toggleForm);
      if (typeof toggleForm.requestSubmit === "function") {
        toggleForm.requestSubmit();
        return;
      }
      toggleForm.submit();
    });
  }

  forms.forEach((form) => {
    form.addEventListener("submit", () => {
      persistUiState(form);
    });
  });

  window.addEventListener("load", () => {
    const rawState = window.sessionStorage.getItem(stateKey);
    if (!rawState) {
      return;
    }

    window.sessionStorage.removeItem(stateKey);

    let state = null;
    try {
      state = JSON.parse(rawState);
    } catch (_error) {
      return;
    }

    if (Number.isFinite(state?.scrollY)) {
      window.scrollTo(0, state.scrollY);
    }

    if (state?.modalId && window.bootstrap?.Modal) {
      const modalElement = document.getElementById(state.modalId);
      if (modalElement) {
        const modal = window.bootstrap.Modal.getOrCreateInstance(modalElement);
        modal.show();
      }
    }
  });
})();

(() => {
  const toggles = document.querySelectorAll("[data-auto-submit='stock-visibility']");
  toggles.forEach((toggle) => {
    toggle.addEventListener("change", () => {
      const form = toggle.closest("form");
      if (form) {
        const modalEl = form.closest(".modal");
        const state = {
          scrollY: window.scrollY || 0,
          modalId: modalEl ? modalEl.id : null,
        };
        window.sessionStorage.setItem("adminInventoryUiState", JSON.stringify(state));
        if (typeof form.requestSubmit === "function") {
          form.requestSubmit();
          return;
        }
        form.submit();
      }
    });
  });
})();

(() => {
  const thresholdForms = document.querySelectorAll("[data-auto-submit-threshold]");
  if (!thresholdForms.length) return;
  const stateKey = "adminInventoryUiState";

  thresholdForms.forEach((form) => {
    const input = form.querySelector("[data-threshold-input]");
    if (!input) return;

    input.dataset.initialValue = String(input.value ?? "");
    form.dataset.submitting = "false";

    const submitIfChanged = () => {
      const initial = String(input.dataset.initialValue ?? "");
      const current = String(input.value ?? "");
      if (initial === current) return;
      if (form.dataset.submitting === "true") return;
      form.dataset.submitting = "true";
      const modalEl = form.closest(".modal");
      const state = {
        scrollY: window.scrollY || 0,
        modalId: modalEl ? modalEl.id : null,
      };
      window.sessionStorage.setItem(stateKey, JSON.stringify(state));

      if (typeof form.requestSubmit === "function") {
        form.requestSubmit();
        return;
      }
      form.submit();
    };

    input.addEventListener("change", submitIfChanged);
    input.addEventListener("blur", submitIfChanged);
  });
})();

(() => {
  const searchInput = document.getElementById("supplierSearchInput");
  const cards = document.querySelectorAll("[data-supplier-card]");
  const emptyState = document.getElementById("supplierSearchEmptyState");
  if (!searchInput || !cards.length) return;

  const applyFilter = () => {
    const query = (searchInput.value || "").toLowerCase().trim();
    let visibleCount = 0;

    cards.forEach((card) => {
      const searchText = (card.getAttribute("data-supplier-search") || "").toLowerCase();
      const isMatch = !query || searchText.includes(query);
      card.classList.toggle("d-none", !isMatch);
      if (isMatch) {
        visibleCount += 1;
      }
    });

    if (emptyState) {
      emptyState.classList.toggle("d-none", visibleCount > 0);
    }
  };

  searchInput.addEventListener("input", applyFilter);
})();

(() => {
  const loadMoreButtons = document.querySelectorAll("[data-history-load-more]");
  if (!loadMoreButtons.length) return;

  const resetHistoryModal = (modalBody, button) => {
    const initialCount =
      Number.parseInt(button.getAttribute("data-history-initial"), 10) || 5;
    const rows = modalBody.querySelectorAll("tr[data-history-row]");
    rows.forEach((row, index) => {
      row.classList.toggle("d-none", index >= initialCount);
    });

    const remainingHiddenRows = modalBody.querySelectorAll("tr[data-history-row].d-none");
    button.classList.toggle("d-none", !remainingHiddenRows.length);
  };

  loadMoreButtons.forEach((button) => {
    const modalBody = button.closest(".modal-body");
    const modalEl = button.closest(".modal");
    if (!modalBody) return;

    button.addEventListener("click", () => {
      const step = Number.parseInt(button.getAttribute("data-history-step"), 10) || 5;
      const hiddenRows = modalBody.querySelectorAll("tr[data-history-row].d-none");
      if (!hiddenRows.length) {
        button.classList.add("d-none");
        return;
      }

      Array.from(hiddenRows)
        .slice(0, step)
        .forEach((row) => row.classList.remove("d-none"));

      const remainingHiddenRows = modalBody.querySelectorAll("tr[data-history-row].d-none");
      if (!remainingHiddenRows.length) {
        button.classList.add("d-none");
      }
    });

    if (modalEl) {
      modalEl.addEventListener("hidden.bs.modal", () => {
        resetHistoryModal(modalBody, button);
      });
    }
  });
})();

(() => {
  const pickers = document.querySelectorAll("[data-import-picker]");
  if (!pickers.length) return;

  pickers.forEach((picker) => {
    const searchInput = picker.querySelector("[data-import-search]");
    const options = picker.querySelectorAll("[data-import-option]");
    const checkboxes = picker.querySelectorAll("[data-import-checkbox]");
    const selectedCount = picker.querySelector("[data-import-selected-count]");
    const emptyState = picker.querySelector("[data-import-empty]");
    const form = picker.closest("form");

    const updateSelectedCount = () => {
      const count = Array.from(checkboxes).filter((cb) => cb.checked).length;
      if (selectedCount) {
        selectedCount.textContent = `${count} selected`;
      }
    };

    const applyFilter = () => {
      const query = (searchInput?.value || "").trim().toLowerCase();
      let visibleCount = 0;

      options.forEach((option) => {
        const text = (option.getAttribute("data-search-text") || "").toLowerCase();
        const isMatch = !query || text.includes(query);
        option.classList.toggle("d-none", !isMatch);
        if (isMatch) visibleCount += 1;
      });

      if (emptyState) {
        emptyState.classList.toggle("d-none", visibleCount > 0);
      }
    };

    checkboxes.forEach((checkbox) => {
      checkbox.addEventListener("change", updateSelectedCount);
    });

    if (searchInput) {
      searchInput.addEventListener("input", applyFilter);
    }

    if (form) {
      form.addEventListener("submit", (event) => {
        const count = Array.from(checkboxes).filter((cb) => cb.checked).length;
        if (!count) {
          event.preventDefault();
          if (searchInput) {
            searchInput.focus();
          }
        }
      });
    }

    updateSelectedCount();
    applyFilter();
  });
})();
