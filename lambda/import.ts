import { Hono } from 'hono'
import { handle } from 'hono/aws-lambda'
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { cors } from 'hono/cors'

const s3 = new S3Client({})

const BUCKET = process.env.IMPORT_BUCKET_NAME
const SIGNED_URL_EXPIRES_IN = 300 // seconds (5 minutes)

// ─── Cold-start guard ─────────────────────────────────────────────────────────
if (!BUCKET) {
    throw new Error('Missing required env var: IMPORT_BUCKET_NAME')
}

const app = new Hono()

// ─── CORS middleware ──────────────────────────────────────────────────────────
// API Gateway handles OPTIONS preflight, but every real response also needs
// the header or the browser will block it.
app.use('*', async (c, next) => {
    await next()
    c.res.headers.set('Access-Control-Allow-Origin', '*')
    c.res.headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
    c.res.headers.set('Access-Control-Allow-Headers', 'Content-Type')
    c.res.headers.set('Access-Control-Allow-Credentials', 'true')
})
app.use('*', cors({
    origin: ['*'],
    allowMethods: ['GET', 'POST', 'OPTIONS'],
    allowHeaders: ['*'],
    credentials: true,
}))
// ─── GET /import?name={fileName} ─────────────────────────────────────────────
app.get('/import', async (c) => {
    try {
        const fileName = c.req.query('name')

        if (!fileName?.trim()) {
            return c.json({ message: "Query parameter 'name' is required." }, 400)
        }

        if (!fileName.endsWith('.csv')) {
            return c.json({ message: "Only .csv files are accepted." }, 400)
        }

        const key = `uploaded/${fileName}`

        console.log(`Generating signed URL | bucket: ${BUCKET} | key: ${key}`)

        const signedUrl = await getSignedUrl(
            s3,
            new PutObjectCommand({ Bucket: BUCKET, Key: key, ContentType: 'text/csv' }),
            { expiresIn: SIGNED_URL_EXPIRES_IN }
        )

        console.log(`Signed URL generated for key: ${key}`)

        return c.json({ url: signedUrl }, 200)
    } catch (err) {
        const message = (err as Error).message
        console.error('GET /import failed:', err)
        return c.json({ message: 'Failed to generate signed URL', error: message }, 500)
    }
})

// ─── POST /import?name={fileName} ────────────────────────────────────────────
app.post('/import', async (c) => {
    try {
        const fileName = c.req.query('name')

        if (!fileName?.trim()) {
            return c.json({ message: "Query parameter 'name' is required." }, 400)
        }

        if (!fileName.endsWith('.csv')) {
            return c.json({ message: "Only .csv files are accepted." }, 400)
        }

        const contentType = c.req.header('content-type') ?? ''
        let fileBuffer: Buffer

        if (contentType.includes('multipart/form-data')) {
            let formData: FormData
            try {
                formData = await c.req.formData()
            } catch (err) {
                console.error('Failed to parse multipart form data:', err)
                return c.json({ message: 'Invalid multipart form data.', error: (err as Error).message }, 400)
            }

            const file = formData.get('file')
            if (!file || typeof file === 'string') {
                return c.json({ message: "Form field 'file' is missing or not a file." }, 400)
            }

            fileBuffer = Buffer.from(await (file as File).arrayBuffer())
        } else {
            try {
                fileBuffer = Buffer.from(await c.req.arrayBuffer())
            } catch (err) {
                console.error('Failed to read request body:', err)
                return c.json({ message: 'Failed to read request body.', error: (err as Error).message }, 400)
            }
        }

        if (fileBuffer.length === 0) {
            return c.json({ message: 'File is empty.' }, 400)
        }

        const key = `uploaded/${fileName}`

        console.log(`Uploading file | bucket: ${BUCKET} | key: ${key} | size: ${fileBuffer.length} bytes`)

        await s3.send(
            new PutObjectCommand({
                Bucket: BUCKET,
                Key: key,
                Body: fileBuffer,
                ContentType: 'text/csv',
            })
        )

        console.log(`File uploaded successfully: ${key}`)

        return c.json({ message: 'File uploaded successfully.', key }, 201)
    } catch (err) {
        const message = (err as Error).message
        console.error('POST /import failed:', err)
        return c.json({ message: 'Failed to upload file', error: message }, 500)
    }
})

export const handler = handle(app)