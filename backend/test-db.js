const pool = require("./db");

async function testConnection() {
    try {
        const [rows] = await pool.query(
            "SELECT NOW() AS server_time, DATABASE() AS database_name"
        );

        console.log("Database connection successful!");
        console.log(rows[0]);
    } catch (error) {
        console.error("Database connection failed:", error.message);
        process.exitCode = 1;
    } finally {
        await pool.end();
    }
}

testConnection();