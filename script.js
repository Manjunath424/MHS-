(function () {
  'use strict';

  var TAU = Math.PI * 2;
  var clamp = function (v, a, b) { return Math.min(b, Math.max(a, v)); };
  var lerp = function (a, b, t) { return a + (b - a) * t; };
  var smooth = function (t) { return t * t * (3 - 2 * t); };
  var nums = function (s) { return s.split(',').map(Number); };
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var root = document.documentElement;

  /* ---------------------------------------------------------
     Configurator state and UI (works even without WebGL)
  --------------------------------------------------------- */
  var PAINTS = {
    petrol:   { hex: 0x0f5c63, css: '#0f5c63', name: 'Petrol' },
    signal:   { hex: 0xf0b800, css: '#f0b800', name: 'Signal' },
    bone:     { hex: 0xe2dac6, css: '#b9ae93', name: 'Bone' },
    oxide:    { hex: 0xa1332b, css: '#a1332b', name: 'Oxide' },
    midnight: { hex: 0x1c2a52, css: '#1c2a52', name: 'Midnight' }
  };
  var WHEELS = {
    black:  { hex: 0x16191b, name: 'black',  metal: 0.6, rough: 0.45 },
    bronze: { hex: 0x8c5a2a, name: 'bronze', metal: 0.9, rough: 0.35 },
    silver: { hex: 0xc7ccd0, name: 'silver', metal: 0.95, rough: 0.3 }
  };
  var state = { paint: 'petrol', wheels: 'black', lights: true, speed: 0 };

  var summaryEl = document.getElementById('summary');
  var speedEl = document.getElementById('speed');
  var speedOut = document.getElementById('speedOut');

  function updateSummary() {
    summaryEl.textContent = 'Your T2: ' + PAINTS[state.paint].name.toLowerCase() + ' paint, ' +
      WHEELS[state.wheels].name + ' wheels, lights ' + (state.lights ? 'on' : 'off') + '.';
  }
  function applyPaintUI() {
    root.style.setProperty('--accent', PAINTS[state.paint].css);
    updateSummary();
  }

  document.querySelectorAll('input[name="paint"]').forEach(function (el) {
    el.addEventListener('change', function () { state.paint = el.value; applyPaintUI(); if (api.setPaint) api.setPaint(); });
  });
  document.querySelectorAll('input[name="wheels"]').forEach(function (el) {
    el.addEventListener('change', function () { state.wheels = el.value; updateSummary(); if (api.setWheels) api.setWheels(); });
  });
  document.getElementById('lights').addEventListener('change', function (e) { state.lights = e.target.checked; updateSummary(); });
  speedEl.addEventListener('input', function () { state.speed = Number(speedEl.value); speedOut.textContent = state.speed + ' km/h'; });

  var api = {};
  updateSummary();
  applyPaintUI();

  /* ---------------------------------------------------------
     WebGL scene
  --------------------------------------------------------- */
  if (!window.THREE) { root.classList.add('no-gl'); return; }

  var canvas = document.getElementById('gl');
  var renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
  } catch (err) {
    root.classList.add('no-gl');
    return;
  }
  renderer.setClearColor(0x000000, 0);
  renderer.outputEncoding = THREE.sRGBEncoding;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  var scene = new THREE.Scene();
  var camera = new THREE.PerspectiveCamera(30, 1, 0.1, 60);

  /* Soft studio environment so paint and metal have something to reflect */
  (function makeEnvironment() {
    try {
      var env = new THREE.Scene();
      var room = new THREE.Mesh(
        new THREE.BoxGeometry(22, 10, 22),
        new THREE.MeshBasicMaterial({ color: 0x8b9598, side: THREE.BackSide })
      );
      room.position.y = 4.5;
      env.add(room);
      var softbox = function (w, h, x, y, z, rx, ry, level) {
        var m = new THREE.Mesh(
          new THREE.PlaneGeometry(w, h),
          new THREE.MeshBasicMaterial({ color: new THREE.Color(level, level, level), side: THREE.DoubleSide })
        );
        m.position.set(x, y, z);
        m.rotation.set(rx, ry, 0);
        env.add(m);
      };
      softbox(9, 4, 0, 9, 0, Math.PI / 2, 0, 7);
      softbox(3, 6, -9, 4, 1, 0, Math.PI / 2, 5);
      softbox(3, 6, 9, 4, 3, 0, -Math.PI / 2, 3.5);
      softbox(7, 2.5, 0, 3.5, -10, 0, 0, 3);
      var pmrem = new THREE.PMREMGenerator(renderer);
      var rt = pmrem.fromScene(env, 0.04);
      scene.environment = rt.texture;
      pmrem.dispose();
    } catch (e) { /* the scene still renders with plain lights */ }
  })();

  scene.add(new THREE.HemisphereLight(0xffffff, 0x8a9296, 0.35));
  var key = new THREE.DirectionalLight(0xffffff, 1.1);
  key.position.set(3, 6, 4);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.left = -2.5; key.shadow.camera.right = 2.5;
  key.shadow.camera.top = 2.5; key.shadow.camera.bottom = -2.5;
  key.shadow.camera.near = 1; key.shadow.camera.far = 16;
  key.shadow.bias = -0.0004;
  key.shadow.radius = 4;
  scene.add(key);
  var rimLight = new THREE.DirectionalLight(0xdfeeff, 0.6);
  rimLight.position.set(-4, 3, -3);
  scene.add(rimLight);

  var ground = new THREE.Mesh(new THREE.PlaneGeometry(30, 30), new THREE.ShadowMaterial({ opacity: 0.32 }));
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  /* ---------- Materials ---------- */
  var paintMat = new THREE.MeshPhysicalMaterial({ color: PAINTS.petrol.hex, metalness: 0.4, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.06, transparent: true });
  var paintMatDS = paintMat.clone(); paintMatDS.side = THREE.DoubleSide;
  var paintMats = [paintMat, paintMatDS];
  var seatMat = new THREE.MeshStandardMaterial({ color: 0x101213, roughness: 0.85, metalness: 0, transparent: true });
  var frameMat = new THREE.MeshStandardMaterial({ color: 0x23282c, metalness: 0.75, roughness: 0.42 });
  var darkMat = new THREE.MeshStandardMaterial({ color: 0x1b1f22, metalness: 0.7, roughness: 0.5 });
  var alloyMat = new THREE.MeshStandardMaterial({ color: 0x9da4a9, metalness: 0.9, roughness: 0.34 });
  var goldMat = new THREE.MeshStandardMaterial({ color: 0xc9a24b, metalness: 1, roughness: 0.28 });
  var steelMat = new THREE.MeshStandardMaterial({ color: 0xb4b8ba, metalness: 1, roughness: 0.3 });
  var pipeMat = new THREE.MeshStandardMaterial({ color: 0x9a9c9d, metalness: 1, roughness: 0.36 });
  var rubberMat = new THREE.MeshStandardMaterial({ color: 0x0c0d0e, roughness: 0.92, metalness: 0 });
  var markMat = new THREE.MeshStandardMaterial({ color: 0xe9e9e4, roughness: 0.7 });
  var wheelMat = new THREE.MeshStandardMaterial({ color: WHEELS.black.hex, metalness: WHEELS.black.metal, roughness: WHEELS.black.rough, side: THREE.DoubleSide });
  var discMat = new THREE.MeshStandardMaterial({ color: 0xb9bcbe, metalness: 1, roughness: 0.38 });
  var chainMat = new THREE.MeshStandardMaterial({ color: 0x2c2c2c, metalness: 0.8, roughness: 0.5 });
  var lensMat = new THREE.MeshStandardMaterial({ color: 0xfff6dc, emissive: 0xfff1c4, emissiveIntensity: 2.4, roughness: 0.2 });
  var tailMat = new THREE.MeshStandardMaterial({ color: 0xb01810, emissive: 0xff2a18, emissiveIntensity: 1.6, roughness: 0.3 });
  var amberMat = new THREE.MeshStandardMaterial({ color: 0xff9d1a, emissive: 0xff8a00, emissiveIntensity: 0.4, roughness: 0.4 });

  /* ---------- Geometry helpers ---------- */
  var V = function (x, y, z) { return new THREE.Vector3(x, y, z); };
  var UP = V(0, 1, 0);
  function orient(mesh, a, b) {
    var va = V(a[0], a[1], a[2]), vb = V(b[0], b[1], b[2]);
    mesh.position.copy(va).add(vb).multiplyScalar(0.5);
    mesh.quaternion.setFromUnitVectors(UP, vb.sub(va).normalize());
    return mesh;
  }
  function distance(a, b) { return V(a[0], a[1], a[2]).distanceTo(V(b[0], b[1], b[2])); }
  function tube(a, b, r, mat) {
    return orient(new THREE.Mesh(new THREE.CylinderGeometry(r, r, distance(a, b), 12), mat), a, b);
  }
  function beam(a, b, w, d, mat) {
    return orient(new THREE.Mesh(new THREE.BoxGeometry(w, distance(a, b), d), mat), a, b);
  }
  function ball(p, r, mat) {
    var m = new THREE.Mesh(new THREE.SphereGeometry(r, 12, 10), mat);
    m.position.set(p[0], p[1], p[2]);
    return m;
  }
  function poly(pts, r, mat, parent) {
    for (var i = 0; i < pts.length - 1; i++) parent.add(tube(pts[i], pts[i + 1], r, mat));
    for (var j = 0; j < pts.length; j++) parent.add(ball(pts[j], r, mat));
  }
  function cyl(r, h, mat, axis, seg) {
    var g = new THREE.CylinderGeometry(r, r, h, seg || 24);
    if (axis === 'z') g.rotateX(Math.PI / 2);
    if (axis === 'x') g.rotateZ(Math.PI / 2);
    return new THREE.Mesh(g, mat);
  }
  function place(mesh, x, y, z) { mesh.position.set(x, y, z); return mesh; }
  function ellipsoid(mat, x, y, z, sx, sy, sz) {
    var m = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 20), mat);
    m.position.set(x, y, z); m.scale.set(sx, sy, sz);
    return m;
  }
  function both(fn) { fn(1); fn(-1); }

  /* ---------- Wheel ---------- */
  function makeWheel(rear) {
    var g = new THREE.Group();
    var spin = new THREE.Group();
    g.add(spin);

    var tire = new THREE.Mesh(new THREE.TorusGeometry(0.305, 0.08, 24, 72), rubberMat);
    if (rear) tire.scale.z = 1.35;
    spin.add(tire);

    var markZ = 0.075 * (rear ? 1.35 : 1);
    [1, -1].forEach(function (s) {
      var arc = new THREE.Mesh(new THREE.TorusGeometry(0.268, 0.0035, 6, 28, 0.9), markMat);
      arc.position.z = s * markZ;
      spin.add(arc);
      var rim = new THREE.Mesh(new THREE.TorusGeometry(0.232, 0.013, 10, 64), wheelMat);
      rim.position.z = s * 0.03;
      spin.add(rim);
    });
    spin.add(cyl(0.235, 0.07, wheelMat, 'z', 48));

    for (var i = 0; i < 10; i++) {
      var a = (i / 10) * TAU;
      var sp = new THREE.Mesh(new THREE.BoxGeometry(0.21, 0.02, 0.014), wheelMat);
      sp.position.set(Math.cos(a) * 0.125, Math.sin(a) * 0.125, i % 2 ? 0.02 : -0.02);
      sp.rotation.z = a;
      spin.add(sp);
    }
    spin.add(cyl(0.04, 0.12, alloyMat, 'z', 16));

    var discZs = rear ? [0.06] : [0.06, -0.06];
    discZs.forEach(function (z) {
      var d = cyl(0.15, 0.006, discMat, 'z', 48); d.position.z = z; spin.add(d);
      var carrier = new THREE.Mesh(new THREE.TorusGeometry(0.11, 0.012, 6, 36), darkMat);
      carrier.position.z = z + (z > 0 ? 0.004 : -0.004);
      spin.add(carrier);
    });

    // Brake caliper stays with the fork / swingarm, not the spinning wheel
    var cal = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.06, 0.036), goldMat);
    cal.position.set(rear ? -0.13 : 0.1, rear ? 0.05 : 0.11, 0.075);
    g.add(cal);
    if (!rear) {
      var cal2 = cal.clone(); cal2.position.z = -0.075; g.add(cal2);
    }
    return { g: g, spin: spin };
  }

  /* ---------- Build the bike ---------- */
  var bike = new THREE.Group();
  var body = new THREE.Group();
  bike.add(body);
  scene.add(bike);

  var RAKE = 25 * Math.PI / 180;
  var FA = [0.72, 0.385];                      // front axle
  var RA = [-0.68, 0.385];                     // rear axle
  var forkPt = function (len, z) { return [FA[0] - Math.sin(RAKE) * len, FA[1] + Math.cos(RAKE) * len, z || 0]; };

  var front = makeWheel(false);
  front.g.position.set(FA[0], FA[1], 0);
  bike.add(front.g);
  var rear = makeWheel(true);
  rear.g.position.set(RA[0], RA[1], 0);
  bike.add(rear.g);

  // Rear sprocket spins with the wheel
  var rSprocket = cyl(0.095, 0.012, chainMat, 'z', 32);
  rSprocket.position.z = -0.155;
  rear.spin.add(rSprocket);

  // Trellis frame
  both(function (s) {
    poly([[0.41, 0.93, 0.035 * s], [0.10, 0.88, 0.11 * s], [-0.30, 0.66, 0.11 * s]], 0.02, frameMat, body);
    poly([[0.44, 0.85, 0.04 * s], [0.37, 0.55, 0.12 * s], [0.25, 0.30, 0.12 * s], [-0.10, 0.27, 0.12 * s], [-0.30, 0.44, 0.12 * s]], 0.017, frameMat, body);
    body.add(tube([-0.30, 0.66, 0.11 * s], [-0.30, 0.44, 0.12 * s], 0.024, frameMat));
    poly([[-0.30, 0.66, 0.11 * s], [-0.24, 0.86, 0.09 * s], [-0.88, 0.98, 0.08 * s]], 0.016, frameMat, body);
    body.add(tube([-0.28, 0.72, 0.1 * s], [-0.64, 0.95, 0.08 * s], 0.012, frameMat));
    // swingarm
    body.add(beam([-0.30, 0.46, 0.125 * s], [-0.68, 0.385, 0.115 * s], 0.075, 0.04, alloyMat));
    // foot pegs
    body.add(tube([-0.30, 0.46, 0.13 * s], [-0.10, 0.40, 0.2 * s], 0.012, frameMat));
    body.add(tube([-0.10, 0.40, 0.18 * s], [-0.10, 0.40, 0.29 * s], 0.011, steelMat));
  });
  body.add(tube([0.47, 0.80, 0], [0.395, 0.965, 0], 0.034, frameMat));
  body.add(tube([-0.30, 0.66, -0.11], [-0.30, 0.66, 0.11], 0.02, frameMat));
  body.add(tube([-0.30, 0.46, -0.14], [-0.30, 0.46, 0.14], 0.03, frameMat));
  body.add(tube([RA[0], RA[1], -0.14], [RA[0], RA[1], 0.14], 0.016, steelMat));

  // Rear shock with a visible spring
  var shockBot = V(-0.44, 0.47, 0), shockTop = V(-0.25, 0.86, 0);
  var shockDir = shockTop.clone().sub(shockBot), shockLen = shockDir.length();
  body.add(tube([shockBot.x, shockBot.y, 0], [shockTop.x, shockTop.y, 0], 0.02, darkMat));
  var springPts = [], turns = 9, per = 14;
  for (var si = 0; si <= turns * per; si++) {
    var st = si / (turns * per), sa = st * turns * TAU;
    springPts.push(V(Math.cos(sa) * 0.038, 0.06 + st * (shockLen - 0.12), Math.sin(sa) * 0.038));
  }
  var spring = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(springPts), turns * per * 2, 0.0065, 6, false), goldMat);
  spring.position.copy(shockBot);
  spring.quaternion.setFromUnitVectors(UP, shockDir.clone().normalize());
  body.add(spring);

  // Fork
  both(function (s) {
    body.add(tube(forkPt(0, 0.095 * s), forkPt(0.42, 0.095 * s), 0.026, darkMat));
    body.add(tube(forkPt(0.34, 0.095 * s), forkPt(0.72, 0.095 * s), 0.02, goldMat));
  });
  body.add(tube([FA[0], FA[1], -0.11], [FA[0], FA[1], 0.11], 0.015, steelMat));
  [0.66, 0.46].forEach(function (len) {
    var p = forkPt(len, 0);
    var clamp3 = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.03, 0.27), darkMat);
    clamp3.position.set(p[0], p[1], p[2]);
    clamp3.rotation.z = RAKE;
    body.add(clamp3);
  });

  // Handlebar, grips, levers, mirrors
  both(function (s) {
    body.add(tube([0.44, 0.985, 0.03 * s], [0.40, 1.045, 0.05 * s], 0.014, darkMat));
    body.add(tube([0.40, 1.045, 0.06 * s], [0.395, 1.05, 0.36 * s], 0.011, steelMat));
    body.add(tube([0.395, 1.05, 0.36 * s], [0.335, 1.056, 0.42 * s], 0.011, steelMat));
    body.add(tube([0.345, 1.056, 0.41 * s], [0.30, 1.058, 0.52 * s], 0.018, rubberMat));
    body.add(tube([0.37, 1.05, 0.40 * s], [0.48, 1.02, 0.45 * s], 0.006, steelMat));
    body.add(tube([0.36, 1.06, 0.39 * s], [0.33, 1.20, 0.42 * s], 0.005, steelMat));
    body.add(ellipsoid(darkMat, 0.33, 1.21, 0.43 * s, 0.02, 0.03, 0.045));
  });
  body.add(tube([0.40, 1.045, -0.06], [0.40, 1.045, 0.06], 0.012, steelMat));

  // Headlight
  var hl = cyl(0.09, 0.11, darkMat, 'x', 32); hl.position.set(0.535, 0.985, 0); body.add(hl);
  var lens = cyl(0.078, 0.012, lensMat, 'x', 32); lens.position.set(0.595, 0.985, 0); body.add(lens);
  var ring = new THREE.Mesh(new THREE.TorusGeometry(0.086, 0.008, 8, 40), steelMat);
  ring.rotation.y = Math.PI / 2; ring.position.set(0.59, 0.985, 0); body.add(ring);
  both(function (s) {
    body.add(tube([0.46, 0.98, 0.095 * s], [0.53, 0.985, 0.08 * s], 0.01, darkMat));
    body.add(ball([0.50, 0.93, 0.125 * s], 0.02, amberMat));
    body.add(ball([-0.98, 0.93, 0.115 * s], 0.022, amberMat));
  });

  // Engine
  body.add(place(new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.26, 0.30), alloyMat), -0.02, 0.40, 0));
  body.add(place(new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.06, 0.24), darkMat), -0.02, 0.24, 0));
  body.add(place(cyl(0.085, 0.025, alloyMat, 'z', 28), 0.07, 0.41, 0.163));
  body.add(place(cyl(0.10, 0.025, alloyMat, 'z', 28), -0.12, 0.42, 0.165));
  body.add(place(cyl(0.065, 0.025, darkMat, 'z', 28), 0.2, 0.38, -0.163));
  var cylinders = new THREE.Group();
  cylinders.position.set(0.12, 0.50, 0);
  cylinders.rotation.z = -0.3;
  both(function (s) {
    var barrel = cyl(0.07, 0.26, darkMat, 'y', 24); barrel.position.set(0, 0.13, 0.085 * s); cylinders.add(barrel);
    for (var i = 0; i < 7; i++) {
      var fin = cyl(0.105, 0.012, alloyMat, 'y', 28); fin.position.set(0, 0.04 + i * 0.033, 0.085 * s); cylinders.add(fin);
    }
    cylinders.add(place(new THREE.Mesh(new THREE.BoxGeometry(0.20, 0.09, 0.16), darkMat), 0, 0.27, 0.085 * s));
    cylinders.add(place(new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.05, 0.14), alloyMat), 0, 0.335, 0.085 * s));
  });
  body.add(cylinders);

  // Exhaust
  both(function (s) {
    var header = new THREE.CatmullRomCurve3([
      V(0.29, 0.72, 0.085 * s), V(0.36, 0.60, 0.09 * s), V(0.36, 0.45, 0.09 * s),
      V(0.26, 0.30, 0.07 * s), V(0.06, 0.235, 0.04 * s), V(-0.16, 0.235, 0.02 * s)
    ]);
    body.add(new THREE.Mesh(new THREE.TubeGeometry(header, 40, 0.019, 10, false), pipeMat));
  });
  var mid = new THREE.CatmullRomCurve3([V(-0.16, 0.235, 0), V(-0.4, 0.26, 0.10), V(-0.62, 0.35, 0.16), V(-0.78, 0.40, 0.175)]);
  body.add(new THREE.Mesh(new THREE.TubeGeometry(mid, 30, 0.03, 10, false), pipeMat));
  var muffler = cyl(0.055, 0.34, steelMat, 'x', 28);
  muffler.position.set(-0.90, 0.42, 0.175); muffler.rotation.z = -0.12; body.add(muffler);
  var mcap = cyl(0.048, 0.01, darkMat, 'x', 28);
  mcap.position.set(-1.07, 0.435, 0.175); mcap.rotation.z = -0.12; body.add(mcap);

  // Chain and front sprocket (left side)
  body.add(place(cyl(0.05, 0.012, chainMat, 'z', 24), -0.14, 0.39, -0.16));
  body.add(beam([-0.14, 0.44, -0.155], [-0.68, 0.48, -0.155], 0.008, 0.02, chainMat));
  body.add(beam([-0.14, 0.34, -0.155], [-0.68, 0.29, -0.155], 0.008, 0.02, chainMat));

  // Painted bodywork
  var tank = ellipsoid(paintMat, 0.12, 0.965, 0, 0.36, 0.155, 0.185); body.add(tank);
  var cap = cyl(0.035, 0.012, seatMat, 'y', 20); cap.position.set(0.16, 1.115, 0); body.add(cap);
  both(function (s) { body.add(ellipsoid(seatMat, 0.10, 0.93, 0.172 * s, 0.16, 0.07, 0.018)); });
  body.add(ellipsoid(seatMat, -0.34, 0.985, 0, 0.34, 0.055, 0.15));
  var tail = ellipsoid(paintMat, -0.80, 1.0, 0, 0.30, 0.075, 0.12); tail.rotation.z = 0.10; body.add(tail);
  body.add(place(new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.035, 0.12), tailMat), -1.09, 0.985, 0));
  body.add(beam([-0.84, 0.93, 0], [-1.02, 0.70, 0], 0.03, 0.05, darkMat));
  body.add(place(new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.1, 0.19), darkMat), -1.03, 0.65, 0));

  var fender = new THREE.Mesh(new THREE.CylinderGeometry(0.43, 0.43, 0.13, 44, 1, true, Math.PI * 0.6, 1.95), paintMatDS);
  fender.geometry.rotateX(Math.PI / 2);
  fender.position.set(FA[0], FA[1], 0);
  body.add(fender);
  both(function (s) { body.add(tube([0.44, 0.72, 0.06 * s], [0.55, 0.72, 0.095 * s], 0.008, frameMat)); });

  // Headlight and tail-light glow
  function glowTexture() {
    var c = document.createElement('canvas'); c.width = c.height = 128;
    var x = c.getContext('2d');
    var g = x.createRadialGradient(64, 64, 0, 64, 64, 64);
    g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.25, 'rgba(255,255,255,.35)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = g; x.fillRect(0, 0, 128, 128);
    return new THREE.CanvasTexture(c);
  }
  var glowTex = glowTexture();
  var headGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: 0xfff0c0, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, opacity: 0.6 }));
  headGlow.scale.set(0.55, 0.55, 1); headGlow.position.set(0.65, 0.985, 0); body.add(headGlow);
  var tailGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: 0xff2a18, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, opacity: 0.6 }));
  tailGlow.scale.set(0.3, 0.3, 1); tailGlow.position.set(-1.13, 0.985, 0); body.add(tailGlow);

  bike.traverse(function (o) { if (o.isMesh) o.castShadow = true; });

  /* ---------- Live paint / wheel / lights ---------- */
  var paintCol = new THREE.Color(PAINTS.petrol.hex), paintTarget = new THREE.Color(PAINTS.petrol.hex);
  var wheelCol = new THREE.Color(WHEELS.black.hex), wheelTarget = new THREE.Color(WHEELS.black.hex);
  var wheelMetal = WHEELS.black.metal, wheelRough = WHEELS.black.rough;
  api.setPaint = function () { paintTarget.setHex(PAINTS[state.paint].hex); };
  api.setWheels = function () { wheelTarget.setHex(WHEELS[state.wheels].hex); };

  /* ---------------------------------------------------------
     Camera rig driven by scroll
  --------------------------------------------------------- */
  var keys = Array.prototype.map.call(document.querySelectorAll('[data-cam]'), function (el) {
    var p = nums(el.dataset.cam), t = nums(el.dataset.target);
    return {
      el: el, pos: V(p[0], p[1], p[2]), tgt: V(t[0], t[1], t[2]),
      shift: parseFloat(el.dataset.shift || 0), body: parseFloat(el.dataset.body || 1),
      fit: parseFloat(el.dataset.fit || 0.7), mode: el.dataset.mode || ''
    };
  });

  var W = 1, H = 1, narrow = false;
  function resize() {
    W = window.innerWidth; H = window.innerHeight;
    narrow = W < 860;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(W, H, false);
    camera.aspect = W / H;
    camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', resize);
  resize();

  function sample() {
    var ref = H * 0.55, idx = 0, i;
    for (i = 0; i < keys.length; i++) {
      if (keys[i].el.getBoundingClientRect().top <= ref) idx = i;
    }
    var r = keys[idx].el.getBoundingClientRect();
    var t = clamp((ref - r.top) / r.height, 0, 1);
    var next = Math.min(idx + 1, keys.length - 1);
    var k = idx === next ? 0 : smooth(clamp((t - 0.45) / 0.55, 0, 1));
    return { i: idx, j: next, k: k };
  }

  var camPos = keys[0].pos.clone(), camTgt = keys[0].tgt.clone();
  var curSX = 0, curSY = 0, curBody = 1, inited = false;
  var desPos = V(0, 0, 0), desTgt = V(0, 0, 0);

  /* ---------- Turntable, dragging, view buttons ---------- */
  var rotY = 0, rotVel = 0, goal = null, turntable = !reduce, dragging = false, lastInteract = 0;
  var buildKey = keys[keys.length - 1];
  var camAz = Math.atan2(buildKey.pos.z - buildKey.tgt.z, buildKey.pos.x - buildKey.tgt.x);
  var VIEW_ANGLES = { front: -camAz, right: Math.PI / 2 - camAz, rear: Math.PI - camAz, left: -Math.PI / 2 - camAz };

  document.querySelectorAll('#views button').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var v = btn.dataset.view;
      lastInteract = performance.now();
      if (v === 'turn') { turntable = true; goal = null; }
      else { turntable = false; goal = VIEW_ANGLES[v]; }
    });
  });

  document.querySelectorAll('.drag').forEach(function (el) {
    var pid = null, lastX = 0;
    el.addEventListener('pointerdown', function (e) {
      pid = e.pointerId; lastX = e.clientX; dragging = true; goal = null; turntable = false; rotVel = 0;
      try { el.setPointerCapture(pid); } catch (err) {}
      el.classList.add('grabbing');
    });
    el.addEventListener('pointermove', function (e) {
      if (!dragging || e.pointerId !== pid) return;
      var dx = e.clientX - lastX; lastX = e.clientX;
      rotY += dx * 0.009; rotVel = dx * 0.009 * 0.6;
      lastInteract = performance.now();
    });
    var end = function (e) {
      if (e.pointerId !== pid) return;
      dragging = false; pid = null; lastInteract = performance.now();
      el.classList.remove('grabbing');
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
    el.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowLeft') { rotY -= 0.18; goal = null; turntable = false; lastInteract = performance.now(); e.preventDefault(); }
      if (e.key === 'ArrowRight') { rotY += 0.18; goal = null; turntable = false; lastInteract = performance.now(); e.preventDefault(); }
    });
  });

  /* ---------- Frame loop ---------- */
  var last = performance.now(), lastY = window.scrollY, scrollVel = 0, wheelAngle = 0, lightLevel = 1, revealed = false;

  function frame(now) {
    requestAnimationFrame(frame);
    var dt = Math.min(0.05, (now - last) / 1000 || 0.016);
    last = now;

    var sy = window.scrollY;
    scrollVel = lerp(scrollVel, (sy - lastY) / Math.max(dt, 0.001), 1 - Math.exp(-dt * 8));
    lastY = sy;

    // Camera keyframes
    var s = sample(), A = keys[s.i], B = keys[s.j], k = s.k;
    desTgt.lerpVectors(A.tgt, B.tgt, k);
    desPos.lerpVectors(A.pos, B.pos, k);
    var fit = lerp(A.fit, B.fit, k);
    var scale = 1 + Math.max(0, 1 / camera.aspect - 1) * fit;
    desPos.sub(desTgt).multiplyScalar(scale).add(desTgt);
    var dsx = narrow ? 0 : lerp(A.shift, B.shift, k);
    var dsy = narrow ? 0.2 : 0;
    var desBody = lerp(A.body, B.body, k);
    var mode = (k > 0.5 ? B : A).mode;

    var f = inited ? 1 - Math.exp(-dt * (reduce ? 12 : 4.5)) : 1;
    inited = true;
    camPos.lerp(desPos, f);
    camTgt.lerp(desTgt, f);
    curSX += (dsx - curSX) * f;
    curSY += (dsy - curSY) * f;
    curBody += (desBody - curBody) * f;

    camera.position.copy(camPos);
    camera.lookAt(camTgt);
    camera.setViewOffset(W, H, -curSX * W, curSY * H, W, H);

    // Turntable / drag inertia / return to rest
    if (mode !== 'free') goal = null;
    if (!dragging) {
      rotY += rotVel; rotVel *= Math.pow(0.02, dt);
      if (goal !== null) {
        var d = ((goal - rotY + Math.PI) % TAU + TAU) % TAU - Math.PI;
        rotY += d * (1 - Math.exp(-dt * 5));
      } else if (mode === 'free') {
        if (turntable) rotY += dt * 0.35;
      } else if (now - lastInteract > 1400) {
        var rest = Math.round(rotY / TAU) * TAU;
        rotY += (rest - rotY) * (1 - Math.exp(-dt * 3));
      }
    }
    bike.rotation.y = rotY;

    // Wheels turn with the slider and with scrolling
    var omega = (state.speed / 200) * 22 + clamp(scrollVel * 0.02, -30, 30);
    wheelAngle -= omega * dt;
    front.spin.rotation.z = wheelAngle;
    rear.spin.rotation.z = wheelAngle;

    // Paint, wheel finish, body fade, lights
    var pf = 1 - Math.exp(-dt * 7);
    paintCol.lerp(paintTarget, pf);
    wheelCol.lerp(wheelTarget, pf);
    var wt = WHEELS[state.wheels];
    wheelMetal += (wt.metal - wheelMetal) * pf; wheelRough += (wt.rough - wheelRough) * pf;
    wheelMat.color.copy(wheelCol); wheelMat.metalness = wheelMetal; wheelMat.roughness = wheelRough;
    paintMats.forEach(function (m) {
      m.color.copy(paintCol); m.opacity = curBody; m.depthWrite = curBody > 0.98;
    });
    seatMat.opacity = curBody; seatMat.depthWrite = curBody > 0.98;

    lightLevel += ((state.lights ? 1 : 0) - lightLevel) * (1 - Math.exp(-dt * 8));
    lensMat.emissiveIntensity = lerp(0.0, 2.4, lightLevel);
    tailMat.emissiveIntensity = lerp(0.1, 1.6, lightLevel);
    headGlow.material.opacity = 0.6 * lightLevel;
    tailGlow.material.opacity = 0.6 * lightLevel;

    renderer.render(scene, camera);
    if (!revealed) { revealed = true; root.classList.add('ready'); }
  }
  requestAnimationFrame(frame);
})();
