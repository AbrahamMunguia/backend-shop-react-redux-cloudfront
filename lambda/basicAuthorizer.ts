import {
    APIGatewayAuthorizerResult,
    APIGatewayTokenAuthorizerEvent,
    PolicyDocument,
} from "aws-lambda";

const generatePolicy = (
    principalId: string,
    effect: "Allow" | "Deny",
    resource: string
): APIGatewayAuthorizerResult => {
    const policyDocument: PolicyDocument = {
        Version: "2012-10-17",
        Statement: [
            {
                Action: "execute-api:Invoke",
                Effect: effect,
                Resource: resource,
            },
        ],
    };

    return {
        principalId,
        policyDocument,
    };
};

export const handler = async (
    event: APIGatewayTokenAuthorizerEvent
): Promise<APIGatewayAuthorizerResult> => {
    const { authorizationToken, methodArn } = event;

    // 401 — no Authorization header provided
    if (!authorizationToken) {
        throw new Error("Unauthorized");  // API Gateway maps this to 401
    }

    try {
        // Token arrives as "Basic <base64encoded>"
        const [scheme, encoded] = authorizationToken.split(" ");

        if (scheme !== "Basic" || !encoded) {
            throw new Error("Unauthorized");
        }

        const decoded = Buffer.from(encoded, "base64").toString("utf-8");
        const [username, password] = decoded.split(":");

        if (!username || !password) {
            throw new Error("Unauthorized");
        }

        // Credentials are stored as USERNAME=password in lambda env vars
        // e.g. CREDENTIALS_john=secret123
        const envKey = `CREDENTIALS_${username}`;
        const expectedPassword = process.env[envKey];

        if (!expectedPassword) {
            console.warn(`basicAuthorizer: unknown user "${username}"`);
            return generatePolicy(username, "Deny", methodArn);  // 403
        }

        if (expectedPassword !== password) {
            console.warn(`basicAuthorizer: wrong password for user "${username}"`);
            return generatePolicy(username, "Deny", methodArn);  // 403
        }

        console.log(`basicAuthorizer: access granted for user "${username}"`);
        return generatePolicy(username, "Allow", methodArn);

    } catch (err) {
        // Any decode/parse failure → 401
        throw new Error("Unauthorized");
    }
};