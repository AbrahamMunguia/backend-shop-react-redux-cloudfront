import { Hono } from 'hono'
import { handle } from 'hono/aws-lambda'
import {
    DynamoDBClient,
    ScanCommand,
    GetItemCommand,
    PutItemCommand,
} from '@aws-sdk/client-dynamodb'
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb'
import type { Product } from '../models'

const app = new Hono()
const db = new DynamoDBClient({})
const TABLE = process.env.PRODUCTS_TABLE_NAME!

// ─── GET /products ────────────────────────────────────────────────────────────
app.get('/products', async (c) => {
    const { Items = [] } = await db.send(new ScanCommand({ TableName: TABLE }))
    const products = Items.map((item) => unmarshall(item) as Product)
    return c.json(products, 200)
})

// ─── GET /products/:id ───────────────────────────────────────────────────────
app.get('/products/:id', async (c) => {
    const { id } = c.req.param()

    const { Item } = await db.send(
        new GetItemCommand({
            TableName: TABLE,
            Key: marshall({ id }),
        })
    )

    if (!Item) {
        return c.json({ message: `Product with id "${id}" not found.` }, 404)
    }

    return c.json(unmarshall(Item) as Product, 200)
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
            TableName: TABLE,
            Item: marshall(newProduct),
        })
    )

    return c.json(newProduct, 201)
})

export const handler = handle(app)