import { initGL } from "./gl.js";

document.addEventListener("DOMContentLoaded", () => {
  // -- WebGL background --
  const canvas = document.getElementById("gl-canvas");
  if (canvas) initGL(canvas);

  // -- Scroll fade-in --
  const targets = document.querySelectorAll(".fade-in");
  if ("IntersectionObserver" in window) {
    const obs = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) {
            e.target.classList.add("visible");
            obs.unobserve(e.target);
          }
        });
      },
      { threshold: 0.15 }
    );
    targets.forEach((t) => obs.observe(t));
  } else {
    targets.forEach((t) => t.classList.add("visible"));
  }
});
