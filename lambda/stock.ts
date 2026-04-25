import { Hono } from "hono";
import { handle } from "hono/aws-lambda";
import type { Stock } from "../models";

const app = new Hono();

// In-memory store — replace with your DB client (e.g. RDS, DynamoDB)
const stocks: Stock[] = [];

// ─── GET /stocks ─────────────────────────────────────────────────────────────
// Returns the full stock list
app.get("/stocks", (c) => {
    return c.json(stocks, 200);
});

// ─── GET /stocks/:product_id ─────────────────────────────────────────────────
// Returns the stock entry for a given product UUID
app.get("/stocks/:product_id", (c) => {
    const { product_id } = c.req.param();
    const stock = stocks.find((s) => s.product_id === product_id);

    if (!stock) {
        return c.json({ message: `Stock for product_id "${product_id}" not found.` }, 404);
    }

    return c.json(stock, 200);
});

// ─── POST /stocks ─────────────────────────────────────────────────────────────
// Creates or replaces the stock entry for a product.
// The count cannot exceed the existing count (if a record already exists).
app.post("/stocks", async (c) => {
    const body = await c.req.json<Stock>();

    // Validate required fields
    if (!body.product_id || typeof body.product_id !== "string") {
        return c.json({ message: "Field 'product_id' is required and must be a UUID string." }, 400);
    }

    if (body.count === undefined || !Number.isInteger(body.count) || body.count < 0) {
        return c.json({ message: "Field 'count' is required and must be a non-negative integer." }, 400);
    }

    const existingIndex = stocks.findIndex((s) => s.product_id === body.product_id);

    if (existingIndex !== -1) {
        const existing = stocks[existingIndex];

        // Enforce the "count can't be exceeded" constraint
        if (body.count > existing.count) {
            return c.json(
                {
                    message: `Requested count (${body.count}) exceeds the current stock limit (${existing.count}).`,
                },
                409
            );
        }

        // Update the existing stock record
        stocks[existingIndex] = { ...existing, count: body.count };
        return c.json(stocks[existingIndex], 200);
    }

    // Create a new stock entry
    const newStock: Stock = {
        product_id: body.product_id,
        count: body.count,
    };

    stocks.push(newStock);

    return c.json(newStock, 201);
});

export const handler = handle(app);