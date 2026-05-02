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
app.post('/import', async (c) => {
    try {
        const fileName = c.req.query('name')

        if (!fileName || !fileName.trim()) {
            return c.json({ message: "Query parameter 'name' is required." }, 400)
        }

        if (!fileName.endsWith('.csv')) {
            return c.json({ message: "Only .csv files are accepted." }, 400)
        }

        const contentType = c.req.header('content-type') ?? ''

        let fileBuffer: Buffer

        if (contentType.includes('multipart/form-data')) {
            // multipart/form-data — field must be named "file"
            const formData = await c.req.formData()
            const file = formData.get('file')

            if (!file || typeof file === 'string') {
                return c.json({ message: "Form field 'file' is missing or not a file." }, 400)
            }

            fileBuffer = Buffer.from(await (file as File).arrayBuffer())
        } else {
            // Raw body upload — Content-Type: text/csv
            fileBuffer = Buffer.from(await c.req.arrayBuffer())
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
        console.error('POST /import failed:', err)
        return c.json({ message: 'Failed to upload file', error: (err as Error).message }, 500)
    }
})
export const handler = handle(app)