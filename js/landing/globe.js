/* ============================================================
   NEXUS Landing · Globo interactivo (canvas)
   ------------------------------------------------------------
   Extraído de script.js (Ola 5 · refactor). Autocontenido: solo
   necesita el canvas #globeCanvas y window.INFINITY_COUNTRIES
   (js/data/world-countries.js). Expone window.NexusGlobe.setup().
   ============================================================ */
(function () {
  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const lerp = (a, b, t) => a + (b - a) * t;

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

  window.NexusGlobe = { setup: setupGlobe };
})();
