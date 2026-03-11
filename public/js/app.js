// OrthoRef - Presentation UI
(async function () {
  const searchInput = document.getElementById("searchInput");
  const searchContainer = document.getElementById("searchContainer");
  const resultsGrid = document.getElementById("resultsGrid");
  const emptyState = document.getElementById("emptyState");
  const overlay = document.getElementById("overlay");
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

  let conditions = [];
  let fuse = null;
  let currentCondition = null;
  let currentImageIndex = 0;
  let isDrawing = false;
  let ctx = null;
  let hintTimeout = null;

  // --- Load Data ---
  async function loadConditions() {
    const res = await fetch("/api/conditions");
    conditions = await res.json();

    if (conditions.length === 0) {
      emptyState.style.display = "";
      return;
    }
    emptyState.style.display = "none";

    fuse = new Fuse(conditions, {
      keys: [
        { name: "name", weight: 2 },
        { name: "aliases", weight: 1.5 },
        { name: "body_region", weight: 0.5 },
      ],
      threshold: 0.35,
      includeScore: true,
    });

    // Show all conditions initially
    renderResults(conditions);
  }

  function renderResults(items) {
    if (items.length === 0) {
      resultsGrid.innerHTML = '<div class="no-results">No matching conditions</div>';
      return;
    }
    resultsGrid.innerHTML = items
      .map((c) => {
        const thumb = c.images?.length
          ? `<img class="thumb" src="/uploads/${c.images[0].filename}" alt="${c.name}" loading="lazy">`
          : `<div class="thumb-placeholder">🦴</div>`;
        const region = c.body_region
          ? `<span class="card-region">${c.body_region}</span>`
          : "";
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
  }

  // --- Search ---
  searchInput.addEventListener("input", () => {
    const query = searchInput.value.trim();
    if (!fuse) return;

    if (!query) {
      searchContainer.classList.remove("has-results");
      renderResults(conditions);
      return;
    }

    searchContainer.classList.add("has-results");
    const results = fuse.search(query).map((r) => r.item);
    renderResults(results);
  });

  // --- Click to Present ---
  resultsGrid.addEventListener("click", (e) => {
    const card = e.target.closest(".result-card");
    if (!card) return;
    const id = Number(card.dataset.id);
    const condition = conditions.find((c) => c.id === id);
    if (!condition || !condition.images?.length) return;
    openPresentation(condition);
  });

  // --- Presentation Mode ---
  function openPresentation(condition) {
    currentCondition = condition;
    currentImageIndex = 0;
    showCurrentImage();
    overlay.classList.add("active");
    document.body.style.overflow = "hidden";

    // Show hint briefly
    annotationHint.classList.remove("hidden");
    clearTimeout(hintTimeout);
    hintTimeout = setTimeout(() => annotationHint.classList.add("hidden"), 4000);
  }

  function closePresentation() {
    overlay.classList.remove("active");
    document.body.style.overflow = "";
    currentCondition = null;
    clearAnnotations();
  }

  function showCurrentImage() {
    if (!currentCondition) return;
    const images = currentCondition.images;
    const img = images[currentImageIndex];

    overlayTitle.textContent = currentCondition.name;
    overlayViewLabel.textContent = img.view_label ? `— ${img.view_label}` : "";
    presentationImage.src = `/uploads/${img.filename}`;

    // Wait for image to load to size canvas
    presentationImage.onload = () => resizeCanvas();

    // Navigation visibility
    navPrev.style.display = images.length > 1 ? "" : "none";
    navNext.style.display = images.length > 1 ? "" : "none";

    // Dots
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
    if (!currentCondition) return;
    currentImageIndex = (currentImageIndex - 1 + currentCondition.images.length) % currentCondition.images.length;
    showCurrentImage();
  });

  navNext.addEventListener("click", (e) => {
    e.stopPropagation();
    if (!currentCondition) return;
    currentImageIndex = (currentImageIndex + 1) % currentCondition.images.length;
    showCurrentImage();
  });

  dotIndicators.addEventListener("click", (e) => {
    const dot = e.target.closest(".dot");
    if (!dot) return;
    currentImageIndex = Number(dot.dataset.i);
    showCurrentImage();
  });

  overlayClose.addEventListener("click", closePresentation);

  // Close on click outside image
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) closePresentation();
  });

  // Keyboard navigation
  document.addEventListener("keydown", (e) => {
    if (!currentCondition) return;
    if (e.key === "Escape") closePresentation();
    if (e.key === "ArrowLeft") {
      currentImageIndex = (currentImageIndex - 1 + currentCondition.images.length) % currentCondition.images.length;
      showCurrentImage();
    }
    if (e.key === "ArrowRight") {
      currentImageIndex = (currentImageIndex + 1) % currentCondition.images.length;
      showCurrentImage();
    }
  });

  // --- Annotation Canvas ---
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
    if (currentCondition) resizeCanvas();
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

  // Double-click to clear annotations
  annotationCanvas.addEventListener("dblclick", clearAnnotations);

  // Right-click to clear
  annotationCanvas.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    clearAnnotations();
  });

  function clearAnnotations() {
    if (!ctx) return;
    ctx.clearRect(0, 0, annotationCanvas.width, annotationCanvas.height);
  }

  // --- Utility ---
  function esc(s) {
    const d = document.createElement("div");
    d.textContent = s;
    return d.innerHTML;
  }

  // --- Init ---
  await loadConditions();
  searchInput.focus();
})();
