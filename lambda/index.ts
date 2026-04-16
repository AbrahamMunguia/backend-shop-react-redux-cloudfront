import { Hono } from 'hono'
import { handle } from 'hono/aws-lambda'
import { products } from '../lib/faker'
import { cors } from 'hono/cors'

const app = new Hono()
app.use('*', cors({
    origin: 'http://localhost:3000',
    allowMethods: ['GET', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization'],
}))
app.get('/', (c) => c.text('Hello Hono!'))
//Products lambda
app.get('/products', (c) => c.json(products, 200))
app.get('/products/:uuid', (c) => {
    const uuid = c.req.param('uuid')
    const product = products.find((product) => product.id === uuid)
    if (product) return c.json(product, 200)
    return c.json({
        error: `product not found`
    }, 400)
}
)
export const handler = handle(app)