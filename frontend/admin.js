
"use strict";

// ======================================
// 1. APPLICATION STATE
// ======================================

const AUTH_TOKEN_KEY = "codealpha_ecommerce_token";

let products = [];
let users = [];
let isOwner = false;

const token = sessionStorage.getItem(AUTH_TOKEN_KEY);

// ======================================
// 2. GET HTML ELEMENTS
// ======================================

const productModal = document.getElementById("product-modal");

const openAddButton = document.getElementById("open-add-modal");
const closeModalButton = document.getElementById("close-modal");
const cancelModalButton = document.getElementById("cancel-modal");

const productForm = document.getElementById("product-form");

const menuToggle = document.getElementById("menu-toggle");
const sidebar = document.getElementById("sidebar");

const productList = document.getElementById("admin-product-list");
const productSearch = document.getElementById("product-search");

const totalProducts = document.getElementById("total-products");
const availableProducts = document.getElementById("available-products");
const outOfStock = document.getElementById("out-of-stock");

const usersNavLink = document.getElementById("users-nav-link");
const userSection = document.getElementById("users");

const userList = document.getElementById("admin-user-list");
const userSearch = document.getElementById("user-search");
const roleFilter = document.getElementById("role-filter");
const userMessage = document.getElementById("user-message");

const totalUsers = document.getElementById("total-users");
const totalAdmins = document.getElementById("total-admins");
const totalCustomers = document.getElementById("total-customers");

const refreshUsersButton = document.getElementById("refresh-users");

// ======================================
// 3. HTML ESCAPING
// ======================================

function escapeHTML(value) {
    return String(value ?? "").replace(/[&<>"']/g, (character) => {
        const entities = {
            "&": "&amp;",
            "<": "&lt;",
            ">": "&gt;",
            '"': "&quot;",
            "'": "&#39;"
        };

        return entities[character];
    });
}

// ======================================
// 4. AUTHENTICATED API HELPER
// ======================================

async function authenticatedRequest(url, options = {}) {
    if (!token) {
        window.location.href = "/index.html";
        throw new Error("Authentication required.");
    }

    const response = await fetch(url, {
        ...options,
        headers: {
            ...(options.headers || {}),
            "Authorization": `Bearer ${token}`
        }
    });

    if (response.status === 401) {
        sessionStorage.removeItem(AUTH_TOKEN_KEY);
        alert("Your session has expired. Please log in again.");
        window.location.href = "/index.html";
        throw new Error("Session expired.");
    }

    return response;
}

// ======================================
// 5. DETECT OWNER ROLE
// ======================================

async function initializeUserRole() {
    if (!token) {
        alert("Please log in to access the admin dashboard.");
        window.location.href = "/index.html";
        return;
    }

    try {
        const response = await authenticatedRequest("/api/owner/users");

        if (response.ok) {
            const data = await response.json();

            if (!Array.isArray(data)) {
                throw new Error("Invalid owner users response.");
            }

            isOwner = true;
            users = data;

            usersNavLink.hidden = false;
            userSection.hidden = false;

            document.getElementById("profile-role").textContent =
                "Store Owner";

            document.getElementById("profile-avatar").textContent = "O";

            renderUsers();
            updateUserStatistics();

            return;
        }

        if (response.status === 403) {
            isOwner = false;

            usersNavLink.hidden = true;
            userSection.hidden = true;

            document.getElementById("profile-role").textContent =
                "Administrator";

            document.getElementById("profile-avatar").textContent = "A";

            return;
        }

        throw new Error("Unable to verify account permissions.");

    } catch (error) {
        console.error("Role verification error:", error);

        if (error.message !== "Session expired.") {
            alert("Unable to verify your account permissions.");
        }
    }
}

// ======================================
// 6. LOAD PRODUCTS
// ======================================

async function loadProducts() {
    productList.innerHTML = `
        <tr>
            <td colspan="6" class="empty-state">
                Loading products...
            </td>
        </tr>
    `;

    try {
        const response = await fetch("/api/products");

        if (!response.ok) {
            throw new Error(`HTTP error: ${response.status}`);
        }

        const data = await response.json();

        if (!Array.isArray(data)) {
            throw new Error("Invalid products response.");
        }

        products = data;

        renderProducts(products);
        updateDashboardStatistics();

    } catch (error) {
        console.error("Unable to load products:", error);

        productList.innerHTML = `
            <tr>
                <td colspan="6" class="empty-state">
                    Unable to load products.
                </td>
            </tr>
        `;
    }
}

// ======================================
// 7. DISPLAY PRODUCTS
// ======================================


function renderProducts(productsToRender) {
    productList.innerHTML = "";

    if (productsToRender.length === 0) {
        productList.innerHTML = `
            <tr>
                <td colspan="6" class="empty-state">
                    No products found.
                </td>
            </tr>
        `;
        return;
    }

    productsToRender.forEach((product) => {
        const stock = Number(product.stock);
        const price = Number(product.price);

        const status = stock > 0 ? "In Stock" : "Out of Stock";

        const row = document.createElement("tr");

        row.innerHTML = `
            <td>${Number(product.id)}</td>
            <td>${escapeHTML(product.name)}</td>
            <td>${Number.isFinite(price) ? price.toFixed(2) : "0.00"} ETB</td>
            <td>${Number.isFinite(stock) ? stock : 0}</td>
            <td>${status}</td>
            <td>
                <button
                    type="button"
                    data-action="edit"
                    data-product-id="${Number(product.id)}"
                >Edit</button>

                <button
                    type="button"
                    data-action="delete"
                    data-product-id="${Number(product.id)}"
                >Delete</button>
            </td>
        `;

        productList.appendChild(row);
    });
}


// ======================================
// 8. PRODUCT STATISTICS
// ======================================

function updateDashboardStatistics() {
    const total = products.length;

    const available = products.filter((product) => {
        return Number(product.stock) > 0;
    }).length;

    const unavailable = products.filter((product) => {
        return Number(product.stock) <= 0;
    }).length;

    totalProducts.textContent = total;
    availableProducts.textContent = available;
    outOfStock.textContent = unavailable;
}

// ======================================
// 9. PRODUCT SEARCH
// ======================================

productSearch.addEventListener("input", () => {
    const searchTerm = productSearch.value.toLowerCase().trim();

    const filteredProducts = products.filter((product) => {
        return String(product.name)
            .toLowerCase()
            .includes(searchTerm);
    });

    renderProducts(filteredProducts);
});


// ======================================
// 10. PRODUCT MODAL
// ======================================

const productImageFile = document.getElementById("product-image-file");
const productImagePreview = document.getElementById("product-image-preview");

// Preview selected image.
productImageFile.addEventListener("change", () => {
    const file = productImageFile.files[0];

    if (!file) {
        productImagePreview.src = "";
        productImagePreview.hidden = true;
        return;
    }

    if (file.size > 5 * 1024 * 1024) {
        alert("Image must not exceed 5 MB.");
        productImageFile.value = "";
        productImagePreview.src = "";
        productImagePreview.hidden = true;
        return;
    }

    const allowedTypes = [
        "image/jpeg",
        "image/png",
        "image/webp"
    ];

    if (!allowedTypes.includes(file.type)) {
        alert("Please select a JPG, PNG, or WebP image.");
        productImageFile.value = "";
        productImagePreview.src = "";
        productImagePreview.hidden = true;
        return;
    }

    productImagePreview.src = URL.createObjectURL(file);
    productImagePreview.hidden = false;
});

openAddButton.addEventListener("click", () => {
    productForm.reset();

    document.getElementById("product-id").value = "";
    document.getElementById("modal-title").textContent =
        "Add New Product";
    productForm.querySelector('button[type="submit"]').textContent =
        "Save Product";

    productImagePreview.src = "";
    productImagePreview.hidden = true;

    productModal.classList.add("show");
});

function closeModal() {
    productModal.classList.remove("show");
}

closeModalButton.addEventListener("click", closeModal);
cancelModalButton.addEventListener("click", closeModal);

productModal.addEventListener("click", (event) => {
    if (event.target === productModal) {
        closeModal();
    }
});


// ======================================
// EDIT AND DELETE PRODUCTS
// ======================================

productList.addEventListener("click", async (event) => {
    const button = event.target.closest("button[data-action]");

    if (!button) {
        return;
    }

    const productId = Number(button.dataset.productId);

    const product = products.find((item) => {
        return Number(item.id) === productId;
    });

    if (!product) {
        alert("Product not found.");
        return;
    }

    // EDIT PRODUCT
    if (button.dataset.action === "edit") {
        productForm.reset();

        document.getElementById("product-id").value = product.id;
        document.getElementById("product-name").value = product.name;
        document.getElementById("product-description").value =
            product.description || "";
        document.getElementById("product-price").value = product.price;
        document.getElementById("product-stock").value = product.stock;

        // Reset the file input
        productImageFile.value = "";

        // Show the existing image preview
        if (product.image) {
            productImagePreview.src = product.image;
            productImagePreview.hidden = false;
        } else {
            productImagePreview.src = "";
            productImagePreview.hidden = true;
        }

        // Only populate the URL field for external image URLs
        document.getElementById("product-image").value =
            product.image && !product.image.startsWith("/uploads/")
                ? product.image
                : "";

        document.getElementById("modal-title").textContent =
            "Edit Product";

        productForm.querySelector('button[type="submit"]').textContent =
            "Update Product";

        productModal.classList.add("show");

        return;
    }

    // DELETE PRODUCT
    if (button.dataset.action === "delete") {
        const confirmed = confirm(
            `Are you sure you want to delete "${product.name}"?`
        );

        if (!confirmed) {
            return;
        }

        try {
            button.disabled = true;
            button.textContent = "Deleting...";

            const response = await authenticatedRequest(
                `/api/admin/products/${productId}`,
                {
                    method: "DELETE"
                }
            );

            const result = await response.json();

            if (!response.ok) {
                alert(result.message || "Unable to delete product.");
                return;
            }

            alert(result.message || "Product deleted successfully.");

            await loadProducts();

        } catch (error) {
            console.error("Delete product error:", error);

            if (error.message !== "Session expired.") {
                alert("Could not connect to the server.");
            }

        } finally {
            button.disabled = false;
            button.textContent = "Delete";
        }
    }
});

// ======================================
// 11. MOBILE SIDEBAR
// ======================================

menuToggle.addEventListener("click", () => {
    sidebar.classList.toggle("open");
});

// ======================================
// 12. ADD PRODUCT
// ======================================


productForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    const productId = document.getElementById("product-id").value;
    const isEditing = Boolean(productId);

    const name = document.getElementById("product-name").value.trim();
    const description = document.getElementById("product-description").value.trim();
    const price = document.getElementById("product-price").value;
    const stock = document.getElementById("product-stock").value;
    const imageUrl = document.getElementById("product-image").value.trim();

    const imageFile = productImageFile.files[0];

    const formData = new FormData();

    formData.append("name", name);
    formData.append("description", description);
    formData.append("price", price);
    formData.append("stock", stock);
    formData.append("image_url", imageUrl);

    if (imageFile) {
        formData.append("image", imageFile);
    }

    const saveButton = productForm.querySelector(
        'button[type="submit"]'
    );

    try {
        saveButton.disabled = true;
        saveButton.textContent = isEditing
            ? "Updating..."
            : "Saving...";

        const response = await authenticatedRequest(
            isEditing
                ? `/api/admin/products/${productId}`
                : "/api/admin/products",
            {
                method: isEditing ? "PUT" : "POST",
                body: formData
            }
        );

        const result = await response.json();

        if (!response.ok) {
            alert(
                result.message ||
                (isEditing
                    ? "Failed to update product."
                    : "Failed to add product.")
            );
            return;
        }

        alert(
            isEditing
                ? "Product updated successfully!"
                : "Product added successfully!"
        );

        productForm.reset();

        document.getElementById("product-id").value = "";

        productImagePreview.src = "";
        productImagePreview.hidden = true;

        document.getElementById("modal-title").textContent =
            "Add New Product";

        closeModal();

        await loadProducts();

    } catch (error) {
        console.error("Save product error:", error);

        if (error.message !== "Session expired.") {
            alert("Could not connect to the server.");
        }

    } finally {
        saveButton.disabled = false;
        saveButton.textContent = "Save Product";
    }
});




// ======================================
// 11. MOBILE SIDEBAR
// ======================================

menuToggle.addEventListener("click", () => {
    sidebar.classList.toggle("open");
});


// ======================================
// 13. LOAD ALL USERS (OWNER ONLY)
// ======================================

async function loadUsers() {
    if (!isOwner) {
        return;
    }

    userList.innerHTML = `
        <tr>
            <td colspan="6" class="empty-state">
                Loading users...
            </td>
        </tr>
    `;

    userMessage.textContent = "";

    try {
        const response = await authenticatedRequest("/api/owner/users");

        if (!response.ok) {
            throw new Error("Unable to retrieve users.");
        }

        const data = await response.json();

        if (!Array.isArray(data)) {
            throw new Error("Invalid users response.");
        }

        users = data;

        renderUsers();
        updateUserStatistics();

        showUserMessage("User list updated successfully.", "success");

    } catch (error) {
        console.error("User loading error:", error);

        userList.innerHTML = `
            <tr>
                <td colspan="6" class="empty-state">
                    Unable to load users.
                </td>
            </tr>
        `;

        if (error.message !== "Session expired.") {
            showUserMessage(error.message, "error");
        }
    }
}

// ======================================
// 14. DISPLAY USERS
// ======================================

function renderUsers() {
    if (!isOwner) {
        return;
    }

    const searchTerm = userSearch.value.toLowerCase().trim();
    const selectedRole = roleFilter.value;

    const filteredUsers = users.filter((user) => {
        const matchesSearch =
            String(user.name).toLowerCase().includes(searchTerm) ||
            String(user.email).toLowerCase().includes(searchTerm);

        const matchesRole =
            selectedRole === "all" || user.role === selectedRole;

        return matchesSearch && matchesRole;
    });

    userList.innerHTML = "";

    if (filteredUsers.length === 0) {
        userList.innerHTML = `
            <tr>
                <td colspan="6" class="empty-state">
                    No matching users found.
                </td>
            </tr>
        `;
        return;
    }

    filteredUsers.forEach((user) => {
        const row = document.createElement("tr");

        let actionButton = "";

        if (user.role === "customer") {
            actionButton = `
                <button
                    type="button"
                    class="role-action promote-button"
                    data-user-id="${Number(user.id)}"
                    data-action="promote">
                    Promote to Admin
                </button>
            `;
        } else if (user.role === "admin") {
            actionButton = `
                <button
                    type="button"
                    class="role-action demote-button"
                    data-user-id="${Number(user.id)}"
                    data-action="demote">
                    Demote to Customer
                </button>
            `;
        } else {
            actionButton = `
                <span class="protected-label">Protected</span>
            `;
        }

        const registeredDate = user.created_at
            ? new Date(user.created_at).toLocaleDateString()
            : "Unknown";

        row.innerHTML = `
            <td>${Number(user.id)}</td>
            <td>${escapeHTML(user.name)}</td>
            <td>${escapeHTML(user.email)}</td>
            <td>
                <span class="role-badge ${escapeHTML(user.role)}">
                    ${escapeHTML(user.role)}
                </span>
            </td>
            <td>${escapeHTML(registeredDate)}</td>
            <td>${actionButton}</td>
        `;

        userList.appendChild(row);
    });
}

// ======================================
// 15. USER STATISTICS
// ======================================

function updateUserStatistics() {
    totalUsers.textContent = users.length;

    totalAdmins.textContent = users.filter((user) => {
        return user.role === "admin";
    }).length;

    totalCustomers.textContent = users.filter((user) => {
        return user.role === "customer";
    }).length;
}

// ======================================
// 16. USER SEARCH AND ROLE FILTER
// ======================================

userSearch.addEventListener("input", renderUsers);
roleFilter.addEventListener("change", renderUsers);

// ======================================
// 17. SHOW USER MESSAGE
// ======================================

function showUserMessage(message, type = "success") {
    userMessage.textContent = message;
    userMessage.className = `user-message ${type}`;
}

// ======================================
// 18. PROMOTE / DEMOTE USERS
// ======================================

userList.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-action]");

    if (!button || !isOwner) {
        return;
    }

    const userId = Number(button.dataset.userId);
    const action = button.dataset.action;

    const selectedUser = users.find((user) => {
        return Number(user.id) === userId;
    });

    if (!selectedUser) {
        showUserMessage("User account not found.", "error");
        return;
    }

    const isPromoting = action === "promote";

    const confirmation = isPromoting
        ? `Promote ${selectedUser.name} to administrator?`
        : `Demote ${selectedUser.name} to customer?`;

    if (!window.confirm(confirmation)) {
        return;
    }

    button.disabled = true;
    button.textContent = "Processing...";

    try {
        const endpoint = isPromoting
            ? `/api/owner/users/${userId}/promote`
            : `/api/owner/users/${userId}/demote`;

        const response = await authenticatedRequest(endpoint, {
            method: "PUT"
        });

        const result = await response.json();

        if (!response.ok) {
            throw new Error(result.message || "Role update failed.");
        }

        showUserMessage(
            result.message || "User role updated successfully.",
            "success"
        );

        await loadUsers();

    } catch (error) {
        console.error("Role update error:", error);

        if (error.message !== "Session expired.") {
            showUserMessage(error.message, "error");
        }

        await loadUsers();
    }
});

// ======================================
// 19. REFRESH USERS
// ======================================

refreshUsersButton.addEventListener("click", loadUsers);

// ======================================
// 20. SIDEBAR NAVIGATION
// ======================================

document.querySelectorAll(".nav-link[href^='#']").forEach((link) => {
    link.addEventListener("click", () => {
        document.querySelectorAll(".nav-link").forEach((item) => {
            item.classList.remove("active");
        });

        link.classList.add("active");
        sidebar.classList.remove("open");
    });
});

// ======================================
// 21. START APPLICATION
// ======================================

async function initializeDashboard() {
    if (!token) {
        alert("Please log in first.");
        window.location.href = "/index.html";
        return;
    }

    await initializeUserRole();

    if (!sessionStorage.getItem(AUTH_TOKEN_KEY)) {
        return;
    }

    await loadProducts();

    if (isOwner) {
        await loadUsers();
    }
}

initializeDashboard();
