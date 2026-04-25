import { Hono } from 'hono'
import { handle } from 'hono/aws-lambda'
import {
    DynamoDBClient,
    ScanCommand,
    GetItemCommand,
    PutItemCommand,
    BatchGetItemCommand,
} from '@aws-sdk/client-dynamodb'
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb'
import type { Product, Stock } from '../models'
import { cors } from 'hono/cors'

const app = new Hono()
const db = new DynamoDBClient({})

const PRODUCTS_TABLE = process.env.PRODUCTS_TABLE_NAME!
const STOCK_TABLE = process.env.STOCK_TABLE_NAME!

export type ProductWithStock = Product & { stock: number }
app.use('*', cors({
    origin: ['https://d1jkai40iwonc0.cloudfront.net', 'http://localhost:3000'],
    allowMethods: ['GET', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization'],
}))
// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Fetch stock for a single product id */
async function getStockForProduct(product_id: string): Promise<number> {
    const { Item } = await db.send(
        new GetItemCommand({
            TableName: STOCK_TABLE,
            Key: marshall({ product_id }),
        })
    )
    return Item ? (unmarshall(Item) as Stock).count : 0
}

/**
 * Fetch stock for multiple product ids in one BatchGetItem call.
 * Returns a map of product_id → count.
 */
async function getStockMap(product_ids: string[]): Promise<Record<string, number>> {
    if (product_ids.length === 0) return {}

    const { Responses = {} } = await db.send(
        new BatchGetItemCommand({
            RequestItems: {
                [STOCK_TABLE]: {
                    Keys: product_ids.map((id) => marshall({ product_id: id })),
                },
            },
        })
    )

    const stockMap: Record<string, number> = {}

    // Default every id to 0 so products with no stock row still have a value
    product_ids.forEach((id) => (stockMap[id] = 0))

    for (const item of Responses[STOCK_TABLE] ?? []) {
        const { product_id, count } = unmarshall(item) as Stock
        stockMap[product_id] = count
    }

    return stockMap
}

// ─── GET /products ────────────────────────────────────────────────────────────
// Returns all products, each enriched with its current stock count
app.get('/products', async (c) => {
    const { Items = [] } = await db.send(new ScanCommand({ TableName: PRODUCTS_TABLE }))
    const products = Items.map((item) => unmarshall(item) as Product)

    const stockMap = await getStockMap(products.map((p) => p.id))

    const result: ProductWithStock[] = products.map((p) => ({
        ...p,
        stock: stockMap[p.id],
    }))

    return c.json(result, 200)
})

// ─── GET /products/:id ───────────────────────────────────────────────────────
// Returns a single product enriched with its current stock count
app.get('/products/:id', async (c) => {
    const { id } = c.req.param()

    const { Item } = await db.send(
        new GetItemCommand({
            TableName: PRODUCTS_TABLE,
            Key: marshall({ id }),
        })
    )

    if (!Item) {
        return c.json({ message: `Product with id "${id}" not found.` }, 404)
    }

    const product = unmarshall(Item) as Product
    const stock = await getStockForProduct(id)

    return c.json({ ...product, stock } satisfies ProductWithStock, 200)
})

// ─── POST /products ───────────────────────────────────────────────────────────
app.post('/products', async (c) => {
    const body = await c.req.json<Omit<Product, 'id'>>()

    if (!body.title || typeof body.title !== 'string') {
        return c.json({ message: "Field 'title' is required and must be a string." }, 400)
    }

    if (body.price === undefined || !Number.isInteger(body.price)) {
        return c.json({ message: "Field 'price' is required and must be an integer." }, 400)
    }

    const newProduct: Product = {
        id: crypto.randomUUID(),
        title: body.title,
        description: body.description ?? '',
        price: body.price,
    }

    await db.send(
        new PutItemCommand({
            TableName: PRODUCTS_TABLE,
            Item: marshall(newProduct),
        })
    )

    return c.json(newProduct, 201)
})

export const handler = handle(app)