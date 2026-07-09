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

  function setupGlobe() {
    const canvas = document.getElementById("globeCanvas");
    if (!canvas) return;
    let ctx = canvas.getContext("2d");
    const rad = Math.PI / 180;
    const centerLon = -28;
    const countries = prepareCountries(window.INFINITY_COUNTRIES);
    const portalCountries = prepareCountries(window.INFINITY_COUNTRIES, true);
    const routeSpecs = [
      [[-74.006, 40.7128], [-0.1276, 51.5072]],
      [[-99.1332, 19.4326], [-46.6333, -23.5505]],
      [[-58.3816, -34.6037], [2.3522, 48.8566]],
      [[-3.7038, 40.4168], [55.2708, 25.2048]],
      [[-0.1276, 51.5072], [77.209, 28.6139]],
      [[-73.5673, 45.5017], [13.405, 52.52]],
      [[-87.6298, 41.8781], [4.9041, 52.3676]],
      [[-77.0369, 38.9072], [12.4964, 41.9028]],
      [[-70.6693, -33.4489], [-3.7038, 40.4168]],
      [[3.3792, 6.5244], [31.2357, 30.0444]],
      [[-1.2921, 36.8219], [39.2083, -6.7924]],
      [[32.5599, 15.5007], [44.3661, 33.3152]],
      [[37.6173, 55.7558], [103.8198, 1.3521]],
      [[28.0473, -26.2041], [103.8198, 1.3521]],
      [[31.2357, 30.0444], [77.209, 28.6139]],
      [[72.8777, 19.076], [139.6917, 35.6895]],
      [[77.209, 28.6139], [116.4074, 39.9042]],
      [[100.5018, 13.7563], [126.978, 37.5665]],
      [[103.8198, 1.3521], [151.2093, -33.8688]],
      [[106.8456, -6.2088], [144.9631, -37.8136]],
      [[121.5654, 25.033], [139.6917, 35.6895]],
      [[116.4074, 39.9042], [37.6173, 55.7558]],
      [[-118.2437, 34.0522], [139.6917, 35.6895]],
      [[-122.4194, 37.7749], [151.2093, -33.8688]],
      [[-123.1207, 49.2827], [103.8198, 1.3521]],
      [[-46.6333, -23.5505], [18.4241, -33.9249]],
      [[18.4241, -33.9249], [-74.006, 40.7128]],
      [[2.3522, 48.8566], [35.2137, 31.7683]],
      [[55.2708, 25.2048], [103.8198, 1.3521]],
      [[139.6917, 35.6895], [-74.006, 40.7128]]
    ];
    const routes = routeSpecs.map((route, index) => ({
      delay: index / routeSpecs.length,
      pulses: index % 3 === 0 ? [0, 0.34, 0.68] : [0, 0.52],
      speed: 0.00023 + (index % 5) * 0.000014,
      points: makeRoute(route[0], route[1], 96)
    }));
    const portalRoutes = routeSpecs.filter((route, index) => index % 4 === 0 || index % 7 === 0).map((route, index) => ({
      delay: index / routeSpecs.length,
      pulses: [0],
      speed: 0.00072 + (index % 4) * 0.000026,
      points: makeRoute(route[0], route[1], 34)
    }));
    const autoYawSpeed = 0.00016;
    const portalYawMultiplier = 18;
    const portalRouteTimeMultiplier = 4.65;
    const portalDuration = 2900;
    const portalLaunchAt = 0.42;
    const rotation = {
      yaw: 0,
      pitch: 0.04,
      velocityYaw: autoYawSpeed,
      velocityPitch: 0,
      autoDirection: 1,
      dragging: false,
      lastX: 0,
      lastY: 0,
      lastTime: 0
    };
    let lastFrameTime = 0;
    let portalMode = false;
    let active = true;
    let portalCanvas = null;
    let portalCtx = null;
    let portalFrame = 0;
    let portalLastFrameTime = 0;
    let portalStartTime = 0;
    let portalVisualProgress = 0;
    let portalLayout = null;
    const layout = {
      width: 0,
      height: 0,
      centerX: 0,
      centerY: 0,
      radius: 0
    };

    function makeGeoPoint(lon, lat) {
      const lambda = (lon - centerLon) * rad;
      const phi = lat * rad;
      return {
        lon,
        lat,
        lambda,
        sinPhi: Math.sin(phi),
        cosPhi: Math.cos(phi)
      };
    }

    function lonLatToVector(lon, lat) {
      const lambda = lon * rad;
      const phi = lat * rad;
      const cosPhi = Math.cos(phi);
      return [cosPhi * Math.cos(lambda), Math.sin(phi), cosPhi * Math.sin(lambda)];
    }

    function vectorToLonLat(vector) {
      const length = Math.hypot(vector[0], vector[1], vector[2]) || 1;
      const x = vector[0] / length;
      const y = vector[1] / length;
      const z = vector[2] / length;
      return [Math.atan2(z, x) / rad, Math.asin(y) / rad];
    }

    function makeRoute(from, to, steps) {
      const a = lonLatToVector(from[0], from[1]);
      const b = lonLatToVector(to[0], to[1]);
      const dot = clamp(a[0] * b[0] + a[1] * b[1] + a[2] * b[2], -1, 1);
      const omega = Math.acos(dot);
      const sinOmega = Math.sin(omega) || 1;
      const points = [];
      for (let i = 0; i <= steps; i += 1) {
        const t = i / steps;
        const s1 = Math.sin((1 - t) * omega) / sinOmega;
        const s2 = Math.sin(t * omega) / sinOmega;
        points.push(vectorToLonLat([a[0] * s1 + b[0] * s2, a[1] * s1 + b[1] * s2, a[2] * s1 + b[2] * s2]));
      }
      return points;
    }

    function prepareCountries(collection, compact = false) {
      const features = collection?.features || [];
      return features.map((feature) => {
        const geometry = feature.geometry;
        const polygons = geometry?.type === "Polygon" ? [geometry.coordinates] : geometry?.type === "MultiPolygon" ? geometry.coordinates : [];
        const rings = [];
        let vector = [0, 0, 0];
        let count = 0;
        polygons.forEach((polygon) => {
          polygon.forEach((ring) => {
            const step = compact
              ? ring.length > 220 ? 22 : ring.length > 120 ? 14 : ring.length > 58 ? 8 : ring.length > 24 ? 4 : 2
              : ring.length > 240 ? 5 : ring.length > 140 ? 4 : ring.length > 70 ? 3 : ring.length > 28 ? 2 : 1;
            const cleanCoordinates = ring.filter((point, index) => index % step === 0 || index === ring.length - 1);
            const cleanRing = cleanCoordinates.map(([lon, lat]) => makeGeoPoint(lon, lat));
            rings.push(cleanRing);
            cleanCoordinates.forEach(([lon, lat]) => {
              const v = lonLatToVector(lon, lat);
              vector[0] += v[0];
              vector[1] += v[1];
              vector[2] += v[2];
              count += 1;
            });
          });
        });
        const center = count ? vectorToLonLat(vector) : [0, 0];
        return { center: makeGeoPoint(center[0], center[1]), rings };
      }).filter((country) => country.rings.length);
    }

    function projectPoint(point, orientation, radius, centerX, centerY) {
      const lambda = point.lambda + orientation.yaw;
      const x = point.cosPhi * Math.sin(lambda);
      const y = -point.sinPhi;
      const z = point.cosPhi * Math.cos(lambda);
      const tiltedY = y * orientation.cosPitch - z * orientation.sinPitch;
      const tiltedZ = y * orientation.sinPitch + z * orientation.cosPitch;
      return { x: centerX + x * radius, y: centerY + tiltedY * radius, z: tiltedZ };
    }

    function projectRoutePoint(points, progress, orientation, radius, centerX, centerY) {
      const max = points.length - 1;
      const scaled = clamp(progress, 0, 1) * max;
      const index = Math.min(Math.floor(scaled), max - 1);
      const mix = scaled - index;
      const start = points[index];
      const end = points[index + 1];
      let startLon = start[0];
      let endLon = end[0];
      const lonDelta = endLon - startLon;
      if (lonDelta > 180) startLon += 360;
      if (lonDelta < -180) endLon += 360;
      const lon = ((lerp(startLon, endLon, mix) + 540) % 360) - 180;
      const lat = lerp(start[1], end[1], mix);
      const lambda = (lon - centerLon) * rad + orientation.yaw;
      const phi = lat * rad;
      const cosPhi = Math.cos(phi);
      const x = cosPhi * Math.sin(lambda);
      const y = -Math.sin(phi);
      const z = cosPhi * Math.cos(lambda);
      const tiltedY = y * orientation.cosPitch - z * orientation.sinPitch;
      const tiltedZ = y * orientation.sinPitch + z * orientation.cosPitch;
      return { x: centerX + x * radius, y: centerY + tiltedY * radius, z: tiltedZ };
    }

    function drawCountry(country, orientation, radius, centerX, centerY) {
      const center = projectPoint(country.center, orientation, radius, centerX, centerY);
      if (center.z < -0.16) return;
      const normalX = (center.x - centerX) / radius;
      const normalY = (center.y - centerY) / radius;
      const sunSide = clamp(center.z * 0.62 - normalX * 0.22 - normalY * 0.26, 0, 1);
      const landAlpha = 0.28 + sunSide * 0.32;
      const borderAlpha = 0.36 + sunSide * 0.44;
      ctx.beginPath();
      country.rings.forEach((ring) => {
        ring.forEach((geoPoint, index) => {
          const point = projectPoint(geoPoint, orientation, radius, centerX, centerY);
          if (index === 0) ctx.moveTo(point.x, point.y);
          else ctx.lineTo(point.x, point.y);
        });
        ctx.closePath();
      });
      ctx.save();
      ctx.globalAlpha = landAlpha;
      ctx.fillStyle = orientation.landGradient || "rgba(96, 127, 139, 0.72)";
      ctx.fill("evenodd");
      ctx.restore();

      ctx.strokeStyle = `rgba(218, 236, 240, ${borderAlpha})`;
      ctx.lineWidth = clamp(radius / 720, 0.42, 0.82);
      ctx.stroke();
    }

    function drawTrailPath(route, orientation, radius, centerX, centerY, startProgress, endProgress, color, width, alpha, blur) {
      if (endProgress - startProgress < 0.006) return;
      const steps = clamp(Math.ceil((endProgress - startProgress) * route.points.length * 0.92), 7, 28);
      ctx.save();
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.lineWidth = width;
      ctx.strokeStyle = `rgba(${color[0]}, ${color[1]}, ${color[2]}, ${alpha})`;
      if (blur > 0) {
        ctx.shadowColor = `rgba(${color[0]}, ${color[1]}, ${color[2]}, ${alpha * 0.82})`;
        ctx.shadowBlur = blur;
      }
      ctx.beginPath();

      let drawing = false;
      for (let i = 0; i <= steps; i += 1) {
        const progress = lerp(startProgress, endProgress, i / steps);
        const point = projectRoutePoint(route.points, progress, orientation, radius, centerX, centerY);
        if (point.z <= 0.025) {
          drawing = false;
          continue;
        }
        if (!drawing) {
          ctx.moveTo(point.x, point.y);
          drawing = true;
        } else {
          ctx.lineTo(point.x, point.y);
        }
      }

      ctx.stroke();
      ctx.restore();
    }

    function drawWrappedTrail(route, orientation, radius, centerX, centerY, startProgress, endProgress, color, width, alpha, blur) {
      if (startProgress < 0) {
        drawTrailPath(route, orientation, radius, centerX, centerY, 1 + startProgress, 1, color, width, alpha, blur);
        drawTrailPath(route, orientation, radius, centerX, centerY, 0, endProgress, color, width, alpha, blur);
        return;
      }

      drawTrailPath(route, orientation, radius, centerX, centerY, startProgress, endProgress, color, width, alpha, blur);
    }

    function drawRoute(route, orientation, radius, centerX, centerY, time, index) {
      const tail = portalMode ? 0.12 : 0.16;
      route.pulses.forEach((offset, pulseIndex) => {
        const progress = (time * route.speed + route.delay + offset) % 1;
        const color = (index + pulseIndex) % 2 ? [92, 225, 255] : [228, 0, 124];
        if (portalMode) {
          drawWrappedTrail(route, orientation, radius, centerX, centerY, progress - tail, progress, color, 1.85, 0.72, 0);
          return;
        }
        drawWrappedTrail(route, orientation, radius, centerX, centerY, progress - tail, progress, color, 2.8, 0.18, 7);
        drawWrappedTrail(route, orientation, radius, centerX, centerY, progress - tail * 0.7, progress, color, 1.2, 0.62, 2.4);
        drawWrappedTrail(route, orientation, radius, centerX, centerY, progress - 0.035, progress, color, 1.65, 0.92, 4);
      });
    }

    function easeSmooth(value) {
      return value * value * (3 - 2 * value);
    }

    function getPortalLaunchProgress(progress = portalVisualProgress) {
      return clamp((progress - portalLaunchAt) / (1 - portalLaunchAt), 0, 1);
    }

    function getPortalSpinMultiplier() {
      if (!portalMode) return 1;
      const holdProgress = clamp(portalVisualProgress / portalLaunchAt, 0, 1);
      const launchProgress = getPortalLaunchProgress();
      const anticipation = easeSmooth(holdProgress);
      const burst = Math.pow(launchProgress, 1.22);
      return lerp(2.85, 4.2, anticipation) + (portalYawMultiplier - 4.2) * burst;
    }

    function getPortalRouteTimeMultiplier() {
      if (!portalMode) return 1;
      const launchProgress = getPortalLaunchProgress();
      return lerp(1.7, portalRouteTimeMultiplier, Math.pow(launchProgress, 1.18));
    }

    function updateRotation(delta) {
      if (rotation.dragging) return;
      const normalizedDelta = delta / 16.7;
      const launchProgress = portalMode ? getPortalLaunchProgress() : 0;
      const targetYaw = rotation.autoDirection * autoYawSpeed * getPortalSpinMultiplier();
      const catchup = portalMode ? lerp(0.92, 0.64, Math.pow(launchProgress, 0.72)) : 0.982;
      rotation.yaw += rotation.velocityYaw * delta;
      rotation.pitch = clamp(rotation.pitch + rotation.velocityPitch * delta, -0.92, 0.92);
      rotation.velocityYaw += (targetYaw - rotation.velocityYaw) * (1 - Math.pow(catchup, normalizedDelta));
      rotation.velocityPitch *= Math.pow(0.91, normalizedDelta);
      if (Math.abs(rotation.velocityPitch) < 0.000004) rotation.velocityPitch = 0;
    }

    function handlePointerDown(event) {
      rotation.dragging = true;
      rotation.lastX = event.clientX;
      rotation.lastY = event.clientY;
      rotation.lastTime = event.timeStamp || performance.now();
      rotation.velocityYaw = 0;
      rotation.velocityPitch = 0;
      canvas.classList.add("is-dragging");
      canvas.setPointerCapture?.(event.pointerId);
      event.preventDefault();
    }

    function handlePointerMove(event) {
      if (!rotation.dragging) return;
      const time = event.timeStamp || performance.now();
      const dt = Math.max(12, time - rotation.lastTime);
      const dx = event.clientX - rotation.lastX;
      const dy = event.clientY - rotation.lastY;
      const yawChange = dx * 0.0052;
      const pitchChange = dy * 0.0042;

      rotation.yaw += yawChange;
      rotation.pitch = clamp(rotation.pitch + pitchChange, -0.92, 0.92);
      rotation.velocityYaw = clamp(yawChange / dt, -0.0012, 0.0012);
      rotation.velocityPitch = clamp(pitchChange / dt, -0.00085, 0.00085);
      if (Math.abs(rotation.velocityYaw) > 0.000018) {
        rotation.autoDirection = Math.sign(rotation.velocityYaw);
      }

      rotation.lastX = event.clientX;
      rotation.lastY = event.clientY;
      rotation.lastTime = time;
      event.preventDefault();
    }

    function handlePointerUp(event) {
      if (!rotation.dragging) return;
      rotation.dragging = false;
      if (Math.abs(rotation.velocityYaw) < autoYawSpeed * 0.45) {
        rotation.velocityYaw = rotation.autoDirection * autoYawSpeed;
      }
      canvas.classList.remove("is-dragging");
      if (event.pointerId !== undefined && canvas.hasPointerCapture?.(event.pointerId)) {
        canvas.releasePointerCapture(event.pointerId);
      }
    }

    function resize() {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, window.innerWidth <= 820 ? 1.35 : 1.5);
      layout.width = rect.width;
      layout.height = rect.height;
      layout.centerX = rect.width / 2;
      layout.centerY = rect.height / 2 + 10;
      layout.radius = Math.min(rect.width, rect.height) * 0.405;
      canvas.width = Math.round(rect.width * dpr);
      canvas.height = Math.round(rect.height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    function startPortalBoost() {
      portalMode = true;
      portalVisualProgress = 0;
      rotation.dragging = false;
      rotation.velocityYaw = rotation.autoDirection * Math.max(Math.abs(rotation.velocityYaw), autoYawSpeed * 2.9);
      rotation.velocityPitch *= 0.35;
      canvas.classList.remove("is-dragging");
      if (createPortalCanvas()) {
        active = false;
        portalLastFrameTime = 0;
        portalStartTime = 0;
        if (!portalFrame) drawPortal(performance.now());
      }
    }

    function renderGlobeFrame(time, targetLayout) {
      const w = targetLayout.width;
      const h = targetLayout.height;
      const cx = targetLayout.centerX;
      const cy = targetLayout.centerY;
      const r = targetLayout.radius;
      const orientation = {
        yaw: rotation.yaw,
        cosPitch: Math.cos(rotation.pitch),
        sinPitch: Math.sin(rotation.pitch)
      };

      ctx.clearRect(0, 0, w, h);
      ctx.imageSmoothingEnabled = true;

      const halo = ctx.createRadialGradient(cx, cy, r * 0.94, cx, cy, r * 1.11);
      halo.addColorStop(0, "rgba(255,255,255,0)");
      halo.addColorStop(0.72, "rgba(202,222,230,0.06)");
      halo.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = halo;
      ctx.beginPath();
      ctx.arc(cx, cy, r * 1.12, 0, Math.PI * 2);
      ctx.fill();

      const ocean = ctx.createRadialGradient(cx - r * 0.38, cy - r * 0.46, r * 0.05, cx, cy, r * 1.02);
      ocean.addColorStop(0, "#161b1d");
      ocean.addColorStop(0.34, "#090b0c");
      ocean.addColorStop(0.72, "#020202");
      ocean.addColorStop(1, "#000000");
      ctx.fillStyle = ocean;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fill();

      const oceanLight = ctx.createRadialGradient(cx - r * 0.42, cy - r * 0.48, 0, cx - r * 0.38, cy - r * 0.44, r * 0.82);
      oceanLight.addColorStop(0, "rgba(215, 238, 244, 0.12)");
      oceanLight.addColorStop(0.28, "rgba(96, 157, 174, 0.045)");
      oceanLight.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = oceanLight;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fill();

      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.clip();

      orientation.landGradient = ctx.createLinearGradient(cx - r * 0.52, cy - r * 0.58, cx + r * 0.42, cy + r * 0.52);
      orientation.landGradient.addColorStop(0, "rgba(188, 218, 226, 0.94)");
      orientation.landGradient.addColorStop(0.44, "rgba(99, 128, 138, 0.86)");
      orientation.landGradient.addColorStop(1, "rgba(30, 45, 52, 0.78)");

      const visibleCountries = portalMode ? portalCountries : countries;
      const visibleRoutes = portalMode ? portalRoutes : routes;
      const surfaceProgress = targetLayout.portalProgress || 0;
      if (!portalMode || surfaceProgress < 0.92) {
        visibleCountries.forEach((country) => drawCountry(country, orientation, r, cx, cy));
        visibleRoutes.forEach((route, index) => drawRoute(route, orientation, r, cx, cy, portalMode ? time * getPortalRouteTimeMultiplier() : time, index));
      }

      const sphereShade = ctx.createRadialGradient(cx - r * 0.34, cy - r * 0.42, r * 0.08, cx + r * 0.16, cy + r * 0.12, r * 1.08);
      sphereShade.addColorStop(0, "rgba(255,255,255,0.045)");
      sphereShade.addColorStop(0.42, "rgba(0,0,0,0)");
      sphereShade.addColorStop(0.78, "rgba(0,0,0,0.36)");
      sphereShade.addColorStop(1, "rgba(0,0,0,0.86)");
      ctx.fillStyle = sphereShade;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fill();

      const edge = ctx.createRadialGradient(cx, cy, r * 0.58, cx, cy, r);
      edge.addColorStop(0, "rgba(0,0,0,0)");
      edge.addColorStop(0.74, "rgba(0,0,0,0.1)");
      edge.addColorStop(1, "rgba(0,0,0,0.78)");
      ctx.fillStyle = edge;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      const rim = ctx.createRadialGradient(cx, cy, r * 0.94, cx, cy, r * 1.02);
      rim.addColorStop(0, "rgba(255,255,255,0)");
      rim.addColorStop(0.68, "rgba(180, 212, 222, 0.08)");
      rim.addColorStop(1, "rgba(245,245,250,0)");
      ctx.fillStyle = rim;
      ctx.beginPath();
      ctx.arc(cx, cy, r * 1.02, 0, Math.PI * 2);
      ctx.fill();
    }

    function createPortalCanvas() {
      document.querySelectorAll(".globe-portal-canvas").forEach((element) => element.remove());
      const rootStyles = getComputedStyle(document.documentElement);
      const sourceWidth = parseFloat(rootStyles.getPropertyValue("--portal-width")) || layout.width || 560;
      const sourceHeight = parseFloat(rootStyles.getPropertyValue("--portal-height")) || layout.height || 440;
      const offsetX = parseFloat(rootStyles.getPropertyValue("--portal-offset-x")) || 0;
      const offsetY = parseFloat(rootStyles.getPropertyValue("--portal-offset-y")) || 0;
      const width = window.innerWidth;
      const height = window.innerHeight;
      const dpr = Math.min(window.devicePixelRatio || 1, 1);
      portalCanvas = document.createElement("canvas");
      portalCanvas.className = "globe-portal-canvas";
      portalCanvas.setAttribute("aria-hidden", "true");
      portalCanvas.width = Math.round(width * dpr);
      portalCanvas.height = Math.round(height * dpr);
      portalCtx = portalCanvas.getContext("2d", { alpha: true });
      if (!portalCtx) return false;
      portalCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const startRadius = Math.min(sourceWidth, sourceHeight) * 0.405;
      portalLayout = {
        width,
        height,
        centerX: width / 2 + offsetX,
        centerY: height / 2 + offsetY + 10,
        radius: startRadius,
        startCenterX: width / 2 + offsetX,
        startCenterY: height / 2 + offsetY + 10,
        startRadius,
        endCenterX: width / 2,
        endCenterY: height / 2,
        endRadius: Math.max(startRadius * 15.5, Math.max(width, height) * 1.74),
        portalProgress: 0
      };
      document.body.appendChild(portalCanvas);
      document.body.classList.add("portal-live-ready");
      return true;
    }

    function drawPortalDepth(launchProgress, growProgress, time) {
      if (!portalCtx || !portalLayout || launchProgress <= 0) return;
      const cx = portalLayout.centerX;
      const cy = portalLayout.centerY;
      const radius = portalLayout.radius;
      const burst = Math.pow(launchProgress, 1.35);
      const tunnelAlpha = clamp((launchProgress - 0.08) / 0.72, 0, 1);

      portalCtx.save();
      portalCtx.globalCompositeOperation = "screen";
      portalCtx.lineCap = "round";
      for (let i = 0; i < 22; i += 1) {
        const seed = i * 19.73;
        const angle = seed + time * 0.0011 + burst * 1.8;
        const spin = Math.sin(seed * 0.37 + time * 0.002) * 0.12;
        const inner = radius * (0.14 + 0.22 * launchProgress + (i % 5) * 0.012);
        const outer = radius * (0.6 + burst * (1.45 + (i % 4) * 0.18));
        const x1 = cx + Math.cos(angle + spin) * inner;
        const y1 = cy + Math.sin(angle + spin) * inner;
        const x2 = cx + Math.cos(angle + spin) * outer;
        const y2 = cy + Math.sin(angle + spin) * outer;
        const isAccent = i % 5 === 0;
        portalCtx.strokeStyle = isAccent
          ? `rgba(228, 0, 124, ${0.06 + tunnelAlpha * 0.18})`
          : `rgba(210, 232, 238, ${0.035 + tunnelAlpha * 0.13})`;
        portalCtx.lineWidth = Math.max(1, radius * (0.0016 + burst * 0.0018));
        portalCtx.beginPath();
        portalCtx.moveTo(x1, y1);
        portalCtx.lineTo(x2, y2);
        portalCtx.stroke();
      }

      const entryGlow = portalCtx.createRadialGradient(cx, cy, radius * 0.08, cx, cy, radius * (0.24 + burst * 0.5));
      entryGlow.addColorStop(0, `rgba(255,255,255,${0.02 + tunnelAlpha * 0.08})`);
      entryGlow.addColorStop(0.36, `rgba(92,225,255,${0.02 + tunnelAlpha * 0.045})`);
      entryGlow.addColorStop(0.72, `rgba(228,0,124,${0.015 + tunnelAlpha * 0.045})`);
      entryGlow.addColorStop(1, "rgba(255,255,255,0)");
      portalCtx.fillStyle = entryGlow;
      portalCtx.beginPath();
      portalCtx.arc(cx, cy, radius * (0.28 + burst * 0.72), 0, Math.PI * 2);
      portalCtx.fill();
      portalCtx.restore();

      portalCtx.save();
      portalCtx.globalCompositeOperation = "source-over";
      const vignette = portalCtx.createRadialGradient(cx, cy, radius * (0.22 + growProgress * 0.18), cx, cy, Math.max(window.innerWidth, window.innerHeight) * 0.82);
      vignette.addColorStop(0, `rgba(0,0,0,${0.02 + burst * 0.08})`);
      vignette.addColorStop(0.58, "rgba(0,0,0,0)");
      vignette.addColorStop(1, `rgba(0,0,0,${0.18 + burst * 0.34})`);
      portalCtx.fillStyle = vignette;
      portalCtx.fillRect(0, 0, portalLayout.width, portalLayout.height);
      portalCtx.restore();
    }

    function drawPortal(time) {
      if (!portalCtx || !portalLayout) {
        portalFrame = 0;
        return;
      }
      if (!portalStartTime) portalStartTime = time;
      const elapsed = time - portalStartTime;
      const progress = clamp(elapsed / portalDuration, 0, 1);
      portalVisualProgress = progress;
      const holdProgress = clamp(progress / portalLaunchAt, 0, 1);
      const launchProgress = getPortalLaunchProgress(progress);
      const holdEase = easeSmooth(holdProgress);
      const launchMoveEase = Math.pow(launchProgress, 1.22);
      const launchGrowEase = Math.pow(launchProgress, 1.62);
      const moveProgress = clamp(0.035 * holdEase + 0.965 * launchMoveEase, 0, 1);
      const growProgress = clamp(0.014 * holdEase + 0.986 * launchGrowEase, 0, 1);
      const delta = portalLastFrameTime ? Math.min(20, time - portalLastFrameTime) : 16.7;
      portalLastFrameTime = time;
      updateRotation(delta);

      portalLayout.centerX = lerp(portalLayout.startCenterX, portalLayout.endCenterX, moveProgress);
      portalLayout.centerY = lerp(portalLayout.startCenterY, portalLayout.endCenterY, moveProgress);
      portalLayout.radius = lerp(portalLayout.startRadius, portalLayout.endRadius, growProgress);
      portalLayout.portalProgress = launchProgress;

      const originalCtx = ctx;
      ctx = portalCtx;
      renderGlobeFrame(time, portalLayout);
      ctx = originalCtx;
      drawPortalDepth(launchProgress, growProgress, time);

      if (progress < 1) {
        portalFrame = requestAnimationFrame(drawPortal);
      } else {
        portalFrame = 0;
      }
    }

    function draw(time) {
      if (!active) return;
      if (!layout.width || !layout.height || !layout.radius) {
        requestAnimationFrame(draw);
        return;
      }
      const delta = lastFrameTime ? Math.min(32, time - lastFrameTime) : 16.7;
      lastFrameTime = time;
      updateRotation(delta);
      renderGlobeFrame(time, layout);
      requestAnimationFrame(draw);
    }

    resize();
    window.addEventListener("resize", resize);
    canvas.addEventListener("pointerdown", handlePointerDown);
    canvas.addEventListener("pointermove", handlePointerMove);
    canvas.addEventListener("pointerup", handlePointerUp);
    canvas.addEventListener("pointercancel", handlePointerUp);
    canvas.addEventListener("lostpointercapture", handlePointerUp);
    requestAnimationFrame(draw);
  }

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

  setupGlobe();
  setupAmbient();
  setupDotPulse();
})();
