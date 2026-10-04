/** A small local carousel: one visible slide, touch/drag navigation and pausable rotation. */
export function createHeroCarousel({ branches, icon, escape }) {
  const root = document.querySelector('#hero-carousel');
  const stage = root.querySelector('.hero-slides');
  for (const [index, branch] of branches.entries()) {
    const slide = document.createElement('article');
    slide.className = `hero-slide hero-slide-branch hero-slide-${branch.id}`;
    slide.id = `hero-slide-${index + 1}`;
    slide.hidden = true;
    slide.inert = true;
    slide.setAttribute('role', 'group');
    slide.setAttribute('aria-roledescription', 'snímek');
    slide.setAttribute('aria-label', `${index + 2} ze 4: ${branch.name}`);
    slide.innerHTML = `<img class="hero-slide-photo" src="./${escape(branch.image)}" alt="" draggable="false" decoding="async"><div class="hero-slide-shade"></div><div class="container hero-slide-inner"><div class="hero-slide-copy"><p class="eyebrow">${icon('pin')} Tvoje pizza v sousedství</p><h2>Pizza Visi <em>${escape(branch.name)}</em></h2><p class="hero-slide-description">${escape(branch.address)}<br>Pečeme pondělí–sobota, 11:00–21:00</p><a class="button" href="#pobocka-${branch.id}">O pobočce ${icon('arrow')}</a></div></div>`;
    stage.append(slide);
  }
  const slides = [...stage.children];
  const dots = [...root.querySelectorAll('[data-hero-slide]')];
  const rotation = root.querySelector('[data-hero-rotation]');
  const counter = root.querySelector('.hero-slide-count');
  const status = root.querySelector('.hero-slide-status');
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  let index = 0;
  let paused = motion.matches;
  let inView = false;
  let hovering = false;
  let timer;
  let animations = [];
  let pointer = null;
  let suppressClick = false;

  function syncRotation() {
    clearTimeout(timer);
    rotation.setAttribute('aria-label', paused ? 'Spustit střídání snímků' : 'Pozastavit střídání snímků');
    rotation.title = rotation.getAttribute('aria-label');
    rotation.innerHTML = icon(paused ? 'play' : 'pause');
    if (!paused && inView && !hovering && !document.hidden && !root.closest('[hidden]') && !document.querySelector('dialog[open]')) {
      timer = setTimeout(() => show(index + 1, 1, false), 5500);
    }
  }
  function show(next, direction = 1, manual = true) {
    const previous = index;
    index = (next + slides.length) % slides.length;
    if (manual) paused = true;
    animations.forEach(animation => animation.cancel());
    animations = [];
    slides.forEach((slide, i) => {
      slide.hidden = i !== index;
      slide.inert = i !== index;
      slide.setAttribute('aria-hidden', String(i !== index));
    });
    dots.forEach((dot, i) => dot.setAttribute('aria-current', String(i === index)));
    counter.textContent = `${String(index + 1).padStart(2, '0')} / 04`;
    if (manual) status.textContent = slides[index].getAttribute('aria-label');
    if (previous !== index && !motion.matches) {
      const outgoing = slides[previous];
      outgoing.hidden = false;
      const timing = { duration: 460, easing: 'cubic-bezier(.22,.68,.2,1)', fill: 'both' };
      const leave = outgoing.animate([{ transform: 'translateX(0)' }, { transform: `translateX(${-direction * 100}%)` }], timing);
      const enter = slides[index].animate([{ transform: `translateX(${direction * 100}%)` }, { transform: 'translateX(0)' }], timing);
      animations = [leave, enter];
      leave.onfinish = () => { outgoing.hidden = true; leave.cancel(); enter.cancel(); animations = []; };
    }
    syncRotation();
  }
  root.addEventListener('click', event => {
    if (suppressClick) { event.preventDefault(); event.stopPropagation(); suppressClick = false; return; }
    const button = event.target.closest('button');
    if (!button) return;
    if (button.hasAttribute('data-hero-next')) show(index + 1, 1);
    if (button.hasAttribute('data-hero-prev')) show(index - 1, -1);
    if (button.hasAttribute('data-hero-slide')) {
      const next = Number(button.dataset.heroSlide);
      show(next, next < index ? -1 : 1);
    }
    if (button.hasAttribute('data-hero-rotation')) { paused = !paused; syncRotation(); }
  }, true);
  root.addEventListener('keydown', event => {
    if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
    event.preventDefault();
    show(index + (event.key === 'ArrowRight' ? 1 : -1), event.key === 'ArrowRight' ? 1 : -1);
  });
  root.addEventListener('focusin', event => {
    // The rotation button itself remains usable without focus resetting its state.
    if (!event.target.closest('[data-hero-rotation]')) { paused = true; syncRotation(); }
  });
  root.addEventListener('pointerenter', event => { if (event.pointerType === 'mouse') { hovering = true; syncRotation(); } });
  root.addEventListener('pointerleave', () => { hovering = false; syncRotation(); });
  stage.addEventListener('pointerdown', event => {
    if (!event.isPrimary || event.button !== 0 || event.target.closest('a,button')) return;
    pointer = { id: event.pointerId, x: event.clientX, y: event.clientY, captured: false };
    clearTimeout(timer);
  });
  stage.addEventListener('pointermove', event => {
    if (!pointer || pointer.id !== event.pointerId) return;
    const dx = event.clientX - pointer.x, dy = event.clientY - pointer.y;
    if (!pointer.captured && Math.abs(dx) > 12 && Math.abs(dx) > Math.abs(dy) * 1.3) {
      stage.setPointerCapture(event.pointerId);
      pointer.captured = true;
    }
  });
  stage.addEventListener('pointerup', event => {
    if (!pointer || pointer.id !== event.pointerId) return;
    const dx = event.clientX - pointer.x, dy = event.clientY - pointer.y;
    if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy) * 1.3) {
      suppressClick = true;
      show(index + (dx < 0 ? 1 : -1), dx < 0 ? 1 : -1);
      setTimeout(() => { suppressClick = false; }, 0);
    } else syncRotation();
    pointer = null;
  });
  stage.addEventListener('pointercancel', () => { pointer = null; syncRotation(); });
  document.addEventListener('visibilitychange', syncRotation);
  motion.addEventListener('change', () => { if (motion.matches) paused = true; show(index, 1, false); });
  new IntersectionObserver(entries => { inView = entries[0].intersectionRatio >= .25; syncRotation(); }, { threshold: .25 }).observe(root);
  new MutationObserver(syncRotation).observe(document.body, { subtree: true, attributes: true, attributeFilter: ['open', 'hidden'] });
  syncRotation();
}
