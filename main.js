const BG = 0x080808;
const LINE = 0xebe7da;

const canvas = document.getElementById("scene");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
const PIXEL_RATIO = Math.min(window.devicePixelRatio, 2);
renderer.setPixelRatio(PIXEL_RATIO);
renderer.setSize(window.innerWidth, window.innerHeight);

// --- Post-processing: fisheye / barrel distortion ---
// The scene is rendered into a texture, then drawn to the screen through a
// shader that warps the image outward from the center for a slight lens bulge.
const FISHEYE = 0.4; // distortion strength

const rt = new THREE.WebGLRenderTarget(
	window.innerWidth * PIXEL_RATIO,
	window.innerHeight * PIXEL_RATIO,
);

const postScene = new THREE.Scene();
const postCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
const fisheyeMat = new THREE.ShaderMaterial({
	uniforms: {
		tDiffuse: { value: rt.texture },
		strength: { value: FISHEYE },
		aspect: { value: window.innerWidth / window.innerHeight },
	},
	vertexShader: `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = vec4(position, 1.0);
    }
  `,
	fragmentShader: `
    varying vec2 vUv;
    uniform sampler2D tDiffuse;
    uniform float strength;
    uniform float aspect;
    void main() {
      // Distance from center, aspect-corrected so the bulge stays circular
      vec2 c = vUv - 0.5;
      c.x *= aspect;
      float r2 = dot(c, c);
      vec2 uv = vUv + (vUv - 0.5) * r2 * strength;
      gl_FragColor = texture2D(tDiffuse, uv);
    }
  `,
});
postScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), fisheyeMat));

const scene = new THREE.Scene();
scene.background = new THREE.Color(BG);
scene.fog = new THREE.Fog(BG, 12, 38);

// Room dimensions
const roomW = 16; // width  (x)
const roomH = 12; // height (y)
const roomD = 20; // depth  (z)

// One-point perspective: camera on the central axis, looking straight
// down -z at the center of the back wall. The single vanishing point
// sits dead center, right behind the globe.
const camera = new THREE.PerspectiveCamera(
	55,
	window.innerWidth / window.innerHeight,
	0.1,
	100,
);
camera.position.set(0, 0, roomD / 2);
camera.lookAt(0, 0, 0);

// Wall lines (faint, transparent so the room recedes)
const lineMat = new THREE.LineBasicMaterial({
	color: LINE,
	transparent: true,
	opacity: 0.85,
});

// Globe lines: dashed, occluded by the solid sphere behind them, and
// fading out as they approach the silhouette (where the surface faces away
// from the camera). The fade is injected into the dashed-line shader.
const globeMat = new THREE.LineDashedMaterial({
	color: LINE,
	dashSize: 0.1,
	gapSize: 0.08,
	transparent: true,
});
globeMat.onBeforeCompile = (shader) => {
	shader.vertexShader = shader.vertexShader
		.replace("#include <common>", "#include <common>\nvarying float vFront;")
		.replace(
			"#include <begin_vertex>",
			`#include <begin_vertex>
      vec3 vN = normalize(normalMatrix * normalize(position));
      vec4 mvp = modelViewMatrix * vec4(position, 1.0);
      vFront = dot(vN, normalize(-mvp.xyz));`,
		);
	shader.fragmentShader = shader.fragmentShader
		.replace("#include <common>", "#include <common>\nvarying float vFront;")
		.replace(
			"vec4 diffuseColor = vec4( diffuse, opacity );",
			"vec4 diffuseColor = vec4( diffuse, opacity * smoothstep(0.0, 0.5, vFront) );",
		);
};

// --- The room: five wireframe walls (front left open) ---
const room = new THREE.Group();

// A grid spanning 1×1, 12 divisions — scaled/oriented per wall.
function wall(opacity) {
	const g = new THREE.GridHelper(1, 12, LINE, LINE);
	g.material.transparent = true;
	g.material.opacity = opacity;
	return g;
}

// Floor
const floor = wall(0.28);
floor.scale.set(roomW, 1, roomD);
floor.position.y = -roomH / 2;
room.add(floor);

// Ceiling
const ceil = wall(0.12);
ceil.scale.set(roomW, 1, roomD);
ceil.position.y = roomH / 2;
room.add(ceil);

// Back wall (x = width, local z -> world height)
const back = wall(0.22);
back.rotation.x = Math.PI / 2;
back.scale.set(roomW, 1, roomH);
back.position.z = -roomD / 2;
room.add(back);

// Left wall (local x -> height, local z -> depth)
const left = wall(0.18);
left.rotation.z = Math.PI / 2;
left.scale.set(roomH, 1, roomD);
left.position.x = -roomW / 2;
room.add(left);

// Right wall
const right = wall(0.18);
right.rotation.z = Math.PI / 2;
right.scale.set(roomH, 1, roomD);
right.position.x = roomW / 2;
room.add(right);

scene.add(room);

// --- The globe: vertical lines only (meridians), solid-looking ---
const globe = new THREE.Group();

const RADIUS = 2.4;
const MERIDIANS = 16; // number of vertical lines
const SEGMENTS = 48; // smoothness of each line

// Opaque sphere in the background color, just inside the wireframe.
// It writes depth, so meridian lines on the far side get hidden —
// only the near-side lines show, like a real globe.
const occluder = new THREE.Mesh(
	new THREE.SphereGeometry(RADIUS * 0.99, 48, 32),
	new THREE.MeshBasicMaterial({ color: BG }),
);
globe.add(occluder);

// Meridians (vertical lines, pole to pole)
for (let m = 0; m < MERIDIANS; m++) {
	const lon = (m / MERIDIANS) * Math.PI * 2;
	const pts = [];
	for (let s = 0; s <= SEGMENTS; s++) {
		// sweep from north pole to south pole
		const lat = (s / SEGMENTS) * Math.PI - Math.PI / 2;
		const y = Math.sin(lat) * RADIUS;
		const r = Math.cos(lat) * RADIUS;
		pts.push(new THREE.Vector3(Math.cos(lon) * r, y, Math.sin(lon) * r));
	}
	const geo = new THREE.BufferGeometry().setFromPoints(pts);
	const line = new THREE.Line(geo, globeMat);
	line.computeLineDistances(); // required for dashes
	globe.add(line);
}

// Parallels (horizontal lines / latitudes), a few like a real globe
const PARALLELS = 5; // excludes the poles
for (let p = 1; p <= PARALLELS; p++) {
	const lat = (p / (PARALLELS + 1)) * Math.PI - Math.PI / 2;
	const y = Math.sin(lat) * RADIUS;
	const r = Math.cos(lat) * RADIUS;
	const pts = [];
	for (let s = 0; s <= SEGMENTS; s++) {
		const a = (s / SEGMENTS) * Math.PI * 2;
		pts.push(new THREE.Vector3(Math.cos(a) * r, y, Math.sin(a) * r));
	}
	const geo = new THREE.BufferGeometry().setFromPoints(pts);
	const line = new THREE.Line(geo, globeMat);
	line.computeLineDistances(); // required for dashes
	globe.add(line);
}

scene.add(globe);

// Circumference: a bold ring at the sphere's true silhouette, cell-shaded.
// Under perspective the visible edge of a sphere is a circle slightly
// smaller than the radius and pushed toward the camera, so we size and
// place the ring to match exactly — otherwise the front-bulging meridians
// project outside a flat center circle.
const d = camera.position.z; // camera distance
const silhR = (RADIUS * Math.sqrt(d * d - RADIUS * RADIUS)) / d; // silhouette radius
const silhZ = (RADIUS * RADIUS) / d; // silhouette plane (toward camera)

const ring = new THREE.Mesh(
	new THREE.RingGeometry(silhR, silhR + 0.045, 128),
	new THREE.MeshBasicMaterial({
		color: LINE,
		side: THREE.DoubleSide,
		depthTest: false,
	}),
);
ring.position.z = silhZ;
ring.renderOrder = 999;
scene.add(ring);

// --- Animation ---
const start = performance.now();
let last = start;

// Globe entrance: gentle scale-up, eased, distinct from the scene's fade
const INTRO_DELAY = 0.4; // let the room appear first
const INTRO_DUR = 1.6; // seconds
const easeOut = (t) => 1 - Math.pow(1 - t, 3);

function animate(now) {
	const dt = (now - last) / 1000;
	last = now;

	// Globe rotation
	globe.rotation.y += dt * 1.4;

	// Scale the globe (and its circumference) in once, easing toward full size
	const elapsed = (now - start) / 1000 - INTRO_DELAY;
	const t = Math.min(Math.max(elapsed / INTRO_DUR, 0), 1);
	const s = 0.9 + 0.1 * easeOut(t);
	globe.scale.setScalar(s);
	ring.scale.setScalar(s);

	// Render the scene into the off-screen target, then to the screen through
	// the fisheye shader.
	renderer.setRenderTarget(rt);
	renderer.render(scene, camera);
	renderer.setRenderTarget(null);
	renderer.render(postScene, postCamera);

	requestAnimationFrame(animate);
}
requestAnimationFrame(animate);

// --- Responsive ---
window.addEventListener("resize", () => {
	const w = window.innerWidth;
	const h = window.innerHeight;
	camera.aspect = w / h;
	camera.updateProjectionMatrix();
	renderer.setSize(w, h);
	rt.setSize(w * PIXEL_RATIO, h * PIXEL_RATIO);
	fisheyeMat.uniforms.aspect.value = w / h;
});
