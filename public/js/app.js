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

  // ===== PRESENTATION SURFACE =====
  const overlayTitle = document.getElementById("overlayTitle");
  const overlayViewLabel = document.getElementById("overlayViewLabel");
  const imageCounter = document.getElementById("imageCounter");
  const overlayClose = document.getElementById("overlayClose");
  const navPrev = document.getElementById("navPrev");
  const navNext = document.getElementById("navNext");
  const presentationImage = document.getElementById("presentationImage");
  const annotationCanvas = document.getElementById("annotationCanvas");
  const imageContainer = document.getElementById("imageContainer");
  const imageFrame = document.getElementById("imageFrame");
  const filmstripRail = document.getElementById("filmstripRail");
  const filmstripTrack = document.getElementById("filmstripTrack");
  
  // Zoom controls
  const zoomIn = document.getElementById("zoomIn");
  const zoomOut = document.getElementById("zoomOut");
  const zoomReset = document.getElementById("zoomReset");
  const zoomLevelDisplay = document.getElementById("zoomLevel");
  
  // Annotation controls
  const annotateToggle = document.getElementById("annotateToggle");
  const clearAnnotationsBtn = document.getElementById("clearAnnotations");
  const annotationIndicator = document.getElementById("annotationIndicator");

  // ===== STATE =====
  let conditions = [];
  let fuse = null;
  let selectedRegion = null;
  let selectedCondition = null;
  let currentImageIndex = 0;
  let isDrawing = false;
  let ctx = null;
  const recentConditions = JSON.parse(localStorage.getItem("recentConditions") || "[]");
  
  // Presentation state
  let zoomLevel = 1;
  let panX = 0;
  let panY = 0;
  let isPanning = false;
  let panStartX = 0;
  let panStartY = 0;
  let annotationEnabled = false; // Start with annotation off for clean presentation

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

  // ===== PRESENTATION SURFACE =====
  function openPresentation() {
    if (!selectedCondition || !selectedCondition.images) return;
    
    // Reset state for fresh presentation
    zoomLevel = 1;
    panX = 0;
    panY = 0;
    annotationEnabled = false; // Start clean, user can enable when needed
    
    showCurrentImage();
    renderFilmstrip();
    updateZoomDisplay();
    updateAnnotationState();
    
    overlay.classList.add("active");
    document.body.style.overflow = "hidden";
  }

  function closePresentation() {
    overlay.classList.remove("active");
    document.body.style.overflow = "";
    resetZoom();
  }

  function showCurrentImage() {
    if (!selectedCondition || !selectedCondition.images) return;
    const images = selectedCondition.images;
    const img = images[currentImageIndex];

    // Update metadata
    overlayTitle.textContent = selectedCondition.name;
    overlayViewLabel.textContent = img.view_label || "";
    imageCounter.textContent = images.length > 1 ? `${currentImageIndex + 1} of ${images.length}` : "";

    // Load image
    presentationImage.src = `/uploads/${img.filename}`;
    presentationImage.onload = () => {
      resizeCanvas();
      resetZoom();
    };

    // Navigation visibility
    const hasMultiple = images.length > 1;
    navPrev.style.display = hasMultiple ? "" : "none";
    navNext.style.display = hasMultiple ? "" : "none";
    
    // Update filmstrip selection
    updateFilmstripSelection();
    
    clearAnnotations();
  }

  function renderFilmstrip() {
    if (!selectedCondition || !selectedCondition.images) return;
    const images = selectedCondition.images;
    
    // Single image - hide filmstrip
    if (images.length <= 1) {
      filmstripRail.classList.add("single-image");
      return;
    }
    
    filmstripRail.classList.remove("single-image");
    filmstripTrack.innerHTML = images
      .map((img, idx) => {
        const label = img.view_label || `${idx + 1}`;
        const selected = idx === currentImageIndex ? "selected" : "";
        return `
          <button class="filmstrip-thumb ${selected}" data-idx="${idx}" tabindex="0">
            <img src="/uploads/${img.filename}" alt="${label}" loading="lazy">
            <span class="thumb-label">${esc(label)}</span>
          </button>`;
      })
      .join("");
    
    // Scroll selected into view
    scrollFilmstripToSelected();
  }

  function updateFilmstripSelection() {
    const thumbs = filmstripTrack.querySelectorAll(".filmstrip-thumb");
    thumbs.forEach((thumb, idx) => {
      thumb.classList.toggle("selected", idx === currentImageIndex);
    });
    scrollFilmstripToSelected();
  }

  function scrollFilmstripToSelected() {
    const selected = filmstripTrack.querySelector(".filmstrip-thumb.selected");
    if (selected) {
      selected.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
    }
  }

  // Filmstrip click handler
  filmstripTrack.addEventListener("click", (e) => {
    const thumb = e.target.closest(".filmstrip-thumb");
    if (!thumb) return;
    currentImageIndex = Number(thumb.dataset.idx);
    showCurrentImage();
  });

  // Navigation buttons
  navPrev.addEventListener("click", (e) => {
    e.stopPropagation();
    navigatePrev();
  });

  navNext.addEventListener("click", (e) => {
    e.stopPropagation();
    navigateNext();
  });

  function navigatePrev() {
    if (!selectedCondition || selectedCondition.images.length <= 1) return;
    currentImageIndex = (currentImageIndex - 1 + selectedCondition.images.length) % selectedCondition.images.length;
    showCurrentImage();
  }

  function navigateNext() {
    if (!selectedCondition || selectedCondition.images.length <= 1) return;
    currentImageIndex = (currentImageIndex + 1) % selectedCondition.images.length;
    showCurrentImage();
  }

  overlayClose.addEventListener("click", closePresentation);

  // ===== ZOOM FUNCTIONALITY =====
  const ZOOM_MIN = 1;
  const ZOOM_MAX = 4;
  const ZOOM_STEP = 0.25;

  function setZoom(level) {
    zoomLevel = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, level));
    if (zoomLevel === 1) {
      panX = 0;
      panY = 0;
    }
    applyTransform();
    updateZoomDisplay();
    imageFrame.classList.toggle("zoomed", zoomLevel > 1);
  }

  function resetZoom() {
    zoomLevel = 1;
    panX = 0;
    panY = 0;
    applyTransform();
    updateZoomDisplay();
    imageFrame.classList.remove("zoomed");
  }

  function applyTransform() {
    imageFrame.style.transform = `scale(${zoomLevel}) translate(${panX}px, ${panY}px)`;
  }

  function updateZoomDisplay() {
    zoomLevelDisplay.textContent = `${Math.round(zoomLevel * 100)}%`;
  }

  zoomIn.addEventListener("click", () => setZoom(zoomLevel + ZOOM_STEP));
  zoomOut.addEventListener("click", () => setZoom(zoomLevel - ZOOM_STEP));
  zoomReset.addEventListener("click", resetZoom);

  // Mouse wheel zoom
  imageContainer.addEventListener("wheel", (e) => {
    if (!overlay.classList.contains("active")) return;
    e.preventDefault();
    const delta = e.deltaY > 0 ? -ZOOM_STEP : ZOOM_STEP;
    setZoom(zoomLevel + delta);
  }, { passive: false });

  // Pan functionality
  imageFrame.addEventListener("mousedown", (e) => {
    if (annotationEnabled && annotationCanvas.classList.contains("active")) return;
    if (zoomLevel <= 1) return;
    isPanning = true;
    panStartX = e.clientX - panX * zoomLevel;
    panStartY = e.clientY - panY * zoomLevel;
    imageFrame.classList.add("dragging");
  });

  document.addEventListener("mousemove", (e) => {
    if (!isPanning) return;
    const maxPan = (zoomLevel - 1) * 100;
    panX = Math.max(-maxPan, Math.min(maxPan, (e.clientX - panStartX) / zoomLevel));
    panY = Math.max(-maxPan, Math.min(maxPan, (e.clientY - panStartY) / zoomLevel));
    applyTransform();
  });

  document.addEventListener("mouseup", () => {
    isPanning = false;
    imageFrame.classList.remove("dragging");
  });

  // Double-click to toggle quick zoom (radiology-style inspection)
  presentationImage.addEventListener("dblclick", (e) => {
    if (annotationEnabled) return; // Don't interfere with annotation
    e.preventDefault();
    if (zoomLevel === 1) {
      setZoom(2); // Quick zoom in
    } else {
      resetZoom(); // Reset to fit
    }
  });

  // ===== ANNOTATION CONTROLS =====
  function updateAnnotationState() {
    annotateToggle.dataset.active = annotationEnabled;
    annotationCanvas.classList.toggle("active", annotationEnabled);
    annotationIndicator.classList.toggle("visible", annotationEnabled);
  }

  annotateToggle.addEventListener("click", () => {
    annotationEnabled = !annotationEnabled;
    updateAnnotationState();
  });

  clearAnnotationsBtn.addEventListener("click", clearAnnotations);

  // ===== KEYBOARD NAVIGATION =====
  document.addEventListener("keydown", (e) => {
    if (!overlay.classList.contains("active")) return;
    
    switch (e.key) {
      case "Escape":
        closePresentation();
        break;
      case "ArrowLeft":
        navigatePrev();
        break;
      case "ArrowRight":
        navigateNext();
        break;
      case "+":
      case "=":
        e.preventDefault();
        setZoom(zoomLevel + ZOOM_STEP);
        break;
      case "-":
      case "_":
        e.preventDefault();
        setZoom(zoomLevel - ZOOM_STEP);
        break;
      case "0":
        e.preventDefault();
        resetZoom();
        break;
      case "a":
      case "A":
        annotationEnabled = !annotationEnabled;
        updateAnnotationState();
        break;
      case "c":
      case "C":
        clearAnnotations();
        break;
    }
  });

  // ===== ANNOTATION CANVAS =====
  ctx = annotationCanvas.getContext("2d");

  function resizeCanvas() {
    const rect = presentationImage.getBoundingClientRect();
    const frameRect = imageFrame.getBoundingClientRect();
    annotationCanvas.width = rect.width;
    annotationCanvas.height = rect.height;
    // Position relative to the image frame
    annotationCanvas.style.left = `${rect.left - frameRect.left}px`;
    annotationCanvas.style.top = `${rect.top - frameRect.top}px`;
  }

  window.addEventListener("resize", () => {
    if (selectedCondition && overlay.classList.contains("active")) {
      resizeCanvas();
    }
  });

  function getCanvasPos(e) {
    const rect = annotationCanvas.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    return { x: clientX - rect.left, y: clientY - rect.top };
  }

  // Annotation drawing setup
  function setupAnnotationStroke() {
    ctx.strokeStyle = "#ef4444";
    ctx.lineWidth = 3;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.shadowColor = "rgba(239, 68, 68, 0.5)";
    ctx.shadowBlur = 2;
  }

  annotationCanvas.addEventListener("mousedown", (e) => {
    if (e.button !== 0) return;
    isDrawing = true;
    const pos = getCanvasPos(e);
    ctx.beginPath();
    ctx.moveTo(pos.x, pos.y);
    setupAnnotationStroke();
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
    setupAnnotationStroke();
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
