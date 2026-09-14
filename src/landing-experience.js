import './landing-showcase';

(() => {
  const text = (id, value) => { document.getElementById(id).textContent = value; };

  // Reuse Pip's existing artwork. Only the explicit cuddle button animates it.
  const template = document.getElementById('pip-template');
  document.querySelectorAll('[data-pip]').forEach((slot, index) => {
    const svg = template.content.firstElementChild.cloneNode(true);
    const gradient = svg.querySelector('[id="pip-fabric"]');
    gradient.id = `pip-fabric-${index}`;
    svg.querySelector('[fill="url(#pip-fabric)"]').setAttribute('fill', `url(#${gradient.id})`);
    svg.setAttribute('aria-hidden', 'true');
    svg.removeAttribute('role');
    svg.removeAttribute('aria-label');
    slot.replaceChildren(svg);
  });
  const pipButton = document.getElementById('pip-cuddle');
  pipButton.hidden = false;
  document.getElementById('pip-static').hidden = true;
  let cuddleTimer;
  pipButton.addEventListener('click', () => {
    const pip = pipButton.querySelector('svg');
    clearTimeout(cuddleTimer);
    pip.dataset.mood = 'snuggle';
    text('pip-caption', 'A little encouragement goes a long way.');
    cuddleTimer = setTimeout(() => {
      pip.dataset.mood = '';
      text('pip-caption', 'Meet Pip. Tap for a little hello.');
    }, 2400);
  });

  // Keep hosting choices clear of the interactive example and section actions.
  const mobileCta = document.getElementById('mobile-cta');
  if ('IntersectionObserver' in window) {
    let heroVisible = true;
    const activeSections = new Set();
    const updateCta = () => { mobileCta.hidden = heroVisible || activeSections.size > 0; };
    new IntersectionObserver(entries => {
      heroVisible = entries[0].isIntersecting;
      updateCta();
    }).observe(document.getElementById('hero-actions'));
    const actionObserver = new IntersectionObserver(entries => {
      for (const entry of entries) {
        if (entry.isIntersecting) activeSections.add(entry.target);
        else activeSections.delete(entry.target);
      }
      updateCta();
    });
    ['product-preview', 'shared-demo', 'hosting', 'self-hosting', 'community', 'closing'].forEach(id => {
      const section = document.getElementById(id);
      if (section) actionObserver.observe(section);
    });
  }
})();
