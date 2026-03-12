// OrthoRef - Section-led image bank UI
(async function () {
  const homeScreen = document.getElementById("homeScreen");
  const browserScreen = document.getElementById("browserScreen");
  const sectionGrid = document.getElementById("sectionGrid");
  const homeSearchForm = document.getElementById("homeSearchForm");
  const homeSearchInput = document.getElementById("homeSearchInput");
  const homeSearchSuggestions = document.getElementById("homeSearchSuggestions");
  const sectionTabs = document.getElementById("sectionTabs");
  const browserEyebrow = document.getElementById("browserEyebrow");
  const browserTitle = document.getElementById("browserTitle");
  const browserSummary = document.getElementById("browserSummary");
  const browserSearchInput = document.getElementById("browserSearchInput");
  const browserSearchSuggestions = document.getElementById("browserSearchSuggestions");
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

  const TYPEAHEAD_LIMIT = 8;
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
  let manualSectionKey = null;
  let selectedConditionId = null;
  let searchQuery = "";
  let currentGalleryItems = [];
  let currentImageIndex = 0;
  let isDrawing = false;
  let ctx = null;
  let hintTimeout = null;
  let searchMatchCache = new Map();

  const typeaheadState = {
    home: {
      mode: "home",
      input: homeSearchInput,
      panel: homeSearchSuggestions,
      activeIndex: -1,
      matches: [],
      blurTimer: null,
    },
    browser: {
      mode: "browser",
      input: browserSearchInput,
      panel: browserSearchSuggestions,
      activeIndex: -1,
      matches: [],
      blurTimer: null,
    },
  };

  function getImageUrl(image) {
    return image?.url || image?.asset_url || (image?.filename ? `/uploads/${image.filename}` : "");
  }

  function getThumbUrl(image) {
    return image?.thumb_url || getImageUrl(image);
  }

  function normalizeRegion(value) {
    return (value || "").trim().toLowerCase();
  }

  function normalizeSearchText(value) {
    return (value || "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  }

  function tokenizeSearchText(value) {
    return normalizeSearchText(value)
      .split(/\s+/)
      .filter(Boolean);
  }

  function sortImages(left, right, imageScores = new Map()) {
    const scoreDiff = Number(imageScores.get(right.id) || 0) - Number(imageScores.get(left.id) || 0);
    if (scoreDiff !== 0) {
      return scoreDiff;
    }
    return Number(left._sortOrder) - Number(right._sortOrder);
  }

  function scoreTextMatch(text, normalizedQuery, tokens) {
    if (!normalizedQuery) {
      return 0;
    }

    const normalizedText = normalizeSearchText(text);
    if (!normalizedText) {
      return 0;
    }

    const compactText = normalizedText.replace(/\s+/g, "");
    const compactQuery = normalizedQuery.replace(/\s+/g, "");

    let score = 0;
    if (normalizedText === normalizedQuery) {
      score += 180;
    }
    if (compactText === compactQuery) {
      score += 160;
    }
    if (normalizedText.startsWith(normalizedQuery)) {
      score += 120;
    }
    if (compactText.startsWith(compactQuery)) {
      score += 90;
    }
    if (normalizedText.includes(normalizedQuery)) {
      score += 70;
    }
    if (compactText.includes(compactQuery)) {
      score += 45;
    }

    const matchedTokens = tokens.filter((token) => normalizedText.includes(token) || compactText.includes(token)).length;
    if (matchedTokens) {
      score += matchedTokens * 18;
    }
    if (tokens.length && matchedTokens === tokens.length) {
      score += 24;
    }

    return score;
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
        ? "Universal condition search across the full image bank."
        : "Browse the full image bank, then narrow with a section tab.",
      conditions: sortedConditions,
      images: allImages,
      heroImage: allImages[0] || null,
    };
  }

  function getConditionSearchMatch(condition, query = searchQuery) {
    const normalizedQuery = normalizeSearchText(query);
    const cacheKey = `${condition.id}::${normalizedQuery}`;
    if (searchMatchCache.has(cacheKey)) {
      return searchMatchCache.get(cacheKey);
    }

    let result = null;
    if (!normalizedQuery) {
      const matchedImages = condition.images.slice().sort((left, right) => sortImages(left, right));
      result = {
        condition,
        score: 0,
        matchedImages,
        bestImage: matchedImages[0] || null,
      };
      searchMatchCache.set(cacheKey, result);
      return result;
    }

    const tokens = tokenizeSearchText(normalizedQuery);
    const nameScore = scoreTextMatch(condition.name, normalizedQuery, tokens);
    const aliasScore = scoreTextMatch(condition.aliases, normalizedQuery, tokens);
    const regionScore = scoreTextMatch(condition.body_region, normalizedQuery, tokens);
    const sectionScore = scoreTextMatch(condition._sectionLabel, normalizedQuery, tokens);
    const conditionScore = nameScore * 5 + aliasScore * 3 + regionScore * 2 + sectionScore;

    const imageScores = new Map();
    let highestImageScore = 0;

    for (const image of condition.images) {
      const imageScore =
        scoreTextMatch(image.view_label, normalizedQuery, tokens) * 3 +
        scoreTextMatch(image.original_name, normalizedQuery, tokens);
      imageScores.set(image.id, imageScore);
      if (imageScore > highestImageScore) {
        highestImageScore = imageScore;
      }
    }

    if (!conditionScore && !highestImageScore) {
      searchMatchCache.set(cacheKey, null);
      return null;
    }

    const matchedImages = (conditionScore
      ? condition.images
      : condition.images.filter((image) => Number(imageScores.get(image.id) || 0) > 0)
    ).slice();

    matchedImages.sort((left, right) => sortImages(left, right, imageScores));

    result = {
      condition,
      score: conditionScore + highestImageScore * 2 + matchedImages.length,
      matchedImages,
      bestImage: matchedImages[0] || condition.images[0] || null,
    };
    searchMatchCache.set(cacheKey, result);
    return result;
  }

  function getUniversalMatches(query = searchQuery) {
    const normalizedQuery = normalizeSearchText(query);
    const matches = conditions
      .map((condition) => getConditionSearchMatch(condition, normalizedQuery))
      .filter(Boolean);

    if (!normalizedQuery) {
      return matches.sort(
        (left, right) =>
          left.condition._sectionLabel.localeCompare(right.condition._sectionLabel) ||
          left.condition.name.localeCompare(right.condition.name)
      );
    }

    return matches.sort(
      (left, right) =>
        right.score - left.score ||
        left.condition._sectionLabel.localeCompare(right.condition._sectionLabel) ||
        left.condition.name.localeCompare(right.condition.name)
    );
  }

  function getMatchedImages(condition) {
    return getConditionSearchMatch(condition)?.matchedImages || [];
  }

  function getDisplaySearchTerm() {
    return browserSearchInput.value.trim() || homeSearchInput.value.trim();
  }

  function getHomeSections() {
    if (!searchQuery) {
      return availableSections;
    }

    const matches = getUniversalMatches();
    const groupedSections = new Map(
      availableSections.map((section) => [
        section.key,
        {
          ...section,
          conditions: [],
          images: [],
          heroImage: null,
          heroScore: -1,
          summary: "",
        },
      ])
    );

    for (const match of matches) {
      const sectionKey = match.condition._sectionKey || FALLBACK_SECTION_KEY;
      const bucket = groupedSections.get(sectionKey);
      if (!bucket) {
        continue;
      }

      bucket.conditions.push(match.condition);
      bucket.images.push(...match.matchedImages);

      if (match.score > bucket.heroScore) {
        bucket.heroImage = match.bestImage;
        bucket.heroScore = match.score;
      }
    }

    return Array.from(groupedSections.values())
      .filter((section) => section.conditions.length > 0)
      .map((section) => ({
        ...section,
        summary: `${section.conditions.length} matching condition${section.conditions.length === 1 ? "" : "s"} · ${section.images.length} relevant image${section.images.length === 1 ? "" : "s"}`,
      }))
      .sort(
        (left, right) =>
          right.conditions.length - left.conditions.length ||
          right.images.length - left.images.length ||
          left.label.localeCompare(right.label)
      );
  }

  function showScreen(screen) {
    homeScreen.style.display = "none";
    browserScreen.style.display = "none";
    screen.style.display = "";
  }

  function setSearchTerm(value) {
    const term = (value || "").trim();
    searchQuery = normalizeSearchText(term);
    browserSearchInput.value = term;
    homeSearchInput.value = term;
    searchMatchCache = new Map();
  }

  function closeTypeahead(mode) {
    const state = typeaheadState[mode];
    if (!state) {
      return;
    }

    window.clearTimeout(state.blurTimer);
    state.activeIndex = -1;
    state.matches = [];
    state.panel.hidden = true;
    state.panel.innerHTML = "";
    state.input.setAttribute("aria-expanded", "false");
    state.input.removeAttribute("aria-activedescendant");
  }

  function closeAllTypeahead(exceptMode = null) {
    Object.keys(typeaheadState).forEach((mode) => {
      if (mode !== exceptMode) {
        closeTypeahead(mode);
      }
    });
  }

  function updateTypeaheadActiveOption(mode) {
    const state = typeaheadState[mode];
    const options = state.panel.querySelectorAll("[data-typeahead-index]");

    options.forEach((option, index) => {
      const isActive = index === state.activeIndex;
      option.classList.toggle("is-active", isActive);
      option.setAttribute("aria-selected", isActive ? "true" : "false");
      if (isActive) {
        state.input.setAttribute("aria-activedescendant", option.id);
        option.scrollIntoView({ block: "nearest" });
      }
    });

    if (state.activeIndex < 0) {
      state.input.removeAttribute("aria-activedescendant");
    }
  }

  function renderTypeahead(mode) {
    const state = typeaheadState[mode];
    const term = state.input.value.trim();

    if (!term) {
      closeTypeahead(mode);
      return;
    }

    closeAllTypeahead(mode);

    state.matches = getUniversalMatches(term).slice(0, TYPEAHEAD_LIMIT);
    if (state.activeIndex >= state.matches.length) {
      state.activeIndex = -1;
    }

    if (!state.matches.length) {
      state.panel.innerHTML = '<div class="typeahead-empty">No conditions match this search yet.</div>';
      state.panel.hidden = false;
      state.input.setAttribute("aria-expanded", "true");
      return;
    }

    state.panel.innerHTML = state.matches
      .map((match, index) => {
        const preview = match.bestImage
          ? `<img class="typeahead-option__thumb" src="${getThumbUrl(match.bestImage)}" alt="${esc(match.condition.name)}" loading="lazy">`
          : '<span class="typeahead-option__thumb typeahead-option__thumb--placeholder"></span>';

        return `
          <button
            class="typeahead-option${index === state.activeIndex ? " is-active" : ""}"
            id="${mode}TypeaheadOption${index}"
            type="button"
            role="option"
            aria-selected="${index === state.activeIndex ? "true" : "false"}"
            data-typeahead-index="${index}"
          >
            ${preview}
            <span class="typeahead-option__copy">
              <span class="typeahead-option__name">${esc(match.condition.name)}</span>
              <span class="typeahead-option__meta">${esc(match.condition._sectionLabel)} · ${match.matchedImages.length} matching image${match.matchedImages.length === 1 ? "" : "s"}</span>
            </span>
          </button>
        `;
      })
      .join("");

    state.panel.hidden = false;
    state.input.setAttribute("aria-expanded", "true");
    updateTypeaheadActiveOption(mode);

    state.panel.querySelectorAll("[data-typeahead-index]").forEach((button) => {
      button.addEventListener("mousedown", (event) => {
        event.preventDefault();
      });

      button.addEventListener("click", () => {
        selectTypeaheadMatch(mode, Number(button.dataset.typeaheadIndex));
      });
    });
  }

  function showHome() {
    setSearchTerm(browserSearchInput.value);
    renderHome();
    closeAllTypeahead();
    showScreen(homeScreen);
  }

  function showBrowser(sectionKey, options = {}) {
    if (options.preserveSearch) {
      setSearchTerm(browserSearchInput.value);
    } else if (typeof options.searchTerm === "string") {
      setSearchTerm(options.searchTerm);
    } else {
      setSearchTerm("");
    }

    activeSectionKey = sectionKey;
    if (sectionKey && sectionKey !== ALL_SECTIONS_KEY) {
      manualSectionKey = sectionKey;
    }

    selectedConditionId = typeof options.selectedConditionId === "number" ? options.selectedConditionId : null;

    renderHome();
    renderBrowser();
    closeAllTypeahead();
    showScreen(browserScreen);
  }

  function focusCondition(condition) {
    showBrowser(condition._sectionKey || ALL_SECTIONS_KEY, {
      searchTerm: condition.name,
      selectedConditionId: condition.id,
    });
    browserSearchInput.focus();
  }

  function selectTypeaheadMatch(mode, index) {
    const state = typeaheadState[mode];
    const match = state.matches[index];
    if (!match) {
      return;
    }

    closeAllTypeahead();
    focusCondition(match.condition);
  }

  function getActiveSection() {
    if (activeSectionKey === ALL_SECTIONS_KEY) {
      return getAllSectionsData();
    }

    return availableSections.find((section) => section.key === activeSectionKey) || availableSections[0] || null;
  }

  function renderHome() {
    const homeSections = getHomeSections();

    if (!homeSections.length) {
      sectionGrid.innerHTML = "";

      if (homeNotice.dataset.tone === "error" && !conditions.length) {
        return;
      }

      if (searchQuery) {
        showHomeNotice(`No conditions match "${getDisplaySearchTerm()}". Try another term or browse by section.`, "info");
        return;
      }

      if (!getHomeNoticeMessage()) {
        showHomeNotice("No demo content is available yet. Add at least one condition and image in Admin.", "info");
      }
      return;
    }

    if (homeNotice.dataset.tone !== "error") {
      hideHomeNotice();
    }

    sectionGrid.innerHTML = homeSections
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
      button.addEventListener("click", () => {
        showBrowser(button.dataset.section, { searchTerm: homeSearchInput.value });
      });
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
        if (activeSectionKey !== ALL_SECTIONS_KEY) {
          manualSectionKey = activeSectionKey;
        }
        selectedConditionId = null;
        renderBrowser();
      });
    });
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
        const leftMatch = getConditionSearchMatch(left.condition);
        const rightMatch = getConditionSearchMatch(right.condition);

        if ((rightMatch?.score || 0) !== (leftMatch?.score || 0)) {
          return (rightMatch?.score || 0) - (leftMatch?.score || 0);
        }
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
            : '<span class="condition-option__thumb condition-option__thumb--placeholder"></span>';

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
    const displaySearchTerm = getDisplaySearchTerm();

    browserEyebrow.textContent = searchQuery
      ? "Universal image search"
      : isAllSections
        ? "Image bank search"
        : `${section.label} section`;
    browserTitle.textContent = section.label;
    browserSummary.textContent = displaySearchTerm
      ? isAllSections
        ? `Showing the best condition matches for "${displaySearchTerm}" across the full bank.`
        : `Showing ${section.label.toLowerCase()} matches for "${displaySearchTerm}".`
      : section.summary;

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

  function handleHomeSearchInput() {
    selectedConditionId = null;
    setSearchTerm(homeSearchInput.value);
    renderHome();
    renderTypeahead("home");
  }

  function handleBrowserSearchInput() {
    const nextTerm = browserSearchInput.value;
    const hadSearch = Boolean(searchQuery);

    selectedConditionId = null;
    setSearchTerm(nextTerm);

    if (searchQuery) {
      if (!hadSearch && activeSectionKey && activeSectionKey !== ALL_SECTIONS_KEY) {
        manualSectionKey = activeSectionKey;
      }
      activeSectionKey = ALL_SECTIONS_KEY;
    } else if (activeSectionKey === ALL_SECTIONS_KEY) {
      activeSectionKey = manualSectionKey || availableSections[0]?.key || ALL_SECTIONS_KEY;
    }

    renderHome();
    renderBrowser();
    renderTypeahead("browser");
  }

  function bindTypeahead(mode) {
    const state = typeaheadState[mode];

    state.input.addEventListener("focus", () => {
      if (state.input.value.trim()) {
        renderTypeahead(mode);
      }
    });

    state.input.addEventListener("blur", () => {
      window.clearTimeout(state.blurTimer);
      state.blurTimer = window.setTimeout(() => closeTypeahead(mode), 120);
    });

    state.input.addEventListener("keydown", (event) => {
      const isOpen = !state.panel.hidden;

      if (event.key === "Escape") {
        closeTypeahead(mode);
        return;
      }

      if (event.key === "ArrowDown") {
        event.preventDefault();
        if (!isOpen) {
          renderTypeahead(mode);
        }
        if (!state.matches.length) {
          return;
        }
        state.activeIndex = Math.min(state.activeIndex + 1, state.matches.length - 1);
        updateTypeaheadActiveOption(mode);
        return;
      }

      if (event.key === "ArrowUp") {
        event.preventDefault();
        if (!state.matches.length) {
          return;
        }
        state.activeIndex = Math.max(state.activeIndex - 1, 0);
        updateTypeaheadActiveOption(mode);
        return;
      }

      if (event.key === "Enter" && state.activeIndex >= 0) {
        event.preventDefault();
        selectTypeaheadMatch(mode, state.activeIndex);
      }
    });
  }

  backToHome.addEventListener("click", showHome);

  homeSearchInput.addEventListener("input", handleHomeSearchInput);
  browserSearchInput.addEventListener("input", handleBrowserSearchInput);

  homeSearchForm.addEventListener("submit", (event) => {
    event.preventDefault();
    closeAllTypeahead();
    selectedConditionId = null;
    showBrowser(ALL_SECTIONS_KEY, { searchTerm: homeSearchInput.value });
    browserSearchInput.focus();
  });

  bindTypeahead("home");
  bindTypeahead("browser");

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

  document.addEventListener("click", (event) => {
    if (!event.target.closest(".search-combobox")) {
      closeAllTypeahead();
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
    manualSectionKey = activeSectionKey;
  }

  try {
    hideHomeNotice();
    await loadConditions();
  } catch (error) {
    console.error("Failed to load conditions", error);
    conditions = [];
    availableSections = [];
    activeSectionKey = null;
    manualSectionKey = null;
    showHomeNotice(
      "Unable to load the image bank right now. Check the Supabase connection and refresh before the demo.",
      "error"
    );
  }

  renderHome();
  showHome();
})();
