function mountWorkshopPets(css, artwork) {
  if (window.codexWorkshop) return;
  const style = document.createElement("style");
  style.textContent = css;
  const panel = document.createElement("div");
  panel.id = "codex-workshop";
  panel.hidden = true;
  panel.setAttribute("role", "group");
  panel.setAttribute("aria-label", "Codex 聊天宠物");
  const template = document.createElement("template");
  template.innerHTML = `
    ${artwork}
    <span class="pet-number" aria-hidden="true"></span>
    <span class="readout"><b></b><span></span></span>
  `;
  document.head.append(style);
  document.body.append(panel);
  const labels = { idle: "等开工", thinking: "想办法中", coding: "正在改文件", done: "改完了" };
  const pets = new Map();
  const clicks = [];
  const hues = [0, 45, -48, 105, -100, 170];

  function place() {
    const composer = [...document.querySelectorAll(
      '.composer-surface-chrome, [data-testid="composer"], [class*="ComposerLayoutRoot-"]'
    )].find(element => element.getBoundingClientRect().width > 200);
    panel.hidden = !composer || !pets.size;
    if (panel.hidden) return false;
    const box = composer.getBoundingClientRect();
    const left = Math.max(8, box.left);
    const available = Math.max(0, Math.min(box.right, innerWidth - 8) - left);
    const width = Math.min(pets.size * 148, available);
    panel.style.left = `${left}px`;
    panel.style.width = `${width}px`;
    panel.style.top = `${Math.max(10, box.top - 115)}px`;
    panel.toggleAttribute("data-overflow", width < pets.size * 64);
    return true;
  }

  function render(items) {
    const active = new Set(items.map(({ id }) => id));
    for (const [id, pet] of pets) {
      if (active.has(id)) continue;
      pet.remove();
      pets.delete(id);
    }
    for (const [position, { id, title, state }] of items.entries()) {
      let pet = pets.get(id);
      if (!pet) {
        pet = document.createElement("button");
        pet.type = "button";
        pet.className = "workshop-pet";
        pet.append(template.content.cloneNode(true));
        const idMap = new Map([...pet.querySelectorAll("svg [id]")].map(element => {
          const original = element.id;
          element.id = `${original}-${id || "idle"}`;
          return [original, element.id];
        }));
        for (const element of pet.querySelectorAll("svg, svg *")) {
          for (const attribute of element.attributes) {
            if (attribute.localName === "id") continue;
            const value = attribute.value.replace(/url\(#([^)]+)\)/g, (match, reference) =>
              idMap.has(reference) ? `url(#${idMap.get(reference)})` : match);
            const reference = value.slice(1);
            const next = attribute.localName === "href" && value.startsWith("#") && idMap.has(reference)
              ? `#${idMap.get(reference)}` : value;
            if (next !== attribute.value) attribute.value = next;
          }
        }
        pet.querySelector("svg").setAttribute("aria-hidden", "true");
        pet.addEventListener("click", () => clicks.push(id));
        pet.disabled = !id;
        pets.set(id, pet);
      }
      pet.dataset.state = Object.hasOwn(labels, state) ? state : "idle";
      const label = labels[pet.dataset.state];
      pet.title = `${title} · ${label}`;
      pet.setAttribute("aria-label", `打开 ${title}，${label}`);
      pet.querySelector(".readout span").textContent = label;
      const number = pet.querySelector(".pet-number");
      number.textContent = String(position + 1);
      number.hidden = items.length < 2;
      pet.style.setProperty("--pet-hue", `${hues[position % hues.length]}deg`);
      if (panel.children[position] !== pet) panel.insertBefore(pet, panel.children[position] ?? null);
    }
    return place();
  }

  const positionTimer = setInterval(place, 125);
  window.codexWorkshop = {
    render,
    takeClicks: () => clicks.splice(0),
    destroy() {
      clearInterval(positionTimer);
      panel.remove();
      style.remove();
      delete window.codexWorkshop;
    }
  };
}
