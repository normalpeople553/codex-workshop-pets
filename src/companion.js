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
  const colors = ["#8458e0", "#c749b3", "#3986ce", "#cf624c", "#2f977b", "#9c7626"];
  const shapes = [
    "polygon(50% 0,100% 50%,50% 100%,0 50%)",
    "circle(48%)",
    "polygon(50% 0,100% 100%,0 100%)",
    "inset(5% round 10%)",
    "polygon(25% 0,75% 0,100% 50%,75% 100%,25% 100%,0 50%)"
  ];
  const markedRows = new Map();
  const markedProjects = new Map();
  const slotWidth = 124;
  let items = [];
  let needsReconcile = true;
  let pointedSlot;
  let focusedSlot;

  function clearRow(row) {
    row.removeAttribute("data-workshop-mark");
    row.removeAttribute("data-workshop-highlight");
    row.style.removeProperty("--workshop-mark-color");
    row.style.removeProperty("--workshop-mark-shape");
  }

  function setMarkStyle(element, slot) {
    element.style.setProperty("--workshop-mark-color", slot.color);
    element.style.setProperty("--workshop-mark-shape", slot.shape);
  }

  function clearProject(row, badges) {
    badges.remove();
    row.removeAttribute("data-workshop-highlight");
    row.style.removeProperty("--workshop-mark-color");
  }

  function syncProjects(projects, highlighted) {
    const seen = new Set();
    if (projects.size) {
      for (const row of document.querySelectorAll("[data-app-action-sidebar-project-row][data-app-action-sidebar-project-id]")) {
        const group = projects.get(row.getAttribute("data-app-action-sidebar-project-id"));
        if (!group) continue;
        seen.add(row);
        let mark = markedProjects.get(row);
        if (!mark?.badges.isConnected) {
          const badges = document.createElement("span");
          badges.className = "workshop-project-marks";
          badges.setAttribute("aria-hidden", "true");
          row.insertBefore(badges, row.children[1] ?? null);
          mark = { badges, group: [] };
          markedProjects.set(row, mark);
        }
        if (mark.group.length !== group.length || mark.group.some((slot, i) => slot !== group[i])) {
          mark.badges.replaceChildren(...group.map(slot => {
            const chip = document.createElement("span");
            chip.className = "workshop-project-mark";
            setMarkStyle(chip, slot);
            return chip;
          }));
          mark.group = group;
        }
        const isHighlighted = group.includes(highlighted);
        row.toggleAttribute("data-workshop-highlight", isHighlighted);
        if (isHighlighted) row.style.setProperty("--workshop-mark-color", highlighted.color);
        else row.style.removeProperty("--workshop-mark-color");
      }
    }
    for (const [row, { badges }] of markedProjects) {
      if (seen.has(row)) continue;
      clearProject(row, badges);
      markedProjects.delete(row);
    }
  }

  function syncSidebar() {
    const assigned = new Map();
    const visibleMembership = new Map();
    if (!panel.hidden) {
      for (const slot of slots) {
        if (slot.item) assigned.set(`local:${slot.item.id}`, slot);
      }
    }
    const highlighted = pointedSlot ?? focusedSlot;
    const seen = new Set();
    if (assigned.size) {
      for (const row of document.querySelectorAll("[data-app-action-sidebar-thread-row][data-app-action-sidebar-thread-id]")) {
        const slot = assigned.get(row.getAttribute("data-app-action-sidebar-thread-id"));
        if (!slot) continue;
        const projectId = row.closest("[data-app-action-sidebar-project-list-id]")
          ?.getAttribute("data-app-action-sidebar-project-list-id");
        if (projectId) visibleMembership.set(slot, projectId);
        seen.add(row);
        if (markedRows.get(row) !== slot) {
          row.setAttribute("data-workshop-mark", "");
          setMarkStyle(row, slot);
          markedRows.set(row, slot);
        }
        row.toggleAttribute("data-workshop-highlight", highlighted === slot);
      }
    }
    for (const row of markedRows.keys()) {
      if (seen.has(row)) continue;
      clearRow(row);
      markedRows.delete(row);
    }
    const projects = new Map();
    for (const slot of assigned.values()) {
      const projectId = visibleMembership.get(slot) ?? slot.item.projectId;
      if (!projectId) continue;
      if (!projects.has(projectId)) projects.set(projectId, []);
      projects.get(projectId).push(slot);
    }
    syncProjects(projects, highlighted);
  }

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
    const mark = document.createElement("span");
    mark.className = "workshop-pet-mark";
    mark.setAttribute("aria-hidden", "true");
    pet.append(mark);
    const color = colors[rank % colors.length];
    const shape = shapes[rank % shapes.length];
    pet.style.setProperty("--pet-hue", `${hues[rank % hues.length]}deg`);
    pet.style.setProperty("--pet-delay", `${-0.38 * (rank % 6)}s`);
    const slot = { pet, color, shape, key: null, item: null };
    setMarkStyle(pet, slot);
    pet.addEventListener("click", () => {
      if (slot.item) clicks.push(slot.item.id);
    });
    pet.addEventListener("pointerenter", () => { pointedSlot = slot; syncSidebar(); });
    pet.addEventListener("pointerleave", () => { pointedSlot = undefined; syncSidebar(); });
    pet.addEventListener("focus", () => { focusedSlot = slot; syncSidebar(); });
    pet.addEventListener("blur", () => { focusedSlot = undefined; syncSidebar(); });
    // Keep slot zero at the left edge when the composer changes width.
    panel.append(pet);
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
      if (pointedSlot === slot) pointedSlot = undefined;
      if (focusedSlot === slot) focusedSlot = undefined;
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
      slot.pet.toggleAttribute("data-fast", state === "coding" && slot.item.fast === true);
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
      syncSidebar();
      return false;
    }
    const box = composer.getBoundingClientRect();
    const left = Math.max(8, box.left);
    const width = Math.max(0, Math.min(box.right, innerWidth - 8) - left);
    const capacity = Math.floor(width / slotWidth);
    panel.hidden = capacity === 0;
    if (panel.hidden) {
      syncSidebar();
      return false;
    }
    panel.style.left = `${left}px`;
    panel.style.width = `${width}px`;
    panel.style.top = `${Math.max(10, box.top - 94)}px`;
    if (needsReconcile || capacity !== slots.length) {
      reconcile(capacity);
      needsReconcile = false;
    }
    syncSidebar();
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
      for (const row of markedRows.keys()) clearRow(row);
      for (const [row, { badges }] of markedProjects) clearProject(row, badges);
      panel.remove();
      style.remove();
      delete window.codexWorkshop;
    }
  };
}
