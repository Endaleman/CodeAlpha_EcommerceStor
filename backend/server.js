
const express = require("express");
const pool = require("./db");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: "20kb" }));

// ============================================
// PRODUCT IMAGE UPLOAD CONFIGURATION
// ============================================

const productUploadDirectory = path.join(
    __dirname,
    "uploads",
    "products"
);

// Create upload directory if it does not exist.
fs.mkdirSync(productUploadDirectory, { recursive: true });

// Serve uploaded images publicly.
app.use(
    "/uploads",
    express.static(path.join(__dirname, "uploads"))
);

const allowedImageTypes = {
    "image/jpeg": [".jpg", ".jpeg"],
    "image/png": [".png"],
    "image/webp": [".webp"]
};

const productImageStorage = multer.memoryStorage();

const productImageUpload = multer({
    storage: productImageStorage,
    limits: {
        fileSize: 5 * 1024 * 1024
    },
    fileFilter: (req, file, callback) => {
        const extensions = allowedImageTypes[file.mimetype];
        const extension = path.extname(file.originalname).toLowerCase();

        if (!extensions || !extensions.includes(extension)) {
            return callback(
                new Error("Only JPG, JPEG, PNG, and WebP images are allowed.")
            );
        }

        callback(null, true);
    }
});

function handleProductImageUpload(req, res, next) {
    productImageUpload.single("image")(req, res, (error) => {
        if (error) {
            return res.status(400).json({
                status: "error",
                message: error.code === "LIMIT_FILE_SIZE"
                    ? "Image must not exceed 5 MB."
                    : error.message
            });
        }

        next();
    });
}

// Verify actual image file signatures.
function isValidImageBuffer(buffer, mimetype) {
    if (mimetype === "image/jpeg") {
        return buffer.length >= 3 &&
            buffer[0] === 0xff &&
            buffer[1] === 0xd8 &&
            buffer[2] === 0xff;
    }

    if (mimetype === "image/png") {
        return buffer.length >= 8 &&
            buffer.subarray(0, 8).equals(
                Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
            );
    }

    if (mimetype === "image/webp") {
        return buffer.length >= 12 &&
            buffer.toString("ascii", 0, 4) === "RIFF" &&
            buffer.toString("ascii", 8, 12) === "WEBP";
    }

    return false;
}
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
// ADMIN AUTHORIZATION
// ============================================

async function requireAdmin(req, res, next) {
    try {
        const [users] = await pool.query(
            "SELECT role FROM users WHERE id = ? LIMIT 1",
            [req.user.userId]
        );

        if (users.length === 0) {
            return res.status(401).json({
                status: "error",
                message: "User account not found."
            });
        }

        const role = users[0].role;

        if (!["admin", "owner"].includes(role)) {
            return res.status(403).json({
                status: "error",
                message: "Administrator access required."
            });
        }

        req.user.role = role;
        next();

    } catch (error) {
        console.error("Admin authorization error:", error.message);

        return res.status(500).json({
            status: "error",
            message: "Authorization failed."
        });
    }
}

// ============================================
// OWNER AUTHORIZATION
// ============================================

async function requireOwner(req, res, next) {
    try {
        const [users] = await pool.query(
            "SELECT role FROM users WHERE id = ? LIMIT 1",
            [req.user.userId]
        );

        if (users.length === 0) {
            return res.status(401).json({
                status: "error",
                message: "User account not found."
            });
        }

        if (users[0].role !== "owner") {
            return res.status(403).json({
                status: "error",
                message: "Only the store owner can perform this action."
            });
        }

        req.user.role = "owner";
        next();

    } catch (error) {
        console.error("Owner authorization error:", error.message);

        return res.status(500).json({
            status: "error",
            message: "Authorization failed."
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
             SELECT id, name, email, password_hash, role
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

        res.json({
            message: "Login successful",
            token,
            user: {
                id: user.id,
                name: user.name,
                email: user.email,
                role: user.role
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

// ADMIN: CREATE PRODUCT
// ============================================

// ============================================
// CREATE PRODUCT WITH IMAGE UPLOAD
// ============================================


app.post(
    "/api/admin/products",
    authenticateToken,
    requireAdmin,
    handleProductImageUpload,
    async (req, res) => {
        let savedImagePath = null;

        try {
            const {
                name,
                description,
                price,
                image_url,
                stock
            } = req.body;

            // 1. Validate product name
            if (
                typeof name !== "string" ||
                name.trim().length < 2 ||
                name.trim().length > 150
            ) {
                return res.status(400).json({
                    status: "error",
                    message: "Product name must contain 2 to 150 characters."
                });
            }

            // 2. Validate price
            const productPrice = Number(price);

            if (
                price === undefined ||
                price === null ||
                price === "" ||
                !Number.isFinite(productPrice) ||
                productPrice <= 0
            ) {
                return res.status(400).json({
                    status: "error",
                    message: "Enter a valid product price."
                });
            }

            // 3. Validate stock
            const productStock = Number(stock);

            if (
                stock === undefined ||
                stock === null ||
                stock === "" ||
                !Number.isSafeInteger(productStock) ||
                productStock < 0
            ) {
                return res.status(400).json({
                    status: "error",
                    message: "Stock must be a non-negative whole number."
                });
            }

            // 4. Validate description
            if (
                description !== undefined &&
                description !== null &&
                typeof description !== "string"
            ) {
                return res.status(400).json({
                    status: "error",
                    message: "Invalid product description."
                });
            }

            // 5. Validate image URL
            if (
                image_url !== undefined &&
                image_url !== null &&
                (
                    typeof image_url !== "string" ||
                    image_url.length > 500
                )
            ) {
                return res.status(400).json({
                    status: "error",
                    message: "Image URL must be a string of up to 500 characters."
                });
            }

            // 6. Prepare product image
            let finalImageUrl = image_url?.trim() || null;

            if (req.file) {
                if (!isValidImageBuffer(req.file.buffer, req.file.mimetype)) {
                    return res.status(400).json({
                        status: "error",
                        message: "The uploaded file is not a valid image."
                    });
                }

                const extension = path.extname(
                    req.file.originalname
                ).toLowerCase();

                const filename = `${crypto.randomUUID()}${extension}`;

                savedImagePath = path.join(
                    productUploadDirectory,
                    filename
                );

                await fs.promises.writeFile(
                    savedImagePath,
                    req.file.buffer
                );

                finalImageUrl = `/uploads/products/${filename}`;
            }

            // 7. Insert product into database
            const [result] = await pool.query(
                `
                    INSERT INTO products
                    (name, description, price, image_url, stock)
                    VALUES (?, ?, ?, ?, ?)
                `,
                [
                    name.trim(),
                    description?.trim() || null,
                    productPrice,
                    finalImageUrl,
                    productStock
                ]
            );

            // 8. Return success response
            return res.status(201).json({
                status: "success",
                message: "Product created successfully.",
                product: {
                    id: result.insertId,
                    name: name.trim(),
                    description: description?.trim() || null,
                    price: productPrice,
                    image_url: finalImageUrl,
                    stock: productStock
                }
            });

        } catch (error) {
            console.error("Create product error:", error.message);

            // Remove uploaded image if product creation fails
            if (savedImagePath) {
                await fs.promises.unlink(savedImagePath).catch(() => { });
            }

            return res.status(500).json({
                status: "error",
                message: "Unable to create product."
            });
        }
    }
);


// ============================================
// ADMIN: UPDATE PRODUCT
// ============================================

app.put(
    "/api/admin/products/:id",
    authenticateToken,
    requireAdmin,
    handleProductImageUpload,
    async (req, res) => {
        let savedImagePath = null;

        try {
            // 1. Validate product ID
            const productId = Number(req.params.id);

            if (!Number.isSafeInteger(productId) || productId <= 0) {
                return res.status(400).json({
                    status: "error",
                    message: "Invalid product ID."
                });
            }

            // 2. Get existing product
            const [existingProducts] = await pool.query(
                "SELECT id, image_url FROM products WHERE id = ? LIMIT 1",
                [productId]
            );

            if (existingProducts.length === 0) {
                return res.status(404).json({
                    status: "error",
                    message: "Product not found."
                });
            }

            const existingImageUrl = existingProducts[0].image_url;

            // 3. Get updated product information
            const {
                name,
                description,
                price,
                image_url,
                stock
            } = req.body;

            // 4. Validate product name
            if (
                typeof name !== "string" ||
                name.trim().length < 2 ||
                name.trim().length > 150
            ) {
                return res.status(400).json({
                    status: "error",
                    message: "Product name must contain 2 to 150 characters."
                });
            }

            // 5. Validate price
            const productPrice = Number(price);

            if (
                price === undefined ||
                price === null ||
                price === "" ||
                !Number.isFinite(productPrice) ||
                productPrice <= 0
            ) {
                return res.status(400).json({
                    status: "error",
                    message: "Enter a valid product price."
                });
            }

            // 6. Validate stock
            const productStock = Number(stock);

            if (
                stock === undefined ||
                stock === null ||
                stock === "" ||
                !Number.isSafeInteger(productStock) ||
                productStock < 0
            ) {
                return res.status(400).json({
                    status: "error",
                    message: "Stock must be a non-negative whole number."
                });
            }

            // 7. Validate description
            if (
                description !== undefined &&
                description !== null &&
                typeof description !== "string"
            ) {
                return res.status(400).json({
                    status: "error",
                    message: "Invalid product description."
                });
            }

            // 8. Validate image URL
            if (
                image_url !== undefined &&
                image_url !== null &&
                (
                    typeof image_url !== "string" ||
                    image_url.length > 500
                )
            ) {
                return res.status(400).json({
                    status: "error",
                    message: "Image URL must be a string of up to 500 characters."
                });
            }

            // 9. Preserve the existing image by default
            let finalImageUrl = image_url?.trim() || existingImageUrl || null;

            // If a new image was uploaded, use it instead
            if (req.file) {
                if (!isValidImageBuffer(req.file.buffer, req.file.mimetype)) {
                    return res.status(400).json({
                        status: "error",
                        message: "The uploaded file is not a valid image."
                    });
                }

                const extension = path.extname(
                    req.file.originalname
                ).toLowerCase();

                const filename = `${crypto.randomUUID()}${extension}`;

                savedImagePath = path.join(
                    productUploadDirectory,
                    filename
                );

                await fs.promises.writeFile(
                    savedImagePath,
                    req.file.buffer
                );

                finalImageUrl = `/uploads/products/${filename}`;
            }

            // 10. Update product in MySQL
            await pool.query(
                `
                    UPDATE products
                    SET
                        name = ?,
                        description = ?,
                        price = ?,
                        image_url = ?,
                        stock = ?
                    WHERE id = ?
                `,
                [
                    name.trim(),
                    description?.trim() || null,
                    productPrice,
                    finalImageUrl,
                    productStock,
                    productId
                ]
            );

            // 11. Return success response
            return res.status(200).json({
                status: "success",
                message: "Product updated successfully."
            });

        } catch (error) {
            console.error("Update product error:", error.message);

            // Remove a newly uploaded image if updating fails
            if (savedImagePath) {
                await fs.promises.unlink(savedImagePath).catch(() => { });
            }

            return res.status(500).json({
                status: "error",
                message: "Unable to update product."
            });
        }
    }
);

// ============================================
// ADMIN: DELETE PRODUCT
// ============================================

app.delete(
    "/api/admin/products/:id",
    authenticateToken,
    requireAdmin,
    async (req, res) => {
        try {
            // 1. Validate product ID
            const productId = Number(req.params.id);

            if (!Number.isSafeInteger(productId) || productId <= 0) {
                return res.status(400).json({
                    status: "error",
                    message: "Invalid product ID."
                });
            }

            // 2. Check whether the product exists
            const [products] = await pool.query(
                "SELECT id FROM products WHERE id = ? LIMIT 1",
                [productId]
            );

            if (products.length === 0) {
                return res.status(404).json({
                    status: "error",
                    message: "Product not found."
                });
            }

            // 3. Check whether the product belongs to an order
            const [orderItems] = await pool.query(
                `
                    SELECT COUNT(*) AS total
                    FROM order_items
                    WHERE product_id = ?
                `,
                [productId]
            );

            if (Number(orderItems[0].total) > 0) {
                return res.status(409).json({
                    status: "error",
                    message: "This product cannot be deleted because it is associated with existing orders."
                });
            }

            // 4. Delete product
            await pool.query(
                "DELETE FROM products WHERE id = ?",
                [productId]
            );

            // 5. Return success response
            return res.status(200).json({
                status: "success",
                message: "Product deleted successfully."
            });

        } catch (error) {
            console.error("Delete product error:", error.message);

            return res.status(500).json({
                status: "error",
                message: "Unable to delete product."
            });
        }
    }
);
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
            deliveryStreet,
            deliveryCity,
            deliveryArea,
            deliveryLocationUrl,
            deliveryInstructions,
            items
        } = req.body;

        // Validate customer information.
        if (
            typeof deliveryStreet !== "string" ||
            deliveryStreet.trim().length < 3 ||
            deliveryStreet.trim().length > 250
        ) {
            return res.status(400).json({
                status: "error",
                message: "Enter a valid street or building address."
            });
        }

        if (
            typeof deliveryCity !== "string" ||
            deliveryCity.trim().length < 2 ||
            deliveryCity.trim().length > 100
        ) {
            return res.status(400).json({
                status: "error",
                message: "Enter a valid city or sub-city."
            });
        }

        if (
            typeof deliveryArea !== "string" ||
            deliveryArea.trim().length < 2 ||
            deliveryArea.trim().length > 150
        ) {
            return res.status(400).json({
                status: "error",
                message: "Enter a valid area or woreda."
            });
        }

        if (
            deliveryLocationUrl !== undefined &&
            deliveryLocationUrl !== "" &&
            (
                typeof deliveryLocationUrl !== "string" ||
                deliveryLocationUrl.length > 1000
            )
        ) {
            return res.status(400).json({
                status: "error",
                message: "Invalid delivery location link."
            });
        }

        if (
            deliveryInstructions !== undefined &&
            (
                typeof deliveryInstructions !== "string" ||
                deliveryInstructions.length > 500
            )
        ) {
            return res.status(400).json({
                status: "error",
                message: "Delivery instructions must not exceed 500 characters."
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
    delivery_city,
    delivery_area,
    delivery_location_url,
    delivery_instructions,
    total_amount,
    status,
    payment_status,
    stock_reserved
)
VALUES (NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 'unpaid', 1)
    `,
            [
                customerName.trim(),
                customerEmail.trim().toLowerCase(),
                customerPhone.trim(),
                deliveryStreet.trim(),
                deliveryCity.trim(),
                deliveryArea.trim(),
                deliveryLocationUrl?.trim() || null,
                deliveryInstructions?.trim() || null,
                totalAmount
            ]
        );

        const orderId = orderResult.insertId;

        // Save order items and reduce stock.
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
// CHAPA PAYMENT INITIALIZATION
// ============================================

app.post("/api/payments/chapa/initialize", async (req, res) => {
    let connection;

    try {
        const orderId = Number(req.body.orderId);

        if (!Number.isSafeInteger(orderId) || orderId <= 0) {
            return res.status(400).json({
                status: "error",
                message: "Invalid order ID."
            });
        }

        if (!process.env.CHAPA_SECRET_KEY) {
            return res.status(500).json({
                status: "error",
                message: "Payment service is not configured."
            });
        }

        connection = await pool.getConnection();
        await connection.beginTransaction();

        // Lock the order to prevent simultaneous payment initialization.
        const [orders] = await connection.query(
            `
                SELECT
                    id,
                    customer_name,
                    customer_email,
                    total_amount,
                    payment_status,
                    stock_reserved
                FROM orders
                WHERE id = ?
                FOR UPDATE
            `,
            [orderId]
        );

        if (orders.length === 0) {
            await connection.rollback();

            return res.status(404).json({
                status: "error",
                message: "Order not found."
            });
        }

        const order = orders[0];

        if (order.payment_status === "paid") {
            await connection.rollback();

            return res.status(409).json({
                status: "error",
                message: "This order has already been paid."
            });
        }

        if (order.payment_status === "pending") {
            await connection.rollback();

            return res.status(409).json({
                status: "error",
                message: "A payment attempt is already in progress."
            });
        }

        if (Number(order.stock_reserved) !== 1) {
            await connection.rollback();

            return res.status(409).json({
                status: "error",
                message: "The stock reservation is no longer active."
            });
        }

        // Chapa transaction references must be unique.
        const txRef = `CA${crypto.randomBytes(9).toString("hex")}`;

        await connection.query(
            `
                UPDATE orders
                SET
                    payment_status = 'pending',
                    merchant_reference = ?,
                    payment_expires_at = DATE_ADD(NOW(), INTERVAL 30 MINUTE)
                WHERE id = ?
            `,
            [txRef, orderId]
        );

        await connection.commit();
        connection.release();
        connection = null;

        // Split the customer's full name.
        const nameParts = order.customer_name.trim().split(/\s+/);
        const firstName = nameParts[0];
        const lastName = nameParts.slice(1).join(" ") || firstName;

        const frontendUrl =
            process.env.FRONTEND_URL || "http://localhost:8080";

        const chapaPayload = {
            amount: Number(order.total_amount).toFixed(2),
            currency: "ETB",
            email: order.customer_email,
            first_name: firstName,
            last_name: lastName,
            tx_ref: txRef,
            return_url:
                `${frontendUrl}/?payment=return&tx_ref=${encodeURIComponent(txRef)}`,
            customization: {
                title: "CodeAlpha E-commerce",
                description: `Payment for order #${orderId}`
            }
        };

        // Add a callback URL when a public HTTPS URL is configured.
        if (process.env.CHAPA_CALLBACK_URL) {
            chapaPayload.callback_url =
                process.env.CHAPA_CALLBACK_URL;
        }

        const chapaResponse = await fetch(
            "https://api.chapa.co/v1/transaction/initialize",
            {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${process.env.CHAPA_SECRET_KEY}`,
                    "Content-Type": "application/json"
                },
                body: JSON.stringify(chapaPayload)
            }
        );

        const chapaResult = await chapaResponse.json();

        if (
            !chapaResponse.ok ||
            chapaResult.status !== "success" ||
            !chapaResult.data?.checkout_url
        ) {
            await pool.query(
                `
                    UPDATE orders
                    SET
                        payment_status = 'failed',
                        payment_expires_at = NULL
                    WHERE id = ?
                      AND merchant_reference = ?
                      AND payment_status = 'pending'
                `,
                [orderId, txRef]
            );

            console.error(
                "Chapa initialization failed:",
                chapaResult.message || "Unknown error"
            );

            return res.status(502).json({
                status: "error",
                message: "Unable to initialize payment. Please try again."
            });
        }

        await pool.query(
            `
                UPDATE orders
                SET chapa_reference = ?
                WHERE id = ? AND merchant_reference = ?
            `,
            [
                chapaResult.data.reference || null,
                orderId,
                txRef
            ]
        );

        return res.status(200).json({
            status: "success",
            message: "Payment initialized successfully.",
            checkoutUrl: chapaResult.data.checkout_url,
            txRef
        });

    } catch (error) {
        if (connection) {
            await connection.rollback();
        }

        console.error("Chapa initialization error:", error.message);

        return res.status(500).json({
            status: "error",
            message: "Unable to initialize payment."
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
                    delivery_city AS deliveryCity,
                    delivery_area AS deliveryArea,
                    delivery_location_url AS deliveryLocationUrl,
                    delivery_instructions AS deliveryInstructions,
                    total_amount AS totalAmount,
                    status,
                    payment_status AS paymentStatus,
                    created_at AS createdAt,
                     paid_at AS paidAt
                FROM orders orders
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
// ADMIN: VIEW CUSTOMERS
// ============================================

app.get(
    "/api/admin/customers",
    authenticateToken,
    requireAdmin,
    async (req, res) => {
        try {
            const [customers] = await pool.query(`
                SELECT
                    id,
                    name,
                    email,
                    role,
                    created_at
                FROM users
                WHERE role = 'customer'
                ORDER BY created_at DESC
            `);

            res.json(customers);

        } catch (error) {
            console.error("Customer retrieval error:", error.message);

            res.status(500).json({
                status: "error",
                message: "Unable to retrieve customers."
            });
        }
    }
);

// ============================================
// OWNER: VIEW ALL USERS
// ============================================

app.get(
    "/api/owner/users",
    authenticateToken,
    requireOwner,
    async (req, res) => {
        try {
            const [users] = await pool.query(`
                SELECT
                    id,
                    name,
                    email,
                    role,
                    created_at
                FROM users
                ORDER BY created_at DESC
            `);

            res.json(users);

        } catch (error) {
            console.error("User retrieval error:", error.message);

            res.status(500).json({
                message: "Unable to retrieve users."
            });
        }
    }
);
// ============================================
// OWNER: PROMOTE CUSTOMER TO ADMIN
// ============================================

app.put(
    "/api/owner/users/:id/promote",
    authenticateToken,
    requireOwner,
    async (req, res) => {
        try {
            const userId = Number(req.params.id);

            if (!Number.isSafeInteger(userId) || userId <= 0) {
                return res.status(400).json({
                    message: "Invalid user ID."
                });
            }

            const [result] = await pool.query(
                `UPDATE users
                 SET role = 'admin'
                 WHERE id = ? AND role = 'customer'`,
                [userId]
            );

            if (result.affectedRows === 0) {
                return res.status(404).json({
                    message: "Customer not found or already has another role."
                });
            }

            res.json({
                message: "Customer successfully promoted to administrator."
            });

        } catch (error) {
            console.error("Promotion error:", error.message);

            res.status(500).json({
                message: "Unable to promote customer."
            });
        }
    }
);
// ============================================
// OWNER: DEMOTE ADMIN
// ============================================

app.put(
    "/api/owner/users/:id/demote",
    authenticateToken,
    requireOwner,
    async (req, res) => {
        try {
            const userId = Number(req.params.id);

            if (!Number.isSafeInteger(userId) || userId <= 0) {
                return res.status(400).json({
                    message: "Invalid user ID."
                });
            }

            const [result] = await pool.query(
                `UPDATE users
                 SET role = 'customer'
                 WHERE id = ? AND role = 'admin'`,
                [userId]
            );

            if (result.affectedRows === 0) {
                return res.status(404).json({
                    message: "Administrator not found."
                });
            }

            res.json({
                message: "Administrator successfully demoted."
            });

        } catch (error) {
            console.error("Demotion error:", error.message);

            res.status(500).json({
                message: "Unable to demote administrator."
            });
        }
    }
);

// ============================================
// OWNER: VIEW ADMINISTRATORS
// ============================================

app.get(
    "/api/owner/admins",
    authenticateToken,
    requireOwner,
    async (req, res) => {
        try {
            const [admins] = await pool.query(`
                SELECT id, name, email, created_at
                FROM users
                WHERE role = 'admin'
                ORDER BY created_at DESC
            `);

            res.json(admins);

        } catch (error) {
            console.error("Admin retrieval error:", error.message);

            res.status(500).json({
                message: "Unable to retrieve administrators."
            });
        }
    }
);

// ============================================
// 4. START SERVER
// ============================================

app.listen(PORT, "0.0.0.0", () => {
    console.log(`E-commerce API running on port ${PORT}`);
});
