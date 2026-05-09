import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3'
import { S3Event } from 'aws-lambda'
import { Readable } from 'stream'
import csv from 'csv-parser'

const s3 = new S3Client({})

// ─── Handler ──────────────────────────────────────────────────────────────────
// Triggered by s3:ObjectCreated:* on the uploaded/ prefix.
// Streams the CSV from S3, parses it row by row, and logs each record.
export async function handler(event: S3Event): Promise<void> {
    for (const record of event.Records) {
        const bucket = record.s3.bucket.name
        const key = decodeURIComponent(record.s3.object.key.replace(/\+/g, ' '))

        console.log(`Processing file | bucket: ${bucket} | key: ${key}`)

        try {
            const { Body } = await s3.send(
                new GetObjectCommand({ Bucket: bucket, Key: key })
            )

            if (!Body) {
                console.warn(`Empty body received for key: ${key}`)
                continue
            }

            await parseCSVStream(Body as Readable, key)
        } catch (err) {
            console.error(`Failed to process file ${key}:`, err)
            throw err // rethrow so Lambda marks the invocation as failed
        }
    }
}

// ─── Stream parser ────────────────────────────────────────────────────────────

function parseCSVStream(stream: Readable, key: string): Promise<void> {
    return new Promise((resolve, reject) => {
        let rowCount = 0

        stream
            .pipe(csv())
            .on('data', (row: Record<string, string>) => {
                rowCount++
                console.log(`[${key}] Row ${rowCount}:`, JSON.stringify(row))
            })
            .on('end', () => {
                console.log(`[${key}] Finished parsing. Total rows: ${rowCount}`)
                resolve()
            })
            .on('error', (err) => {
                console.error(`[${key}] CSV parse error:`, err)
                reject(err)
            })
    })
}