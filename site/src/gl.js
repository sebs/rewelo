/**
 * WebGL background — animated noise gradient.
 *
 * A full-screen fragment shader that blends organic Simplex-style noise
 * with a slow colour drift. The effect is subtle and sits behind the
 * content layer, giving the page depth without distraction.
 */

const VERT = `#version 300 es
precision mediump float;
in vec2 a_pos;
void main() {
  gl_Position = vec4(a_pos, 0.0, 1.0);
}`;

const FRAG = `#version 300 es
precision mediump float;

uniform float u_time;
uniform vec2  u_resolution;
uniform float u_scroll;

out vec4 fragColor;

// --- Simplex-ish 2D noise (hash-based, no texture lookup) ---
vec3 mod289(vec3 x) { return x - floor(x / 289.0) * 289.0; }
vec2 mod289(vec2 x) { return x - floor(x / 289.0) * 289.0; }
vec3 permute(vec3 x) { return mod289((x * 34.0 + 1.0) * x); }

float snoise(vec2 v) {
  const vec4 C = vec4(
    0.211324865405187,   // (3-sqrt(3))/6
    0.366025403784439,   // 0.5*(sqrt(3)-1)
   -0.577350269189626,   // -1 + 2*C.x
    0.024390243902439    // 1/41
  );
  vec2 i = floor(v + dot(v, C.yy));
  vec2 x0 = v - i + dot(i, C.xx);
  vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
  vec4 x12 = x0.xyxy + C.xxzz;
  x12.xy -= i1;
  i = mod289(i);
  vec3 p = permute(permute(i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0));
  vec3 m = max(0.5 - vec3(dot(x0,x0), dot(x12.xy,x12.xy), dot(x12.zw,x12.zw)), 0.0);
  m = m * m;
  m = m * m;
  vec3 x_ = 2.0 * fract(p * C.www) - 1.0;
  vec3 h = abs(x_) - 0.5;
  vec3 ox = floor(x_ + 0.5);
  vec3 a0 = x_ - ox;
  m *= 1.79284291400159 - 0.85373472095314 * (a0*a0 + h*h);
  vec3 g;
  g.x = a0.x * x0.x + h.x * x0.y;
  g.yz = a0.yz * x12.xz + h.yz * x12.yw;
  return 130.0 * dot(m, g);
}

// --- FBM (fractal Brownian motion) for richer texture ---
float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  vec2 shift = vec2(100.0);
  mat2 rot = mat2(cos(0.5), sin(0.5), -sin(0.5), cos(0.5));
  for (int i = 0; i < 4; i++) {
    v += a * snoise(p);
    p = rot * p * 2.0 + shift;
    a *= 0.5;
  }
  return v;
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution;
  float aspect = u_resolution.x / u_resolution.y;
  vec2 p = vec2(uv.x * aspect, uv.y);

  float t = u_time * 0.06;
  float scroll = u_scroll * 0.0003;

  // Two noise layers with slow drift
  float n1 = fbm(p * 1.8 + vec2(t * 0.7, scroll + t * 0.3));
  float n2 = fbm(p * 2.5 + vec2(-t * 0.5, scroll - t * 0.4 + 3.0));

  // Colour palette: deep navy → warm gold → dark
  vec3 c1 = vec3(0.04, 0.04, 0.10);  // deep background
  vec3 c2 = vec3(0.12, 0.08, 0.04);  // warm undertone
  vec3 c3 = vec3(0.76, 0.64, 0.35);  // gold accent

  float blend = smoothstep(-0.4, 0.6, n1);
  vec3 col = mix(c1, c2, blend);

  // Gold wisps
  float gold = smoothstep(0.35, 0.65, n2) * 0.12;
  col += c3 * gold;

  // Subtle vignette
  float vig = 1.0 - length((uv - 0.5) * 1.4);
  vig = smoothstep(0.0, 0.7, vig);
  col *= vig * 0.85 + 0.15;

  // Film grain
  float grain = (fract(sin(dot(uv * u_time * 0.01, vec2(12.9898, 78.233))) * 43758.5453) - 0.5) * 0.03;
  col += grain;

  fragColor = vec4(col, 1.0);
}`;

export function initGL(canvas) {
  const gl = canvas.getContext("webgl2", { alpha: false, antialias: false });
  if (!gl) {
    console.warn("WebGL 2 not available — falling back to plain background.");
    canvas.style.display = "none";
    return null;
  }

  // -- Compile shaders --
  function compile(type, src) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      console.error(gl.getShaderInfoLog(s));
      gl.deleteShader(s);
      return null;
    }
    return s;
  }

  const vs = compile(gl.VERTEX_SHADER, VERT);
  const fs = compile(gl.FRAGMENT_SHADER, FRAG);
  const prog = gl.createProgram();
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);

  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    console.error(gl.getProgramInfoLog(prog));
    return null;
  }

  gl.useProgram(prog);

  // -- Full-screen quad --
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, 1,1]), gl.STATIC_DRAW);
  const aPos = gl.getAttribLocation(prog, "a_pos");
  gl.enableVertexAttribArray(aPos);
  gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

  // -- Uniforms --
  const uTime = gl.getUniformLocation(prog, "u_time");
  const uRes  = gl.getUniformLocation(prog, "u_resolution");
  const uScroll = gl.getUniformLocation(prog, "u_scroll");

  let scrollY = 0;
  window.addEventListener("scroll", () => { scrollY = window.scrollY; }, { passive: true });

  function resize() {
    const dpr = Math.min(window.devicePixelRatio, 2);
    canvas.width  = canvas.clientWidth  * dpr;
    canvas.height = canvas.clientHeight * dpr;
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.uniform2f(uRes, canvas.width, canvas.height);
  }

  window.addEventListener("resize", resize);
  resize();

  let startTime = performance.now();
  let raf;

  function frame(now) {
    gl.uniform1f(uTime, (now - startTime) * 0.001);
    gl.uniform1f(uScroll, scrollY);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    raf = requestAnimationFrame(frame);
  }

  raf = requestAnimationFrame(frame);

  return {
    destroy() {
      cancelAnimationFrame(raf);
      gl.deleteProgram(prog);
      gl.deleteShader(vs);
      gl.deleteShader(fs);
      gl.deleteBuffer(buf);
    }
  };
}
