/* Mouvement et finitions — purement décoratif.
   Aucune logique d'envoi, de galerie ou d'administration ici : ce fichier ne lit ni ne modifie de données.
   Sans JavaScript, ou si l'utilisateur demande moins d'animations, la page reste complète et immobile.
   Classique (non module) et chargé dans <head> pour poser la classe « motion » avant le premier affichage. */
(() => {
  "use strict";
  const root = document.documentElement;
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  root.classList.add("motion");

  let ready = false;
  const setReady = () => {
    if (ready) return;
    ready = true;
    root.classList.add("is-ready");
  };
  // Filet de sécurité : rien ne doit rester caché si une étape échoue.
  setTimeout(setReady, 2500);

  const $$ = (selector, scope = document) => [...scope.querySelectorAll(selector)];

  /* Chaque mot est placé dans un masque pour pouvoir « se lever » ; le texte reste identique (mêmes espaces). */
  const splitWords = (element, base = 0) => {
    if (!element || element.dataset.split) return;
    element.dataset.split = "1";
    let index = 0;
    const walk = (node) => {
      [...node.childNodes].forEach((child) => {
        if (child.nodeType === 3) {
          const fragment = document.createDocumentFragment();
          child.textContent.split(/(\s+)/).forEach((part) => {
            if (!part) return;
            if (/^\s+$/.test(part)) {
              fragment.append(document.createTextNode(part));
              return;
            }
            const mask = document.createElement("span");
            mask.className = "mask";
            const word = document.createElement("span");
            word.className = "word";
            word.textContent = part;
            word.style.transitionDelay = `${base + index++ * 80}ms`;
            mask.append(word);
            fragment.append(mask);
          });
          child.replaceWith(fragment);
        } else if (child.nodeType === 1 && child.tagName !== "BR") {
          walk(child);
        }
      });
    };
    walk(element);
  };

  const revealOnView = (elements, options = {}) => {
    if (!("IntersectionObserver" in window)) {
      elements.forEach((element) => element.classList.add("in"));
      return;
    }
    const observer = new IntersectionObserver(
      (entries) =>
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          entry.target.classList.add("in");
          observer.unobserve(entry.target);
        }),
      { threshold: options.threshold ?? 0.18, rootMargin: "0px 0px -6% 0px" },
    );
    elements.forEach((element) => observer.observe(element));
  };

  const init = () => {
    // 1. Titres : les mots se lèvent. Ceux de l'accueil attendent la fin du chargement.
    [
      ["#names", 150],
      [".hero h1", 650],
      ["#couple-memories-title", 0],
      ["#gallery-title", 0],
      ["#share-title", 0],
      [".choose-step > h2", 0],
      [".site-footer p", 0],
    ].forEach(([selector, base]) => $$(selector).forEach((element) => splitWords(element, base)));
    revealOnView($$("#couple-memories-title, #gallery-title, #share-title, .choose-step > h2, .site-footer p"), {
      threshold: 0.4,
    });

    // 2. Blocs qui apparaissent en défilant.
    const blocks = $$(
      ".memories-note, .section-heading .eyebrow, .share-section .eyebrow, .lead, .advice, .destination-card, .site-footer > span, #refresh, .memories-heading > span",
    );
    blocks.forEach((block, i) => {
      block.classList.add("reveal");
      block.style.transitionDelay = `${(i % 3) * 90}ms`;
      // Le décalage ne sert qu'à l'apparition : il ne doit pas retarder les survols ensuite.
      block.addEventListener("transitionend", () => (block.style.transitionDelay = ""), { once: true });
    });
    revealOnView(blocks, { threshold: 0.2 });

    // 3. Parallaxe : seule une variable CSS change, la mise en page ne bouge pas.
    const parallax = [
      [".hero-portrait", 0.07],
      [".hero-content", -0.035],
      ...$$(".polaroid").map((_, i) => [`.polaroid:nth-child(${i + 1})`, i % 2 ? -0.05 : 0.07]),
    ]
      .map(([selector, speed]) => ({ element: document.querySelector(selector), speed }))
      .filter((item) => item.element);
    const visible = new Set();
    if ("IntersectionObserver" in window) {
      const watcher = new IntersectionObserver((entries) =>
        entries.forEach((entry) => (entry.isIntersecting ? visible.add(entry.target) : visible.delete(entry.target))),
        { rootMargin: "20% 0px" },
      );
      parallax.forEach((item) => watcher.observe(item.element));
    } else parallax.forEach((item) => visible.add(item.element));

    const progress = document.createElement("div");
    progress.className = "page-progress";
    progress.setAttribute("aria-hidden", "true");
    document.body.append(progress);

    let frame = 0;
    const update = () => {
      frame = 0;
      const view = innerHeight;
      parallax.forEach(({ element, speed }) => {
        if (!visible.has(element)) return;
        const rect = element.getBoundingClientRect();
        const offset = rect.top + rect.height / 2 - view / 2;
        // L'offset déjà appliqué est retiré pour ne pas s'auto-entretenir.
        const applied = parseFloat(element.style.getPropertyValue("--py")) || 0;
        const base = offset - applied;
        const next = Math.max(-34, Math.min(34, base * speed * -1));
        element.style.setProperty("--py", `${next.toFixed(1)}px`);
      });
      const total = document.documentElement.scrollHeight - view;
      progress.style.transform = `scaleX(${total > 0 ? Math.min(1, scrollY / total) : 0})`;
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    addEventListener("scroll", schedule, { passive: true });
    addEventListener("resize", schedule, { passive: true });
    update();

    // 4. Galerie des invités : chaque photo se dévoile une seule fois, même si la liste est reconstruite.
    const gallery = document.getElementById("gallery");
    if (gallery) {
      const seen = new Set();
      const cardObserver = "IntersectionObserver" in window
        ? new IntersectionObserver(
            (entries) =>
              entries.forEach((entry) => {
                if (!entry.isIntersecting) return;
                entry.target.classList.add("in");
                cardObserver.unobserve(entry.target);
              }),
            { threshold: 0.12 },
          )
        : null;
      const prepare = () => {
        let batch = 0;
        $$(".photo-card:not([data-rv])", gallery).forEach((card) => {
          card.dataset.rv = "1";
          card.classList.add("rv");
          const id = card.dataset.photoId;
          if (id && seen.has(id)) {
            card.classList.add("in", "no-delay");
            return;
          }
          if (id) seen.add(id);
          card.style.setProperty("--rv-delay", `${(batch++ % 9) * 70}ms`);
          if (cardObserver) cardObserver.observe(card);
          else card.classList.add("in");
        });
      };
      new MutationObserver(prepare).observe(gallery, { childList: true });
      prepare();
    }

    // 5. Souris : anneau suiveur et boutons aimantés (écrans à pointeur précis uniquement).
    if (matchMedia("(hover: hover) and (pointer: fine)").matches) {
      const ring = document.createElement("div");
      ring.className = "cursor-ring";
      ring.setAttribute("aria-hidden", "true");
      document.body.append(ring);
      let x = innerWidth / 2, y = innerHeight / 2, tx = x, ty = y, shown = false, running = false;
      const follow = () => {
        x += (tx - x) * 0.2;
        y += (ty - y) * 0.2;
        ring.style.transform = `translate3d(${x - 20}px, ${y - 20}px, 0)`;
        if (Math.abs(tx - x) + Math.abs(ty - y) > 0.3) requestAnimationFrame(follow);
        else running = false;
      };
      addEventListener("pointermove", (event) => {
        tx = event.clientX;
        ty = event.clientY;
        if (!shown) {
          shown = true;
          x = tx;
          y = ty;
          ring.classList.add("is-visible");
        }
        if (!running) {
          running = true;
          requestAnimationFrame(follow);
        }
        const target = event.target instanceof Element ? event.target.closest("a, button, .photo-card, .destination-card") : null;
        ring.classList.toggle("is-active", Boolean(target));
      }, { passive: true });
      document.addEventListener("pointerleave", () => ring.classList.remove("is-visible"));
      $$(".hero-actions .button").forEach((button) => {
        button.addEventListener("pointermove", (event) => {
          const rect = button.getBoundingClientRect();
          const dx = (event.clientX - (rect.left + rect.width / 2)) / rect.width;
          const dy = (event.clientY - (rect.top + rect.height / 2)) / rect.height;
          button.style.setProperty("--mx", `${(dx * 10).toFixed(1)}px`);
          button.style.setProperty("--my", `${(dy * 8).toFixed(1)}px`);
        });
        button.addEventListener("pointerleave", () => {
          button.style.setProperty("--mx", "0px");
          button.style.setProperty("--my", "0px");
        });
      });
    }

    // 6. Départ de la séquence d'ouverture une fois les polices prêtes.
    const go = () => requestAnimationFrame(() => setTimeout(setReady, 120));
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(go, go);
    else go();
  };

  const run = () => {
    try {
      init();
    } catch {
      // Si une étape décorative échoue, la page reste utilisable : on libère les éléments cachés.
      setReady();
    }
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", run, { once: true });
  else run();
})();
