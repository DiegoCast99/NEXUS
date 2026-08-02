/* ============================================================
   NEXUS Dashboard · Módulo · Finanzas Personales
   Parte de window.NexusDash — namespace compartido (sin build).
   ============================================================ */
(function () {
  const S = window.NexusDash;
  const { MONTH_FILTER_KEY, categories, currentMonth, drawCashflowChart, drawCategoryChart, financeMoney } = S;
  const { elements, escapeHtml, formatDate, getFilteredMovements, labelMonth } = S;
  const { movementMonth, safeSetItem, sampleMovements, saveMovements, shiftMonth, state } = S;
  const { summarize, toDateInput } = S;

  // Interpreta un monto escrito a mano en formato uruguayo (coma = decimal,
  // punto = miles) o internacional (punto = decimal). El input es type=text
  // porque type=number DESCARTA el valor si tiene coma y el gasto se perdia en
  // silencio. Heuristica: el ultimo separador con 1-2 cifras detras es el
  // decimal; si tiene 3+ cifras detras es separador de miles.
  //   "500,50" -> 500.5 · "1.250,50" -> 1250.5 · "1.250" -> 1250 · "500.50" -> 500.5
  function parseMonto(raw) {
    var s = String(raw == null ? "" : raw).replace(/[^\d.,]/g, "");
    if (!s) return NaN;
    var sep = Math.max(s.lastIndexOf(","), s.lastIndexOf("."));
    if (sep !== -1) {
      var decimales = s.length - sep - 1;
      if (decimales >= 1 && decimales <= 2) {
        // separador decimal real: quitar el OTRO (miles) y normalizar a punto
        var sepChar = s.charAt(sep);
        var otro = sepChar === "," ? "." : ",";
        s = s.split(otro).join("").replace(sepChar, ".");
      } else {
        // 3+ cifras detras = separador de miles: quitar todos los separadores
        s = s.replace(/[.,]/g, "");
      }
    }
    var n = Number(s);
    return Number.isFinite(n) ? n : NaN;
  }

  function getAvailableMonths() {
    const months = new Set([currentMonth()]);
    for (let i = 1; i <= 11; i += 1) {
      months.add(shiftMonth(currentMonth(), -i));
    }
    state.movements.forEach((movement) => months.add(movementMonth(movement)));
    return Array.from(months).sort().reverse();
  }

  function populateMonthFilter() {
    const months = getAvailableMonths();
    const opciones = [
      `<option value="all">Todos</option>`,
      ...months.map((month) => `<option value="${month}">${escapeHtml(labelMonth(month))}</option>`)
    ].join("");
    if (elements.monthFrom) elements.monthFrom.innerHTML = opciones;
    if (elements.monthTo) elements.monthTo.innerHTML = opciones;
    // Si un mes guardado ya no existe entre las opciones, cae al mes actual.
    if (state.filters.monthFrom !== "all" && !months.includes(state.filters.monthFrom)) state.filters.monthFrom = currentMonth();
    if (state.filters.monthTo !== "all" && !months.includes(state.filters.monthTo)) state.filters.monthTo = currentMonth();
    if (elements.monthFrom) elements.monthFrom.value = state.filters.monthFrom;
    if (elements.monthTo) elements.monthTo.value = state.filters.monthTo;
  }

  // Etiqueta del rango para las metricas: "Julio 2026" (un mes) o "Marzo — Agosto".
  function rangoLabel() {
    const f = state.filters.monthFrom, t = state.filters.monthTo;
    if (f === "all" && t === "all") return "Todos los meses";
    if (f === t) return labelMonth(f);
    const desde = f === "all" ? "el inicio" : labelMonth(f);
    const hasta = t === "all" ? "hoy" : labelMonth(t);
    return desde + " — " + hasta;
  }

  function populateMovementCategories() {
    const type = elements.movementType.value;
    elements.movementCategory.innerHTML = categories[type]
      .map((category) => `<option value="${escapeHtml(category)}">${escapeHtml(category)}</option>`)
      .join("");
  }

  function populateCategoryFilter() {
    const allCategories = [...categories.income, ...categories.expense];
    elements.categoryFilter.innerHTML = [
      `<option value="all">Todas</option>`,
      ...allCategories.map((category) => `<option value="${escapeHtml(category)}">${escapeHtml(category)}</option>`)
    ].join("");
    elements.categoryFilter.value = state.filters.category;
  }

  function renderMetrics() {
    const filtered = getFilteredMovements();
    const totals = summarize(filtered);
    const monthLabel = rangoLabel();
    elements.balanceValue.textContent = financeMoney(totals.balance);
    elements.incomeValue.textContent = financeMoney(totals.income);
    elements.expenseValue.textContent = financeMoney(totals.expense);
    elements.savingValue.textContent = financeMoney(Math.max(0, totals.balance));
    elements.balanceHint.textContent = monthLabel;
    elements.incomeHint.textContent = `${totals.incomeCount} movimiento${totals.incomeCount === 1 ? "" : "s"}`;
    elements.expenseHint.textContent = `${totals.expenseCount} movimiento${totals.expenseCount === 1 ? "" : "s"}`;
    elements.savingHint.textContent = `${Math.max(0, totals.savingRate).toFixed(1)}% de tus ingresos`;
  }

  function renderMovements() {
    const filtered = getFilteredMovements().sort((a, b) => b.date.localeCompare(a.date));
    elements.emptyState.classList.toggle("is-visible", filtered.length === 0);
    elements.movementsTable.innerHTML = filtered.map((movement) => {
      const typeLabel = movement.type === "income" ? "Ingreso" : "Gasto";
      const amountClass = movement.type === "income" ? "amount-income" : "amount-expense";
      const sign = movement.type === "income" ? "+" : "-";
      return `
        <tr>
          <td>${escapeHtml(formatDate(movement.date))}</td>
          <td>${escapeHtml(movement.description)}</td>
          <td>${escapeHtml(movement.category)}</td>
          <td><span class="type-pill ${movement.type}">${typeLabel}</span></td>
          <td class="${amountClass}">${sign}${financeMoney(Number(movement.amount), true)}</td>
          <td>
            <div class="row-actions">
              <button class="table-action" type="button" data-action="edit" data-id="${movement.id}">Editar</button>
              <button class="table-action delete-action" type="button" data-action="delete" data-id="${movement.id}">Eliminar</button>
            </div>
          </td>
        </tr>
      `;
    }).join("");
  }

  function renderAll() {
    populateMonthFilter();
    populateCategoryFilter();
    renderMetrics();
    renderMovements();
    drawCashflowChart();
    drawCategoryChart();
    if (S.renderRevolut) S.renderRevolut();   // refresca la seccion Revolut
  }

  function handleFormSubmit(event) {
    event.preventDefault();
    const id = elements.movementId.value;
    const amount = parseMonto(elements.movementAmount.value);
    if (!Number.isFinite(amount) || amount <= 0) return;

    const payload = {
      id: id || `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      type: elements.movementType.value,
      amount,
      date: elements.movementDate.value,
      category: elements.movementCategory.value,
      description: elements.movementDescription.value.trim()
    };

    if (!payload.description) return;

    if (id) {
      state.movements = state.movements.map((movement) => movement.id === id ? payload : movement);
    } else {
      state.movements = [payload, ...state.movements];
      // Al agregar, saltar al mes del nuevo movimiento (rango de un solo mes)
      // para que se vea de una.
      S.setMonthRange(movementMonth(payload), movementMonth(payload));
    }

    saveMovements();
    resetForm();
    renderAll();
  }

  function resetForm() {
    elements.form.reset();
    elements.movementId.value = "";
    elements.movementDate.value = toDateInput();
    elements.movementType.value = "income";
    populateMovementCategories();
    elements.formTitle.textContent = "Agregar movimiento";
    elements.saveMovementButton.textContent = "Guardar movimiento";
    elements.cancelEditButton.classList.add("is-hidden");
  }

  function startEdit(id) {
    const movement = state.movements.find((item) => item.id === id);
    if (!movement) return;
    elements.movementId.value = movement.id;
    elements.movementType.value = movement.type;
    populateMovementCategories();
    elements.movementAmount.value = movement.amount;
    elements.movementDate.value = movement.date;
    elements.movementCategory.value = movement.category;
    elements.movementDescription.value = movement.description;
    elements.formTitle.textContent = "Editar movimiento";
    elements.saveMovementButton.textContent = "Guardar cambios";
    elements.cancelEditButton.classList.remove("is-hidden");
    elements.form.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  function deleteMovement(id) {
    const movement = state.movements.find((item) => item.id === id);
    if (!movement) return;
    const ok = window.confirm(`Eliminar "${movement.description}" de tus finanzas?`);
    if (!ok) return;
    state.movements = state.movements.filter((item) => item.id !== id);
    saveMovements();
    renderAll();
  }

  function seedData() {
    const baseMonth = currentMonth();
    const seeded = sampleMovements.map(([type, category, description, amount, monthOffset], index) => {
      const monthKey = shiftMonth(baseMonth, monthOffset + 1);
      const [year, month] = monthKey.split("-").map(Number);
      const day = Math.min(26, 5 + index * 2);
      return {
        id: `demo-${Date.now()}-${index}`,
        type,
        category,
        description,
        amount,
        date: `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`
      };
    });
    state.movements = [...seeded, ...state.movements.filter((movement) => !movement.id.startsWith("demo-"))];
    S.setMonthRange(currentMonth(), currentMonth());
    saveMovements();
    renderAll();
  }


  Object.assign(S, {
    deleteMovement, getAvailableMonths, handleFormSubmit, populateCategoryFilter, populateMonthFilter, populateMovementCategories,
    renderAll, renderMetrics, renderMovements, resetForm, seedData, startEdit,
  });
})();
