import { Hono } from 'hono'
import { handle } from 'hono/aws-lambda'
import {
    DynamoDBClient,
    ScanCommand,
    GetItemCommand,
    PutItemCommand,
    UpdateItemCommand,
} from '@aws-sdk/client-dynamodb'
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb'
import type { Stock } from '../models'
import { cors } from 'hono/cors'

const app = new Hono()
const db = new DynamoDBClient({})
const TABLE = process.env.STOCK_TABLE_NAME!
app.use('*', cors({
    origin: ['https://d1jkai40iwonc0.cloudfront.net', 'http://localhost:3000'],
    allowMethods: ['GET', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization'],
}))
// ─── GET /stocks ──────────────────────────────────────────────────────────────
app.get('/stocks', async (c) => {
    const { Items = [] } = await db.send(new ScanCommand({ TableName: TABLE }))
    const stocks = Items.map((item) => unmarshall(item) as Stock)
    return c.json(stocks, 200)
})

// ─── GET /stocks/:product_id ──────────────────────────────────────────────────
app.get('/stocks/:product_id', async (c) => {
    const { product_id } = c.req.param()

    const { Item } = await db.send(
        new GetItemCommand({
            TableName: TABLE,
            Key: marshall({ product_id }),
        })
    )

    if (!Item) {
        return c.json({ message: `Stock for product_id "${product_id}" not found.` }, 404)
    }

    return c.json(unmarshall(Item) as Stock, 200)
})

// ─── POST /stocks ─────────────────────────────────────────────────────────────
app.post('/stocks', async (c) => {
    const body = await c.req.json<Stock>()

    if (!body.product_id || typeof body.product_id !== 'string') {
        return c.json({ message: "Field 'product_id' is required and must be a UUID string." }, 400)
    }

    if (body.count === undefined || !Number.isInteger(body.count) || body.count < 0) {
        return c.json({ message: "Field 'count' is required and must be a non-negative integer." }, 400)
    }

    // Check if a stock entry already exists for this product
    const { Item: existing } = await db.send(
        new GetItemCommand({
            TableName: TABLE,
            Key: marshall({ product_id: body.product_id }),
        })
    )

    if (existing) {
        const existingStock = unmarshall(existing) as Stock

        // Enforce: count can't exceed the existing recorded limit
        if (body.count > existingStock.count) {
            return c.json(
                {
                    message: `Requested count (${body.count}) exceeds the current stock limit (${existingStock.count}).`,
                },
                409
            )
        }

        // Update the count in DynamoDB
        await db.send(
            new UpdateItemCommand({
                TableName: TABLE,
                Key: marshall({ product_id: body.product_id }),
                UpdateExpression: 'SET #count = :count',
                ExpressionAttributeNames: { '#count': 'count' },
                ExpressionAttributeValues: marshall({ ':count': body.count }),
            })
        )

        return c.json({ product_id: body.product_id, count: body.count } as Stock, 200)
    }

    // Create a new stock entry
    const newStock: Stock = {
        product_id: body.product_id,
        count: body.count,
    }

    await db.send(
        new PutItemCommand({
            TableName: TABLE,
            Item: marshall(newStock),
        })
    )

    return c.json(newStock, 201)
})

export const handler = handle(app)