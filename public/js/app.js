// OrthoRef - Section-led image bank UI
(async function () {
  const homeScreen = document.getElementById("homeScreen");
  const browserScreen = document.getElementById("browserScreen");
  const sectionGrid = document.getElementById("sectionGrid");
  const homeSearchForm = document.getElementById("homeSearchForm");
  const homeSearchInput = document.getElementById("homeSearchInput");
  const sectionTabs = document.getElementById("sectionTabs");
  const browserEyebrow = document.getElementById("browserEyebrow");
  const browserTitle = document.getElementById("browserTitle");
  const browserSummary = document.getElementById("browserSummary");
  const browserSearchInput = document.getElementById("browserSearchInput");
  const conditionPanelTitle = document.getElementById("conditionPanelTitle");
  const conditionPanelMeta = document.getElementById("conditionPanelMeta");
  const conditionList = document.getElementById("conditionList");
  const imagePanelTitle = document.getElementById("imagePanelTitle");
  const imagePanelMeta = document.getElementById("imagePanelMeta");
  const imageGrid = document.getElementById("imageGrid");
  const emptyGridState = document.getElementById("emptyGridState");
  const backToHome = document.getElementById("backToHome");
  const homeNotice = document.getElementById("homeNotice");

  const overlay = document.getElementById("overlay");
  const overlayTitle = document.getElementById("overlayTitle");
  const overlayViewLabel = document.getElementById("overlayViewLabel");
  const overlayClose = document.getElementById("overlayClose");
  const navPrev = document.getElementById("navPrev");
  const navNext = document.getElementById("navNext");
  const presentationImage = document.getElementById("presentationImage");
  const annotationCanvas = document.getElementById("annotationCanvas");
  const imageContainer = document.getElementById("imageContainer");
  const filmstrip = document.getElementById("dotIndicators");
  const annotationHint = document.getElementById("annotationHint");

  const SECTION_CONFIG = [
    {
      key: "head",
      label: "Head",
      regions: ["head", "head-neck", "neck"],
      accent: "section-card--head",
      summary: "Cervical and cranial reference images",
    },
    {
      key: "upper-limb",
      label: "Upper Limb",
      regions: ["shoulder", "elbow", "wrist", "hand"],
      accent: "section-card--shoulders",
      summary: "Shoulder, elbow, wrist, and hand reference images",
    },
    {
      key: "spine",
      label: "Spine",
      regions: ["spine"],
      accent: "section-card--spine",
      summary: "Lumbar, stenosis, scoliosis, and vertebral references",
    },
    {
      key: "hips",
      label: "Hips",
      regions: ["hip"],
      accent: "section-card--hips",
      summary: "Hip trauma, osteoarthritis, and hamstring-related images",
    },
    {
      key: "knees",
      label: "Knees",
      regions: ["knee"],
      accent: "section-card--knees",
      summary: "ACL, meniscus, arthritis, and nerve-related imagery",
    },
    {
      key: "ankle",
      label: "Ankle",
      regions: ["ankle", "foot"],
      accent: "section-card--ankle",
      summary: "Lower-leg, ankle, and forefoot references",
    },
    {
      key: "other",
      label: "Other",
      regions: [],
      accent: "section-card--other",
      summary: "Unmapped or uncategorized reference images",
    },
  ];
  const ALL_SECTIONS_KEY = "all-sections";
  const FALLBACK_SECTION_KEY = "other";

  let conditions = [];
  let availableSections = [];
  let activeSectionKey = null;
  let selectedConditionId = null;
  let searchQuery = "";
  let currentGalleryItems = [];
  let currentImageIndex = 0;
  let isDrawing = false;
  let ctx = null;
  let hintTimeout = null;

  function getImageUrl(image) {
    return image?.url || image?.asset_url || (image?.filename ? `/uploads/${image.filename}` : "");
  }

  function getThumbUrl(image) {
    return image?.thumb_url || getImageUrl(image);
  }

  function normalizeRegion(value) {
    return (value || "").trim().toLowerCase();
  }

  function getSectionForRegion(region) {
    return (
      SECTION_CONFIG.find((entry) => entry.regions.includes(region)) ||
      SECTION_CONFIG.find((entry) => entry.key === FALLBACK_SECTION_KEY) ||
      null
    );
  }

  function getHomeNoticeMessage() {
    return homeNotice.textContent || "";
  }

  function showHomeNotice(message, tone = "info") {
    homeNotice.textContent = message;
    homeNotice.dataset.tone = tone;
    homeNotice.style.display = "";
  }

  function hideHomeNotice() {
    homeNotice.textContent = "";
    homeNotice.style.display = "none";
    delete homeNotice.dataset.tone;
  }

  function enrichCondition(condition) {
    const region = normalizeRegion(condition.body_region);
    const section = getSectionForRegion(region);

    const images = (condition.images || []).map((image, index) => ({
      ...image,
      _conditionId: condition.id,
      _conditionName: condition.name,
      _conditionAliases: condition.aliases || "",
      _region: region,
      _sectionKey: section?.key || null,
      _sectionLabel: section?.label || "Other",
      _sortOrder: typeof image.sort_order === "number" ? image.sort_order : index,
    }));

    return {
      ...condition,
      _sectionKey: section?.key || null,
      _sectionLabel: section?.label || "Other",
      _region: region,
      images,
    };
  }

  function getSectionData() {
    return SECTION_CONFIG.map((section) => {
      const sectionConditions = conditions.filter((condition) => condition._sectionKey === section.key);
      const sectionImages = sectionConditions.flatMap((condition) => condition.images);

      return {
        ...section,
        conditions: sectionConditions,
        images: sectionImages,
        heroImage: sectionImages[0] || null,
      };
    }).filter((section) => section.images.length > 0);
  }

  function getAllSectionsData() {
    const sortedConditions = conditions
      .slice()
      .sort(
        (left, right) =>
          left._sectionLabel.localeCompare(right._sectionLabel) || left.name.localeCompare(right.name)
      );
    const allImages = sortedConditions.flatMap((condition) => condition.images);

    return {
      key: ALL_SECTIONS_KEY,
      label: "All Sections",
      summary: searchQuery
        ? "Search across the full image bank, then narrow with a section tab."
        : "Browse the full image bank, then narrow with a section tab.",
      conditions: sortedConditions,
      images: allImages,
      heroImage: allImages[0] || null,
    };
  }

  function showScreen(screen) {
    homeScreen.style.display = "none";
    browserScreen.style.display = "none";
    screen.style.display = "";
  }

  function showHome() {
    homeSearchInput.value = browserSearchInput.value.trim();
    showScreen(homeScreen);
  }

  function setSearchTerm(value) {
    const term = (value || "").trim();
    searchQuery = term.toLowerCase();
    browserSearchInput.value = term;
    homeSearchInput.value = term;
  }

  function showBrowser(sectionKey, options = {}) {
    activeSectionKey = sectionKey;
    selectedConditionId = null;

    if (options.preserveSearch) {
      setSearchTerm(browserSearchInput.value);
    } else if (typeof options.searchTerm === "string") {
      setSearchTerm(options.searchTerm);
    } else {
      setSearchTerm("");
    }

    renderBrowser();
    showScreen(browserScreen);
  }

  function getActiveSection() {
    if (activeSectionKey === ALL_SECTIONS_KEY) {
      return getAllSectionsData();
    }

    return availableSections.find((section) => section.key === activeSectionKey) || availableSections[0] || null;
  }

  function matchesSearch(condition, image) {
    if (!searchQuery) {
      return true;
    }

    const haystack = [
      condition.name,
      condition.aliases,
      condition.body_region,
      image.view_label,
      image.original_name,
    ]
      .join(" ")
      .toLowerCase();

    return haystack.includes(searchQuery);
  }

  function renderHome() {
    if (!availableSections.length) {
      sectionGrid.innerHTML = "";
      if (!getHomeNoticeMessage()) {
        showHomeNotice("No demo content is available yet. Add at least one condition and image in Admin.", "info");
      }
      return;
    }

    sectionGrid.innerHTML = availableSections
      .map((section) => {
        const style = section.heroImage
          ? `style="background-image:linear-gradient(180deg, rgba(8,15,20,0.12), rgba(8,15,20,0.88)),url('${getThumbUrl(section.heroImage)}')"`
          : "";
        const conditionCount = section.conditions.length;
        const imageCount = section.images.length;

        return `
          <button class="section-card ${section.accent}" type="button" data-section="${section.key}" ${style}>
            <div class="section-card__meta">
              <p class="section-card__label">${esc(section.label)}</p>
              <p class="section-card__summary">${esc(section.summary)}</p>
            </div>
            <div class="section-card__footer">
              <span>${conditionCount} condition${conditionCount === 1 ? "" : "s"}</span>
              <span>${imageCount} image${imageCount === 1 ? "" : "s"}</span>
            </div>
          </button>
        `;
      })
      .join("");

    sectionGrid.querySelectorAll("[data-section]").forEach((button) => {
      button.addEventListener("click", () => showBrowser(button.dataset.section));
    });
  }

  function renderSectionTabs(section) {
    const tabSections = [getAllSectionsData(), ...availableSections];

    sectionTabs.innerHTML = tabSections
      .map(
        (entry) => `
          <button
            class="section-tab${entry.key === section?.key ? " is-active" : ""}"
            type="button"
            data-section-tab="${entry.key}"
          >
            ${esc(entry.label)}
          </button>
        `
      )
      .join("");

    sectionTabs.querySelectorAll("[data-section-tab]").forEach((button) => {
      button.addEventListener("click", () => {
        activeSectionKey = button.dataset.sectionTab;
        selectedConditionId = null;
        setSearchTerm(browserSearchInput.value);
        renderBrowser();
      });
    });
  }

  function getMatchedImages(condition) {
    return condition.images.filter((image) => matchesSearch(condition, image));
  }

  function buildVisibleState(section) {
    if (!section) {
      return {
        visibleConditions: [],
        visibleImages: [],
        activeCondition: null,
        visibleCounts: new Map(),
        allVisibleImageCount: 0,
      };
    }

    const visibleConditions = section.conditions.filter((condition) => getMatchedImages(condition).length > 0);
    const visibleConditionIds = new Set(visibleConditions.map((condition) => condition.id));

    if (selectedConditionId && !visibleConditionIds.has(selectedConditionId)) {
      selectedConditionId = null;
    }

    const visibleCounts = new Map(
      visibleConditions.map((condition) => [condition.id, getMatchedImages(condition).length])
    );
    const allVisibleImageCount = Array.from(visibleCounts.values()).reduce((sum, count) => sum + count, 0);

    const activeCondition = selectedConditionId
      ? section.conditions.find((condition) => condition.id === selectedConditionId) || null
      : null;

    const baseConditions = activeCondition ? [activeCondition] : visibleConditions;
    const visibleImages = baseConditions
      .flatMap((condition) =>
        getMatchedImages(condition).map((image) => ({
          condition,
          image,
        }))
      )
      .sort((left, right) => {
        if (left.condition.name !== right.condition.name) {
          return left.condition.name.localeCompare(right.condition.name);
        }
        return Number(left.image._sortOrder) - Number(right.image._sortOrder);
      });

    return {
      visibleConditions,
      visibleImages,
      activeCondition,
      visibleCounts,
      allVisibleImageCount,
    };
  }

  function renderConditionList(section, visibleState) {
    const { visibleConditions, visibleCounts, allVisibleImageCount } = visibleState;
    const isAllSections = section.key === ALL_SECTIONS_KEY;
    conditionPanelTitle.textContent = isAllSections
      ? searchQuery
        ? "Matched conditions"
        : "All conditions"
      : `All ${section.label}`;
    conditionPanelMeta.textContent = `${visibleConditions.length} conditions`;

    conditionList.innerHTML = `
      <button class="condition-option${selectedConditionId === null ? " is-active" : ""}" type="button" data-condition-id="">
        <span class="condition-option__thumb condition-option__thumb--placeholder"></span>
        <span class="condition-option__copy">
          <span class="condition-option__name">${isAllSections ? "All results" : `All ${esc(section.label)}`}</span>
          ${isAllSections ? '<span class="condition-option__section">Across all body sections</span>' : ""}
        </span>
        <span class="condition-option__count">${allVisibleImageCount}</span>
      </button>
      ${visibleConditions
        .map((condition) => {
          const matchedImages = getMatchedImages(condition);
          const previewImage = matchedImages[0] || condition.images[0];
          const preview = previewImage
            ? `<img class="condition-option__thumb" src="${getThumbUrl(previewImage)}" alt="${esc(condition.name)}" loading="lazy">`
            : `<span class="condition-option__thumb condition-option__thumb--placeholder"></span>`;

          return `
            <button
              class="condition-option${selectedConditionId === condition.id ? " is-active" : ""}"
              type="button"
              data-condition-id="${condition.id}"
            >
              ${preview}
              <span class="condition-option__copy">
                <span class="condition-option__name">${esc(condition.name)}</span>
                ${isAllSections ? `<span class="condition-option__section">${esc(condition._sectionLabel)}</span>` : ""}
              </span>
              <span class="condition-option__count">${visibleCounts.get(condition.id) || 0}</span>
            </button>
          `;
        })
        .join("")}
    `;

    conditionList.querySelectorAll("[data-condition-id]").forEach((button) => {
      button.addEventListener("click", () => {
        const id = button.dataset.conditionId;
        selectedConditionId = id ? Number(id) : null;
        renderBrowser();
      });
    });
  }

  function renderImageGrid(section, visibleState) {
    const { activeCondition, visibleImages } = visibleState;
    const isAllSections = section.key === ALL_SECTIONS_KEY;
    imagePanelTitle.textContent = activeCondition
      ? activeCondition.name
      : isAllSections
        ? searchQuery
          ? "All matching images"
          : "All images"
        : `${section.label} image bank`;
    imagePanelMeta.textContent = `${visibleImages.length} image${visibleImages.length === 1 ? "" : "s"}`;

    if (!visibleImages.length) {
      imageGrid.innerHTML = "";
      emptyGridState.style.display = "";
      return;
    }

    emptyGridState.style.display = "none";
    imageGrid.innerHTML = visibleImages
      .map(
        ({ condition, image }, index) => `
          <button class="image-card" type="button" data-image-index="${index}">
            <img class="image-card__thumb" src="${getThumbUrl(image)}" alt="${esc(condition.name)}" loading="lazy">
            <span class="image-card__section">${esc(condition._sectionLabel || section.label)}</span>
            <div class="image-card__body">
              <h4>${esc(condition.name)}</h4>
              <p>${esc(image.view_label || image.original_name || "Reference view")}</p>
            </div>
          </button>
        `
      )
      .join("");

    imageGrid.querySelectorAll("[data-image-index]").forEach((button) => {
      button.addEventListener("click", () => {
        currentGalleryItems = visibleImages;
        currentImageIndex = Number(button.dataset.imageIndex);
        openPresentation();
      });
    });
  }

  function renderBrowser() {
    const section = getActiveSection();
    if (!section) {
      return;
    }

    const isAllSections = section.key === ALL_SECTIONS_KEY;
    browserEyebrow.textContent = isAllSections ? "Image bank search" : `${section.label} section`;
    browserTitle.textContent = section.label;
    browserSummary.textContent = section.summary;

    renderSectionTabs(section);

    const visibleState = buildVisibleState(section);
    renderConditionList(section, visibleState);
    renderImageGrid(section, visibleState);
  }

  function openPresentation() {
    if (!currentGalleryItems.length) {
      return;
    }

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
    const current = currentGalleryItems[currentImageIndex];
    if (!current) {
      return;
    }

    overlayTitle.textContent = current.condition.name;
    overlayViewLabel.textContent = current.image.view_label ? `— ${current.image.view_label}` : "";
    presentationImage.src = getImageUrl(current.image);
    presentationImage.alt = current.condition.name;
    presentationImage.onload = () => resizeCanvas();

    navPrev.style.display = currentGalleryItems.length > 1 ? "" : "none";
    navNext.style.display = currentGalleryItems.length > 1 ? "" : "none";

    filmstrip.innerHTML = currentGalleryItems
      .map(
        (entry, index) => `
          <button class="filmstrip__item${index === currentImageIndex ? " is-active" : ""}" type="button" data-filmstrip-index="${index}">
            <img src="${getThumbUrl(entry.image)}" alt="${esc(entry.condition.name)}" loading="lazy">
            <span>${esc(entry.image.view_label || entry.condition.name)}</span>
          </button>
        `
      )
      .join("");

    filmstrip.querySelectorAll("[data-filmstrip-index]").forEach((button) => {
      button.addEventListener("click", () => {
        currentImageIndex = Number(button.dataset.filmstripIndex);
        showCurrentImage();
      });
    });

    clearAnnotations();
  }

  function moveOverlay(direction) {
    if (currentGalleryItems.length < 2) {
      return;
    }

    currentImageIndex =
      (currentImageIndex + direction + currentGalleryItems.length) % currentGalleryItems.length;
    showCurrentImage();
  }

  backToHome.addEventListener("click", showHome);

  homeSearchForm.addEventListener("submit", (event) => {
    event.preventDefault();
    showBrowser(ALL_SECTIONS_KEY, { searchTerm: homeSearchInput.value });
    browserSearchInput.focus();
  });

  browserSearchInput.addEventListener("input", () => {
    setSearchTerm(browserSearchInput.value);
    renderBrowser();
  });

  navPrev.addEventListener("click", (event) => {
    event.stopPropagation();
    moveOverlay(-1);
  });

  navNext.addEventListener("click", (event) => {
    event.stopPropagation();
    moveOverlay(1);
  });

  overlayClose.addEventListener("click", closePresentation);

  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) {
      closePresentation();
    }
  });

  document.addEventListener("keydown", (event) => {
    if (!overlay.classList.contains("active")) {
      return;
    }

    if (event.key === "Escape") {
      closePresentation();
    }
    if (event.key === "ArrowLeft") {
      moveOverlay(-1);
    }
    if (event.key === "ArrowRight") {
      moveOverlay(1);
    }
  });

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
    if (overlay.classList.contains("active")) {
      resizeCanvas();
    }
  });

  function getCanvasPos(event) {
    const rect = annotationCanvas.getBoundingClientRect();
    const clientX = event.touches ? event.touches[0].clientX : event.clientX;
    const clientY = event.touches ? event.touches[0].clientY : event.clientY;
    return { x: clientX - rect.left, y: clientY - rect.top };
  }

  annotationCanvas.addEventListener("mousedown", (event) => {
    if (event.button !== 0) {
      return;
    }
    isDrawing = true;
    const pos = getCanvasPos(event);
    ctx.beginPath();
    ctx.moveTo(pos.x, pos.y);
    ctx.strokeStyle = "#ef4444";
    ctx.lineWidth = 3;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
  });

  annotationCanvas.addEventListener("mousemove", (event) => {
    if (!isDrawing) {
      return;
    }
    const pos = getCanvasPos(event);
    ctx.lineTo(pos.x, pos.y);
    ctx.stroke();
  });

  annotationCanvas.addEventListener("mouseup", () => {
    isDrawing = false;
  });

  annotationCanvas.addEventListener("mouseleave", () => {
    isDrawing = false;
  });

  annotationCanvas.addEventListener(
    "touchstart",
    (event) => {
      event.preventDefault();
      isDrawing = true;
      const pos = getCanvasPos(event);
      ctx.beginPath();
      ctx.moveTo(pos.x, pos.y);
      ctx.strokeStyle = "#ef4444";
      ctx.lineWidth = 3;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
    },
    { passive: false }
  );

  annotationCanvas.addEventListener(
    "touchmove",
    (event) => {
      event.preventDefault();
      if (!isDrawing) {
        return;
      }
      const pos = getCanvasPos(event);
      ctx.lineTo(pos.x, pos.y);
      ctx.stroke();
    },
    { passive: false }
  );

  annotationCanvas.addEventListener("touchend", () => {
    isDrawing = false;
  });

  annotationCanvas.addEventListener("dblclick", clearAnnotations);
  annotationCanvas.addEventListener("contextmenu", (event) => {
    event.preventDefault();
    clearAnnotations();
  });

  function clearAnnotations() {
    if (!ctx) {
      return;
    }
    ctx.clearRect(0, 0, annotationCanvas.width, annotationCanvas.height);
  }

  function esc(value) {
    const element = document.createElement("div");
    element.textContent = value || "";
    return element.innerHTML;
  }

  async function loadConditions() {
    const response = await fetch("/api/conditions");
    if (!response.ok) {
      throw new Error(`Condition request failed (${response.status})`);
    }

    const rawConditions = await response.json();
    if (!Array.isArray(rawConditions)) {
      throw new Error("Condition response was not an array");
    }

    conditions = rawConditions.map(enrichCondition);
    availableSections = getSectionData();
    activeSectionKey = availableSections[0]?.key || null;
  }

  try {
    hideHomeNotice();
    await loadConditions();
  } catch (error) {
    console.error("Failed to load conditions", error);
    conditions = [];
    availableSections = [];
    activeSectionKey = null;
    showHomeNotice("Unable to load the image bank right now. Check the Supabase connection and refresh before the demo.", "error");
  }

  renderHome();
  showHome();
})();
