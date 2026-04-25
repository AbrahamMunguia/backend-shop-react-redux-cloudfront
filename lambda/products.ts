import { Hono } from "hono";
import { handle } from "hono/aws-lambda";
import type { Product } from "../models";

const app = new Hono();

// In-memory store — replace with your DB client (e.g. RDS, DynamoDB)
const products: Product[] = [];

// ─── GET /products ──────────────────────────────────────────────────────────
// Returns the full list of products
app.get("/products", (c) => {
    return c.json(products, 200);
});

// ─── GET /products/:id ──────────────────────────────────────────────────────
// Returns a single product by its UUID
app.get("/products/:id", (c) => {
    const { id } = c.req.param();
    const product = products.find((p) => p.id === id);

    if (!product) {
        return c.json({ message: `Product with id "${id}" not found.` }, 404);
    }

    return c.json(product, 200);
});

// ─── POST /products ─────────────────────────────────────────────────────────
// Creates a new product; auto-generates the UUID
app.post("/products", async (c) => {
    const body = await c.req.json<Omit<Product, "id">>();

    // Validate required fields
    if (!body.title || typeof body.title !== "string") {
        return c.json({ message: "Field 'title' is required and must be a string." }, 400);
    }

    if (body.price === undefined || !Number.isInteger(body.price)) {
        return c.json({ message: "Field 'price' is required and must be an integer." }, 400);
    }

    const newProduct: Product = {
        id: crypto.randomUUID(),
        title: body.title,
        description: body.description ?? "",
        price: body.price,
    };

    products.push(newProduct);

    return c.json(newProduct, 201);
});

export const handler = handle(app);