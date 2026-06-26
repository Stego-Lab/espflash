// Heltec Wireless Paper – Projektseite: Scroll-Reveal + Lightbox

// ── Scroll-Reveal: Elemente faden beim Hereinscrollen ein ──────────────────
const revealEls = document.querySelectorAll(".reveal");
if ("IntersectionObserver" in window && revealEls.length) {
  const io = new IntersectionObserver(
    (entries) => {
      entries.forEach((e) => {
        if (e.isIntersecting) {
          e.target.classList.add("visible");
          io.unobserve(e.target);
        }
      });
    },
    { threshold: 0.12 }
  );
  revealEls.forEach((el) => io.observe(el));
} else {
  // Fallback: alles sofort sichtbar
  revealEls.forEach((el) => el.classList.add("visible"));
}

// ── Lightbox: Galerie-Foto groß anzeigen ───────────────────────────────────
const lb = document.getElementById("lightbox");
if (lb) {
  const lbImg = lb.querySelector("img");
  const open = (src, alt) => {
    lbImg.src = src;
    lbImg.alt = alt || "";
    lb.classList.add("open");
    document.body.style.overflow = "hidden";
  };
  const close = () => {
    lb.classList.remove("open");
    document.body.style.overflow = "";
  };

  document.querySelectorAll("[data-full]").forEach((el) => {
    el.addEventListener("click", () => {
      const img = el.querySelector("img");
      open(el.dataset.full, img ? img.alt : "");
    });
  });

  lb.addEventListener("click", close);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") close();
  });
}
