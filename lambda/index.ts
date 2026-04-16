import { Hono } from 'hono'
import { handle } from 'hono/aws-lambda'
import { products } from '../lib/faker'

const app = new Hono()

app.get('/', (c) => c.text('Hello Hono!'))
//Products lambda
app.get('/products', (c) => c.json(products, 200))
app.get('/products/:uuid', (c) => {
    const uuid = c.req.param('uuid')
    const product = products.find((product) => product.uuid === uuid)
    if (product) return c.json(product, 200)
    return c.json({
        error: `product not found`
    }, 400)
}
)
export const handler = handle(app)