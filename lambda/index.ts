import { Hono } from 'hono'
import { handle } from 'hono/aws-lambda'
import { products } from '../lib/faker'

const app = new Hono()

app.get('/', (c) => c.text('Hello Hono!'))
app.get('/products', (c) => c.json(products, 200))
export const handler = handle(app)