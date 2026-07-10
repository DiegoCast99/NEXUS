(function () {
  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const lerp = (a, b, t) => a + (b - a) * t;

  const headerShell = document.querySelector(".nav-shell");
  const menuButton = document.querySelector(".menu-button");
  const searchForm = document.querySelector(".search-form");
  const searchInput = searchForm?.querySelector("input");
  const percent = document.getElementById("scrollPercent");
  const method = document.querySelector(".method-section");
  const methodSticky = document.querySelector(".method-sticky");
  const phaseNavItems = Array.from(document.querySelectorAll(".phase-nav span"));
  const frictionCount = document.getElementById("frictionCount");
  const loginOverlay = document.querySelector("[data-login-overlay]");
  const loginForm = document.querySelector("[data-login-form]");
  const loginError = document.querySelector("[data-login-error]");
  const loginUser = window.NexusAuth.USER;
  const loginUserKey = loginUser.toLowerCase();
  const loginPassword = "0000";
  const dashboardRevealKey = "nexus.dashboard.reveal.v1";
  const introSeenKey = "nexus_intro_seen";
  const SHOW_INTRO_ON_EVERY_REFRESH = false;
  const introCopy = {
    brand: "Nexus",
    text: "Tu centro operativo digital."
  };

  function markDashboardReveal() {
    try {
      sessionStorage.setItem(dashboardRevealKey, "soft");
    } catch (error) {
      // The dashboard still opens normally if sessionStorage is unavailable.
    }
  }

  // Guard de sesión en la landing:
  // - Con Firebase: onAuthStateChanged redirige al dashboard cuando detecta al
  //   usuario ya logueado (la restauración de sesión es asíncrona).
  // - Sin Firebase (preview local sin CDN): chequeo síncrono de localStorage.
  if (window.NexusFirebaseAuth) {
    window.NexusFirebaseAuth.onAuthStateChanged(function (user) {
      if (user) {
        document.body.classList.remove("intro-boot", "intro-lock");
        window.location.replace("./dashboard.html");
      }
    });
  } else if (window.NexusAuth.hasSession()) {
    document.body.classList.remove("intro-boot", "intro-lock");
    window.location.replace("./dashboard.html");
    return;
  }

  function runNexusIntro() {
    const intro = document.getElementById("nexusIntro");
    const counter = document.getElementById("introCounter");
    const brand = document.getElementById("introBrand");
    const text = document.getElementById("introText");
    const canvas = document.getElementById("introCanvas");
    if (!intro || !counter || !canvas) {
      document.body.classList.remove("intro-boot", "intro-lock");
      return;
    }

    let seen = false;
    try {
      seen = sessionStorage.getItem(introSeenKey) === "true";
    } catch (error) {
      seen = false;
    }

    const shouldShow = SHOW_INTRO_ON_EVERY_REFRESH || !seen;
    if (!shouldShow) {
      document.body.classList.remove("intro-boot", "intro-lock");
      return;
    }

    const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
    const timings = reducedMotion
      ? { counter: 620, globe: 220, copy: 360, outro: 260 }
      : { counter: 1650, globe: 640, copy: 760, outro: 620 };
    let completed = false;
    let raf = 0;
    let safetyTimer = 0;
    let typeTimer = 0;

    if (brand) brand.textContent = introCopy.brand;
    if (text) text.textContent = "";
    intro.setAttribute("aria-hidden", "false");
    intro.classList.add("is-running");
    document.body.classList.add("intro-lock");

    const stopCanvas = setupIntroSphere(canvas, reducedMotion);

    function finishIntro() {
      if (completed) return;
      completed = true;
      window.clearTimeout(safetyTimer);
      window.clearTimeout(typeTimer);
      window.cancelAnimationFrame(raf);
      stopCanvas?.();
      try {
        sessionStorage.setItem(introSeenKey, "true");
      } catch (error) {
        // Session storage is optional; the intro still completes.
      }
      document.body.classList.remove("intro-boot");
      intro.classList.add("is-finalizing");
      window.setTimeout(() => {
        intro.classList.remove("is-running", "is-counter-done", "is-globe-visible", "is-copy-visible", "is-finalizing");
        intro.setAttribute("aria-hidden", "true");
        document.body.classList.remove("intro-boot", "intro-lock");
      }, timings.outro);
    }

    safetyTimer = window.setTimeout(finishIntro, 5000);

    const start = performance.now();
    function animateCounter(time) {
      if (completed) return;
      const progress = clamp((time - start) / timings.counter, 0, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      counter.textContent = `${String(Math.round(eased * 100)).padStart(3, "0")}%`;
      if (progress < 1) {
        raf = requestAnimationFrame(animateCounter);
        return;
      }

      counter.textContent = "100%";
      intro.classList.add("is-counter-done");
      window.setTimeout(() => {
        if (completed) return;
        intro.classList.add("is-globe-visible");
        window.setTimeout(() => {
          if (completed) return;
          intro.classList.add("is-copy-visible");
          typeIntroText(text, introCopy.text, reducedMotion ? 8 : 24, () => {
            typeTimer = window.setTimeout(finishIntro, timings.copy);
          });
        }, timings.globe);
      }, 260);
    }

    raf = requestAnimationFrame(animateCounter);
  }

  function typeIntroText(target, value, speed, done) {
    if (!target) {
      done?.();
      return;
    }
    let index = 0;
    function tick() {
      target.textContent = value.slice(0, index);
      index += 1;
      if (index <= value.length) {
        window.setTimeout(tick, speed);
        return;
      }
      done?.();
    }
    tick();
  }

  function setupIntroSphere(canvas, reducedMotion = false) {
    const ctx = canvas.getContext("2d", { alpha: true });
    if (!ctx) return () => {};
    const points = [];
    const rings = [];
    const pointCount = window.innerWidth <= 760 ? 130 : 230;
    let width = 0;
    let height = 0;
    let dpr = 1;
    let frame = 0;
    let running = true;

    for (let i = 0; i < pointCount; i += 1) {
      const y = 1 - (i / (pointCount - 1)) * 2;
      const radius = Math.sqrt(1 - y * y);
      const theta = i * 2.3999632297;
      points.push({
        x: Math.cos(theta) * radius,
        y,
        z: Math.sin(theta) * radius,
        pulse: Math.random() * Math.PI * 2
      });
    }

    for (let i = 0; i < 10; i += 1) {
      rings.push({
        tilt: (i - 4.5) * 0.08,
        speed: 0.00018 + i * 0.000018,
        phase: i * 0.7,
        accent: i % 3 === 0
      });
    }

    function resize() {
      dpr = Math.min(window.devicePixelRatio || 1, window.innerWidth <= 760 ? 1.25 : 1.75);
      width = window.innerWidth;
      height = window.innerHeight;
      canvas.width = Math.max(1, Math.round(width * dpr));
      canvas.height = Math.max(1, Math.round(height * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    function draw(time) {
      if (!running) return;
      ctx.clearRect(0, 0, width, height);
      const cx = width / 2;
      const cy = height / 2 - Math.min(28, height * 0.04);
      const radius = Math.min(width, height) * (window.innerWidth <= 760 ? 0.25 : 0.2);
      const yaw = time * (reducedMotion ? 0.00009 : 0.00018);
      const pitch = -0.22;

      const glow = ctx.createRadialGradient(cx, cy, radius * 0.2, cx, cy, radius * 1.75);
      glow.addColorStop(0, "rgba(255,26,157,0.09)");
      glow.addColorStop(0.45, "rgba(82,225,255,0.035)");
      glow.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(cx, cy, radius * 1.8, 0, Math.PI * 2);
      ctx.fill();

      ctx.save();
      ctx.globalCompositeOperation = "screen";
      rings.forEach((ring) => {
        const phase = ring.phase + time * ring.speed;
        ctx.strokeStyle = ring.accent ? "rgba(255,26,157,0.26)" : "rgba(235,245,248,0.12)";
        ctx.lineWidth = ring.accent ? 1.2 : 0.8;
        ctx.beginPath();
        for (let i = 0; i <= 120; i += 1) {
          const t = (i / 120) * Math.PI * 2;
          const rx = Math.cos(t + phase) * radius * 1.16;
          const rz = Math.sin(t + phase) * radius * 0.38;
          const x = cx + rx;
          const y = cy + rz * Math.sin(ring.tilt) + Math.sin(t) * radius * 0.08;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
      });

      points.forEach((point) => {
        const x1 = point.x * Math.cos(yaw) - point.z * Math.sin(yaw);
        const z1 = point.x * Math.sin(yaw) + point.z * Math.cos(yaw);
        const y1 = point.y * Math.cos(pitch) - z1 * Math.sin(pitch);
        const z2 = point.y * Math.sin(pitch) + z1 * Math.cos(pitch);
        if (z2 < -0.42) return;
        const depth = (z2 + 1) / 2;
        const px = cx + x1 * radius;
        const py = cy + y1 * radius;
        const alpha = 0.16 + depth * 0.58;
        const size = 0.9 + depth * 1.8 + Math.sin(time * 0.002 + point.pulse) * 0.12;
        ctx.fillStyle = `rgba(235,245,248,${alpha})`;
        ctx.beginPath();
        ctx.arc(px, py, size, 0, Math.PI * 2);
        ctx.fill();
      });
      ctx.restore();

      const rim = ctx.createRadialGradient(cx, cy, radius * 0.8, cx, cy, radius * 1.04);
      rim.addColorStop(0, "rgba(255,255,255,0)");
      rim.addColorStop(0.82, "rgba(255,255,255,0.1)");
      rim.addColorStop(1, "rgba(255,26,157,0)");
      ctx.fillStyle = rim;
      ctx.beginPath();
      ctx.arc(cx, cy, radius * 1.05, 0, Math.PI * 2);
      ctx.fill();

      frame = requestAnimationFrame(draw);
    }

    resize();
    window.addEventListener("resize", resize);
    frame = requestAnimationFrame(draw);

    return () => {
      running = false;
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", resize);
    };
  }

  runNexusIntro();

  document.querySelectorAll(".has-menu > button, .has-menu > a").forEach((control) => {
    control.addEventListener("click", (event) => {
      const parent = event.currentTarget.closest(".has-menu");
      if (!parent) return;
      const hasFlyout = Boolean(parent.querySelector(".mega-menu, .compact-menu"));
      if (!hasFlyout) return;
      event.preventDefault();
      document.querySelectorAll(".has-menu.is-open").forEach((item) => {
        if (item !== parent) {
          item.classList.remove("is-open");
          item.querySelector("button, a")?.setAttribute("aria-expanded", "false");
        }
      });
      const isOpen = parent.classList.toggle("is-open");
      event.currentTarget.setAttribute("aria-expanded", String(isOpen));
    });
  });

  document.addEventListener("click", (event) => {
    if (!event.target.closest(".has-menu")) {
      document.querySelectorAll(".has-menu.is-open").forEach((item) => {
        item.classList.remove("is-open");
        item.querySelector("button")?.setAttribute("aria-expanded", "false");
      });
    }
  });

  menuButton?.addEventListener("click", () => {
    const isOpen = headerShell.classList.toggle("mobile-open");
    menuButton.setAttribute("aria-expanded", String(isOpen));
  });

  searchForm?.addEventListener("submit", (event) => {
    if (!searchForm.classList.contains("is-open")) {
      event.preventDefault();
      searchForm.classList.add("is-open");
      window.setTimeout(() => searchInput?.focus(), 80);
      return;
    }

    if (!searchInput.value.trim()) {
      event.preventDefault();
      searchInput?.focus();
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      searchForm?.classList.remove("is-open");
      headerShell?.classList.remove("mobile-open");
      closeLogin();
    }
  });

  function openLogin() {
    loginOverlay?.classList.add("is-open");
    loginOverlay?.setAttribute("aria-hidden", "false");
    document.body.classList.add("login-lock");
    loginError.textContent = "";
    window.setTimeout(() => loginForm?.querySelector("input")?.focus(), 80);
  }

  function closeLogin() {
    loginOverlay?.classList.remove("is-open");
    loginOverlay?.setAttribute("aria-hidden", "true");
    document.body.classList.remove("login-lock");
    loginForm?.reset();
    if (loginError) loginError.textContent = "";
  }

  function createSession() {
    window.NexusAuth.createSession();
  }

  function enterDashboard() {
    const submitButton = loginForm?.querySelector("button[type='submit']");

    if (submitButton) {
      submitButton.disabled = true;
      submitButton.textContent = "Entrando...";
    }

    markDashboardReveal();
    window.location.href = "./dashboard.html#welcome";
  }

  document.querySelectorAll("[data-login-trigger]").forEach((trigger) => {
    trigger.addEventListener("click", (event) => {
      event.preventDefault();
      openLogin();
    });
  });

  document.querySelectorAll("[data-login-close]").forEach((trigger) => {
    trigger.addEventListener("click", closeLogin);
  });

  loginForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const formData = new FormData(loginForm);
    const email = String(formData.get("user") || "").trim();
    const password = String(formData.get("password") || "");

    loginError.textContent = "";

    // Si Firebase Auth está disponible, usarlo; sino, fallback a hardcoded
    if (window.NexusFirebaseAuth) {
      const result = await window.NexusFirebaseAuth.loginWithEmail(email, password);
      if (result.success) {
        markDashboardReveal();
        enterDashboard();
        return;
      } else {
        loginError.textContent = "Error: " + (result.error || "No se pudo iniciar sesión.");
        return;
      }
    }

    // Fallback: login hardcoded (para dev local sin Firebase)
    const user = email.toLowerCase();
    if (user === loginUserKey && password === loginPassword) {
      createSession();
      enterDashboard();
      return;
    }

    loginError.textContent = "Usuario o contraseña incorrectos.";
  });

  function colorMix(from, to, t) {
    const mixed = from.map((value, index) => Math.round(lerp(value, to[index], t)));
    return `rgb(${mixed[0]}, ${mixed[1]}, ${mixed[2]})`;
  }

  function updateScrollEffects() {
    const maxScroll = document.documentElement.scrollHeight - window.innerHeight;
    const pageProgress = maxScroll > 0 ? window.scrollY / maxScroll : 0;
    percent.textContent = `${String(Math.round(pageProgress * 100)).padStart(3, "0")}%`;

    if (frictionCount) {
      frictionCount.textContent = String(Math.round(183 + pageProgress * 62));
    }

    if (!method || !methodSticky) return;

    const methodTop = method.offsetTop;
    const methodRange = method.offsetHeight - window.innerHeight;
    const p = clamp((window.scrollY - methodTop) / methodRange, 0, 1);
    const introOpacity = clamp(1 - p / 0.24, 0, 1);
    const trackProgress = clamp((p - 0.22) / 0.72, 0, 1);
    const activeIndex = clamp(Math.floor(trackProgress * 5), 0, 4);
    const darkT = clamp((p - 0.74) / 0.22, 0, 1);
    const bg = colorMix([247, 247, 246], [23, 23, 25], darkT);
    const fg = colorMix([23, 23, 25], [240, 240, 248], darkT);

    method.style.setProperty("--method-progress", p.toFixed(3));
    method.style.setProperty("--intro-opacity", introOpacity.toFixed(3));
    method.style.setProperty("--track-opacity", clamp((p - 0.16) / 0.16, 0, 1).toFixed(3));
    method.style.setProperty("--method-shift", (trackProgress * 4).toFixed(3));
    method.style.setProperty("--method-bg", bg);
    method.style.setProperty("--method-fg", fg);

    phaseNavItems.forEach((item, index) => item.classList.toggle("is-active", index === activeIndex));
  }

  window.addEventListener("scroll", updateScrollEffects, { passive: true });
  window.addEventListener("resize", updateScrollEffects);
  updateScrollEffects();

  function setupAmbient() {
    const canvas = document.getElementById("ambientCanvas");
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    let active = true;
    const stars = Array.from({ length: 140 }, () => ({
      x: Math.random(),
      y: Math.random(),
      s: Math.random() * 1.8 + 0.4,
      a: Math.random() * 0.35 + 0.1,
      d: Math.random() * 0.8 + 0.2
    }));

    function resize() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(window.innerWidth * dpr);
      canvas.height = Math.round(window.innerHeight * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    function draw(time) {
      if (!active) return;
      ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
      stars.forEach((star) => {
        const twinkle = Math.sin(time * 0.001 * star.d + star.x * 10) * 0.12;
        ctx.fillStyle = `rgba(255,255,255,${star.a + twinkle})`;
        ctx.beginPath();
        ctx.arc(star.x * window.innerWidth, star.y * window.innerHeight, star.s, 0, Math.PI * 2);
        ctx.fill();
      });
      requestAnimationFrame(draw);
    }

    resize();
    window.addEventListener("resize", resize);
    requestAnimationFrame(draw);
  }

  function setupDotPulse() {
    const sections = Array.from(document.querySelectorAll(".dark-grid"));
    if (!sections.length) return;

    const dprLimit = 1.5;
    const grid = 24;
    const dotOffset = 12;
    const fadeMs = 140;
    const influence = 92;
    const ringRadius = 36;
    const ringWidth = 24;
    let raf = 0;

    const layers = sections.map((section) => {
      const canvas = document.createElement("canvas");
      canvas.className = "dot-pulse-layer";
      canvas.setAttribute("aria-hidden", "true");
      section.prepend(canvas);
      return {
        section,
        canvas,
        ctx: canvas.getContext("2d"),
        width: 0,
        height: 0,
        active: false,
        x: 0,
        y: 0,
        lastAt: 0
      };
    });

    function resizeLayer(layer) {
      const width = layer.section.offsetWidth;
      const height = layer.section.offsetHeight;
      const dpr = Math.min(window.devicePixelRatio || 1, dprLimit);
      layer.width = width;
      layer.height = height;
      layer.canvas.width = Math.max(1, Math.round(width * dpr));
      layer.canvas.height = Math.max(1, Math.round(height * dpr));
      layer.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    function resize() {
      layers.forEach(resizeLayer);
    }

    function drawCursorField(layer, time) {
      const age = time - layer.lastAt;
      const life = clamp(1 - age / fadeMs, 0, 1);
      layer.ctx.clearRect(0, 0, layer.width, layer.height);
      if (!layer.active || life <= 0) {
        layer.active = false;
        return false;
      }

      const minX = Math.max(dotOffset, Math.floor((layer.x - influence - dotOffset) / grid) * grid + dotOffset);
      const maxX = Math.min(layer.width + dotOffset, layer.x + influence);
      const minY = Math.max(dotOffset, Math.floor((layer.y - influence - dotOffset) / grid) * grid + dotOffset);
      const maxY = Math.min(layer.height + dotOffset, layer.y + influence);

      for (let x = minX; x <= maxX; x += grid) {
        for (let y = minY; y <= maxY; y += grid) {
          const dx = x - layer.x;
          const dy = y - layer.y;
          const distance = Math.hypot(dx, dy);
          if (distance > influence) continue;

          const ring = Math.exp(-Math.pow((distance - ringRadius) / ringWidth, 2)) * 0.38;
          const center = Math.exp(-Math.pow(distance / 72, 2)) * 0.18;
          const strength = (ring + center) * life;
          if (strength < 0.018) continue;

          const unitX = distance ? dx / distance : 0;
          const unitY = distance ? dy / distance : 0;
          const shimmer = Math.sin(distance * 0.08 + time * 0.018) * 0.5 + 0.5;
          const shift = strength * (4.5 + shimmer * 2.2);
          const dotSize = 0.78 + strength * 1.22;
          const alpha = clamp(strength * 0.46, 0, 0.34);

          layer.ctx.fillStyle = `rgba(240, 240, 248, ${alpha})`;
          layer.ctx.beginPath();
          layer.ctx.arc(x + unitX * shift, y + unitY * shift, dotSize, 0, Math.PI * 2);
          layer.ctx.fill();
        }
      }

      return true;
    }

    function draw(time) {
      let hasActivePulses = false;

      layers.forEach((layer) => {
        layer.ctx.save();
        layer.ctx.globalCompositeOperation = "lighter";
        if (drawCursorField(layer, time)) hasActivePulses = true;
        layer.ctx.restore();
      });

      raf = hasActivePulses ? requestAnimationFrame(draw) : 0;
    }

    function movePulse(event) {
      const now = performance.now();
      layers.forEach((layer) => {
        const rect = layer.section.getBoundingClientRect();
        if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) {
          return;
        }

        layer.x = event.clientX - rect.left;
        layer.y = event.clientY - rect.top;
        layer.active = true;
        layer.lastAt = now;
        if (!raf) raf = requestAnimationFrame(draw);
      });
    }

    resize();
    window.addEventListener("resize", resize);
    document.addEventListener("pointermove", movePulse, { passive: true });
    document.addEventListener("mousemove", movePulse, { passive: true });
    window.addEventListener("pointermove", movePulse, { passive: true });
    window.addEventListener("mousemove", movePulse, { passive: true });
  }

  if (window.NexusGlobe) window.NexusGlobe.setup();
  setupAmbient();
  setupDotPulse();
})();
