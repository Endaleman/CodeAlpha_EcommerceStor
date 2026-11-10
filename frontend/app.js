
"use strict";

// ============================================
// 1. APPLICATION STATE AND HTML ELEMENTS
// ============================================

const CART_STORAGE_KEY = "codealpha_ecommerce_cart";

let products = [];
let cart = [];

const productList = document.getElementById("product-list");
const statusMessage = document.getElementById("status");

const cartItemsElement = document.getElementById("cart-items");
const cartCountElement = document.getElementById("cart-count");
const cartTotalElement = document.getElementById("cart-total");
const clearCartButton = document.getElementById("clear-cart");

const searchInput = document.getElementById("searchInput");
const minPriceInput = document.getElementById("minPrice");
const maxPriceInput = document.getElementById("maxPrice");
const sortSelect = document.getElementById("sortSelect");
const filterButton = document.getElementById("filterButton");
const resetButton = document.getElementById("resetButton");

// ============================================
// 2. ESCAPE HTML TO HELP PREVENT XSS
// ============================================

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

// ============================================
// 3. SAVE CART TO BROWSER STORAGE
// ============================================

function saveCart() {
    try {
        const savedItems = cart.map((item) => ({
            id: item.id,
            quantity: item.quantity
        }));

        localStorage.setItem(
            CART_STORAGE_KEY,
            JSON.stringify(savedItems)
        );
    } catch (error) {
        console.error("Unable to save cart:", error);

        statusMessage.textContent =
            "Warning: Your cart could not be saved in this browser.";
    }
}

// ============================================
// 4. RESTORE CART AFTER PRODUCTS LOAD
// ============================================

function restoreCart() {
    try {
        const savedData = localStorage.getItem(CART_STORAGE_KEY);

        if (!savedData) {
            cart = [];
            return;
        }

        const savedItems = JSON.parse(savedData);

        if (!Array.isArray(savedItems)) {
            cart = [];
            saveCart();
            return;
        }

        cart = savedItems
            .filter((item) => {
                return (
                    item &&
                    Number.isInteger(Number(item.id)) &&
                    Number(item.id) > 0 &&
                    Number.isInteger(item.quantity) &&
                    item.quantity > 0
                );
            })
            .map((item) => {
                const product = products.find(
                    (product) => Number(product.id) === Number(item.id)
                );

                if (!product) {
                    return null;
                }

                const stock = Number(product.stock);

                if (!Number.isFinite(stock) || stock <= 0) {
                    return null;
                }

                return {
                    ...product,
                    quantity: Math.min(item.quantity, stock)
                };
            })
            .filter(Boolean);

        saveCart();
    } catch (error) {
        console.error("Unable to restore cart:", error);
        cart = [];
        saveCart();
    }
}

// ============================================
// 5. LOAD PRODUCTS FROM THE BACKEND
// ============================================

async function loadProducts() {
    statusMessage.textContent = "Loading products...";

    try {
        const response = await fetch("/api/products");

        if (!response.ok) {
            throw new Error(`Request failed: ${response.status}`);
        }

        const data = await response.json();

        if (!Array.isArray(data)) {
            throw new Error("The products API did not return a product list.");
        }

        products = data;

        restoreCart();
        renderProducts();
        renderCart();

        statusMessage.textContent = products.length
            ? "Products loaded successfully."
            : "No products are available.";
    } catch (error) {
        console.error("Unable to load products:", error);

        statusMessage.textContent =
            "Unable to load products. Check that the backend is running.";
    }
}

// ============================================
// 6. DISPLAY PRODUCTS
// ============================================


function renderProducts(productsToRender = products) {
    productList.innerHTML = "";

    if (productsToRender.length === 0) {
        productList.textContent = "No products match your filters.";
        return;
    }

    productsToRender.forEach((product) => {
        const stock = Number(product.stock);
        const price = Number(product.price);

        const article = document.createElement("article");
        article.className = "product-card";

        article.innerHTML = `
            <div class="product-image-wrapper">
                ${product.image
                ? `
                            <img
                                src="${escapeHTML(product.image)}"
                                alt="${escapeHTML(product.name)}"
                                loading="lazy"
                            />
                        `
                : `
                            <div class="product-image-placeholder">
                                No image available
                            </div>
                        `
            }
            </div>

            <div class="product-content">
                <h3>${escapeHTML(product.name)}</h3>

                <p class="product-description">
                    ${escapeHTML(product.description || "No description available.")}
                </p>

                <div class="product-details">
                    <span class="product-price">
                        ${Number.isFinite(price) ? price.toFixed(2) : "0.00"} ETB
                    </span>

                    <span class="product-stock ${stock > 0 ? "in-stock" : "out-of-stock"}">
                        ${stock > 0 ? `${stock} available` : "Out of stock"}
                    </span>
                </div>

                <button
                    type="button"
                    class="add-to-cart"
                    data-id="${Number(product.id)}"
                    ${stock <= 0 ? "disabled" : ""}
                >
                    ${stock <= 0 ? "Out of Stock" : "Add to Cart"}
                </button>
            </div>
        `;

        productList.appendChild(article);
    });
}

// ============================================
// 7. SEARCH, FILTER, AND SORT PRODUCTS
// ============================================

function applyFilters() {
    const search = searchInput.value.trim().toLowerCase();
    const minText = minPriceInput.value.trim();
    const maxText = maxPriceInput.value.trim();
    const sort = sortSelect.value;

    const minPrice = minText === "" ? null : Number(minText);
    const maxPrice = maxText === "" ? null : Number(maxText);

    // Validate price inputs.
    if (
        (minPrice !== null &&
            (!Number.isFinite(minPrice) || minPrice < 0)) ||
        (maxPrice !== null &&
            (!Number.isFinite(maxPrice) || maxPrice < 0))
    ) {
        statusMessage.textContent =
            "Enter valid, non-negative prices.";
        return;
    }

    if (
        minPrice !== null &&
        maxPrice !== null &&
        minPrice > maxPrice
    ) {
        statusMessage.textContent =
            "Minimum price cannot be greater than maximum price.";
        return;
    }

    const allowedSortOptions = [
        "",
        "name_asc",
        "name_desc",
        "price_asc",
        "price_desc"
    ];

    if (!allowedSortOptions.includes(sort)) {
        statusMessage.textContent = "Please select a valid sort option.";
        return;
    }

    // Filter by product name, description, and price.
    const filteredProducts = products.filter((product) => {
        const name = String(product.name ?? "").toLowerCase();
        const description = String(product.description ?? "").toLowerCase();
        const price = Number(product.price);

        const matchesSearch =
            name.includes(search) || description.includes(search);

        const matchesMin =
            minPrice === null || price >= minPrice;

        const matchesMax =
            maxPrice === null || price <= maxPrice;

        return matchesSearch && matchesMin && matchesMax;
    });

    // Sort the filtered results.
    switch (sort) {
        case "name_asc":
            filteredProducts.sort((a, b) =>
                String(a.name).localeCompare(String(b.name))
            );
            break;

        case "name_desc":
            filteredProducts.sort((a, b) =>
                String(b.name).localeCompare(String(a.name))
            );
            break;

        case "price_asc":
            filteredProducts.sort(
                (a, b) => Number(a.price) - Number(b.price)
            );
            break;

        case "price_desc":
            filteredProducts.sort(
                (a, b) => Number(b.price) - Number(a.price)
            );
            break;
    }

    renderProducts(filteredProducts);

    statusMessage.textContent = filteredProducts.length
        ? `Found ${filteredProducts.length} product(s).`
        : "No products match your filters.";
}

// ============================================
// 8. RESET SEARCH, FILTERS, AND SORTING
// ============================================

function resetFilters() {
    searchInput.value = "";
    minPriceInput.value = "";
    maxPriceInput.value = "";
    sortSelect.value = "";

    renderProducts();

    statusMessage.textContent =
        "Filters reset. Showing all products.";
}

// ============================================
// 9. ADD PRODUCTS TO THE CART
// ============================================

function addToCart(productId) {
    const product = products.find(
        (item) => Number(item.id) === Number(productId)
    );

    if (!product) {
        statusMessage.textContent = "Product not found.";
        return;
    }

    const stock = Number(product.stock);

    if (!Number.isInteger(stock) || stock <= 0) {
        statusMessage.textContent = "This product is out of stock.";
        return;
    }

    const existingItem = cart.find(
        (item) => Number(item.id) === Number(productId)
    );

    if (existingItem) {
        if (existingItem.quantity >= stock) {
            statusMessage.textContent =
                "You cannot add more than the available stock.";
            return;
        }

        existingItem.quantity += 1;
    } else {
        cart.push({
            ...product,
            quantity: 1
        });
    }

    saveCart();
    renderCart();

    statusMessage.textContent = `${product.name} added to cart.`;
}

// ============================================
// 10. REMOVE A PRODUCT FROM THE CART
// ============================================

function removeFromCart(productId) {
    cart = cart.filter(
        (item) => Number(item.id) !== Number(productId)
    );

    saveCart();
    renderCart();

    statusMessage.textContent = "Product removed from cart.";
}

// ============================================
// 11. DISPLAY CART AND CALCULATE TOTALS
// ============================================

function renderCart() {
    cartItemsElement.innerHTML = "";

    const totalItems = cart.reduce(
        (total, item) => total + item.quantity,
        0
    );

    const totalPrice = cart.reduce(
        (total, item) =>
            total + Number(item.price) * item.quantity,
        0
    );

    cartCountElement.textContent = totalItems;
    cartTotalElement.textContent = totalPrice.toFixed(2);

    if (cart.length === 0) {
        cartItemsElement.textContent = "Your cart is empty.";
        return;
    }

    cart.forEach((item) => {
        const row = document.createElement("div");

        row.className = "cart-item";

        row.innerHTML = `
            <span>
                ${escapeHTML(item.name)}
                × ${item.quantity}
                — ${(Number(item.price) * item.quantity).toFixed(2)} ETB
            </span>

            <button
                type="button"
                class="remove-from-cart"
                data-id="${Number(item.id)}"
            >
                Remove
            </button>
        `;

        cartItemsElement.appendChild(row);
    });
}

// ============================================
// 12. CONNECT PRODUCT BUTTONS
// ============================================

productList.addEventListener("click", (event) => {
    const button = event.target.closest(".add-to-cart");

    if (!button) {
        return;
    }

    addToCart(Number(button.dataset.id));
});

// ============================================
// 13. CONNECT CART REMOVE BUTTONS
// ============================================

cartItemsElement.addEventListener("click", (event) => {
    const button = event.target.closest(".remove-from-cart");

    if (!button) {
        return;
    }

    removeFromCart(Number(button.dataset.id));
});

// ============================================
// 14. CLEAR THE CART
// ============================================

clearCartButton.addEventListener("click", () => {
    cart = [];

    saveCart();
    renderCart();

    statusMessage.textContent = "Cart cleared.";
});

// ============================================
// 15. CONNECT FILTER AND RESET BUTTONS
// ============================================

filterButton.addEventListener("click", applyFilters);
resetButton.addEventListener("click", resetFilters);

// Press Enter in the search input to apply filters.
searchInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
        applyFilters();
    }
});


// ============================================
// 16. CHECKOUT AND ORDER SUBMISSION
// ============================================

// Get the checkout HTML elements.
const checkoutForm = document.getElementById("checkout-form");
const checkoutMessage = document.getElementById("checkout-message");
const placeOrderButton = document.getElementById("place-order-button");

// Prevent multiple submissions at the same time.
let isSubmittingOrder = false;

// Display checkout messages.
function showCheckoutMessage(message) {
    checkoutMessage.textContent = message;
}

// Handle checkout form submission.


async function handleCheckout(event) {
    event.preventDefault();

    if (isSubmittingOrder) {
        return;
    }

    if (cart.length === 0) {
        showCheckoutMessage("Your cart is empty. Add products first.");
        return;
    }

    const orderData = {
        customerName: document.getElementById("customerName").value.trim(),
        customerEmail: document.getElementById("customerEmail").value.trim(),
        customerPhone: document.getElementById("customerPhone").value.trim(),
        deliveryStreet: document.getElementById("deliveryStreet").value.trim(),
        deliveryCity: document.getElementById("deliveryCity").value.trim(),
        deliveryArea: document.getElementById("deliveryArea").value.trim(),
        deliveryLocationUrl: document.getElementById("deliveryLocationUrl").value.trim(),
        deliveryInstructions: document.getElementById("deliveryInstructions").value.trim(),
        items: cart.map((item) => ({
            productId: Number(item.id),
            quantity: Number(item.quantity)
        }))
    };

    const originalButtonText = placeOrderButton.textContent;

    try {
        isSubmittingOrder = true;

        placeOrderButton.disabled = true;
        clearCartButton.disabled = true;

        cartItemsElement
            .querySelectorAll(".remove-from-cart")
            .forEach((button) => {
                button.disabled = true;
            });

        productList
            .querySelectorAll(".add-to-cart")
            .forEach((button) => {
                button.disabled = true;
            });

        placeOrderButton.textContent = "Processing...";

        // Reuse an order if payment initialization previously failed.
        let orderId = sessionStorage.getItem("pendingPaymentOrderId");

        if (!orderId) {
            showCheckoutMessage("Creating your order...");

            const orderResponse = await fetch("/api/orders", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify(orderData)
            });

            const orderResult = await orderResponse.json();

            if (!orderResponse.ok) {
                throw new Error(
                    orderResult.message || "Unable to create your order."
                );
            }

            orderId = String(orderResult.order.id);

            sessionStorage.setItem("pendingPaymentOrderId", orderId);
        }

        // Initialize Chapa payment.
        showCheckoutMessage("Connecting to Chapa payment...");

        const paymentResponse = await fetch(
            "/api/payments/chapa/initialize",
            {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    orderId: Number(orderId)
                })
            }
        );

        const paymentResult = await paymentResponse.json();

        if (!paymentResponse.ok) {
            throw new Error(
                paymentResult.message || "Unable to initialize payment."
            );
        }

        if (!paymentResult.checkoutUrl) {
            throw new Error("Chapa did not return a checkout URL.");
        }

        showCheckoutMessage("Redirecting you to Chapa...");

        window.location.assign(paymentResult.checkoutUrl);

    } catch (error) {
        console.error("Checkout/payment error:", error);

        showCheckoutMessage(
            error.message || "Unable to process your payment. Please try again."
        );

    } finally {
        isSubmittingOrder = false;

        placeOrderButton.disabled = false;
        placeOrderButton.textContent = originalButtonText;

        clearCartButton.disabled = cart.length === 0;

        cartItemsElement
            .querySelectorAll(".remove-from-cart")
            .forEach((button) => {
                button.disabled = false;
            });

        productList
            .querySelectorAll(".add-to-cart")
            .forEach((button) => {
                const product = products.find(
                    (item) => Number(item.id) === Number(button.dataset.id)
                );

                button.disabled = !product || Number(product.stock) <= 0;
            });
    }
}


// Listen for checkout form submission.
checkoutForm.addEventListener("submit", handleCheckout);


// ============================================
// 17. MY ORDERS - ORDER HISTORY
// ============================================

const orderSearchForm = document.getElementById("order-search-form");
const orderEmailInput = document.getElementById("order-email");
const orderHistoryMessage = document.getElementById("order-history-message");
const orderHistoryList = document.getElementById("order-history-list");
const orderDetailsContainer = document.getElementById("order-details");
const findOrdersButton = document.getElementById("find-orders-button");

let currentOrderEmail = "";

function formatOrderDate(dateValue) {
    const date = new Date(dateValue);

    if (Number.isNaN(date.getTime())) {
        return "Date unavailable";
    }

    return date.toLocaleString();
}

function formatOrderMoney(amount) {
    const value = Number(amount);

    return Number.isFinite(value)
        ? `${value.toFixed(2)} ETB`
        : "Amount unavailable";
}

function renderOrderHistory(orders) {
    if (!Array.isArray(orders) || orders.length === 0) {
        orderHistoryList.innerHTML =
            "<p>No orders found for this email address.</p>";
        return;
    }

    orderHistoryList.innerHTML = orders.map((order) => `
        <article class="order-card">
            <h3>Order #${escapeHTML(order.id)}</h3>

            <p>
                <strong>Date:</strong>
                ${escapeHTML(formatOrderDate(order.createdAt))}
            </p>

            <p>
                <strong>Total:</strong>
                ${escapeHTML(formatOrderMoney(order.totalAmount))}
            </p>

            <p>
                <strong>Items:</strong>
                ${escapeHTML(order.itemCount)}
            </p>

            <p>
                <strong>Status:</strong>
                <span class="order-status">
                    ${escapeHTML(order.status)}
                </span>
            </p>

            <button
                type="button"
                class="view-order-button"
                data-order-id="${escapeHTML(order.id)}"
                aria-expanded="false"
            >
                View Details
            </button>

            <div
                class="order-details-panel"
                id="order-details-${escapeHTML(order.id)}"
                hidden
            ></div>
        </article>
    `).join("");
}

async function loadOrderHistory(email) {
    orderHistoryMessage.textContent = "Loading your orders...";
    orderHistoryList.innerHTML = "";
    orderDetailsContainer.innerHTML = "";
    findOrdersButton.disabled = true;

    try {
        const query = new URLSearchParams({ email });

        const response = await fetch(`/api/orders?${query.toString()}`);
        const result = await response.json();

        if (!response.ok) {
            throw new Error(result.message || "Unable to load orders.");
        }

        currentOrderEmail = email;

        renderOrderHistory(result.orders);

        orderHistoryMessage.textContent =
            `Found ${result.count} order(s).`;

    } catch (error) {
        console.error("Order history error:", error);
        orderHistoryMessage.textContent = error.message;
    } finally {
        findOrdersButton.disabled = false;
    }
}

orderSearchForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    const email = orderEmailInput.value.trim().toLowerCase();

    if (!email) {
        orderHistoryMessage.textContent = "Please enter your email address.";
        return;
    }

    await loadOrderHistory(email);
});


// ============================================
// 18. MY ORDERS - ORDER DETAILS
// ============================================

async function loadOrderDetails(orderId) {
    const detailsPanel = document.getElementById(
        `order-details-${orderId}`
    );

    if (!detailsPanel) {
        return;
    }

    detailsPanel.innerHTML = "<p>Loading order details...</p>";

    try {
        const query = new URLSearchParams({
            email: currentOrderEmail
        });

        const response = await fetch(
            `/api/orders/${encodeURIComponent(orderId)}?${query.toString()}`
        );

        const result = await response.json();

        if (!response.ok) {
            throw new Error(result.message || "Unable to load order details.");
        }

        const order = result.order;

        const itemRows = order.items.map((item) => `
            <tr>
                <td>${escapeHTML(item.productName || "Unavailable product")}</td>
                <td class="order-number-cell">${escapeHTML(item.quantity)}</td>
                <td class="order-money-cell">${escapeHTML(formatOrderMoney(item.unitPrice))}</td>
                <td class="order-money-cell">${escapeHTML(formatOrderMoney(item.subtotal))}</td>
            </tr>
        `).join("");

        let deliveryLocationHtml = "";

        if (order.deliveryLocationUrl) {
            try {
                const locationUrl = new URL(order.deliveryLocationUrl);

                if (
                    locationUrl.protocol === "https:" ||
                    locationUrl.protocol === "http:"
                ) {
                    deliveryLocationHtml = `
                        <p>
                            <strong>Google Maps:</strong>
                            <a
                                href="${escapeHTML(locationUrl.href)}"
                                target="_blank"
                                rel="noopener noreferrer"
                            >
                                View Delivery Location
                            </a>
                        </p>
                    `;
                }
            } catch (error) {
                console.warn("Invalid delivery location link.");
            }
        }

        detailsPanel.innerHTML = `
            <article class="order-details-card">
                <h4>Customer Information</h4>

                <p><strong>Name:</strong> ${escapeHTML(order.customerName)}</p>
                <p><strong>Email:</strong> ${escapeHTML(order.customerEmail)}</p>
                <p><strong>Phone:</strong> ${escapeHTML(order.customerPhone)}</p>
                <p><strong>Street / Building:</strong> ${escapeHTML(order.deliveryAddress)}</p>
                <p><strong>City / Sub-city:</strong> ${escapeHTML(order.deliveryCity || "Not provided")}</p>
                <p><strong>Area / Woreda:</strong> ${escapeHTML(order.deliveryArea || "Not provided")}</p>
                ${deliveryLocationHtml}
                <p><strong>Delivery Instructions:</strong> ${escapeHTML(order.deliveryInstructions || "None")}</p>

                <h4>Order Information</h4>

                <p><strong>Order Status:</strong> ${escapeHTML(order.status)}</p>
                <p><strong>Payment Status:</strong> ${escapeHTML(order.paymentStatus || "unpaid")}</p>
                <p><strong>Total:</strong> ${escapeHTML(formatOrderMoney(order.totalAmount))}</p>

                <h4>Purchased Products</h4>

                <div class="order-table-wrapper">
                    <table class="order-table">
                        <thead>
                            <tr>
                                <th>Product</th>
                                <th>Quantity</th>
                                <th>Unit Price</th>
                                <th>Subtotal</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${itemRows}
                        </tbody>
                    </table>
                </div>
            </article>
        `;

        detailsPanel.dataset.loaded = "true";

    } catch (error) {
        console.error("Order details error:", error);

        detailsPanel.innerHTML =
            `<p>${escapeHTML(error.message)}</p>`;
    }
}

// Event delegation: handles View Details buttons
// even after the order list is re-rendered.
orderHistoryList.addEventListener("click", (event) => {
    orderHistoryList.addEventListener("click", async (event) => {
        const button = event.target.closest(".view-order-button");

        if (!button || !currentOrderEmail) {
            return;
        }

        const orderId = button.dataset.orderId;

        const detailsPanel = document.getElementById(
            `order-details-${orderId}`
        );

        if (!detailsPanel) {
            return;
        }

        const isExpanded = button.getAttribute("aria-expanded") === "true";

        if (isExpanded) {
            detailsPanel.hidden = true;
            button.setAttribute("aria-expanded", "false");
            button.textContent = "View Details";
            return;
        }

        detailsPanel.hidden = false;
        button.setAttribute("aria-expanded", "true");
        button.textContent = "Hide Details";

        if (detailsPanel.dataset.loaded !== "true") {
            await loadOrderDetails(orderId);
        }
    });

    loadOrderDetails(button.dataset.orderId);
});


// ============================================
// 19. CUSTOMER AUTHENTICATION
// ============================================

const AUTH_TOKEN_KEY = "codealpha_ecommerce_token";

// Authentication HTML elements
const loginForm = document.getElementById("login-form");
const registerForm = document.getElementById("register-form");

const loginMessage = document.getElementById("login-message");
const registerMessage = document.getElementById("register-message");

const customerAccount = document.getElementById("customer-account");
const accountName = document.getElementById("account-name");
const accountEmail = document.getElementById("account-email");

const logoutButton = document.getElementById("logout-button");


// --------------------------------------------
// 19.1 DISPLAY CUSTOMER ACCOUNT
// --------------------------------------------

function displayCustomer(user) {
    loginForm.hidden = true;
    registerForm.hidden = true;

    customerAccount.hidden = false;

    accountName.textContent = user.name;
    accountEmail.textContent = user.email;
}


// --------------------------------------------
// 19.2 LOGOUT
// --------------------------------------------

function logoutCustomer() {
    sessionStorage.removeItem(AUTH_TOKEN_KEY);

    loginForm.hidden = false;
    registerForm.hidden = false;

    customerAccount.hidden = true;

    loginMessage.textContent = "";
    registerMessage.textContent = "";

    alert("You have logged out successfully.");
}

logoutButton.addEventListener("click", logoutCustomer);


// --------------------------------------------
// 19.3 CUSTOMER REGISTRATION
// --------------------------------------------

registerForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    registerMessage.textContent = "Creating your account...";

    const name = document.getElementById("register-name").value.trim();

    const email = document.getElementById("register-email")
        .value.trim().toLowerCase();

    const password = document.getElementById("register-password").value;

    const registerButton = document.getElementById("register-button");

    registerButton.disabled = true;

    try {
        const response = await fetch("/api/auth/register", {
            method: "POST",

            headers: {
                "Content-Type": "application/json"
            },

            body: JSON.stringify({
                name,
                email,
                password
            })
        });

        const result = await response.json();

        if (!response.ok) {
            throw new Error(result.message || "Registration failed.");
        }

        registerMessage.textContent =
            "Account created successfully! You can now log in.";

        registerForm.reset();

        document.getElementById("login-email").value = email;

    } catch (error) {
        console.error("Registration error:", error);

        registerMessage.textContent = error.message;

    } finally {
        registerButton.disabled = false;
    }
});


// --------------------------------------------
// 19.4 CUSTOMER LOGIN
// --------------------------------------------

loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    loginMessage.textContent = "Logging in...";

    const email = document.getElementById("login-email")
        .value.trim().toLowerCase();

    const password = document.getElementById("login-password").value;

    const loginButton = document.getElementById("login-button");

    loginButton.disabled = true;

    try {
        const response = await fetch("/api/auth/login", {
            method: "POST",

            headers: {
                "Content-Type": "application/json"
            },

            body: JSON.stringify({
                email,
                password
            })
        });

        const result = await response.json();

        if (!response.ok) {
            throw new Error(result.message || "Login failed.");
        }

        if (!result.token || !result.user) {
            throw new Error("Invalid login response from server.");
        }

        // Save JWT for this browser tab
        sessionStorage.setItem(
            AUTH_TOKEN_KEY,
            result.token
        );

        console.log("Logged-in user:", result.user);
        console.log("User role:", result.user?.role);

        if (
            result.user?.role === "admin" ||
            result.user?.role === "owner"
        ) {
            window.location.href = "/admin.html";
            return;
        }
        // Display authenticated customer
        displayCustomer(result.user);

        loginForm.reset();

        loginMessage.textContent = "";

    } catch (error) {
        console.error("Login error:", error);

        loginMessage.textContent = error.message;

    } finally {
        loginButton.disabled = false;
    }
});


// ============================================
// 17. START THE APPLICATION
// ============================================

renderCart();
loadProducts();
