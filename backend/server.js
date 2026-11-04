
const express = require("express");
const pool = require("./db");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: "20kb" }));
// ============================================
// AUTHENTICATION MIDDLEWARE
// ============================================

function authenticateToken(req, res, next) {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return res.status(401).json({
            status: "error",
            message: "Authentication required."
        });
    }

    const token = authHeader.split(" ")[1];

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);

        req.user = decoded;

        next();
    } catch (error) {
        return res.status(401).json({
            status: "error",
            message: "Invalid or expired authentication token."
        });
    }
}

// ============================================
// CUSTOMER REGISTRATION
// ============================================

app.post("/api/auth/register", async (req, res) => {
    try {
        const { name, email, password } = req.body;

        if (
            typeof name !== "string" ||
            name.trim().length < 2 ||
            name.trim().length > 100
        ) {
            return res.status(400).json({
                status: "error",
                message: "Name must contain 2 to 100 characters."
            });
        }

        if (
            typeof email !== "string" ||
            email.length > 254 ||
            !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())
        ) {
            return res.status(400).json({
                status: "error",
                message: "Enter a valid email address."
            });
        }

        if (
            typeof password !== "string" ||
            password.length < 8 ||
            Buffer.byteLength(password, "utf8") > 72
        ) {
            return res.status(400).json({
                status: "error",
                message: "Password must be at least 8 characters and no more than 72 UTF-8 bytes."
            });
        }

        const normalizedEmail = email.trim().toLowerCase();

        const [existingUsers] = await pool.query(
            "SELECT id FROM users WHERE email = ? LIMIT 1",
            [normalizedEmail]
        );

        if (existingUsers.length > 0) {
            return res.status(409).json({
                status: "error",
                message: "An account with this email already exists."
            });
        }

        const passwordHash = await bcrypt.hash(password, 12);

        const [result] = await pool.query(
            `
                INSERT INTO users (name, email, password_hash)
                VALUES (?, ?, ?)
            `,
            [name.trim(), normalizedEmail, passwordHash]
        );

        return res.status(201).json({
            status: "success",
            message: "Account created successfully.",
            user: {
                id: result.insertId,
                name: name.trim(),
                email: normalizedEmail
            }
        });

    } catch (error) {
        console.error("Registration error:", error.message);

        if (error.code === "ER_DUP_ENTRY") {
            return res.status(409).json({
                status: "error",
                message: "An account with this email already exists."
            });
        }

        return res.status(500).json({
            status: "error",
            message: "Unable to create account."
        });
    }
});

// ============================================
// CUSTOMER LOGIN
// ============================================

app.post("/api/auth/login", async (req, res) => {
    try {
        const { email, password } = req.body;

        if (
            typeof email !== "string" ||
            typeof password !== "string" ||
            email.trim().length > 254 ||
            !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())
        ) {
            return res.status(400).json({
                status: "error",
                message: "Enter a valid email and password."
            });
        }

        const normalizedEmail = email.trim().toLowerCase();

        const [users] = await pool.query(
            `
                SELECT id, name, email, password_hash
                FROM users
                WHERE email = ?
                LIMIT 1
            `,
            [normalizedEmail]
        );

        if (users.length === 0) {
            return res.status(401).json({
                status: "error",
                message: "Invalid email or password."
            });
        }

        const user = users[0];

        const passwordMatches = await bcrypt.compare(
            password,
            user.password_hash
        );

        if (!passwordMatches) {
            return res.status(401).json({
                status: "error",
                message: "Invalid email or password."
            });
        }

        if (!process.env.JWT_SECRET) {
            throw new Error("JWT_SECRET is not configured.");
        }

        const token = jwt.sign(
            {
                userId: user.id,
                email: user.email
            },
            process.env.JWT_SECRET,
            {
                expiresIn: "1h",
                issuer: "codealpha-ecommerce"
            }
        );

        return res.json({
            status: "success",
            message: "Login successful.",
            token,
            user: {
                id: user.id,
                name: user.name,
                email: user.email
            }
        });

    } catch (error) {
        console.error("Login error:", error.message);

        return res.status(500).json({
            status: "error",
            message: "Unable to log in."
        });
    }
});

// ============================================
// GET AUTHENTICATED CUSTOMER PROFILE
// ============================================

app.get("/api/auth/me", authenticateToken, async (req, res) => {
    try {
        const [users] = await pool.query(
            `
                SELECT id, name, email
                FROM users
                WHERE id = ?
                LIMIT 1
            `,
            [req.user.userId]
        );

        if (users.length === 0) {
            return res.status(404).json({
                status: "error",
                message: "Customer account not found."
            });
        }

        return res.json({
            status: "success",
            user: users[0]
        });

    } catch (error) {
        console.error("Profile error:", error.message);

        return res.status(500).json({
            status: "error",
            message: "Unable to retrieve customer profile."
        });
    }
});

// ============================================
// 1. HEALTH CHECK
// ============================================

app.get("/api/health", (req, res) => {
    res.json({
        status: "success",
        message: "E-commerce API is running"
    });
});

// ============================================
// 2. GET PRODUCTS WITH SEARCH, FILTER AND SORT
// ============================================

app.get("/api/products", async (req, res) => {
    try {
        const { search, minPrice, maxPrice, sort } = req.query;

        let sql = `
            SELECT
                id,
                name,
                description,
                price,
                image_url AS image,
                stock
            FROM products
            WHERE 1 = 1
        `;

        const params = [];

        if (search !== undefined && search.trim() !== "") {
            sql += " AND (name LIKE ? OR description LIKE ?)";
            const keyword = `%${search.trim()}%`;
            params.push(keyword, keyword);
        }

        if (minPrice !== undefined) {
            const min = Number(minPrice);

            if (
                minPrice.trim() === "" ||
                !Number.isFinite(min) ||
                min < 0
            ) {
                return res.status(400).json({
                    status: "error",
                    message: "minPrice must be a non-negative number"
                });
            }

            sql += " AND price >= ?";
            params.push(min);
        }

        if (maxPrice !== undefined) {
            const max = Number(maxPrice);

            if (
                maxPrice.trim() === "" ||
                !Number.isFinite(max) ||
                max < 0
            ) {
                return res.status(400).json({
                    status: "error",
                    message: "maxPrice must be a non-negative number"
                });
            }

            sql += " AND price <= ?";
            params.push(max);
        }

        if (
            minPrice !== undefined &&
            maxPrice !== undefined &&
            Number(minPrice) > Number(maxPrice)
        ) {
            return res.status(400).json({
                status: "error",
                message: "minPrice cannot be greater than maxPrice"
            });
        }

        const sortOptions = {
            name_asc: "name ASC",
            name_desc: "name DESC",
            price_asc: "price ASC",
            price_desc: "price DESC"
        };

        if (sort !== undefined && !sortOptions[sort]) {
            return res.status(400).json({
                status: "error",
                message: "Invalid sort option"
            });
        }

        sql += ` ORDER BY ${sortOptions[sort] || "id ASC"}`;

        const [rows] = await pool.query(sql, params);

        res.json(rows);
    } catch (error) {
        console.error("Error retrieving products:", error.message);

        res.status(500).json({
            status: "error",
            message: "Unable to retrieve products"
        });
    }
});

// ============================================
// 3. CREATE A GUEST CUSTOMER ORDER
// ============================================

app.post("/api/orders", async (req, res) => {
    let connection;

    try {
        const {
            customerName,
            customerEmail,
            customerPhone,
            deliveryAddress,
            items
        } = req.body;

        // Validate customer information.
        if (
            typeof customerName !== "string" ||
            customerName.trim().length < 2 ||
            customerName.trim().length > 100
        ) {
            return res.status(400).json({
                status: "error",
                message: "Enter a valid customer name."
            });
        }

        if (
            typeof customerEmail !== "string" ||
            customerEmail.length > 254 ||
            !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customerEmail.trim())
        ) {
            return res.status(400).json({
                status: "error",
                message: "Enter a valid email address."
            });
        }

        if (
            typeof customerPhone !== "string" ||
            !/^[+0-9() -]{7,20}$/.test(customerPhone.trim())
        ) {
            return res.status(400).json({
                status: "error",
                message: "Enter a valid phone number."
            });
        }

        if (
            typeof deliveryAddress !== "string" ||
            deliveryAddress.trim().length < 5 ||
            deliveryAddress.trim().length > 500
        ) {
            return res.status(400).json({
                status: "error",
                message: "Enter a valid delivery address."
            });
        }

        // Validate shopping cart.
        if (
            !Array.isArray(items) ||
            items.length === 0 ||
            items.length > 50
        ) {
            return res.status(400).json({
                status: "error",
                message: "Your cart is empty or contains too many items."
            });
        }

        // Combine duplicate product IDs.
        const quantities = new Map();

        for (const item of items) {
            const productId = Number(item.productId);
            const quantity = Number(item.quantity);

            if (
                !Number.isSafeInteger(productId) ||
                productId <= 0 ||
                !Number.isSafeInteger(quantity) ||
                quantity <= 0 ||
                quantity > 99
            ) {
                return res.status(400).json({
                    status: "error",
                    message: "Invalid product ID or quantity."
                });
            }

            const newQuantity =
                (quantities.get(productId) || 0) + quantity;

            if (newQuantity > 99) {
                return res.status(400).json({
                    status: "error",
                    message: "Maximum quantity per product is 99."
                });
            }

            quantities.set(productId, newQuantity);
        }

        const productIds = [...quantities.keys()].sort((a, b) => a - b);

        // Get a dedicated database connection.
        connection = await pool.getConnection();

        await connection.beginTransaction();

        // Lock product rows so simultaneous orders cannot
        // oversell the same stock.
        const placeholders = productIds.map(() => "?").join(",");

        const [products] = await connection.query(
            `
                SELECT id, name, price, stock
                FROM products
                WHERE id IN (${placeholders})
                ORDER BY id
                FOR UPDATE
            `,
            productIds
        );

        if (products.length !== productIds.length) {
            await connection.rollback();

            return res.status(400).json({
                status: "error",
                message: "One or more products no longer exist."
            });
        }

        // Calculate the total using prices from MySQL.
        let totalCents = 0;
        const orderItems = [];

        for (const product of products) {
            const quantity = quantities.get(product.id);

            if (product.stock < quantity) {
                await connection.rollback();

                return res.status(409).json({
                    status: "error",
                    message: `Insufficient stock for ${product.name}. Available: ${product.stock}.`
                });
            }

            const unitPriceCents = Math.round(
                Number(product.price) * 100
            );

            totalCents += unitPriceCents * quantity;

            orderItems.push({
                productId: product.id,
                quantity,
                unitPrice: (unitPriceCents / 100).toFixed(2)
            });
        }

        const totalAmount = (totalCents / 100).toFixed(2);

        // Create the order. NULL user_id means guest customer.
        const [orderResult] = await connection.query(
            `
                INSERT INTO orders (
                    user_id,
                    customer_name,
                    customer_email,
                    customer_phone,
                    delivery_address,
                    total_amount,
                    status
                )
                VALUES (NULL, ?, ?, ?, ?, ?, 'pending')
            `,
            [
                customerName.trim(),
                customerEmail.trim().toLowerCase(),
                customerPhone.trim(),
                deliveryAddress.trim(),
                totalAmount
            ]
        );

        const orderId = orderResult.insertId;

        // Save order items and reduce stock.
        for (const item of orderItems) {
            await connection.query(
                `
                    INSERT INTO order_items (
                        order_id,
                        product_id,
                        quantity,
                        unit_price
                    )
                    VALUES (?, ?, ?, ?)
                `,
                [
                    orderId,
                    item.productId,
                    item.quantity,
                    item.unitPrice
                ]
            );

            await connection.query(
                `
                    UPDATE products
                    SET stock = stock - ?
                    WHERE id = ? AND stock >= ?
                `,
                [
                    item.quantity,
                    item.productId,
                    item.quantity
                ]
            );
        }

        // Commit everything together.
        await connection.commit();

        return res.status(201).json({
            status: "success",
            message: "Order placed successfully.",
            order: {
                id: orderId,
                totalAmount,
                status: "pending",
                items: orderItems
            }
        });

    } catch (error) {
        if (connection) {
            await connection.rollback();
        }

        console.error("Error creating order:", error.message);

        return res.status(500).json({
            status: "error",
            message: "Unable to place your order. Please try again."
        });

    } finally {
        if (connection) {
            connection.release();
        }
    }
});


// ============================================
// 3. GET GUEST CUSTOMER ORDER HISTORY
// ============================================

app.get("/api/orders", async (req, res) => {
    try {
        const email = req.query.email;

        if (
            typeof email !== "string" ||
            email.trim().length > 254 ||
            !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())
        ) {
            return res.status(400).json({
                status: "error",
                message: "Enter a valid customer email address."
            });
        }

        const [orders] = await pool.query(
            `
                SELECT
                    o.id,
                    o.customer_name AS customerName,
                    o.customer_email AS customerEmail,
                    o.total_amount AS totalAmount,
                    o.status,
                    o.created_at AS createdAt,
                    COUNT(oi.id) AS itemCount
                FROM orders o
                LEFT JOIN order_items oi ON oi.order_id = o.id
                WHERE o.customer_email = ?
                GROUP BY
                    o.id,
                    o.customer_name,
                    o.customer_email,
                    o.total_amount,
                    o.status,
                    o.created_at
                ORDER BY o.created_at DESC
            `,
            [email.trim().toLowerCase()]
        );

        return res.json({
            status: "success",
            count: orders.length,
            orders
        });

    } catch (error) {
        console.error("Error retrieving order history:", error.message);

        return res.status(500).json({
            status: "error",
            message: "Unable to retrieve order history."
        });
    }
});


// ============================================
// 4. GET ONE ORDER WITH ITS ITEMS
// ============================================

app.get("/api/orders/:id", async (req, res) => {
    try {
        const orderId = Number(req.params.id);
        const email = req.query.email;

        if (!Number.isSafeInteger(orderId) || orderId <= 0) {
            return res.status(400).json({
                status: "error",
                message: "Invalid order ID."
            });
        }

        if (
            typeof email !== "string" ||
            email.trim().length > 254 ||
            !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())
        ) {
            return res.status(400).json({
                status: "error",
                message: "Enter a valid customer email address."
            });
        }

        const [orders] = await pool.query(
            `
                SELECT
                    id,
                    customer_name AS customerName,
                    customer_email AS customerEmail,
                    customer_phone AS customerPhone,
                    delivery_address AS deliveryAddress,
                    total_amount AS totalAmount,
                    status,
                    created_at AS createdAt
                FROM orders
                WHERE id = ? AND customer_email = ?
                LIMIT 1
            `,
            [orderId, email.trim().toLowerCase()]
        );

        if (orders.length === 0) {
            return res.status(404).json({
                status: "error",
                message: "Order not found."
            });
        }

        const [items] = await pool.query(
            `
                SELECT
                    oi.product_id AS productId,
                    p.name AS productName,
                    oi.quantity,
                    oi.unit_price AS unitPrice,
                    (oi.quantity * oi.unit_price) AS subtotal
                FROM order_items oi
                LEFT JOIN products p ON p.id = oi.product_id
                WHERE oi.order_id = ?
                ORDER BY oi.id ASC
            `,
            [orderId]
        );

        return res.json({
            status: "success",
            order: {
                ...orders[0],
                items
            }
        });

    } catch (error) {
        console.error("Error retrieving order details:", error.message);

        return res.status(500).json({
            status: "error",
            message: "Unable to retrieve order details."
        });
    }
});

// ============================================
// 4. START SERVER
// ============================================

app.listen(PORT, "0.0.0.0", () => {
    console.log(`E-commerce API running on port ${PORT}`);
});
