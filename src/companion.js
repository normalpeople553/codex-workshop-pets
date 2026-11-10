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
  template.innerHTML = artwork;
  document.head.append(style);
  document.body.append(panel);
  const slots = [];
  const skipped = new Set();
  const clicks = [];
  const hues = [0, 45, -48, 105, -100, 170];
  const slotWidth = 124;
  let items = [];
  let needsReconcile = true;

  function makeSlot(rank) {
    const pet = document.createElement("button");
    pet.type = "button";
    pet.className = "workshop-pet";
    pet.append(template.content.cloneNode(true));
    const idMap = new Map([...pet.querySelectorAll("svg [id]")].map(element => {
      const original = element.id;
      element.id = `${original}-slot-${rank}`;
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
    pet.style.setProperty("--pet-hue", `${hues[rank % hues.length]}deg`);
    pet.style.setProperty("--pet-delay", `${-0.38 * (rank % 6)}s`);
    const slot = { pet, key: null, item: null };
    pet.addEventListener("click", () => {
      if (slot.item) clicks.push(slot.item.id);
    });
    // Index zero is the rightmost slot. A resize only adds or removes slots on the left.
    panel.prepend(pet);
    return slot;
  }

  function reconcile(capacity) {
    const current = new Map(items.map(item => [`${item.id}/${item.started ?? ""}`, item]));
    for (const key of skipped) {
      if (!current.has(key)) skipped.delete(key);
    }
    while (slots.length > capacity) {
      const slot = slots.pop();
      if (current.has(slot.key)) skipped.add(slot.key);
      slot.pet.remove();
    }
    while (slots.length < capacity) slots.push(makeSlot(slots.length));

    const assigned = new Set();
    for (const slot of slots) {
      if (!current.has(slot.key)) slot.key = null;
      if (slot.key !== null) assigned.add(slot.key);
    }
    for (const [key, item] of current) {
      if (item.state !== "coding" || assigned.has(key) || skipped.has(key)) continue;
      const free = slots.find(slot => slot.key === null || current.get(slot.key).state === "done");
      if (!free) {
        skipped.add(key);
        continue;
      }
      if (free.key !== null) skipped.add(free.key);
      free.key = key;
    }
    for (const slot of slots) {
      slot.item = current.get(slot.key) ?? null;
      const state = slot.item?.state ?? "idle";
      if (slot.pet.dataset.state !== state) slot.pet.dataset.state = state;
      slot.pet.disabled = slot.item === null;
      if (slot.item) slot.pet.setAttribute("aria-label", `打开 ${slot.item.title}`);
      else slot.pet.removeAttribute("aria-label");
    }
  }

  function place() {
    const composer = [...document.querySelectorAll(
      '.composer-surface-chrome, [data-testid="composer"], [class*="ComposerLayoutRoot-"]'
    )].find(element => element.getBoundingClientRect().width >= slotWidth);
    if (!composer) {
      panel.hidden = true;
      return false;
    }
    const box = composer.getBoundingClientRect();
    const left = Math.max(8, box.left);
    const width = Math.max(0, Math.min(box.right, innerWidth - 8) - left);
    const capacity = Math.floor(width / slotWidth);
    panel.hidden = capacity === 0;
    if (panel.hidden) return false;
    panel.style.left = `${left}px`;
    panel.style.width = `${width}px`;
    panel.style.top = `${Math.max(10, box.top - 94)}px`;
    if (needsReconcile || capacity !== slots.length) {
      reconcile(capacity);
      needsReconcile = false;
    }
    return true;
  }

  function render(nextItems) {
    items = nextItems;
    needsReconcile = true;
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
