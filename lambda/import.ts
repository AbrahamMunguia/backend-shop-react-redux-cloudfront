import { Hono } from 'hono'
import { handle } from 'hono/aws-lambda'
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { cors } from 'hono/cors'

const app = new Hono()
const s3 = new S3Client({})

const BUCKET = process.env.IMPORT_BUCKET_NAME!
const SIGNED_URL_EXPIRES_IN = 300 // seconds (5 minutes)

app.use('*', cors({
    origin: ['https://d1jkai40iwonc0.cloudfront.net', 'http://localhost:3000'],
    allowMethods: ['GET', 'POST', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization'],
}))
app.get('/import', async (c) => {
    try {
        const fileName = c.req.query('name')

        if (!fileName || !fileName.trim()) {
            return c.json({ message: "Query parameter 'name' is required." }, 400)
        }

        if (!fileName.endsWith('.csv')) {
            return c.json({ message: "Only .csv files are accepted." }, 400)
        }

        const key = `uploaded/${fileName}`

        console.log(`Generating signed URL | bucket: ${BUCKET} | key: ${key}`)

        const command = new PutObjectCommand({
            Bucket: BUCKET,
            Key: key,
            ContentType: 'text/csv',
        })

        const signedUrl = await getSignedUrl(s3, command, {
            expiresIn: SIGNED_URL_EXPIRES_IN,
        })

        console.log(`Signed URL generated for key: ${key}`)

        return c.json({ url: signedUrl }, 200)
    } catch (err) {
        console.error('GET /import failed:', err)
        return c.json({ message: 'Failed to generate signed URL', error: (err as Error).message }, 500)
    }
})

export const handler = handle(app)