/* ============================================================
   NEXUS Dashboard · Gráficos Canvas 2D (compartidos)
   Parte de window.NexusDash — namespace compartido (sin build).
   ============================================================ */
(function () {
  const S = window.NexusDash;
  const { categoryColors, chartTargets, currency, currentMonth, elements, escapeHtml, financeMoney } = S;
  const { getCommerceSnapshot, getFilteredMovements, integerNumber, labelMonth, moneyWithCents, movementMonth } = S;
  const { shiftMonth, state, summarize } = S;
  function getMonthlySeries() {
    // El grafico de tendencia muestra 6 meses terminando en el "Hasta" del rango.
    const endingMonth = (state.filters.monthTo && state.filters.monthTo !== "all") ? state.filters.monthTo : currentMonth();
    const months = Array.from({ length: 6 }, (_, index) => shiftMonth(endingMonth, index - 5));
    const baseData = getFilteredMovements({ includeMonth: false });
    return months.map((month) => {
      const movements = baseData.filter((movement) => movementMonth(movement) === month);
      const totals = summarize(movements);
      return { month, income: totals.income, expense: totals.expense };
    });
  }

  // Devuelve null si el canvas no esta visible. Dibujar con ancho 0 dejaba un
  // canvas de 1px que despues se estiraba al mostrar la seccion: de ahi salia
  // la franja de color en vez del grafico.
  function resizeCanvas(canvas) {
    const rect = canvas.getBoundingClientRect();
    if (!rect.width) return null;
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
    ctx.fillStyle = "rgba(244,244,246,0.12)";
    ctx.strokeStyle = "rgba(255,255,255,0.08)";
    ctx.lineWidth = 1;
    for (let i = 0; i < 4; i += 1) {
      const y = 44 + i * ((height - 82) / 3);
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }
    ctx.fillStyle = "rgba(244,244,246,0.5)";
    ctx.font = "12px ui-monospace, SFMono-Regular, Menlo, monospace";
    ctx.textAlign = "center";
    ctx.fillText(label, width / 2, height / 2);
    ctx.restore();
  }

  function prefersReducedMotion() {
    return Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches);
  }

  // ============================================================
  // Animación de entrada de las gráficas: se anima UNA vez cuando
  // se entra a una vista/sección (o al recargar), después standby.
  // `bumpChartGen()` sube la generación al entrar; cada gráfica
  // llama shouldAnimate(key) SOLO cuando tiene datos reales para
  // mostrar (así el redibujo async con datos anima, no el vacío).
  // ============================================================
  var _chartGen = 0;
  var _chartAnimatedGen = {};   // key -> último "sello" animado (gen + firma de datos)
  var _chartRaf = {};           // key -> requestAnimationFrame id
  function bumpChartGen() { _chartGen += 1; }
  // Anima cuando (a) se entra/recarga la vista (sube la generación) O (b) cambian
  // los datos de esa gráfica (cambia la `signature`). Así re-anima al cambiar el
  // período (7/15/30/personalizado) o al actualizarse cualquier información,
  // pero NO en redibujos idénticos (resize, misma data) → queda en standby.
  function shouldAnimate(key, signature) {
    if (prefersReducedMotion()) return false;
    // Con la pestaña oculta el rAF/CSS no corre: pintar el estado final directo
    // (si no, la gráfica quedaría en blanco hasta que se vea). No se marca el sello,
    // así anima recién cuando se dibuja con la pestaña visible.
    if (typeof document !== "undefined" && document.visibilityState === "hidden") return false;
    var stamp = _chartGen + "|" + (signature == null ? "" : String(signature));
    if (_chartAnimatedGen[key] === stamp) return false;
    _chartAnimatedGen[key] = stamp;
    return true;
  }
  function easeOutCubic(t) { return 1 - Math.pow(1 - t, 3); }
  // Corre paint(progress) de 0→1 con rAF. Cancela una animación previa de la
  // misma gráfica para no encimar dos loops.
  function runCanvasAnim(key, paint, duration) {
    if (_chartRaf[key]) { cancelAnimationFrame(_chartRaf[key]); _chartRaf[key] = null; }
    var start = null, dur = duration || 720;
    function frame(ts) {
      if (start === null) start = ts;
      var t = Math.min(1, (ts - start) / dur);
      paint(easeOutCubic(t));
      if (t < 1) _chartRaf[key] = requestAnimationFrame(frame);
      else _chartRaf[key] = null;
    }
    _chartRaf[key] = requestAnimationFrame(frame);
  }
  // Azúcar: dibuja con animación si corresponde (primera vez en esta gen y con
  // datos), o pinta el estado final directo.
  function paintChart(key, paint, duration, signature) {
    if (shouldAnimate(key, signature)) runCanvasAnim(key, paint, duration);
    else { if (_chartRaf[key]) { cancelAnimationFrame(_chartRaf[key]); _chartRaf[key] = null; } paint(1); }
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

  // Muestra el tooltip compartido (#chartTooltip) con `html` cerca del cursor.
  // Reutilizable por cualquier gráfica (canvas por hit-test, o SVG por índice).
  function showTooltipAt(clientX, clientY, html) {
    const tooltip = elements.chartTooltip;
    if (!tooltip) return;
    tooltip.innerHTML = html;
    tooltip.style.left = `${Math.min(window.innerWidth - 280, clientX + 16)}px`;
    tooltip.style.top = `${Math.min(window.innerHeight - 130, clientY + 16)}px`;
    tooltip.classList.add("is-visible");
  }

  function showChartTooltip(canvas, event) {
    const targets = chartTargets.get(canvas) || [];
    if (!elements.chartTooltip || !targets.length) return;
    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    // Tolerancia para el dedo: una barra fina es imposible de acertar al toque,
    // asi que se agranda el area de acierto unos pixeles alrededor.
    const TOL = 8;
    const hit = targets.find((target) => (
      x >= target.x - TOL && x <= target.x + target.width + TOL && y >= target.y - TOL && y <= target.y + target.height + TOL
    ));
    if (!hit) { hideChartTooltip(); return; }
    showTooltipAt(event.clientX, event.clientY, hit.html);
  }

  function hideChartTooltip() {
    elements.chartTooltip?.classList.remove("is-visible");
  }

  function drawCashflowChart() {
    if (!elements.cashflowChart) return;
    const size = resizeCanvas(elements.cashflowChart);
    if (!size) return;            // seccion oculta: se redibuja al mostrarla
    const { ctx, width, height } = size;
    const series = getMonthlySeries();
    const maxValue = Math.max(...series.flatMap((item) => [item.income, item.expense]), 1) * 1.18;
    const padding = { top: 18, right: 18, bottom: 34, left: 38 };
    const chartW = width - padding.left - padding.right;
    const chartH = height - padding.top - padding.bottom;

    if (series.every((item) => item.income === 0 && item.expense === 0)) {
      ctx.clearRect(0, 0, width, height);
      drawNoData(ctx, width, height, "Sin datos para la evolución mensual");
      setChartTargets(elements.cashflowChart, []);
      return;
    }

    const groupW = chartW / series.length;
    const barW = Math.min(18, groupW * 0.2);
    const baseY = padding.top + chartH;
    const use3D = is3DMode();

    setChartTargets(elements.cashflowChart, series.map((item, index) => {
      const x = padding.left + index * groupW + groupW / 2;
      return {
        x: x - groupW / 2, y: padding.top, width: groupW, height: chartH,
        html: `<b>${escapeHtml(labelMonth(item.month))}</b><span>Ingresos: ${financeMoney(item.income, true)}</span><span>Gastos: ${financeMoney(item.expense, true)}</span>`
      };
    }));

    // Barras suben desde la base y la línea de gastos sube junto con ellas.
    function paint(p) {
      ctx.clearRect(0, 0, width, height);
      ctx.save();
      ctx.strokeStyle = "rgba(255,255,255,0.06)";
      ctx.lineWidth = 1;
      for (let i = 0; i <= 4; i += 1) {
        const y = padding.top + (chartH / 4) * i;
        ctx.beginPath(); ctx.moveTo(padding.left, y); ctx.lineTo(width - padding.right, y); ctx.stroke();
      }
      const expensePoints = [];
      series.forEach((item, index) => {
        const x = padding.left + index * groupW + groupW / 2;
        const incomeH = (item.income / maxValue) * chartH * p;
        const expenseH = (item.expense / maxValue) * chartH * p;
        if (use3D) {
          draw3DBar(ctx, x - barW - 3, baseY - incomeH, barW, incomeH, 5, "rgba(52,211,153,0.95)", "rgba(52,211,153,0.12)", 8);
          draw3DBar(ctx, x + 3, baseY - expenseH, barW, expenseH, 5, "rgba(255,106,61,0.95)", "rgba(255,106,61,0.12)", 8);
        } else {
          const ig = ctx.createLinearGradient(0, baseY - incomeH, 0, baseY);
          ig.addColorStop(0, "rgba(52,211,153,0.95)"); ig.addColorStop(1, "rgba(52,211,153,0.10)");
          ctx.fillStyle = ig; barTop(ctx, x - barW - 3, baseY - incomeH, barW, incomeH, 4); ctx.fill();
          const eg = ctx.createLinearGradient(0, baseY - expenseH, 0, baseY);
          eg.addColorStop(0, "rgba(255,106,61,0.92)"); eg.addColorStop(1, "rgba(255,106,61,0.08)");
          ctx.fillStyle = eg; barTop(ctx, x + 3, baseY - expenseH, barW, expenseH, 4); ctx.fill();
        }
        expensePoints.push({ x: x + barW / 2, y: baseY - expenseH });
        ctx.fillStyle = "rgba(244,244,246,0.48)";
        ctx.font = "10px ui-monospace, SFMono-Regular, Menlo, monospace";
        ctx.textAlign = "center";
        ctx.fillText(labelMonth(item.month).slice(0, 3), x, height - 14);
      });
      ctx.beginPath();
      expensePoints.forEach((point, index) => { if (index === 0) ctx.moveTo(point.x, point.y); else ctx.lineTo(point.x, point.y); });
      ctx.strokeStyle = "rgba(255,138,90,0.94)";
      ctx.lineWidth = 2.8; ctx.lineJoin = "round"; ctx.lineCap = "round";
      ctx.shadowColor = "rgba(255,106,61,0.55)"; ctx.shadowBlur = p >= 1 ? 16 : 0; ctx.stroke(); ctx.shadowBlur = 0;
      ctx.restore();
    }
    paintChart("cashflow", paint, 1800, series.map(function (s) { return s.income + "/" + s.expense; }).join(","));
  }

  function roundedRect(ctx, x, y, width, height, radius) {
    // safeRadius nunca puede ser negativo: si el canvas aún no tiene tamaño real
    // (p.ej. panel oculto en el init), width/height pueden ser <= 0 y arcTo
    // rechaza radios negativos con IndexSizeError.
    const safeRadius = Math.max(0, Math.min(radius, width / 2, height / 2));
    ctx.beginPath();
    ctx.moveTo(x + safeRadius, y);
    ctx.arcTo(x + width, y, x + width, y + height, safeRadius);
    ctx.arcTo(x + width, y + height, x, y + height, safeRadius);
    ctx.arcTo(x, y + height, x, y, safeRadius);
    ctx.arcTo(x, y, x + width, y, safeRadius);
    ctx.closePath();
  }

  // Barra con esquinas SUPERIORES redondeadas y base recta (estilo dashboards de
  // ads): la barra "crece" desde la base. Usada por la gráfica de Métricas.
  function barTop(ctx, x, y, width, height, radius) {
    const r = Math.max(0, Math.min(radius, width / 2, height));
    ctx.beginPath();
    ctx.moveTo(x, y + height);
    ctx.lineTo(x, y + r);
    ctx.arcTo(x, y, x + r, y, r);
    ctx.lineTo(x + width - r, y);
    ctx.arcTo(x + width, y, x + width, y + r, r);
    ctx.lineTo(x + width, y + height);
    ctx.closePath();
  }

  function drawCategoryChart() {
    if (!elements.categoryChart) return;
    const size = resizeCanvas(elements.categoryChart);
    if (!size) return;            // seccion oculta: se redibuja al mostrarla
    const { ctx, width, height } = size;
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

    elements.categoryLegend.innerHTML = entries.slice(0, 6).map(([category, amount], index) => {
      const percent = total ? (amount / total) * 100 : 0;
      return `<div class="legend-row"><i style="background:${categoryColors[index % categoryColors.length]}"></i><span>${escapeHtml(category)}</span><small>${percent.toFixed(1)}%</small></div>`;
    }).join("");

    // La dona se "barre" (dibuja su arco) y el total del centro aparece con fade.
    function paint(p) {
      ctx.clearRect(0, 0, width, height);
      const sweep = Math.PI * 2 * p;
      let start = -Math.PI / 2, drawn = 0;
      for (let index = 0; index < entries.length; index += 1) {
        const angle = (entries[index][1] / total) * Math.PI * 2;
        const rem = sweep - drawn;
        if (rem <= 0.0001) break;
        ctx.beginPath();
        ctx.arc(cx, cy, radius, start, start + Math.min(angle, rem));
        ctx.lineWidth = Math.max(16, radius * 0.22);
        ctx.strokeStyle = categoryColors[index % categoryColors.length];
        ctx.shadowColor = categoryColors[index % categoryColors.length];
        ctx.shadowBlur = p >= 1 ? (index < 3 ? 12 : 4) : 0;
        ctx.stroke();
        start += angle; drawn += angle;
      }
      ctx.shadowBlur = 0;
      ctx.globalAlpha = Math.max(0, Math.min(1, (p - 0.45) / 0.55));
      ctx.fillStyle = "rgba(244,244,246,0.94)";
      ctx.font = "700 22px ui-monospace, SFMono-Regular, Menlo, monospace";
      ctx.textAlign = "center";
      ctx.fillText(financeMoney(total), cx, cy - 2);
      ctx.fillStyle = "rgba(244,244,246,0.52)";
      ctx.font = "11px ui-monospace, SFMono-Regular, Menlo, monospace";
      ctx.fillText("gastos", cx, cy + 18);
      ctx.globalAlpha = 1;
    }
    paintChart("category", paint, 1700, entries.map(function (e) { return e[0] + ":" + e[1]; }).join(","));
  }

  // Dona de costos de e-commerce, con el MISMO estilo que la de gastos de
  // Finanzas: cargos por venta + costos de envio (lo que da la API de pedidos).
  function drawCommerceCostsChart() {
    if (!elements.commerceCostsChart) return;
    const size = resizeCanvas(elements.commerceCostsChart);
    if (!size) return;            // seccion oculta: se redibuja al mostrarla
    const { ctx, width, height } = size;
    const totals = getCommerceSnapshot()?.totals || {};
    const entries = [
      ["Cargos por venta", Number(totals.commission) || 0],
      ["Costos de envio", Number(totals.shipping) || 0]
    ].filter((item) => item[1] > 0);
    const total = entries.reduce((sum, item) => sum + item[1], 0);

    ctx.clearRect(0, 0, width, height);
    if (!entries.length) {
      drawNoData(ctx, width, height, "Sin costos en el periodo");
      if (elements.commerceCostsLegend) elements.commerceCostsLegend.innerHTML = "";
      setChartTargets(elements.commerceCostsChart, []);
      return;
    }

    const cx = width / 2;
    const cy = height / 2;
    const radius = Math.min(width, height) * 0.35;

    if (elements.commerceCostsLegend) {
      elements.commerceCostsLegend.innerHTML = entries.map(([name, amount], index) => {
        const percent = total ? (amount / total) * 100 : 0;
        return `<div class="legend-row"><i style="background:${categoryColors[index % categoryColors.length]}"></i><span>${escapeHtml(name)}</span><small>${percent.toFixed(1)}%</small></div>`;
      }).join("");
    }

    function paint(p) {
      ctx.clearRect(0, 0, width, height);
      const sweep = Math.PI * 2 * p;
      let start = -Math.PI / 2, drawn = 0;
      for (let index = 0; index < entries.length; index += 1) {
        const angle = (entries[index][1] / total) * Math.PI * 2;
        const rem = sweep - drawn;
        if (rem <= 0.0001) break;
        ctx.beginPath();
        ctx.arc(cx, cy, radius, start, start + Math.min(angle, rem));
        ctx.lineWidth = Math.max(16, radius * 0.22);
        ctx.strokeStyle = categoryColors[index % categoryColors.length];
        ctx.shadowColor = categoryColors[index % categoryColors.length];
        ctx.shadowBlur = p >= 1 ? (index < 3 ? 12 : 4) : 0;
        ctx.stroke();
        start += angle; drawn += angle;
      }
      ctx.shadowBlur = 0;
      ctx.globalAlpha = Math.max(0, Math.min(1, (p - 0.45) / 0.55));
      ctx.fillStyle = "rgba(244,244,246,0.94)";
      ctx.font = "700 22px ui-monospace, SFMono-Regular, Menlo, monospace";
      ctx.textAlign = "center";
      ctx.fillText(currency.format(total), cx, cy - 2);
      ctx.fillStyle = "rgba(244,244,246,0.52)";
      ctx.font = "11px ui-monospace, SFMono-Regular, Menlo, monospace";
      ctx.fillText("costos", cx, cy + 18);
      ctx.globalAlpha = 1;
    }
    paintChart("commercecosts", paint, 1700, entries.map(function (e) { return e[0] + ":" + e[1]; }).join(","));
    setChartTargets(elements.commerceCostsChart, []);
  }

  function drawMetaTrendChart() {
    if (!elements.metaTrendChart) return;
    const size = resizeCanvas(elements.metaTrendChart);
    if (!size) return;            // seccion oculta: se redibuja al mostrarla
    const { ctx, width, height } = size;
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

    const use3D = is3DMode();
    const baseY = padding.top + chartH;
    const barW = Math.min(26, step * 0.35);

    setChartTargets(elements.metaTrendChart, trend.map((item, index) => {
      const x = trend.length > 1 ? padding.left + index * step - barW / 2 : padding.left + chartW / 2 - barW / 2;
      return {
        x: x - step * 0.2, y: padding.top, width: Math.max(barW + step * 0.4, 34), height: chartH,
        html: `<b>${escapeHtml(item.date)}</b><span>Inversión: ${moneyWithCents.format(item.spend)}</span><span>ROAS: ${(item.roas || 0).toFixed(2)}x</span><span>Ingresos atribuidos: ${moneyWithCents.format(item.revenue || 0)}</span>`
      };
    }));

    // Barras (inversión) suben y la línea de ROAS se traza subiendo desde la base.
    function paint(p) {
      ctx.clearRect(0, 0, width, height);
      ctx.save();
      ctx.strokeStyle = "rgba(255,255,255,0.06)";
      for (let i = 0; i <= 4; i += 1) {
        const y = padding.top + (chartH / 4) * i;
        ctx.beginPath(); ctx.moveTo(padding.left, y); ctx.lineTo(width - padding.right, y); ctx.stroke();
      }
      trend.forEach((item, index) => {
        const x = trend.length > 1 ? padding.left + index * step - barW / 2 : padding.left + chartW / 2 - barW / 2;
        const h = (item.spend / maxSpend) * chartH * p;
        const y = baseY - h;
        if (use3D) {
          draw3DBar(ctx, x, y, barW, h, 5, "rgba(245,166,35,0.72)", "rgba(245,166,35,0.07)", 9);
        } else {
          const g = ctx.createLinearGradient(0, y, 0, baseY);
          g.addColorStop(0, "rgba(245,166,35,0.62)"); g.addColorStop(1, "rgba(245,166,35,0.05)");
          ctx.fillStyle = g; barTop(ctx, x, y, barW, h, 4); ctx.fill();
        }
      });
      const points = trend.map((item, index) => ({
        x: trend.length > 1 ? padding.left + index * step : padding.left + chartW / 2,
        fy: baseY - (item.roas / maxRoas) * chartH
      }));
      const yAt = (pt) => baseY - (baseY - pt.fy) * p;
      // Área degradada bajo la línea de ROAS (protagonista), como en Métricas/Ads.
      if (points.length > 1) {
        const area = ctx.createLinearGradient(0, padding.top, 0, baseY);
        area.addColorStop(0, "rgba(255,106,61,0.26)"); area.addColorStop(0.6, "rgba(255,106,61,0.08)"); area.addColorStop(1, "rgba(255,106,61,0)");
        ctx.beginPath(); ctx.moveTo(points[0].x, baseY);
        points.forEach((pt) => ctx.lineTo(pt.x, yAt(pt)));
        ctx.lineTo(points[points.length - 1].x, baseY); ctx.closePath();
        ctx.fillStyle = area; ctx.fill();
      }
      ctx.beginPath();
      points.forEach((pt, index) => { const y = yAt(pt); if (index === 0) ctx.moveTo(pt.x, y); else ctx.lineTo(pt.x, y); });
      ctx.strokeStyle = "#ff6a3d"; ctx.lineWidth = 2.8; ctx.lineJoin = "round"; ctx.lineCap = "round";
      ctx.shadowColor = "rgba(255,106,61,0.58)"; ctx.shadowBlur = p >= 1 ? 16 : 0; ctx.stroke(); ctx.shadowBlur = 0;
      if (p >= 0.98) {
        points.forEach((pt) => {
          const y = yAt(pt);
          ctx.beginPath(); ctx.arc(pt.x, y, 3.2, 0, Math.PI * 2); ctx.fillStyle = "#0d0d0f"; ctx.fill();
          ctx.beginPath(); ctx.arc(pt.x, y, 2.3, 0, Math.PI * 2); ctx.fillStyle = "#ff6a3d"; ctx.fill();
        });
      }
      trend.forEach((item, index) => {
        const x = trend.length > 1 ? padding.left + index * step : padding.left + chartW / 2;
        const label = item.date === "Periodo" ? "Periodo" : item.date.slice(5).replace("-", "/");
        ctx.fillStyle = "rgba(244,244,246,0.48)"; ctx.font = "10px ui-monospace, SFMono-Regular, Menlo, monospace"; ctx.textAlign = "center";
        ctx.fillText(label, x, height - 14);
      });
      ctx.fillStyle = "rgba(244,244,246,0.72)"; ctx.font = "11px ui-monospace, SFMono-Regular, Menlo, monospace"; ctx.textAlign = "left";
      ctx.fillText("Barras: inversión · Línea: ROAS", padding.left, height - 12);
      ctx.restore();
    }
    paintChart("metatrend", paint, 1800, trend.map(function (t) { return (t.spend || 0) + "/" + (t.roas || 0); }).join(","));
  }

  // Animación de la gráfica de e-commerce: barras que suben desde abajo y línea que
  // se traza junto con ellas. Solo se activa cuando se pide con animarProximoTrend()
  // (al entrar a Métricas o al cambiar el periodo), no en cada repintado.
  var trendRaf = null;
  var animarTrendProxima = false;
  function animarProximoTrend() { animarTrendProxima = true; }

  function drawCommerceTrendChart() {
    if (!elements.commerceTrendChart) return;
    const size = resizeCanvas(elements.commerceTrendChart);
    if (!size) return;            // seccion oculta: se redibuja al mostrarla
    const { ctx, width, height } = size;
    const trend = getCommerceSnapshot()?.trend || [];
    const maxRevenue = Math.max(...trend.map((item) => item.revenue), 1);
    const maxOrders = Math.max(...trend.map((item) => item.orders), 1);
    const padding = { top: 28, right: 28, bottom: 38, left: 42 };
    const chartW = width - padding.left - padding.right;
    const chartH = height - padding.top - padding.bottom;
    const step = trend.length > 1 ? chartW / (trend.length - 1) : chartW;
    const baseline = padding.top + chartH;
    const use3D = is3DMode();

    if (trendRaf) { cancelAnimationFrame(trendRaf); trendRaf = null; }

    if (!trend.length || trend.every((item) => item.revenue === 0 && item.orders === 0)) {
      ctx.clearRect(0, 0, width, height);
      drawNoData(ctx, width, height, "Sin datos de E-Commerce para graficar");
      setChartTargets(elements.commerceTrendChart, []);
      animarTrendProxima = false;
      return;
    }

    // Posiciones finales + zonas de hover (se calculan una sola vez).
    const barX = [], barW = [], barFullH = [], lineX = [], lineFullY = [], targets = [];
    trend.forEach((item, index) => {
      const bw = Math.min(28, step * 0.36);
      const x = trend.length > 1 ? padding.left + index * step - bw / 2 : padding.left + chartW / 2 - bw / 2;
      barX.push(x); barW.push(bw); barFullH.push((item.revenue / maxRevenue) * chartH);
      const lx = trend.length > 1 ? padding.left + index * step : padding.left + chartW / 2;
      lineX.push(lx); lineFullY.push(baseline - (item.orders / maxOrders) * chartH);
      targets.push({
        x: x - step * 0.2, y: padding.top,
        width: Math.max(bw + step * 0.4, 34), height: chartH,
        html: `<b>${escapeHtml(item.date)}</b><span>Ventas: ${moneyWithCents.format(item.revenue)}</span><span>Pedidos: ${integerNumber.format(item.orders)}</span>`
      });
    });
    setChartTargets(elements.commerceTrendChart, targets);

    const labelStep = Math.max(1, Math.ceil(trend.length / 10));

    // Estilo dashboard de ads (igual que Publicidad): barras índigo frías con top
    // redondeado + glow (ingresos), y línea ROSA NEÓN protagonista con área
    // degradada + glow + puntos (pedidos). Retina lo maneja resizeCanvas.
    const LINE = "#ff3d9a", LINE_GLOW = "rgba(255,61,154,0.60)";
    function pintar(progress) {
      ctx.clearRect(0, 0, width, height);
      ctx.save();
      // Rejilla horizontal muy sutil.
      ctx.strokeStyle = "rgba(255,255,255,0.06)"; ctx.lineWidth = 1;
      for (let i = 0; i <= 4; i += 1) {
        const y = padding.top + (chartH / 4) * i;
        ctx.beginPath(); ctx.moveTo(padding.left, y); ctx.lineTo(width - padding.right, y); ctx.stroke();
      }
      // Barras (ingresos): índigo con top redondeado + glow suave, crecen desde la base.
      trend.forEach((item, index) => {
        const h = barFullH[index] * progress;
        if (h <= 0.5) return;
        const x = barX[index], bw = barW[index], y = baseline - h;
        const gA = ctx.createLinearGradient(0, y, 0, baseline);
        gA.addColorStop(0, "rgba(124,148,255,0.90)");
        gA.addColorStop(1, "rgba(110,130,255,0.06)");
        ctx.save();
        ctx.shadowColor = "rgba(120,140,255,0.40)"; ctx.shadowBlur = progress >= 1 ? 8 : 0;
        ctx.fillStyle = gA;
        barTop(ctx, x, y, bw, h, Math.min(4, bw / 2));
        ctx.fill();
        ctx.restore();
      });
      // Línea (pedidos): ÁREA rosa neón + línea gruesa con glow + puntos (protagonista).
      const points = trend.map((item, index) => ({ x: lineX[index], y: baseline - (baseline - lineFullY[index]) * progress }));
      if (points.length > 1) {
        const area = ctx.createLinearGradient(0, padding.top, 0, baseline);
        area.addColorStop(0, "rgba(255,61,154,0.34)");
        area.addColorStop(0.55, "rgba(255,61,154,0.12)");
        area.addColorStop(1, "rgba(255,61,154,0)");
        ctx.beginPath(); ctx.moveTo(points[0].x, baseline);
        points.forEach((pt) => ctx.lineTo(pt.x, pt.y));
        ctx.lineTo(points[points.length - 1].x, baseline); ctx.closePath();
        ctx.fillStyle = area; ctx.fill();
      }
      ctx.beginPath();
      points.forEach((point, index) => { if (index === 0) ctx.moveTo(point.x, point.y); else ctx.lineTo(point.x, point.y); });
      ctx.strokeStyle = LINE; ctx.lineWidth = 2.8; ctx.lineJoin = "round"; ctx.lineCap = "round";
      ctx.shadowColor = LINE_GLOW; ctx.shadowBlur = progress >= 1 ? 16 : 6;
      ctx.stroke(); ctx.shadowBlur = 0;
      if (progress >= 0.98) {
        points.forEach((point, i) => {
          const ultimo = i === points.length - 1;
          if (ultimo) { ctx.save(); ctx.shadowColor = LINE_GLOW; ctx.shadowBlur = 14; }
          ctx.beginPath(); ctx.arc(point.x, point.y, ultimo ? 4.6 : 3.2, 0, Math.PI * 2); ctx.fillStyle = "#0d0d0f"; ctx.fill();
          ctx.beginPath(); ctx.arc(point.x, point.y, ultimo ? 3.4 : 2.3, 0, Math.PI * 2); ctx.fillStyle = LINE; ctx.fill();
          if (ultimo) ctx.restore();
        });
      }
      // Etiquetas de fecha (~10 repartidas + la última).
      ctx.fillStyle = "rgba(244,244,246,0.48)";
      ctx.font = "10px ui-monospace, SFMono-Regular, Menlo, monospace";
      ctx.textAlign = "center";
      trend.forEach((item, index) => {
        if (index % labelStep !== 0 && index !== trend.length - 1) return;
        ctx.fillText(item.date.slice(5).replace("-", "/"), lineX[index], height - 12);
      });
      ctx.restore();
    }

    // Anima al entrar a la sección (flag) o cuando cambian los datos/período
    // (firma). shouldAnimate() se llama SIEMPRE para sellar la generación+firma
    // (si no, un redibujo posterior con la misma data volvería a animar).
    const sig = trend.map(function (t) { return (t.revenue || 0) + "/" + (t.orders || 0); }).join(",");
    const dataChanged = (typeof shouldAnimate === "function") ? shouldAnimate("commercetrend", sig) : false;
    const hidden = typeof document !== "undefined" && document.visibilityState === "hidden";
    // Respeta "reducir movimiento" y pestaña oculta (rAF pausado → quedaría en blanco).
    const animar = !hidden && (animarTrendProxima || dataChanged) && !(typeof prefersReducedMotion === "function" && prefersReducedMotion());
    animarTrendProxima = false;
    if (animar && typeof requestAnimationFrame === "function") {
      let t0 = null; const dur = 1800;
      const frame = (ts) => {
        if (t0 == null) t0 = ts;
        const p = Math.min(1, (ts - t0) / dur);
        pintar(1 - Math.pow(1 - p, 3)); // easeOutCubic
        if (p < 1) trendRaf = requestAnimationFrame(frame); else trendRaf = null;
      };
      trendRaf = requestAnimationFrame(frame);
    } else {
      pintar(1);
    }
  }


  // Entrar a una subsección (Métricas/Publicidad/…) también dispara la animación
  // de las gráficas que quedan visibles en esa sección.
  try {
    window.addEventListener("nexus:section", function () { bumpChartGen(); });
  } catch (e) { /* sin CustomEvent */ }

  Object.assign(S, {
    animarProximoTrend,
    bumpChartGen, paintChart, runCanvasAnim, shouldAnimateChart: shouldAnimate, chartAnimGen: function () { return _chartGen; },
    applyChartMode, draw3DBar, drawCashflowChart, drawCategoryChart, drawCommerceCostsChart, drawCommerceTrendChart, drawMetaTrendChart,
    drawNoData, getMonthlySeries, hideChartTooltip, is3DMode, prefersReducedMotion, resizeCanvas,
    roundedRect, setChartTargets, showChartTooltip, showTooltipAt,
  });
})();
