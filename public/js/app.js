// OrthoRef - Premium Consultation UI
(async function () {
  // ===== SCREEN ELEMENTS =====
  const welcomeScreen = document.getElementById("welcomeScreen");
  const bodymapScreen = document.getElementById("bodymapScreen");
  const conditionScreen = document.getElementById("conditionScreen");
  const trayScreen = document.getElementById("trayScreen");
  const overlay = document.getElementById("overlay");

  // ===== WELCOME SCREEN =====
  const startConsultationBtn = document.getElementById("startConsultation");
  const recentList = document.getElementById("recentList");
  const quickLinks = document.querySelectorAll(".quick-link");

  // ===== BODYMAP SCREEN =====
  const bodyFront = document.getElementById("bodyFront");
  const bodyBack = document.getElementById("bodyBack");
  const backFromBodyMap = document.getElementById("backFromBodyMap");
  const searchInputFallback = document.getElementById("searchInputFallback");
  const resultsGridFallback = document.getElementById("resultsGridFallback");

  // ===== CONDITION SCREEN =====
  const selectedRegionTitle = document.getElementById("selectedRegionTitle");
  const breadcrumbRegion = document.getElementById("breadcrumbRegion");
  const conditionSearchInput = document.getElementById("conditionSearchInput");
  const conditionChips = document.getElementById("conditionChips");
  const backFromCondition = document.getElementById("backFromCondition");

  // ===== TRAY SCREEN =====
  const trayConditionName = document.getElementById("trayConditionName");
  const trayConditionRegion = document.getElementById("trayConditionRegion");
  const imageTray = document.getElementById("imageTray");
  const emptyTrayState = document.getElementById("emptyTrayState");
  const backFromTray = document.getElementById("backFromTray");

  // ===== PRESENTATION OVERLAY =====
  const overlayTitle = document.getElementById("overlayTitle");
  const overlayViewLabel = document.getElementById("overlayViewLabel");
  const overlayClose = document.getElementById("overlayClose");
  const navPrev = document.getElementById("navPrev");
  const navNext = document.getElementById("navNext");
  const presentationImage = document.getElementById("presentationImage");
  const annotationCanvas = document.getElementById("annotationCanvas");
  const imageContainer = document.getElementById("imageContainer");
  const dotIndicators = document.getElementById("dotIndicators");
  const annotationHint = document.getElementById("annotationHint");

  // ===== STATE =====
  let conditions = [];
  let fuse = null;
  let selectedRegion = null;
  let selectedCondition = null;
  let currentImageIndex = 0;
  let isDrawing = false;
  let ctx = null;
  let hintTimeout = null;
  const recentConditions = JSON.parse(localStorage.getItem("recentConditions") || "[]");

  // ===== NAVIGATION HELPERS =====
  function showScreen(screen) {
    welcomeScreen.style.display = "none";
    bodymapScreen.style.display = "none";
    conditionScreen.style.display = "none";
    trayScreen.style.display = "none";
    screen.style.display = "";
  }

  function goToWelcome() {
    selectedRegion = null;
    selectedCondition = null;
    showScreen(welcomeScreen);
  }

  function goToBodyMap() {
    showScreen(bodymapScreen);
  }

  function goToConditions(region) {
    selectedRegion = region;
    selectedRegionTitle.textContent = `Select ${region.charAt(0).toUpperCase() + region.slice(1)} Condition`;
    breadcrumbRegion.textContent = region.charAt(0).toUpperCase() + region.slice(1);
    renderConditionChips();
    showScreen(conditionScreen);
  }

  function goToTray(condition) {
    selectedCondition = condition;
    trayConditionName.textContent = condition.name;
    trayConditionRegion.textContent = condition.body_region;
    
    // Add to recent
    const idx = recentConditions.findIndex(c => c.id === condition.id);
    if (idx > -1) recentConditions.splice(idx, 1);
    recentConditions.unshift(condition);
    if (recentConditions.length > 5) recentConditions.pop();
    localStorage.setItem("recentConditions", JSON.stringify(recentConditions));

    renderImageTray();
    showScreen(trayScreen);
  }

  // ===== DATA LOADING =====
  async function loadConditions() {
    const res = await fetch("/api/conditions");
    conditions = await res.json();

    fuse = new Fuse(conditions, {
      keys: [
        { name: "name", weight: 2 },
        { name: "aliases", weight: 1.5 },
        { name: "body_region", weight: 0.5 },
      ],
      threshold: 0.35,
      includeScore: true,
    });

    renderRecentList();
  }

  // ===== WELCOME SCREEN RENDERING =====
  function renderRecentList() {
    if (recentConditions.length === 0) {
      recentList.innerHTML = '<p style="color: var(--text-muted); font-size: 0.9rem;">No recent conditions yet</p>';
      return;
    }
    recentList.innerHTML = recentConditions
      .slice(0, 3)
      .map(c => {
        const thumb = c.images?.length
          ? `<img class="recent-thumb" src="/uploads/${c.images[0].filename}" alt="${c.name}" loading="lazy">`
          : `<div class="recent-thumb-placeholder">🦴</div>`;
        return `
          <button class="recent-item" data-id="${c.id}">
            ${thumb}
            <span>${c.name}</span>
          </button>`;
      })
      .join("");
  }

  // ===== BODYMAP INTERACTION =====
  function handleBodyRegionClick(e) {
    const region = e.target.closest(".region");
    if (!region) return;
    const regionName = region.getAttribute("data-region");
    goToConditions(regionName);
  }

  bodyFront.addEventListener("click", handleBodyRegionClick);
  bodyBack.addEventListener("click", handleBodyRegionClick);
  
  // Keyboard support for body regions
  document.querySelectorAll('.body-svg .region').forEach(region => {
    region.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        const regionName = region.getAttribute('data-region');
        goToConditions(regionName);
      }
    });
  });

  // ===== CONDITION CHIPS RENDERING =====
  function renderConditionChips() {
    const filtered = selectedRegion
      ? conditions.filter(c => !selectedRegion || c.body_region === selectedRegion || c.body_region === "general")
      : conditions;

    // Apply search filter
    const searchQuery = conditionSearchInput.value.trim();
    let items = filtered;
    if (searchQuery && fuse) {
      const results = fuse.search(searchQuery).map(r => r.item);
      items = results.filter(c => !selectedRegion || c.body_region === selectedRegion || c.body_region === "general");
    }

    if (items.length === 0) {
      conditionChips.innerHTML = '<p class="no-results">No conditions found</p>';
      return;
    }

    conditionChips.innerHTML = items
      .map(c => {
        const thumb = c.images?.length
          ? `<img class="chip-thumb" src="/uploads/${c.images[0].filename}" alt="${c.name}" loading="lazy">`
          : `<div class="chip-thumb-placeholder">🦴</div>`;
        return `
          <button class="condition-chip" data-id="${c.id}">
            ${thumb}
            <span>${c.name}</span>
          </button>`;
      })
      .join("");

    // Attach click handlers
    document.querySelectorAll(".condition-chip").forEach(chip => {
      chip.addEventListener("click", (e) => {
        const id = Number(e.currentTarget.dataset.id);
        const condition = conditions.find(c => c.id === id);
        if (condition) goToTray(condition);
      });
    });
  }

  conditionSearchInput.addEventListener("input", () => {
    renderConditionChips();
  });

  // ===== IMAGE TRAY RENDERING =====
  function renderImageTray() {
    if (!selectedCondition || !selectedCondition.images || selectedCondition.images.length === 0) {
      imageTray.innerHTML = "";
      emptyTrayState.style.display = "";
      return;
    }

    emptyTrayState.style.display = "none";
    imageTray.innerHTML = selectedCondition.images
      .map((img, idx) => {
        const viewLabel = img.view_label ? ` • ${img.view_label}` : "";
        return `
          <div class="tray-thumbnail" data-idx="${idx}">
            <img src="/uploads/${img.filename}" alt="Image ${idx + 1}${viewLabel}" loading="lazy">
            <span class="tray-label">${idx === 0 ? "Best" : idx + 1}${viewLabel}</span>
          </div>`;
      })
      .join("");

    // Attach click handlers
    document.querySelectorAll(".tray-thumbnail").forEach(thumb => {
      thumb.addEventListener("click", (e) => {
        currentImageIndex = Number(e.currentTarget.dataset.idx);
        openPresentation();
      });
    });
  }

  // ===== FALLBACK SEARCH =====
  searchInputFallback.addEventListener("input", () => {
    const query = searchInputFallback.value.trim();
    if (!fuse) return;

    if (!query) {
      resultsGridFallback.innerHTML = "";
      return;
    }

    const results = fuse.search(query).map(r => r.item);
    resultsGridFallback.innerHTML = results
      .map(c => {
        const thumb = c.images?.length
          ? `<img class="thumb" src="/uploads/${c.images[0].filename}" alt="${c.name}" loading="lazy">`
          : `<div class="thumb-placeholder">🦴</div>`;
        const region = c.body_region ? `<span class="card-region">${c.body_region}</span>` : "";
        return `
          <div class="result-card" data-id="${c.id}">
            ${thumb}
            <div class="card-body">
              <div class="card-title">${esc(c.name)}</div>
              ${region}
            </div>
          </div>`;
      })
      .join("");

    document.querySelectorAll(".result-card").forEach(card => {
      card.addEventListener("click", (e) => {
        const id = Number(e.currentTarget.dataset.id);
        const condition = conditions.find(c => c.id === id);
        if (condition && condition.images && condition.images.length > 0) {
          goToTray(condition);
        }
      });
    });
  });

  // ===== PRESENTATION MODE =====
  function openPresentation() {
    if (!selectedCondition || !selectedCondition.images) return;
    showCurrentImage();
    overlay.classList.add("active");
    document.body.style.overflow = "hidden";

    annotationHint.classList.remove("hidden");
    clearTimeout(hintTimeout);
    hintTimeout = setTimeout(() => annotationHint.classList.add("hidden"), 4000);
  }

  function closePresentation() {
    overlay.classList.remove("active");
    document.body.style.overflow = "";
  }

  function showCurrentImage() {
    if (!selectedCondition || !selectedCondition.images) return;
    const images = selectedCondition.images;
    const img = images[currentImageIndex];

    overlayTitle.textContent = selectedCondition.name;
    overlayViewLabel.textContent = img.view_label ? `— ${img.view_label}` : "";
    presentationImage.src = `/uploads/${img.filename}`;

    presentationImage.onload = () => resizeCanvas();

    navPrev.style.display = images.length > 1 ? "" : "none";
    navNext.style.display = images.length > 1 ? "" : "none";

    if (images.length > 1) {
      dotIndicators.innerHTML = images
        .map((_, i) => `<div class="dot${i === currentImageIndex ? " active" : ""}" data-i="${i}"></div>`)
        .join("");
      dotIndicators.style.display = "";
    } else {
      dotIndicators.style.display = "none";
    }

    clearAnnotations();
  }

  navPrev.addEventListener("click", (e) => {
    e.stopPropagation();
    if (!selectedCondition) return;
    currentImageIndex = (currentImageIndex - 1 + selectedCondition.images.length) % selectedCondition.images.length;
    showCurrentImage();
  });

  navNext.addEventListener("click", (e) => {
    e.stopPropagation();
    if (!selectedCondition) return;
    currentImageIndex = (currentImageIndex + 1) % selectedCondition.images.length;
    showCurrentImage();
  });

  dotIndicators.addEventListener("click", (e) => {
    const dot = e.target.closest(".dot");
    if (!dot) return;
    currentImageIndex = Number(dot.dataset.i);
    showCurrentImage();
  });

  overlayClose.addEventListener("click", closePresentation);

  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) closePresentation();
  });

  document.addEventListener("keydown", (e) => {
    if (!selectedCondition) return;
    if (e.key === "Escape") closePresentation();
    if (e.key === "ArrowLeft") {
      currentImageIndex = (currentImageIndex - 1 + selectedCondition.images.length) % selectedCondition.images.length;
      showCurrentImage();
    }
    if (e.key === "ArrowRight") {
      currentImageIndex = (currentImageIndex + 1) % selectedCondition.images.length;
      showCurrentImage();
    }
  });

  // ===== ANNOTATION CANVAS =====
  ctx = annotationCanvas.getContext("2d");

  function resizeCanvas() {
    const rect = presentationImage.getBoundingClientRect();
    const containerRect = imageContainer.getBoundingClientRect();
    annotationCanvas.width = rect.width;
    annotationCanvas.height = rect.height;
    annotationCanvas.style.left = `${rect.left - containerRect.left}px`;
    annotationCanvas.style.top = `${rect.top - containerRect.top}px`;
  }

  window.addEventListener("resize", () => {
    if (selectedCondition) resizeCanvas();
  });

  function getCanvasPos(e) {
    const rect = annotationCanvas.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    return { x: clientX - rect.left, y: clientY - rect.top };
  }

  annotationCanvas.addEventListener("mousedown", (e) => {
    if (e.button !== 0) return;
    isDrawing = true;
    const pos = getCanvasPos(e);
    ctx.beginPath();
    ctx.moveTo(pos.x, pos.y);
    ctx.strokeStyle = "#ef4444";
    ctx.lineWidth = 3;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
  });

  annotationCanvas.addEventListener("mousemove", (e) => {
    if (!isDrawing) return;
    const pos = getCanvasPos(e);
    ctx.lineTo(pos.x, pos.y);
    ctx.stroke();
  });

  annotationCanvas.addEventListener("mouseup", () => { isDrawing = false; });
  annotationCanvas.addEventListener("mouseleave", () => { isDrawing = false; });

  // Touch support
  annotationCanvas.addEventListener("touchstart", (e) => {
    e.preventDefault();
    isDrawing = true;
    const pos = getCanvasPos(e);
    ctx.beginPath();
    ctx.moveTo(pos.x, pos.y);
    ctx.strokeStyle = "#ef4444";
    ctx.lineWidth = 3;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
  }, { passive: false });

  annotationCanvas.addEventListener("touchmove", (e) => {
    e.preventDefault();
    if (!isDrawing) return;
    const pos = getCanvasPos(e);
    ctx.lineTo(pos.x, pos.y);
    ctx.stroke();
  }, { passive: false });

  annotationCanvas.addEventListener("touchend", () => { isDrawing = false; });

  annotationCanvas.addEventListener("dblclick", clearAnnotations);
  annotationCanvas.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    clearAnnotations();
  });

  function clearAnnotations() {
    if (!ctx) return;
    ctx.clearRect(0, 0, annotationCanvas.width, annotationCanvas.height);
  }

  // ===== BACK BUTTONS =====
  startConsultationBtn.addEventListener("click", goToBodyMap);
  backFromBodyMap.addEventListener("click", goToWelcome);
  backFromCondition.addEventListener("click", goToBodyMap);
  backFromTray.addEventListener("click", goToBodyMap);

  // Recent items
  recentList.addEventListener("click", (e) => {
    const btn = e.target.closest(".recent-item");
    if (!btn) return;
    const id = Number(btn.dataset.id);
    const condition = conditions.find(c => c.id === id);
    if (condition && condition.images && condition.images.length > 0) {
      goToTray(condition);
    }
  });

  // Quick links
  quickLinks.forEach(link => {
    link.addEventListener("click", (e) => {
      const region = e.target.dataset.region;
      goToConditions(region);
    });
  });

  // ===== UTILITY =====
  function esc(s) {
    const d = document.createElement("div");
    d.textContent = s;
    return d.innerHTML;
  }

  // ===== INIT =====
  await loadConditions();
  showScreen(welcomeScreen);
})();
