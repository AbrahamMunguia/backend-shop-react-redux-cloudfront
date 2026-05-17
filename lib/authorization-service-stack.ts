import * as cdk from 'aws-cdk-lib'
import { Construct } from 'constructs'
import * as lambda from 'aws-cdk-lib/aws-lambda'
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs'
import * as cognito from 'aws-cdk-lib/aws-cognito'

export class AuthorizationServiceStack extends cdk.Stack {
    public readonly basicAuthorizerFn: lambda.IFunction
    public readonly userPool: cognito.IUserPool
    public readonly userPoolClient: cognito.IUserPoolClient

    constructor(scope: Construct, id: string, props?: cdk.StackProps) {
        super(scope, id, props)

        // ─── basicAuthorizer Lambda ───────────────────────────────────────────────

        const basicAuthorizer = new NodejsFunction(this, 'BasicAuthorizer', {
            functionName: 'basicAuthorizer',
            runtime: lambda.Runtime.NODEJS_22_X,
            memorySize: 512,
            timeout: cdk.Duration.seconds(10),
            entry: 'lambda/basicAuthorizer.ts',
            handler: 'handler',
            environment: {
                // Format: CREDENTIALS_<username>=<password>
                // Add more users by adding more env vars following the same pattern
                [`CREDENTIALS_${process.env.AUTH_USERNAME ?? 'cesarmunguia'}`]:
                    process.env.AUTH_PASSWORD ?? 'TEST_PASSWORD',
            },
        })

        this.basicAuthorizerFn = basicAuthorizer

        // ─── Cognito User Pool ────────────────────────────────────────────────────

        const userPool = new cognito.UserPool(this, 'ShopUserPool', {
            userPoolName: 'shop-user-pool',

            // Allow users to sign up themselves
            selfSignUpEnabled: true,

            // What attributes are required at sign-up
            standardAttributes: {
                email: { required: true, mutable: true },
            },

            // Auto-verify email so users don't need an admin to confirm them
            autoVerify: { email: true },

            // Sign in with email instead of a generated username
            signInAliases: { email: true },

            passwordPolicy: {
                minLength: 8,
                requireLowercase: true,
                requireUppercase: true,
                requireDigits: true,
                requireSymbols: false,
            },

            // Email users when their account is created or password resets
            accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,

            // Clean up on cdk destroy — set to RETAIN in production
            removalPolicy: cdk.RemovalPolicy.DESTROY,
        })

        // ─── User Pool Client ─────────────────────────────────────────────────────
        //
        // The client is what the frontend uses to authenticate.
        // No client secret — this is a public SPA client (Next.js frontend).

        const userPoolClient = userPool.addClient('ShopUserPoolClient', {
            userPoolClientName: 'shop-user-pool-client',

            // No secret — public client used from the browser
            generateSecret: false,

            authFlows: {
                // USER_PASSWORD_AUTH — simple email/password login
                userPassword: true,
                // USER_SRP_AUTH — more secure, use this in production
                userSrp: true,
            },

            // Token validity windows
            accessTokenValidity: cdk.Duration.hours(1),
            idTokenValidity: cdk.Duration.hours(1),
            refreshTokenValidity: cdk.Duration.days(30),

            preventUserExistenceErrors: true,
        })

        this.userPool = userPool
        this.userPoolClient = userPoolClient

        // ─── Cognito Domain ───────────────────────────────────────────────────────
        //
        // Cognito domain prefixes must be globally unique across all AWS accounts.
        // We include the account ID to avoid collisions.
        // Hosted UI: https://shop-auth-<account>.auth.<region>.amazoncognito.com

        const userPoolDomain = userPool.addDomain('ShopUserPoolDomain', {
            cognitoDomain: {
                domainPrefix: `shop-auth-${this.account}`,
            },
        })

        // ─── Outputs ──────────────────────────────────────────────────────────────

        new cdk.CfnOutput(this, 'BasicAuthorizerArn', {
            value: basicAuthorizer.functionArn,
            exportName: 'BasicAuthorizerArn',
        })

        new cdk.CfnOutput(this, 'UserPoolId', {
            value: userPool.userPoolId,
            exportName: 'ShopUserPoolId',
            description: 'Cognito User Pool ID — needed for frontend config',
        })

        new cdk.CfnOutput(this, 'UserPoolClientId', {
            value: userPoolClient.userPoolClientId,
            exportName: 'ShopUserPoolClientId',
            description: 'Cognito User Pool Client ID — needed for frontend config',
        })

        new cdk.CfnOutput(this, 'UserPoolArn', {
            value: userPool.userPoolArn,
            exportName: 'ShopUserPoolArn',
        })

        new cdk.CfnOutput(this, 'UserPoolDomainUrl', {
            value: `https://${userPoolDomain.domainName}.auth.${this.region}.amazoncognito.com`,
            exportName: 'ShopUserPoolDomainUrl',
            description: 'Cognito Hosted UI base URL — use for OAuth2 login/token endpoints',
        })
    }
}