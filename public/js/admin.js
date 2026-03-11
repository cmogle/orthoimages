// OrthoRef - Admin UI
(async function () {
  const sidebarList = document.getElementById("sidebarList");
  const placeholder = document.getElementById("placeholder");
  const formSection = document.getElementById("formSection");
  const formTitle = document.getElementById("formTitle");
  const imagesSection = document.getElementById("imagesSection");
  const condName = document.getElementById("condName");
  const condAliases = document.getElementById("condAliases");
  const condRegion = document.getElementById("condRegion");
  const btnSave = document.getElementById("btnSave");
  const btnDelete = document.getElementById("btnDelete");
  const btnAdd = document.getElementById("btnAdd");
  const uploadZone = document.getElementById("uploadZone");
  const fileInput = document.getElementById("fileInput");
  const uploadViewLabel = document.getElementById("uploadViewLabel");
  const imageGrid = document.getElementById("imageGrid");
  const toast = document.getElementById("toast");

  let conditions = [];
  let selectedId = null;

  // --- API Helpers ---
  async function api(url, opts = {}) {
    const res = await fetch(url, {
      headers: opts.body instanceof FormData ? {} : { "Content-Type": "application/json" },
      ...opts,
      body: opts.body instanceof FormData ? opts.body : opts.body ? JSON.stringify(opts.body) : undefined,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ message: "Request failed" }));
      throw new Error(err.message);
    }
    return res.json();
  }

  function showToast(msg) {
    toast.textContent = msg;
    toast.classList.add("show");
    setTimeout(() => toast.classList.remove("show"), 2500);
  }

  // --- Load & Render Sidebar ---
  async function loadConditions() {
    conditions = await api("/api/conditions");
    renderSidebar();
  }

  function renderSidebar() {
    // Group by body_region
    const groups = {};
    for (const c of conditions) {
      const region = c.body_region || "unclassified";
      if (!groups[region]) groups[region] = [];
      groups[region].push(c);
    }

    const regionOrder = ["shoulder", "elbow", "wrist", "hand", "hip", "knee", "ankle", "foot", "spine", "neck", "other", "unclassified"];
    const sorted = Object.entries(groups).sort(
      ([a], [b]) => (regionOrder.indexOf(a) === -1 ? 99 : regionOrder.indexOf(a)) - (regionOrder.indexOf(b) === -1 ? 99 : regionOrder.indexOf(b))
    );

    sidebarList.innerHTML = sorted
      .map(
        ([region, items]) => `
        <div class="region-group">
          <div class="region-label">${region}</div>
          ${items
            .map(
              (c) => `
            <div class="condition-item${c.id === selectedId ? " active" : ""}" data-id="${c.id}">
              ${esc(c.name)}
              <span class="img-count">${c.images?.length || 0}</span>
            </div>`
            )
            .join("")}
        </div>`
      )
      .join("");
  }

  // --- Sidebar Click ---
  sidebarList.addEventListener("click", (e) => {
    const item = e.target.closest(".condition-item");
    if (!item) return;
    selectCondition(Number(item.dataset.id));
  });

  function selectCondition(id) {
    selectedId = id;
    const c = conditions.find((x) => x.id === id);
    if (!c) return;

    placeholder.style.display = "none";
    formSection.style.display = "";
    formTitle.textContent = "Edit Condition";
    condName.value = c.name;
    condAliases.value = c.aliases;
    condRegion.value = c.body_region;
    btnDelete.style.display = "";
    imagesSection.style.display = "";
    renderImages(c.images || []);
    renderSidebar();
  }

  // --- Add New ---
  btnAdd.addEventListener("click", () => {
    selectedId = null;
    placeholder.style.display = "none";
    formSection.style.display = "";
    formTitle.textContent = "New Condition";
    condName.value = "";
    condAliases.value = "";
    condRegion.value = "";
    btnDelete.style.display = "none";
    imagesSection.style.display = "none";
    imageGrid.innerHTML = "";
    renderSidebar();
    condName.focus();
  });

  // --- Save ---
  btnSave.addEventListener("click", async () => {
    const name = condName.value.trim();
    if (!name) { condName.focus(); return; }

    const body = {
      name,
      aliases: condAliases.value.trim(),
      body_region: condRegion.value,
    };

    try {
      if (selectedId) {
        await api(`/api/conditions/${selectedId}`, { method: "PUT", body });
        showToast("Condition updated");
      } else {
        const result = await api("/api/conditions", { method: "POST", body });
        selectedId = result.id;
        showToast("Condition created");
      }
      await loadConditions();
      if (selectedId) selectCondition(selectedId);
    } catch (e) {
      showToast("Error: " + e.message);
    }
  });

  // --- Delete ---
  btnDelete.addEventListener("click", async () => {
    if (!selectedId) return;
    if (!confirm("Delete this condition and all its images?")) return;

    try {
      await api(`/api/conditions/${selectedId}`, { method: "DELETE" });
      showToast("Condition deleted");
      selectedId = null;
      placeholder.style.display = "";
      formSection.style.display = "none";
      await loadConditions();
    } catch (e) {
      showToast("Error: " + e.message);
    }
  });

  // --- Image Upload ---
  uploadZone.addEventListener("click", () => fileInput.click());
  uploadZone.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      fileInput.click();
    }
  });

  uploadZone.addEventListener("dragover", (e) => {
    e.preventDefault();
    uploadZone.classList.add("dragover");
  });

  uploadZone.addEventListener("dragleave", () => {
    uploadZone.classList.remove("dragover");
  });

  uploadZone.addEventListener("drop", (e) => {
    e.preventDefault();
    uploadZone.classList.remove("dragover");
    if (e.dataTransfer.files.length) uploadFiles(e.dataTransfer.files);
  });

  fileInput.addEventListener("change", () => {
    if (fileInput.files.length) uploadFiles(fileInput.files);
    fileInput.value = "";
  });

  async function uploadFiles(files) {
    if (!selectedId) return;

    const formData = new FormData();
    formData.append("view_label", uploadViewLabel.value.trim());
    for (const f of files) formData.append("file", f);

    try {
      await api(`/api/conditions/${selectedId}/images`, {
        method: "POST",
        body: formData,
      });
      showToast(`${files.length} image(s) uploaded`);
      uploadViewLabel.value = "";
      await loadConditions();
      selectCondition(selectedId);
    } catch (e) {
      showToast("Upload error: " + e.message);
    }
  }

  // --- Render Images ---
  function renderImages(images) {
    if (!images.length) {
      imageGrid.innerHTML = '<p style="color:#9ca3af;font-size:0.85rem">No images yet. Upload some above.</p>';
      return;
    }

    imageGrid.innerHTML = images
      .map(
        (img) => `
        <div class="image-card" data-img-id="${img.id}">
          <img src="/uploads/${img.filename}" alt="${esc(img.view_label || img.original_name)}">
          <div class="image-info">
            <input type="text" value="${esc(img.view_label)}" placeholder="View label" data-field="view_label">
            <div class="image-actions">
              <button class="btn-sm save" data-action="save-img">Save</button>
              <button class="btn-sm delete" data-action="delete-img">Delete</button>
            </div>
          </div>
        </div>`
      )
      .join("");
  }

  // --- Image Actions ---
  imageGrid.addEventListener("click", async (e) => {
    const btn = e.target.closest("[data-action]");
    if (!btn) return;
    const card = btn.closest(".image-card");
    const imgId = Number(card.dataset.imgId);
    const action = btn.dataset.action;

    if (action === "save-img") {
      const viewLabel = card.querySelector('[data-field="view_label"]').value.trim();
      try {
        await api(`/api/images/${imgId}`, { method: "PUT", body: { view_label: viewLabel } });
        showToast("Image updated");
      } catch (e) {
        showToast("Error: " + e.message);
      }
    }

    if (action === "delete-img") {
      if (!confirm("Delete this image?")) return;
      try {
        await api(`/api/images/${imgId}`, { method: "DELETE" });
        showToast("Image deleted");
        await loadConditions();
        selectCondition(selectedId);
      } catch (e) {
        showToast("Error: " + e.message);
      }
    }
  });

  // --- Utility ---
  function esc(s) {
    if (!s) return "";
    const d = document.createElement("div");
    d.textContent = s;
    return d.innerHTML;
  }

  // --- Init ---
  await loadConditions();
})();
