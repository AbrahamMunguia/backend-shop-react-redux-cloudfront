import { S3Event } from "aws-lambda";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { SQSClient, SendMessageCommand } from "@aws-sdk/client-sqs";
import { Readable } from "stream";
import csv from "csv-parser";

const s3Client = new S3Client({ region: process.env.AWS_REGION });
const sqsClient = new SQSClient({ region: process.env.AWS_REGION });

const QUEUE_URL = process.env.CATALOG_ITEMS_QUEUE_URL;

const sendToSqs = async (record: Record<string, string>): Promise<void> => {
    if (!QUEUE_URL) {
        throw new Error("CATALOG_ITEMS_QUEUE_URL environment variable is not set");
    }

    await sqsClient.send(
        new SendMessageCommand({
            QueueUrl: QUEUE_URL,
            MessageBody: JSON.stringify(record),
            // Group by filename for FIFO queues — safe to leave on standard queues too
            MessageGroupId: undefined,
        })
    );
};

const parseAndSendCsv = (stream: Readable): Promise<number> => {
    return new Promise((resolve, reject) => {
        let sentCount = 0;
        const pendingSends: Promise<void>[] = [];

        stream
            .pipe(csv())
            .on("data", (record: Record<string, string>) => {
                // Task 6.2: send each record to SQS — no more console.log of entries
                const sendPromise = sendToSqs(record)
                    .then(() => {
                        sentCount++;
                    })
                    .catch((err) => {
                        console.error(
                            `Failed to send record to SQS: ${JSON.stringify(record)}`,
                            err
                        );
                        // Re-throw so the outer promise rejects on any failure
                        throw err;
                    });

                pendingSends.push(sendPromise);
            })
            .on("error", (err) => {
                reject(err);
            })
            .on("end", () => {
                // Wait for all in-flight SQS sends before resolving
                Promise.all(pendingSends).then(() => resolve(sentCount)).catch(reject);
            });
    });
};

export const handler = async (event: S3Event): Promise<void> => {
    for (const record of event.Records) {
        const bucket = record.s3.bucket.name;
        const key = decodeURIComponent(record.s3.object.key.replace(/\+/g, " "));

        console.log(`Processing file: s3://${bucket}/${key}`);

        const s3Response = await s3Client.send(
            new GetObjectCommand({ Bucket: bucket, Key: key })
        );

        if (!s3Response.Body) {
            console.error(`Empty body for s3://${bucket}/${key} — skipping`);
            continue;
        }

        const stream = s3Response.Body as Readable;
        const sentCount = await parseAndSendCsv(stream);

        // Task 6.2: only log summary metadata, not individual CSV records
        console.log(
            `importFileParser: sent ${sentCount} record(s) to SQS from s3://${bucket}/${key}`
        );
    }
};