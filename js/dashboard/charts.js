/* ============================================================
   NEXUS Dashboard · Gráficos Canvas 2D (compartidos)
   Parte de window.NexusDash — namespace compartido (sin build).
   ============================================================ */
(function () {
  const S = window.NexusDash;
  const { categoryColors, chartTargets, currency, currentMonth, elements, escapeHtml } = S;
  const { getCommerceSnapshot, getFilteredMovements, integerNumber, labelMonth, moneyWithCents, movementMonth } = S;
  const { shiftMonth, state, summarize } = S;
  function getMonthlySeries() {
    const endingMonth = state.filters.month === "all" ? currentMonth() : state.filters.month;
    const months = Array.from({ length: 6 }, (_, index) => shiftMonth(endingMonth, index - 5));
    const baseData = getFilteredMovements({ includeMonth: false });
    return months.map((month) => {
      const movements = baseData.filter((movement) => movementMonth(movement) === month);
      const totals = summarize(movements);
      return { month, income: totals.income, expense: totals.expense };
    });
  }

  function resizeCanvas(canvas) {
    const rect = canvas.getBoundingClientRect();
    const fallbackHeight = Number(canvas.getAttribute("height") || rect.height || 220);
    const cssHeight = rect.height || fallbackHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.max(1, Math.round(rect.width * dpr));
    canvas.height = Math.max(1, Math.round(cssHeight * dpr));
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx, width: rect.width, height: cssHeight };
  }

  function drawNoData(ctx, width, height, label) {
    ctx.save();
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = "rgba(243,243,248,0.12)";
    ctx.strokeStyle = "rgba(255,255,255,0.08)";
    ctx.lineWidth = 1;
    for (let i = 0; i < 4; i += 1) {
      const y = 44 + i * ((height - 82) / 3);
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }
    ctx.fillStyle = "rgba(243,243,248,0.5)";
    ctx.font = "12px ui-monospace, SFMono-Regular, Menlo, monospace";
    ctx.textAlign = "center";
    ctx.fillText(label, width / 2, height / 2);
    ctx.restore();
  }

  function prefersReducedMotion() {
    return Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches);
  }

  function is3DMode() {
    return state.chartMode === "3d" && !prefersReducedMotion() && window.innerWidth > 760;
  }

  function applyChartMode() {
    document.body.classList.toggle("chart-mode-3d", is3DMode());
    document.body.classList.toggle("chart-mode-2d", !is3DMode());
    elements.chartModeButtons.forEach((button) => {
      const active = button.dataset.chartMode === state.chartMode;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", String(active));
    });
  }

  function setChartTargets(canvas, targets) {
    if (!canvas) return;
    chartTargets.set(canvas, targets);
  }

  function draw3DBar(ctx, x, y, width, height, radius, colorTop, colorBottom, depth = 8) {
    const safeHeight = Math.max(0, height);
    const dx = depth;
    const dy = -depth * 0.55;
    const gradient = ctx.createLinearGradient(0, y, 0, y + safeHeight);
    gradient.addColorStop(0, colorTop);
    gradient.addColorStop(1, colorBottom);

    ctx.save();
    ctx.fillStyle = "rgba(255,255,255,0.06)";
    ctx.beginPath();
    ctx.moveTo(x + radius, y + dy);
    ctx.lineTo(x + width + dx - radius, y + dy);
    ctx.quadraticCurveTo(x + width + dx, y + dy, x + width + dx, y + radius + dy);
    ctx.lineTo(x + width, y + radius);
    ctx.quadraticCurveTo(x + width, y, x + width - radius, y);
    ctx.lineTo(x + radius, y);
    ctx.quadraticCurveTo(x, y, x + radius, y + dy);
    ctx.fill();

    ctx.fillStyle = "rgba(0,0,0,0.28)";
    ctx.beginPath();
    ctx.moveTo(x + width, y + radius);
    ctx.lineTo(x + width + dx, y + dy + radius);
    ctx.lineTo(x + width + dx, y + safeHeight + dy);
    ctx.lineTo(x + width, y + safeHeight);
    ctx.closePath();
    ctx.fill();

    ctx.shadowColor = colorTop;
    ctx.shadowBlur = 14;
    ctx.fillStyle = gradient;
    roundedRect(ctx, x, y, width, safeHeight, radius);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.restore();
  }

  function showChartTooltip(canvas, event) {
    const tooltip = elements.chartTooltip;
    const targets = chartTargets.get(canvas) || [];
    if (!tooltip || !targets.length) return;
    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const hit = targets.find((target) => (
      x >= target.x && x <= target.x + target.width && y >= target.y && y <= target.y + target.height
    ));
    if (!hit) {
      tooltip.classList.remove("is-visible");
      return;
    }
    tooltip.innerHTML = hit.html;
    tooltip.style.left = `${Math.min(window.innerWidth - 280, event.clientX + 16)}px`;
    tooltip.style.top = `${Math.min(window.innerHeight - 130, event.clientY + 16)}px`;
    tooltip.classList.add("is-visible");
  }

  function hideChartTooltip() {
    elements.chartTooltip?.classList.remove("is-visible");
  }

  function drawCashflowChart() {
    if (!elements.cashflowChart) return;
    const { ctx, width, height } = resizeCanvas(elements.cashflowChart);
    const series = getMonthlySeries();
    const maxValue = Math.max(...series.flatMap((item) => [item.income, item.expense]), 1) * 1.18;
    ctx.clearRect(0, 0, width, height);

    const padding = { top: 18, right: 18, bottom: 34, left: 38 };
    const chartW = width - padding.left - padding.right;
    const chartH = height - padding.top - padding.bottom;

    if (series.every((item) => item.income === 0 && item.expense === 0)) {
      drawNoData(ctx, width, height, "Sin datos para la evolución mensual");
      setChartTargets(elements.cashflowChart, []);
      return;
    }

    ctx.save();
    ctx.strokeStyle = "rgba(255,255,255,0.075)";
    ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i += 1) {
      const y = padding.top + (chartH / 4) * i;
      ctx.beginPath();
      ctx.moveTo(padding.left, y);
      ctx.lineTo(width - padding.right, y);
      ctx.stroke();
    }

    const groupW = chartW / series.length;
    const barW = Math.min(18, groupW * 0.2);
    const expensePoints = [];
    const targets = [];
    const use3D = is3DMode();

    series.forEach((item, index) => {
      const x = padding.left + index * groupW + groupW / 2;
      const incomeH = (item.income / maxValue) * chartH;
      const expenseH = (item.expense / maxValue) * chartH;
      const baseY = padding.top + chartH;

      if (use3D) {
        draw3DBar(ctx, x - barW - 3, baseY - incomeH, barW, incomeH, 5, "rgba(49,230,173,0.95)", "rgba(49,230,173,0.12)", 8);
        draw3DBar(ctx, x + 3, baseY - expenseH, barW, expenseH, 5, "rgba(255,26,157,0.95)", "rgba(255,26,157,0.12)", 8);
      } else {
        const incomeGradient = ctx.createLinearGradient(0, baseY - incomeH, 0, baseY);
        incomeGradient.addColorStop(0, "rgba(49,230,173,0.95)");
        incomeGradient.addColorStop(1, "rgba(49,230,173,0.12)");
        ctx.fillStyle = incomeGradient;
        roundedRect(ctx, x - barW - 3, baseY - incomeH, barW, incomeH, 5);
        ctx.fill();

        const expenseGradient = ctx.createLinearGradient(0, baseY - expenseH, 0, baseY);
        expenseGradient.addColorStop(0, "rgba(255,26,157,0.95)");
        expenseGradient.addColorStop(1, "rgba(255,26,157,0.12)");
        ctx.fillStyle = expenseGradient;
        roundedRect(ctx, x + 3, baseY - expenseH, barW, expenseH, 5);
        ctx.fill();
      }

      expensePoints.push({ x: x + barW / 2, y: baseY - expenseH });
      targets.push({
        x: x - groupW / 2,
        y: padding.top,
        width: groupW,
        height: chartH,
        html: `<b>${escapeHtml(labelMonth(item.month))}</b><span>Ingresos: ${moneyWithCents.format(item.income)}</span><span>Gastos: ${moneyWithCents.format(item.expense)}</span>`
      });

      ctx.fillStyle = "rgba(243,243,248,0.5)";
      ctx.font = "10px ui-monospace, SFMono-Regular, Menlo, monospace";
      ctx.textAlign = "center";
      ctx.fillText(labelMonth(item.month).slice(0, 3), x, height - 14);
    });

    ctx.beginPath();
    expensePoints.forEach((point, index) => {
      if (index === 0) ctx.moveTo(point.x, point.y);
      else ctx.lineTo(point.x, point.y);
    });
    ctx.strokeStyle = "rgba(255,170,221,0.88)";
    ctx.lineWidth = 2;
    ctx.shadowColor = "rgba(255,26,157,0.45)";
    ctx.shadowBlur = 12;
    ctx.stroke();
    ctx.restore();
    setChartTargets(elements.cashflowChart, targets);
  }

  function roundedRect(ctx, x, y, width, height, radius) {
    const safeRadius = Math.min(radius, width / 2, Math.max(0, height) / 2);
    ctx.beginPath();
    ctx.moveTo(x + safeRadius, y);
    ctx.arcTo(x + width, y, x + width, y + height, safeRadius);
    ctx.arcTo(x + width, y + height, x, y + height, safeRadius);
    ctx.arcTo(x, y + height, x, y, safeRadius);
    ctx.arcTo(x, y, x + width, y, safeRadius);
    ctx.closePath();
  }

  function drawCategoryChart() {
    if (!elements.categoryChart) return;
    const { ctx, width, height } = resizeCanvas(elements.categoryChart);
    const expenses = getFilteredMovements().filter((movement) => movement.type === "expense");
    const totals = new Map();
    expenses.forEach((movement) => totals.set(movement.category, (totals.get(movement.category) || 0) + Number(movement.amount)));
    const entries = Array.from(totals.entries()).sort((a, b) => b[1] - a[1]);
    const total = entries.reduce((sum, item) => sum + item[1], 0);

    ctx.clearRect(0, 0, width, height);
    if (!entries.length) {
      drawNoData(ctx, width, height, "Sin gastos por categoría");
      elements.categoryLegend.innerHTML = "";
      setChartTargets(elements.categoryChart, []);
      return;
    }

    const cx = width / 2;
    const cy = height / 2;
    const radius = Math.min(width, height) * 0.35;
    let start = -Math.PI / 2;

    entries.forEach(([category, amount], index) => {
      const angle = (amount / total) * Math.PI * 2;
      ctx.beginPath();
      ctx.arc(cx, cy, radius, start, start + angle);
      ctx.lineWidth = Math.max(16, radius * 0.22);
      ctx.strokeStyle = categoryColors[index % categoryColors.length];
      ctx.shadowColor = categoryColors[index % categoryColors.length];
      ctx.shadowBlur = index < 3 ? 12 : 4;
      ctx.stroke();
      start += angle;
    });

    ctx.shadowBlur = 0;
    ctx.fillStyle = "rgba(243,243,248,0.94)";
    ctx.font = "700 22px ui-monospace, SFMono-Regular, Menlo, monospace";
    ctx.textAlign = "center";
    ctx.fillText(currency.format(total), cx, cy - 2);
    ctx.fillStyle = "rgba(243,243,248,0.52)";
    ctx.font = "11px ui-monospace, SFMono-Regular, Menlo, monospace";
    ctx.fillText("gastos", cx, cy + 18);

    elements.categoryLegend.innerHTML = entries.slice(0, 6).map(([category, amount], index) => {
      const percent = total ? (amount / total) * 100 : 0;
      return `<div class="legend-row"><i style="background:${categoryColors[index % categoryColors.length]}"></i><span>${escapeHtml(category)}</span><small>${percent.toFixed(1)}%</small></div>`;
    }).join("");
  }

  function drawMetaTrendChart() {
    if (!elements.metaTrendChart) return;
    const { ctx, width, height } = resizeCanvas(elements.metaTrendChart);
    const trend = state.meta.snapshot?.trend || [];
    const maxSpend = Math.max(...trend.map((item) => item.spend), 1);
    const maxRoas = Math.max(...trend.map((item) => item.roas), 1);
    const padding = { top: 28, right: 28, bottom: 38, left: 42 };
    const chartW = width - padding.left - padding.right;
    const chartH = height - padding.top - padding.bottom;
    const step = trend.length > 1 ? chartW / (trend.length - 1) : chartW;

    ctx.clearRect(0, 0, width, height);

    if (!trend.length || trend.every((item) => item.spend === 0 && item.roas === 0)) {
      drawNoData(ctx, width, height, "Sin datos de Meta Ads para graficar");
      setChartTargets(elements.metaTrendChart, []);
      return;
    }

    ctx.save();
    ctx.strokeStyle = "rgba(255,255,255,0.075)";
    for (let i = 0; i <= 4; i += 1) {
      const y = padding.top + (chartH / 4) * i;
      ctx.beginPath();
      ctx.moveTo(padding.left, y);
      ctx.lineTo(width - padding.right, y);
      ctx.stroke();
    }

    const targets = [];
    const use3D = is3DMode();

    trend.forEach((item, index) => {
      const barW = Math.min(26, step * 0.35);
      const x = trend.length > 1 ? padding.left + index * step - barW / 2 : padding.left + chartW / 2 - barW / 2;
      const h = (item.spend / maxSpend) * chartH;
      const y = padding.top + chartH - h;
      if (use3D) {
        draw3DBar(ctx, x, y, barW, h, 5, "rgba(82,225,255,0.72)", "rgba(82,225,255,0.07)", 9);
      } else {
        const gradient = ctx.createLinearGradient(0, y, 0, padding.top + chartH);
        gradient.addColorStop(0, "rgba(82,225,255,0.58)");
        gradient.addColorStop(1, "rgba(82,225,255,0.06)");
        ctx.fillStyle = gradient;
        roundedRect(ctx, x, y, barW, h, 5);
        ctx.fill();
      }
      targets.push({
        x: x - step * 0.2,
        y: padding.top,
        width: Math.max(barW + step * 0.4, 34),
        height: chartH,
        html: `<b>${escapeHtml(item.date)}</b><span>Inversión: ${moneyWithCents.format(item.spend)}</span><span>ROAS: ${(item.roas || 0).toFixed(2)}x</span><span>Ingresos atribuidos: ${moneyWithCents.format(item.revenue || 0)}</span>`
      });
    });

    const points = trend.map((item, index) => ({
      x: trend.length > 1 ? padding.left + index * step : padding.left + chartW / 2,
      y: padding.top + chartH - (item.roas / maxRoas) * chartH
    }));

    ctx.beginPath();
    points.forEach((point, index) => {
      if (index === 0) ctx.moveTo(point.x, point.y);
      else ctx.lineTo(point.x, point.y);
    });
    ctx.strokeStyle = "rgba(255,120,205,0.96)";
    ctx.lineWidth = 3;
    ctx.shadowColor = "rgba(255,26,157,0.58)";
    ctx.shadowBlur = 16;
    ctx.stroke();
    ctx.shadowBlur = 0;

    points.forEach((point) => {
      ctx.fillStyle = "#ff1a9d";
      ctx.beginPath();
      ctx.arc(point.x, point.y, 4, 0, Math.PI * 2);
      ctx.fill();
    });

    trend.forEach((item, index) => {
      const x = trend.length > 1 ? padding.left + index * step : padding.left + chartW / 2;
      const label = item.date === "Periodo" ? "Periodo" : item.date.slice(5).replace("-", "/");
      ctx.fillStyle = "rgba(243,243,248,0.48)";
      ctx.font = "10px ui-monospace, SFMono-Regular, Menlo, monospace";
      ctx.textAlign = "center";
      ctx.fillText(label, x, height - 14);
    });

    ctx.fillStyle = "rgba(243,243,248,0.72)";
    ctx.font = "11px ui-monospace, SFMono-Regular, Menlo, monospace";
    ctx.textAlign = "left";
    ctx.fillText("Barras: inversión · Línea: ROAS", padding.left, height - 12);
    ctx.restore();
    setChartTargets(elements.metaTrendChart, targets);
  }

  function drawCommerceTrendChart() {
    if (!elements.commerceTrendChart) return;
    const { ctx, width, height } = resizeCanvas(elements.commerceTrendChart);
    const trend = getCommerceSnapshot()?.trend || [];
    const maxRevenue = Math.max(...trend.map((item) => item.revenue), 1);
    const maxOrders = Math.max(...trend.map((item) => item.orders), 1);
    const padding = { top: 28, right: 28, bottom: 38, left: 42 };
    const chartW = width - padding.left - padding.right;
    const chartH = height - padding.top - padding.bottom;
    const step = trend.length > 1 ? chartW / (trend.length - 1) : chartW;

    ctx.clearRect(0, 0, width, height);
    if (!trend.length || trend.every((item) => item.revenue === 0 && item.orders === 0)) {
      drawNoData(ctx, width, height, "Sin datos de E-Commerce para graficar");
      setChartTargets(elements.commerceTrendChart, []);
      return;
    }

    ctx.save();
    ctx.strokeStyle = "rgba(255,255,255,0.075)";
    for (let i = 0; i <= 4; i += 1) {
      const y = padding.top + (chartH / 4) * i;
      ctx.beginPath();
      ctx.moveTo(padding.left, y);
      ctx.lineTo(width - padding.right, y);
      ctx.stroke();
    }

    const targets = [];
    const use3D = is3DMode();

    trend.forEach((item, index) => {
      const barW = Math.min(28, step * 0.36);
      const x = trend.length > 1 ? padding.left + index * step - barW / 2 : padding.left + chartW / 2 - barW / 2;
      const h = (item.revenue / maxRevenue) * chartH;
      const y = padding.top + chartH - h;
      if (use3D) {
        draw3DBar(ctx, x, y, barW, h, 5, "rgba(49,230,173,0.9)", "rgba(49,230,173,0.08)", 9);
      } else {
        const gradient = ctx.createLinearGradient(0, y, 0, padding.top + chartH);
        gradient.addColorStop(0, "rgba(49,230,173,0.82)");
        gradient.addColorStop(1, "rgba(49,230,173,0.08)");
        ctx.fillStyle = gradient;
        roundedRect(ctx, x, y, barW, h, 5);
        ctx.fill();
      }
      targets.push({
        x: x - step * 0.2,
        y: padding.top,
        width: Math.max(barW + step * 0.4, 34),
        height: chartH,
        html: `<b>${escapeHtml(item.date)}</b><span>Ventas: ${moneyWithCents.format(item.revenue)}</span><span>Pedidos: ${integerNumber.format(item.orders)}</span>`
      });
    });

    const points = trend.map((item, index) => ({
      x: trend.length > 1 ? padding.left + index * step : padding.left + chartW / 2,
      y: padding.top + chartH - (item.orders / maxOrders) * chartH
    }));

    ctx.beginPath();
    points.forEach((point, index) => {
      if (index === 0) ctx.moveTo(point.x, point.y);
      else ctx.lineTo(point.x, point.y);
    });
    ctx.strokeStyle = "rgba(82,225,255,0.94)";
    ctx.lineWidth = 3;
    ctx.shadowColor = "rgba(82,225,255,0.42)";
    ctx.shadowBlur = 14;
    ctx.stroke();
    ctx.shadowBlur = 0;

    points.forEach((point) => {
      ctx.fillStyle = "#52e1ff";
      ctx.beginPath();
      ctx.arc(point.x, point.y, 4, 0, Math.PI * 2);
      ctx.fill();
    });

    trend.forEach((item, index) => {
      const x = trend.length > 1 ? padding.left + index * step : padding.left + chartW / 2;
      const label = item.date.slice(5).replace("-", "/");
      ctx.fillStyle = "rgba(243,243,248,0.48)";
      ctx.font = "10px ui-monospace, SFMono-Regular, Menlo, monospace";
      ctx.textAlign = "center";
      ctx.fillText(label, x, height - 14);
    });

    ctx.fillStyle = "rgba(243,243,248,0.72)";
    ctx.font = "11px ui-monospace, SFMono-Regular, Menlo, monospace";
    ctx.textAlign = "left";
    ctx.fillText("Barras: ventas · Línea: pedidos", padding.left, height - 12);
    ctx.restore();
    setChartTargets(elements.commerceTrendChart, targets);
  }


  Object.assign(S, {
    applyChartMode, draw3DBar, drawCashflowChart, drawCategoryChart, drawCommerceTrendChart, drawMetaTrendChart,
    drawNoData, getMonthlySeries, hideChartTooltip, is3DMode, prefersReducedMotion, resizeCanvas,
    roundedRect, setChartTargets, showChartTooltip,
  });
})();
