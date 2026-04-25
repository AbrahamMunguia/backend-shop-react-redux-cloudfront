import {
    DynamoDBClient,
    BatchWriteItemCommand,
    ScanCommand,
    DeleteItemCommand,
} from '@aws-sdk/client-dynamodb'
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb'
import { faker } from '@faker-js/faker'

const db = new DynamoDBClient({})

const PRODUCTS_TABLE = process.env.PRODUCTS_TABLE_NAME!
const STOCK_TABLE = process.env.STOCK_TABLE_NAME!
const PRODUCT_COUNT = 10

interface Product {
    id: string
    title: string
    description: string
    price: number
}

interface Stock {
    product_id: string
    count: number
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function generateProduct(): Product {
    return {
        id: faker.string.uuid(),
        title: faker.commerce.productName(),
        description: faker.commerce.productDescription(),
        price: Number(faker.commerce.price({ min: 100, max: 99900, dec: 0 })),
    }
}

function generateStock(product_id: string): Stock {
    return {
        product_id,
        count: faker.number.int({ min: 0, max: 200 }),
    }
}

/**
 * Wipe all existing items from a table before re-seeding,
 * so repeated deploys don't accumulate duplicate data.
 */
async function clearTable(tableName: string, pkName: string) {
    const { Items = [] } = await db.send(new ScanCommand({ TableName: tableName }))
    for (const item of Items) {
        const parsed = unmarshall(item)
        await db.send(
            new DeleteItemCommand({
                TableName: tableName,
                Key: marshall({ [pkName]: parsed[pkName] }),
            })
        )
    }
}

/** BatchWriteItem supports max 25 items per call. */
async function batchWrite<T extends Record<string, any>>(tableName: string, items: T[]) {
    const CHUNK_SIZE = 25
    for (let i = 0; i < items.length; i += CHUNK_SIZE) {
        const chunk = items.slice(i, i + CHUNK_SIZE)
        await db.send(
            new BatchWriteItemCommand({
                RequestItems: {
                    [tableName]: chunk.map((item) => ({
                        PutRequest: { Item: marshall(item) },
                    })),
                },
            })
        )
    }
}

// ─── Lambda handler (called by CDK Trigger) ───────────────────────────────────
export async function handler() {
    console.log('🌱  Seeding tables…')

    // Clear existing data so re-deploys stay idempotent
    console.log('🗑️   Clearing existing items…')
    await clearTable(PRODUCTS_TABLE, 'id')
    await clearTable(STOCK_TABLE, 'product_id')

    // Generate & insert fresh data
    const products = Array.from({ length: PRODUCT_COUNT }, generateProduct)
    const stocks = products.map((p) => generateStock(p.id))

    console.log(`📦  Inserting ${products.length} products…`)
    await batchWrite(PRODUCTS_TABLE, products)

    console.log(`📊  Inserting ${stocks.length} stock entries…`)
    await batchWrite(STOCK_TABLE, stocks)

    console.log('✅  Seed complete.')

    // Return value is logged by CDK Trigger — handy for quick confirmation
    return {
        seededProducts: products.map((p) => ({ id: p.id, title: p.title })),
        seededStocks: stocks.map((s) => ({ product_id: s.product_id, count: s.count })),
    }
}