import { SQSEvent, SQSRecord } from "aws-lambda";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand } from "@aws-sdk/lib-dynamodb";
import { SNSClient, PublishCommand } from "@aws-sdk/client-sns";
import { randomUUID } from "crypto";

const dynamoClient = new DynamoDBClient({ region: process.env.AWS_REGION });
const docClient = DynamoDBDocumentClient.from(dynamoClient);
const snsClient = new SNSClient({ region: process.env.AWS_REGION });

interface Product {
    id: string;
    title: string;
    description: string;
    price: number;
    count: number;
}

const parseRecord = (record: SQSRecord): Omit<Product, "id"> => {
    const body = JSON.parse(record.body);

    if (!body.title || body.price === undefined) {
        throw new Error(
            `Invalid product record — missing required fields: ${record.body}`
        );
    }

    return {
        title: body.title,
        description: body.description ?? "",
        price: Number(body.price),
        count: Number(body.count ?? 0),
    };
};

const createProduct = async (product: Product): Promise<void> => {
    const { id, count, ...productData } = product;

    // Write product and stock as separate items (common pattern for split tables)
    await docClient.send(
        new PutCommand({
            TableName: process.env.PRODUCTS_TABLE_NAME,
            Item: { id, ...productData },
        })
    );

    await docClient.send(
        new PutCommand({
            TableName: process.env.STOCKS_TABLE_NAME,
            Item: { product_id: id, count },
        })
    );
};

const publishToSns = async (products: Product[]): Promise<void> => {
    const topicArn = process.env.CREATE_PRODUCT_TOPIC_ARN;
    if (!topicArn) {
        console.warn("CREATE_PRODUCT_TOPIC_ARN not set — skipping SNS publish");
        return;
    }

    await snsClient.send(
        new PublishCommand({
            TopicArn: topicArn,
            Subject: `Products created: ${products.length} new item(s)`,
            Message: JSON.stringify({
                message: `Successfully created ${products.length} product(s)`,
                products,
            }),
            // Filter policy attributes — lets email subscribers filter by price range etc.
            MessageAttributes: {
                productCount: {
                    DataType: "Number",
                    StringValue: String(products.length),
                },
            },
        })
    );
};

export const handler = async (event: SQSEvent): Promise<void> => {
    console.log(
        `catalogBatchProcess triggered with ${event.Records.length} records`
    );

    const createdProducts: Product[] = [];
    const errors: string[] = [];

    for (const record of event.Records) {
        try {
            const productData = parseRecord(record);
            const product: Product = { id: randomUUID(), ...productData };

            await createProduct(product);
            createdProducts.push(product);

            console.log(`Created product: ${JSON.stringify(product)}`);
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            console.error(`Failed to process SQS record: ${message}`, record.body);
            errors.push(message);
        }
    }

    if (createdProducts.length > 0) {
        await publishToSns(createdProducts);
    }

    // Surface errors after processing all records so we don't short-circuit the batch
    if (errors.length > 0) {
        throw new Error(
            `catalogBatchProcess completed with ${errors.length} error(s): ${errors.join(" | ")}`
        );
    }

    console.log(
        `catalogBatchProcess finished — ${createdProducts.length} product(s) created`
    );
};